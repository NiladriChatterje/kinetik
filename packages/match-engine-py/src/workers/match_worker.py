"""
Match worker — processes match jobs from the Celery queue.

Handles:
- 'find_match' : Single user match against pool
- 'batch_process' : Process all users in an H3 cell
"""

import json
import logging
import os
import random
import time
from typing import Optional
from uuid import uuid4

import asyncpg

# ─── Celery app (lazy initialised) ──────────────────────────────
from celery import Celery

from ..config import settings
from ..matchers.spatial import SpatialMatcher
from ..matchers.vector import VectorMatcher, UserProfileVector
from ..services.redis_client import RedisClient
from ..services.window_manager import WindowManager
from ..services.kafka_client import KafkaTopics

logger = logging.getLogger(__name__)

# Celery broker/backend — both use Redis
celery_app = Celery(
    "kinetik_match_worker",
    broker=f"redis://:{settings.redis_password or ''}@{settings.redis_host}:{settings.redis_port}/1",
    backend=f"redis://:{settings.redis_password or ''}@{settings.redis_host}:{settings.redis_port}/2",
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
)


def get_services():
    """Lazy-init and cache service instances (Celery worker may fork).

    Note: Assumes --pool=solo or prefork (connections are created once per process).
    For production with multiple workers, each child process creates its own pool.
    """
    if not hasattr(get_services, "_redis"):
        redis = RedisClient()
        import asyncio
        asyncio.run(redis.connect())
        setattr(get_services, "_redis", redis)

    if not hasattr(get_services, "_pg_pool"):
        import asyncio
        pool = asyncio.run(asyncpg.create_pool(
            settings.database_url,
            min_size=2,
            max_size=10,
        ))
        setattr(get_services, "_pg_pool", pool)

    if not hasattr(get_services, "_spatial"):
        setattr(get_services, "_spatial", SpatialMatcher(get_services._redis, get_services._pg_pool))

    if not hasattr(get_services, "_vector"):
        setattr(get_services, "_vector", VectorMatcher())

    if not hasattr(get_services, "_window"):
        setattr(get_services, "_window", WindowManager(get_services._redis, get_services._pg_pool))

    # Kafka producer is optional — we import inside to handle missing deps
    if not hasattr(get_services, "_kafka"):
        from ..services.kafka_client import KafkaClient
        kafka = KafkaClient()
        import asyncio
        try:
            asyncio.run(kafka.connect())
        except Exception as exc:
            logger.warning("Kafka init failed (events will be logged only): %s", exc)
        setattr(get_services, "_kafka", kafka)

    return (
        get_services._redis,
        get_services._pg_pool,
        get_services._spatial,
        get_services._vector,
        get_services._window,
        get_services._kafka,
    )


# ─── Celery Tasks ───────────────────────────────────────────────

@celery_app.task(bind=True, max_retries=3, default_retry_delay=1)
def find_match(self, user_id: str, window_id: str):
    """Find a single match for a user within the active window."""
    import asyncio

    redis, pool, spatial, vector, window, kafka = get_services()
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        loop.run_until_complete(
            _find_single_match(redis, pool, spatial, vector, window, kafka, user_id, window_id)
        )
    except Exception as exc:
        logger.error("find_match failed for user %s: %s", user_id, exc)
        raise self.retry(exc=exc)
    finally:
        loop.close()


@celery_app.task(bind=True, max_retries=1)
def batch_process(self, h3_index: str, window_id: str):
    """Process all users in a given H3 cell."""
    import asyncio

    redis, pool, spatial, vector, window, kafka = get_services()
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        loop.run_until_complete(
            _batch_find_matches(redis, pool, spatial, vector, window, kafka, h3_index, window_id)
        )
    except Exception as exc:
        logger.error("batch_process failed for %s: %s", h3_index, exc)
        raise self.retry(exc=exc)
    finally:
        loop.close()


# ─── Async logic ────────────────────────────────────────────────

async def _find_single_match(
    redis: RedisClient,
    pool: asyncpg.Pool,
    spatial: SpatialMatcher,
    vector: VectorMatcher,
    window: WindowManager,
    kafka,
    user_id: str,
    window_id: str,
):
    # 1. Skip if user is already in a vibe check
    if await redis.get_vibe_check(user_id):
        return

    # 2. Skip if already being matched
    if await redis.is_match_in_progress(user_id):
        return

    # 3. Mark matching in progress
    await redis.set_match_in_progress(user_id)

    try:
        # 4. Get user's H3 location
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT h3_index, latitude, longitude FROM users WHERE id = $1",
                user_id,
            )
            if not row or not row["h3_index"]:
                return

            h3_index = row["h3_index"]

        # 5. Get nearby active users
        nearby = await spatial.get_nearby_users(h3_index, window_id, user_id)
        if not nearby:
            return

        # 6. Get user's preference vector
        async with pool.acquire() as conn:
            prefs = await conn.fetchrow(
                """SELECT uv.vector, up.weight_values, up.weight_age, up.weight_distance,
                          up.weight_interests, up.age_min, up.age_max, up.max_distance_km,
                          up.values_ambition, up.values_social, up.values_adventure,
                          up.values_tradition, up.values_intellect, up.values_emotional
                   FROM user_vectors uv
                   LEFT JOIN user_preferences up ON up.user_id = $1
                   WHERE uv.user_id = $1""",
                user_id,
            )
            if not prefs or not prefs["vector"]:
                return

        user_profile = UserProfileVector(
            vector=prefs["vector"],
            weight_values=float(prefs["weight_values"] or 0.3),
            weight_age=float(prefs["weight_age"] or 0.15),
            weight_distance=float(prefs["weight_distance"] or 0.15),
            weight_interests=float(prefs["weight_interests"] or 0.2),
            age_min=int(prefs["age_min"] or 18),
            age_max=int(prefs["age_max"] or 60),
            max_distance_km=float(prefs["max_distance_km"] or 50),
            values_ambition=float(prefs["values_ambition"] or 0.5),
            values_social=float(prefs["values_social"] or 0.5),
            values_adventure=float(prefs["values_adventure"] or 0.5),
            values_tradition=float(prefs["values_tradition"] or 0.5),
            values_intellect=float(prefs["values_intellect"] or 0.5),
            values_emotional=float(prefs["values_emotional"] or 0.5),
        )

        # 7. Run NCF / vector matching
        best = await vector.find_best_match(user_profile, nearby)
        if not best:
            return

        # 8. Create vibe check session
        vibe_id = str(uuid4())
        async with pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO vibe_checks (id, window_id, user_a_id, user_b_id, status, started_at, call_duration_seconds)
                   VALUES ($1, $2, $3, $4, 'pending', NOW(), 180)""",
                vibe_id, window_id, user_id, best.user_id,
            )

        # 9. Emit match.found event via Kafka
        match_payload = {
            "type": "match.found",
            "payload": {
                "vibeId": vibe_id,
                "userAId": user_id,
                "userBId": best.user_id,
                "windowId": window_id,
                "similarity": best.similarity,
                "confidence": best.confidence,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
            },
        }
        try:
            await kafka.send_event(KafkaTopics.MATCH_EVENTS, "match.found", match_payload)
        except Exception as exc:
            logger.error("Failed to send match event to Kafka: %s", exc)

        # 10. Clean up — remove matched users from pool and set vibe check
        await redis.srem(f"match:pool:{window_id}", user_id, best.user_id)
        await redis.set_vibe_check(user_id, vibe_id)
        await redis.set_vibe_check(best.user_id, vibe_id)

        logger.info("Match found — %s <-> %s (vibe=%s, sim=%.3f)", user_id, best.user_id, vibe_id, best.similarity)

    finally:
        await redis.clear_match_in_progress(user_id)


async def _batch_find_matches(
    redis: RedisClient,
    pool: asyncpg.Pool,
    spatial: SpatialMatcher,
    vector: VectorMatcher,
    window: WindowManager,
    kafka,
    h3_index: str,
    window_id: str,
):
    """Queue self-contained find_match tasks for all users in the match pool."""
    members = await redis.smembers(f"match:pool:{window_id}")
    shuffled = sorted(members, key=lambda _: random.random())

    for user_id in shuffled:
        # Fire-and-forget via Celery with a small stagger delay
        find_match.apply_async(
            args=[user_id, window_id],
            countdown=random.randint(1, 5),
        )

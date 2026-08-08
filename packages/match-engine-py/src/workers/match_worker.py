"""
Match worker — processes match jobs from the Celery queue.

Handles:
- 'find_match' : Single user match against pool
- 'batch_process' : Process all users in an H3 cell

Matching is purely spatial — a match is chosen at random from the
nearby (H3) user pool. No ML scoring.
"""

import logging
import random
import time
from uuid import uuid4

import asyncpg

# ─── Celery app (lazy initialised) ──────────────────────────────
from celery import Celery

from ..config import settings
from ..matchers.spatial import SpatialMatcher
from ..services.redis_client import RedisClient
from ..services.window_manager import WindowManager
from ..services.event_bus import EventBusChannels

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

    if not hasattr(get_services, "_window"):
        setattr(get_services, "_window", WindowManager(get_services._redis, get_services._pg_pool))

    # Event bus producer is optional — we import inside to handle missing deps
    if not hasattr(get_services, "_event_bus"):
        from ..services.event_bus import EventBusClient
        eb = EventBusClient()
        import asyncio
        try:
            asyncio.run(eb.connect())
        except Exception as exc:
            logger.warning("Event bus init failed (events will be logged only): %s", exc)
        setattr(get_services, "_event_bus", eb)

    return (
        get_services._redis,
        get_services._pg_pool,
        get_services._spatial,
        get_services._window,
        get_services._event_bus,
    )


# ─── Celery Tasks ───────────────────────────────────────────────

@celery_app.task(bind=True, max_retries=3, default_retry_delay=1)
def find_match(self, user_id: str, window_id: str):
    """Find a single match for a user within the active window."""
    import asyncio

    redis, pool, spatial, window, event_bus = get_services()
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        loop.run_until_complete(
            _find_single_match(redis, pool, spatial, window, event_bus, user_id, window_id)
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

    redis, pool, spatial, window, event_bus = get_services()
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        loop.run_until_complete(
            _batch_find_matches(redis, pool, spatial, window, event_bus, h3_index, window_id)
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
    window: WindowManager,
    event_bus,
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

        # 5. Get nearby active users (spatial H3 search)
        nearby = await spatial.get_nearby_users(h3_index, window_id, user_id)
        if not nearby:
            return

        # 6. Pick a match at random from the nearby pool
        best = random.choice(nearby)

        # 7. Create vibe check session
        vibe_id = str(uuid4())
        async with pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO vibe_checks (id, window_id, user_a_id, user_b_id, status, started_at, call_duration_seconds)
                   VALUES ($1, $2, $3, $4, 'pending', NOW(), 180)""",
                vibe_id, window_id, user_id, best.user_id,
            )

        # 8. Emit match.found event via event bus
        match_payload = {
            "type": "match.found",
            "payload": {
                "vibeId": vibe_id,
                "userAId": user_id,
                "userBId": best.user_id,
                "windowId": window_id,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
            },
        }
        try:
            await event_bus.send_event(EventBusChannels.MATCH_EVENTS, "match.found", match_payload)
        except Exception as exc:
            logger.error("Failed to send match event to event bus: %s", exc)

        # 9. Clean up — remove matched users from pool and set vibe check
        await redis.srem(f"match:pool:{window_id}", user_id, best.user_id)
        await redis.set_vibe_check(user_id, vibe_id)
        await redis.set_vibe_check(best.user_id, vibe_id)

        logger.info("Match found — %s <-> %s (vibe=%s)", user_id, best.user_id, vibe_id)

    finally:
        await redis.clear_match_in_progress(user_id)


async def _batch_find_matches(
    redis: RedisClient,
    pool: asyncpg.Pool,
    spatial: SpatialMatcher,
    window: WindowManager,
    event_bus,
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

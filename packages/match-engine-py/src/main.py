"""
Kinetik Match Engine — Python backend with NCF neural matching.

Entry point that:
  - Starts a FastAPI health-check HTTP server
  - Connects to Redis, PostgreSQL, and Kafka
  - Runs the Kafka event consumer as a background asyncio task
  - Subscribes to Redis `location:updates` channel for real-time location data
  - Detects CUDA availability and logs the device being used
"""

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import asyncpg
import uvicorn
from fastapi import FastAPI

from .config import settings, get_device
from .matchers.spatial import SpatialMatcher
from .matchers.vector import VectorMatcher
from .services.redis_client import RedisClient
from .services.kafka_client import KafkaClient, KafkaTopics
from .services.window_manager import WindowManager

logger = logging.getLogger("kinetik.match_engine")

# ─── Global service references (initialised in lifespan) ────────
redis_client = RedisClient()
pg_pool: asyncpg.Pool | None = None
kafka_client = KafkaClient()
spatial_matcher: SpatialMatcher | None = None
vector_matcher: VectorMatcher | None = None
window_manager: WindowManager | None = None

# Channel name for location updates (must match the constant in shared constants)
LOCATION_UPDATES_CHANNEL = "location:updates"


# ─── Lifespan ───────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle for the FastAPI app."""
    global pg_pool, spatial_matcher, vector_matcher, window_manager

    device = get_device()
    logger.info("=" * 50)
    logger.info("  Kinetik Match Engine")
    logger.info("  Device: %s", device.upper())
    logger.info("=" * 50)

    # 1. Redis
    await redis_client.connect()

    # 2. PostgreSQL
    pg_pool = await asyncpg.create_pool(
        settings.database_url,
        min_size=4,
        max_size=20,
        command_timeout=30,
    )
    logger.info("PostgreSQL pool created")

    # 3. Services
    spatial_matcher = SpatialMatcher(redis_client, pg_pool)
    vector_matcher = VectorMatcher()
    window_manager = WindowManager(redis_client, pg_pool)

    # 4. Subscribe to location updates from api-core via Redis pub/sub
    location_task: asyncio.Task | None = None
    try:
        location_task = asyncio.create_task(_listen_location_updates())
        logger.info("Redis location:updates subscriber started")
    except Exception as exc:
        logger.warning("Failed to start location subscriber: %s", exc)

    # 5. Kafka — run consumer as background task in the same event loop
    kafka_consumer_task: asyncio.Task | None = None
    try:
        await kafka_client.connect()

        async def _handler(topic: str, payload: dict):
            """Dispatch Kafka events to the appropriate service."""
            event_type = payload.get("type", "")

            if topic == KafkaTopics.WINDOW_EVENTS:
                if event_type == "window.activated" and window_manager:
                    await window_manager.activate_window(payload["payload"]["windowId"])
                elif event_type == "window.closed" and window_manager:
                    await window_manager.close_window(payload["payload"]["windowId"])

            elif topic == KafkaTopics.MATCH_EVENTS:
                if event_type == "window.joined" and spatial_matcher:
                    uid = payload["payload"]["userId"]
                    wid = payload["payload"]["windowId"]
                    from .workers.match_worker import find_match
                    find_match.apply_async(args=[uid, wid])

            elif topic == KafkaTopics.USER_EVENTS:
                if event_type in ("preferences.updated", "location.updated"):
                    uid = payload["payload"]["userId"]
                    await redis_client.delete(f"user:{uid}:match_data")

        kafka_consumer_task = asyncio.create_task(
            kafka_client.run_consumer(_handler)
        )
        logger.info("Kafka consumer background task created")
    except Exception as exc:
        logger.warning("Kafka connection failed — event-driven matching disabled: %s", exc)

    yield

    # ── Shutdown ────────────────────────────────────────────────
    logger.info("Shutting down match engine...")
    if location_task is not None:
        location_task.cancel()
        try:
            await location_task
        except asyncio.CancelledError:
            pass
    if kafka_consumer_task is not None:
        kafka_client._running = False
        kafka_consumer_task.cancel()
        try:
            await kafka_consumer_task
        except asyncio.CancelledError:
            pass
    await kafka_client.disconnect()
    if pg_pool:
        await pg_pool.close()
    await redis_client.disconnect()


async def _listen_location_updates():
    """Subscribe to Redis `location:updates` channel and cache location data.

    The api-core publishes location updates every 3 minutes via Geoapify.
    This subscriber caches the latest location data in Redis under
    `user:{userId}:match_data` so the spatial matcher can access it instantly.
    """
    """
    Subscribe to location updates with automatic reconnection.

    If the Redis connection drops, this loop will retry every 5s
    until cancelled.
    """
    while True:
        try:
            pubsub = redis_client.conn.pubsub()
            await pubsub.subscribe(LOCATION_UPDATES_CHANNEL)
            logger.info("Subscribed to %s", LOCATION_UPDATES_CHANNEL)

            try:
                async for message in pubsub.listen():
                    if message["type"] != "message":
                        continue

                    try:
                        data = json.loads(message["data"])
                        user_id = data.get("userId")
                        if not user_id:
                            continue

                        # Cache location data as part of the user's match_data
                        # This is the same key that spatial_matcher uses for lookups
                        match_data = await redis_client.get_user_match_data(user_id) or {}
                        match_data.update({
                            "latitude": data.get("latitude"),
                            "longitude": data.get("longitude"),
                            "h3Index": data.get("h3Index"),
                            "city": data.get("city"),
                            "county": data.get("county"),
                            "region": data.get("region"),
                            "country": data.get("country"),
                            "location_updated_at": data.get("timestamp"),
                        })
                        await redis_client.cache_user_match_data(user_id, match_data, ttl=900)

                        logger.debug(
                            "Cached location for user %s: %s, %s",
                            user_id,
                            data.get("city", "?"),
                            data.get("region", "?"),
                        )
                    except (json.JSONDecodeError, KeyError, TypeError) as exc:
                        logger.warning("Invalid location update message: %s", exc)
            except asyncio.CancelledError:
                logger.info("Location subscriber cancelled")
                raise
            except Exception as exc:
                logger.warning("Location subscriber disconnected: %s — retrying in 5s", exc)
                await asyncio.sleep(5)
            finally:
                try:
                    await pubsub.unsubscribe(LOCATION_UPDATES_CHANNEL)
                except Exception:
                    pass
        except asyncio.CancelledError:
            break


# ─── FastAPI app ────────────────────────────────────────────────

app = FastAPI(
    title="Kinetik Match Engine",
    version="0.1.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
)


@app.get("/health")
async def health():
    """Health-check endpoint (mirrors the TypeScript health server)."""
    cuda_available = False
    cuda_device_count = 0
    try:
        import torch
        cuda_available = torch.cuda.is_available()
        cuda_device_count = torch.cuda.device_count() if cuda_available else 0
    except (ImportError, Exception):
        pass

    return {
        "status": "ok",
        "service": "match-engine",
        "device": get_device(),
        "cuda_available": cuda_available,
        "cuda_device_count": cuda_device_count,
        "ncf_loaded": vector_matcher.ncf._is_loaded if vector_matcher else False,
        "active_windows": window_manager.get_active_window_count() if window_manager else 0,
        "redis_connected": redis_client._conn is not None,
        "kafka_connected": kafka_client._producer is not None if kafka_client else False,
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


# ─── Entry point ────────────────────────────────────────────────

def main():
    """Start the match-engine server.

    Usage:
        python -m src.main
        # or
        MATCH_ENGINE_PORT=3003 python -m src.main
    """
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
    )
    uvicorn.run(
        "src.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.environment == "development",
        log_level="info",
    )


if __name__ == "__main__":
    main()

"""
Window manager — handles flash window activation / deactivation and
participant queue management for the match engine.
"""

import logging
import time
from typing import Optional

import asyncpg

from ..config import settings
from .redis_client import RedisClient

logger = logging.getLogger(__name__)


class WindowManager:
    """Manages flash window lifecycle and participant H3 queues.

    Mirrors the TypeScript WindowManager but uses asyncpg for DB queries
    and the RedisClient for cache operations.
    """

    def __init__(self, redis: RedisClient, pg_pool: asyncpg.Pool):
        self._redis = redis
        self._pg = pg_pool
        self._active_windows: dict[str, dict] = {}

    # ── Activation ──────────────────────────────────────────────

    async def activate_window(self, window_id: str) -> None:
        """Activate a flash window — move participants into the Redis match pool."""
        # Update window status in DB
        async with self._pg.acquire() as conn:
            await conn.execute(
                "UPDATE flash_windows SET status = 'active' WHERE id = $1",
                window_id,
            )

            # Fetch all active participants
            rows = await conn.fetch(
                "SELECT user_id FROM window_participants WHERE window_id = $1 AND is_active = TRUE",
                window_id,
            )

        participant_ids = [row["user_id"] for row in rows]

        if participant_ids:
            # Add all participants to the Redis match pool
            pool_key = f"match:pool:{window_id}"
            await self._redis.sadd(pool_key, *participant_ids)
            await self._redis.expire(pool_key, 3600)

            # Add to individual H3 queues
            for uid in participant_ids:
                h3_row = await self._pg.fetchrow(
                    "SELECT h3_index FROM users WHERE id = $1",
                    uid,
                )
                if h3_row and h3_row["h3_index"]:
                    await self._redis.sadd(f"h3:queue:{h3_row['h3_index']}", uid)

        # Track active window
        now = time.time() * 1000
        self._active_windows[window_id] = {
            "id": window_id,
            "started_at": now,
            "expires_at": now + settings.window_duration_minutes * 60 * 1000,
        }

        logger.info(
            "Activated window %s with %d participants",
            window_id, len(participant_ids),
        )

    # ── Close ───────────────────────────────────────────────────

    async def close_window(self, window_id: str) -> None:
        """Close a flash window — clean up queues and DB status."""
        async with self._pg.acquire() as conn:
            await conn.execute(
                "UPDATE flash_windows SET status = 'closed' WHERE id = $1",
                window_id,
            )

        # Clean up Redis keys
        await self._redis.delete(
            f"match:pool:{window_id}",
            f"window:participants:{window_id}",
            f"window:state:{window_id}",
        )

        self._active_windows.pop(window_id, None)
        logger.info("Closed window %s", window_id)

    # ── Status ──────────────────────────────────────────────────

    def get_active_window_count(self) -> int:
        return len(self._active_windows)

    def is_window_active(self, window_id: str) -> bool:
        return window_id in self._active_windows

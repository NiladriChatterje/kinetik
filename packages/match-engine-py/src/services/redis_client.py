"""
Redis client — wraps redis-py with async connection management
and type-safe helpers for the match-engine data model.
"""

import json
import logging
from typing import Optional

import redis.asyncio as aioredis

from ..config import settings

logger = logging.getLogger(__name__)


class RedisClient:
    """Manages Redis connections for the match engine.

    Provides high-level helpers for H3 queues, match pools, vibe checks,
    and user match-data caching.
    """

    def __init__(self):
        self._conn: Optional[aioredis.Redis] = None

    async def connect(self) -> None:
        """Establish the async Redis connection."""
        self._conn = await aioredis.from_url(
            f"redis://{settings.redis_host}:{settings.redis_port}",
            password=settings.redis_password or None,
            decode_responses=True,
            retry_on_timeout=True,
            socket_keepalive=True,
            health_check_interval=settings.health_check_interval,
        )
        await self._conn.ping()
        logger.info("Redis connected — %s:%d", settings.redis_host, settings.redis_port)

    async def disconnect(self) -> None:
        if self._conn:
            await self._conn.close()
            self._conn = None
            logger.info("Redis disconnected")

    @property
    def conn(self) -> aioredis.Redis:
        if self._conn is None:
            raise RuntimeError("Redis not connected — call connect() first")
        return self._conn

    # ── Low-level passthroughs (delegate to the raw conn) ────────

    async def get(self, key: str) -> Optional[str]:
        return await self.conn.get(key)

    async def set(self, key: str, value: str, ex: int = 0) -> None:
        if ex > 0:
            await self.conn.set(key, value, ex=ex)
        else:
            await self.conn.set(key, value)

    async def delete(self, *keys: str) -> int:
        return await self.conn.delete(*keys)

    async def exists(self, key: str) -> bool:
        return await self.conn.exists(key) > 0

    async def expire(self, key: str, seconds: int) -> bool:
        return await self.conn.expire(key, seconds)

    # ── Set operations ──────────────────────────────────────────

    async def sadd(self, key: str, *members: str) -> int:
        return await self.conn.sadd(key, *members)

    async def srem(self, key: str, *members: str) -> int:
        return await self.conn.srem(key, *members)

    async def smembers(self, key: str) -> set[str]:
        return await self.conn.smembers(key)

    async def scard(self, key: str) -> int:
        return await self.conn.scard(key)

    async def sunion(self, *keys: str) -> set[str]:
        return await self.conn.sunion(*keys)

    # ── Match-engine helpers ────────────────────────────────────

    async def cache_user_match_data(self, user_id: str, data: dict, ttl: int = 900) -> None:
        """Cache a user's match-profile data (vector, location, etc.) for fast lookup."""
        await self.set(f"user:{user_id}:match_data", json.dumps(data), ex=ttl)

    async def get_user_match_data(self, user_id: str) -> Optional[dict]:
        raw = await self.get(f"user:{user_id}:match_data")
        return json.loads(raw) if raw else None

    async def set_vibe_check(self, user_id: str, vibe_id: str, ttl: int = 300) -> None:
        """Mark a user as currently in a vibe-check session."""
        await self.set(f"vibe:check:{user_id}", vibe_id, ex=ttl)

    async def get_vibe_check(self, user_id: str) -> Optional[str]:
        return await self.get(f"vibe:check:{user_id}")

    async def set_match_in_progress(self, user_id: str, ttl: int = 30) -> None:
        """Prevent duplicate match processing for the same user."""
        await self.set(f"match:in_progress:{user_id}", "1", ex=ttl)

    async def is_match_in_progress(self, user_id: str) -> bool:
        return await self.exists(f"match:in_progress:{user_id}")

    async def clear_match_in_progress(self, user_id: str) -> None:
        await self.delete(f"match:in_progress:{user_id}")

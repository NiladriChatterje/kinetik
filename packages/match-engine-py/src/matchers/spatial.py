"""
Spatial matcher — uses Uber H3 hexagonal indexing for hyperlocal
user discovery within flash windows.

Mirrors the TypeScript SpatialMatcher but uses h3-py (Python bindings).
"""

import logging
import math
from datetime import date
from dataclasses import dataclass
from typing import Optional

import json

import h3

# Optional asyncpg — only needed for DB fallback
_has_asyncpg = True
try:
    import asyncpg
except ImportError:
    _has_asyncpg = False

logger = logging.getLogger(__name__)


@dataclass
class NearbyUser:
    """A nearby active user within the spatial search radius."""
    user_id: str
    vector: list[float]
    latitude: float
    longitude: float
    age: int
    distance_km: float
    similarity: Optional[float] = None


class SpatialMatcher:
    """Manages H3 hexagonal spatial indexing and nearby-user queries.

    Uses Redis-backed H3 cell queues for sub-millisecond spatial lookups
    during active flash windows. Resolution 7 (~244 m edge) for hyperlocal matching.
    """

    H3_RESOLUTION = 7
    EARTH_RADIUS_KM = 6371.0

    def __init__(self, redis_client, pg_pool: Optional[asyncpg.Pool] = None):
        self._redis = redis_client
        self._pg = pg_pool

    # ── H3 helpers ──────────────────────────────────────────────

    def compute_h3_index(self, lat: float, lng: float) -> str:
        """Convert GPS coordinates to an H3 cell index at resolution 7."""
        return h3.latlng_to_cell(lat, lng, self.H3_RESOLUTION)

    def get_neighbor_cells(self, h3_index: str, ring_radius: int = 1) -> list[str]:
        """Get all H3 cells within k-ring distance of the given cell."""
        return list(h3.grid_disk(h3_index, ring_radius))

    def get_cell_center(self, h3_index: str) -> tuple[float, float]:
        """Return (latitude, longitude) of the cell centroid."""
        return h3.cell_to_latlng(h3_index)

    # ── Density-aware ring radius ───────────────────────────────

    @staticmethod
    def get_adaptive_ring_radius(density: int) -> int:
        """Expand search radius when local density is low; shrink when dense."""
        if density > 500:
            return 0       # Very dense — just the user's own cell
        if density > 100:
            return 1       # Moderately dense — immediate neighbours
        if density > 20:
            return 2       # Sparse — broader ring
        return 3           # Very sparse — wide ring

    # ── Core query ──────────────────────────────────────────────

    async def get_nearby_users(
        self,
        h3_index: str,
        window_id: str,
        exclude_user_id: str,
    ) -> list[NearbyUser]:
        """Get all active (non-excluded) users in the same and neighbouring H3 cells.

        Args:
            h3_index: The focal user's H3 cell index.
            window_id: Active flash window ID (for density estimation).
            exclude_user_id: User to exclude from results.

        Returns:
            List of NearbyUser objects with geospatial info.
        """
        if not h3.is_cell(h3_index):
            logger.warning("Invalid H3 index: %s", h3_index)
            return []

        # Adaptive ring radius based on window density
        density = await self._get_window_density(window_id)
        ring_radius = self.get_adaptive_ring_radius(density)
        cells = self.get_neighbor_cells(h3_index, ring_radius)

        center_lat, center_lng = self.get_cell_center(h3_index)

        logger.debug(
            "Searching %d cells (ring=%d density=%d) around (%.4f, %.4f)",
            len(cells), ring_radius, density, center_lat, center_lng,
        )

        # Collect user IDs from Redis cell queues
        all_user_ids: set[str] = set()
        for cell in cells:
            members = await self._redis.smembers(f"h3:queue:{cell}")
            for uid in members:
                if uid != exclude_user_id:
                    all_user_ids.add(uid)

        if not all_user_ids:
            return []

        return await self._fetch_user_details(list(all_user_ids), center_lat, center_lng)

    # ── Queue management ────────────────────────────────────────

    async def add_to_queue(self, user_id: str, h3_index: str) -> None:
        """Add a user to their H3 cell queue in Redis."""
        if not h3.is_cell(h3_index):
            logger.warning("Invalid H3 index for add_to_queue: %s", h3_index)
            return
        key = f"h3:queue:{h3_index}"
        await self._redis.sadd(key, user_id)
        await self._redis.expire(key, 3600)  # Auto-clean after 1 h

    async def remove_from_queue(self, user_id: str, h3_index: str) -> None:
        """Remove a user from their H3 cell queue."""
        if not h3.is_cell(h3_index):
            return
        await self._redis.srem(f"h3:queue:{h3_index}", user_id)

    async def get_cell_user_count(self, h3_index: str) -> int:
        """Return the number of active users in a given H3 cell."""
        if not h3.is_cell(h3_index):
            return 0
        return await self._redis.scard(f"h3:queue:{h3_index}")

    # ── Internal helpers ────────────────────────────────────────

    async def _get_window_density(self, window_id: str) -> int:
        """Estimate density from the number of participants in the window."""
        count = await self._redis.scard(f"window:participants:{window_id}")
        return count or 0

    async def _fetch_user_details(
        self,
        user_ids: list[str],
        center_lat: float,
        center_lng: float,
    ) -> list[NearbyUser]:
        """Fetch user match data — first from Redis cache, then fall back to PostgreSQL."""
        users: list[NearbyUser] = []

        for uid in user_ids:
            try:
                # Try Redis cache first
                cached = await self._redis.get(f"user:{uid}:match_data")
                if cached:
                    try:
                        data = json.loads(cached)
                        users.append(self._format_user(uid, data, center_lat, center_lng))
                        continue
                    except (json.JSONDecodeError, TypeError):
                        pass

                # Fall back to DB if pool is available
                if self._pg is not None:
                    async with self._pg.acquire() as conn:
                        row = await conn.fetchrow(
                            """SELECT u.latitude, u.longitude, u.date_of_birth,
                                      uv.vector
                               FROM users u
                               LEFT JOIN user_vectors uv ON uv.user_id = u.id
                               WHERE u.id = $1""",
                            uid,
                        )
                        if row:
                            data = {
                                "latitude": float(row["latitude"] or 0),
                                "longitude": float(row["longitude"] or 0),
                                "date_of_birth": str(row["date_of_birth"]) if row["date_of_birth"] else None,
                                "vector": row["vector"] or [0.5] * 64,
                            }
                            # Warm the cache
                            await self._redis.set_value(
                                f"user:{uid}:match_data",
                                json.dumps(data),
                                ex=900,
                            )
                            users.append(self._format_user(uid, data, center_lat, center_lng))
                            continue

                logger.debug("No match data for user %s (not in cache or DB)", uid)
            except Exception as exc:
                logger.error("Error fetching user %s details: %s", uid, exc)

        return users

    def _format_user(
        self,
        user_id: str,
        data: dict,
        center_lat: float,
        center_lng: float,
    ) -> NearbyUser:
        """Convert a raw data dict into a NearbyUser with computed distance."""
        lat = float(data.get("latitude", 0))
        lng = float(data.get("longitude", 0))
        dob = data.get("date_of_birth")
        age = self._calculate_age(dob) if dob else 25
        vector = data.get("vector", [0.5] * 64)

        return NearbyUser(
            user_id=user_id,
            vector=vector,
            latitude=lat,
            longitude=lng,
            age=age,
            distance_km=self._haversine(center_lat, center_lng, lat, lng),
        )

    # ── Geospatial helpers ──────────────────────────────────────

    def _haversine(self, lat1: float, lng1: float, lat2: float, lng2: float) -> float:
        """Haversine distance in km between two GPS coordinates."""
        d_lat = math.radians(lat2 - lat1)
        d_lng = math.radians(lng2 - lng1)
        a = (
            math.sin(d_lat / 2) ** 2
            + math.cos(math.radians(lat1))
            * math.cos(math.radians(lat2))
            * math.sin(d_lng / 2) ** 2
        )
        return self.EARTH_RADIUS_KM * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    @staticmethod
    def _calculate_age(dob_str: str) -> int:
        """Calculate age from ISO date string."""
        try:
            born = date.fromisoformat(dob_str)
            today = date.today()
            return today.year - born.year - ((today.month, today.day) < (born.month, born.day))
        except (ValueError, TypeError):
            return 25

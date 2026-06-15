import { Redis } from 'ioredis';
import { Pool } from 'pg';
import { REDIS_KEYS } from '@kinetik/shared';
import {
  geoToH3,
  getNeighborCells,
  getAdaptiveRingRadius,
  isValidH3Index,
  h3ToGeo,
} from '@kinetik/shared';

interface NearbyUser {
  userId: string;
  vector: number[];
  latitude: number;
  longitude: number;
  age: number;
  distance_km: number;
  similarity?: number;
}

export class SpatialMatcher {
  constructor(
    private redis: Redis,
    private pool?: Pool,
  ) {}

  /**
   * Compute a real H3 cell index from GPS coordinates using h3-js.
   * Resolution 7 (~244m edge length) for hyperlocal matching.
   */
  computeH3Index(lat: number, lng: number): string {
    return geoToH3(lat, lng, 7);
  }

  /**
   * Get nearby active users within the same or neighboring H3 cells.
   * Uses real h3-js kRing() for spatial queries instead of simulated offset.
   */
  async getNearbyUsers(
    h3Index: string,
    windowId: string,
    excludeUserId: string,
  ): Promise<NearbyUser[]> {
    // Validate H3 index
    if (!isValidH3Index(h3Index)) {
      console.warn(`[SpatialMatcher] Invalid H3 index: ${h3Index}`);
      return [];
    }

    // Get the center coordinates of the user's cell
    const center = h3ToGeo(h3Index);

    // Get density to determine adaptive search radius
    const density = await this.getCellDensity(h3Index, windowId);
    const ringRadius = getAdaptiveRingRadius(density);

    // Compute real neighbor cells using h3-js kRing
    const cellsToSearch = getNeighborCells(h3Index, ringRadius);
    console.log(
      `[SpatialMatcher] Searching ${cellsToSearch.length} cells` +
      ` (ring=${ringRadius}, density=${density}, center=${center.latitude.toFixed(4)},${center.longitude.toFixed(4)})`,
    );

    // Collect user IDs from Redis queues for all neighboring cells
    const allUserIds = new Set<string>();
    for (const cell of cellsToSearch) {
      const users = await this.redis.smembers(REDIS_KEYS.H3_QUEUE(cell));
      users.forEach((uid) => {
        if (uid !== excludeUserId) {
          allUserIds.add(uid);
        }
      });
    }

    if (allUserIds.size === 0) return [];

    // Fetch user details (from Redis cache or database)
    return this.getUserDetails(Array.from(allUserIds), center);
  }

  /**
   * Add a user to their H3 cell queue in Redis.
   */
  async addToQueue(userId: string, h3Index: string): Promise<void> {
    if (!isValidH3Index(h3Index)) {
      console.warn(`[SpatialMatcher] Invalid H3 index for addToQueue: ${h3Index}`);
      return;
    }
    await this.redis.sadd(REDIS_KEYS.H3_QUEUE(h3Index), userId);
    // Auto-cleanup after window duration
    await this.redis.expire(REDIS_KEYS.H3_QUEUE(h3Index), 3600); // 1 hour
  }

  /**
   * Remove a user from their H3 cell queue.
   */
  async removeFromQueue(userId: string, h3Index: string): Promise<void> {
    if (!isValidH3Index(h3Index)) return;
    await this.redis.srem(REDIS_KEYS.H3_QUEUE(h3Index), userId);
  }

  /**
   * Get the count of active users in an H3 cell.
   */
  async getCellUserCount(h3Index: string): Promise<number> {
    if (!isValidH3Index(h3Index)) return 0;
    return this.redis.scard(REDIS_KEYS.H3_QUEUE(h3Index));
  }

  /**
   * Get density estimate: total active participants in the window.
   */
  private async getCellDensity(h3Index: string, windowId: string): Promise<number> {
    const count = await this.redis.scard(REDIS_KEYS.WINDOW_PARTICIPANTS(windowId));
    return count || 0;
  }

  /**
   * Fetch user details for matching from Redis cache or database.
   * Pre-warmed user profiles in Redis for maximum speed during flash windows.
   */
  private async getUserDetails(
    userIds: string[],
    center: { latitude: number; longitude: number },
  ): Promise<NearbyUser[]> {
    const users: NearbyUser[] = [];

    for (const userId of userIds) {
      try {
        // Try Redis cache first
        const cached = await this.redis.get(`user:${userId}:match_data`);
        if (cached) {
          const data = JSON.parse(cached);
          users.push(this.formatUser(userId, data, center));
          continue;
        }

        // If we have a DB pool, fetch from database
        if (this.pool) {
          const result = await this.pool.query(
            `SELECT u.latitude, u.longitude, u.date_of_birth,
                    uv.vector
             FROM users u
             LEFT JOIN user_vectors uv ON uv.user_id = u.id
             WHERE u.id = $1`,
            [userId],
          );

          if (result.rows[0]) {
            const row = result.rows[0];
            const user = this.formatUser(userId, row, center);

            // Cache for future lookups (15 min TTL during window)
            await this.redis.set(
              `user:${userId}:match_data`,
              JSON.stringify(row),
              'EX',
              900,
            );

            users.push(user);
          }
        }
      } catch (err) {
        console.error(`[SpatialMatcher] Error fetching user ${userId}:`, err);
      }
    }

    return users;
  }

  /**
   * Format a user record into the NearbyUser shape with haversine distance.
   */
  private formatUser(
    userId: string,
    data: any,
    center: { latitude: number; longitude: number },
  ): NearbyUser {
    const lat = data.latitude || 0;
    const lng = data.longitude || 0;
    const age = data.date_of_birth
      ? this.calculateAge(new Date(data.date_of_birth))
      : 25;

    return {
      userId,
      vector: data.vector || new Array(128).fill(0.5),
      latitude: lat,
      longitude: lng,
      age,
      distance_km: this.haversineDistance(center.latitude, center.longitude, lat, lng),
    };
  }

  /**
   * Haversine distance calculation in kilometers.
   */
  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
      Math.cos(this.toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return (deg * Math.PI) / 180;
  }

  private calculateAge(dateOfBirth: Date): number {
    const today = new Date();
    let age = today.getFullYear() - dateOfBirth.getFullYear();
    const monthDiff = today.getMonth() - dateOfBirth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dateOfBirth.getDate())) {
      age--;
    }
    return age;
  }
}

/**
 * Location Poller — periodically re-geocodes user locations and publishes
 * updates to a Redis pub/sub channel for consumption by the match-engine.
 *
 * Rather than saving every geocode result to the database (DB writes are
 * expensive at scale), location updates are emitted via Redis pub/sub on the
 * `location:updates` channel. The match-engine subscribes to this channel
 * and caches the latest location data in its own Redis keys.
 *
 * The Geoapify API is called at most once every 3 minutes per user (gated
 * by a Redis TTL key).
 */

import { REDIS_KEYS, geoToH3 } from '@kinetik/shared';
import { getRedis } from './redis';
import { reverseGeocode } from './geocoding';
import { query } from './database';

const POLL_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes
const LOCATION_TTL_KEY_PREFIX = 'location:polled:';
const INITIAL_DELAY_MS = 5000; // Wait 5s after server start for Redis to be ready

/**
 * Start the location polling loop.
 * The first poll is deferred by 5s to give Redis time to connect.
 */
export function startLocationPoller(): void {
  setTimeout(() => {
    pollActiveUsers();
    setInterval(pollActiveUsers, POLL_INTERVAL_MS);
    console.log('[locationPoller] Started — polling every 3 minutes');
  }, INITIAL_DELAY_MS);
}

/**
 * Fetch all active users who have coordinates but haven't been polled
 * recently, reverse-geocode their location, and publish to Redis pub/sub.
 */
async function pollActiveUsers(): Promise<void> {
  const redis = getRedis();

  try {
    // Fetch users who have lat/lng and haven't been polled in the last 3 min
    const result = await query(
      `SELECT id, latitude, longitude
       FROM users
       WHERE latitude IS NOT NULL
         AND longitude IS NOT NULL
         AND is_active = TRUE
       ORDER BY GREATEST(location_updated_at, updated_at) ASC NULLS LAST
       LIMIT 200`,
    );

    if (result.rows.length === 0) return;

    for (const user of result.rows) {
      const userId: string = user.id;
      const latitude: number = user.latitude;
      const longitude: number = user.longitude;

      // Check if we already polled this user recently (rate-limit via Redis)
      const ttlKey = `${LOCATION_TTL_KEY_PREFIX}${userId}`;
      const alreadyPolled = await redis.exists(ttlKey);
      if (alreadyPolled) continue;

      // Set a 3-minute TTL so we don't re-poll too often
      await redis.set(ttlKey, '1', 'EX', 180);

      // Reverse-geocode
      const geocodeResult = await reverseGeocode(latitude, longitude);
      if (!geocodeResult) continue;

      // Also get the H3 index
      const h3Index = geoToH3(latitude, longitude, 7);

      const locationPayload = {
        userId,
        latitude,
        longitude,
        h3Index,
        city: geocodeResult.city,
        county: geocodeResult.county,
        region: geocodeResult.region,
        country: geocodeResult.country,
        timestamp: new Date().toISOString(),
      };

      // Publish to Redis pub/sub channel for the match-engine
      await redis.publish(REDIS_KEYS.LOCATION_UPDATES_CHANNEL, JSON.stringify(locationPayload));

      console.log(
        `[locationPoller] Published location for user ${userId}: ${geocodeResult.city || '?'}, ${geocodeResult.region || '?'}`,
      );
    }
  } catch (err: any) {
    console.error(`[locationPoller] Error: ${err.message}`);
  }
}

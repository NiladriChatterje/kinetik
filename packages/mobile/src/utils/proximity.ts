/**
 * On-Device Proximity Ranking
 *
 * Sorts the swipe deck nearest-first so meeting in real life stays realistic.
 * The server only ships each profile's coarse H3 cell-center (~5 km² hexagon,
 * never exact coordinates) — all ranking math runs on the device.
 *
 * Nice-to-have by design: any failure (no location permission, no coords,
 * profiles without a cell) degrades to the server's original order.
 */

import * as Location from 'expo-location';

// Lazy require to break the circular dependency with services/api.ts
// (api.ts imports rankByProximity, proximity.ts needs api.getAreaDetails)
let _api: any = null;
const getApi = () => {
  if (!_api) _api = require('../services/api').api;
  return _api;
};

export interface ApproxLocation {
  latitude: number;
  longitude: number;
}

interface Locatable {
  approxLocation?: ApproxLocation;
  /** Attached by rankByProximity — great-circle km to the viewer, rounded */
  distanceKm?: number;
}

// ─── Own location (cached per app session) ───────────────────────

let ownLocationPromise: Promise<ApproxLocation | null> | null = null;

/**
 * Resolve the viewer's own coordinates, cheapest source first:
 *  1. OS last-known position (no GPS fix, instant) — only if permission
 *     is already granted; never prompts.
 *  2. The server's stored onboarding location (no device permission needed).
 * Cached for the session — the ranking only needs city-block accuracy.
 */
function getOwnLocation(): Promise<ApproxLocation | null> {
  if (!ownLocationPromise) {
    ownLocationPromise = (async () => {
      try {
        const { granted } = await Location.getForegroundPermissionsAsync();
        if (granted) {
          const pos = await Location.getLastKnownPositionAsync();
          if (pos) {
            return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
          }
        }
      } catch {
        // Fall through to the server-stored location
      }

      try {
        const area = await getApi().getAreaDetails();
        if (area.latitude != null && area.longitude != null) {
          return { latitude: area.latitude, longitude: area.longitude };
        }
      } catch {
        // No location available — ranking silently disabled
      }
      return null;
    })();
  }
  return ownLocationPromise;
}

// ─── Distance math ───────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: ApproxLocation, b: ApproxLocation): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(s));
}

// ─── Ranking ─────────────────────────────────────────────────────

/**
 * Sort profiles nearest-first (stable: equal/unknown distances keep the
 * server's order; profiles without a location go last). Attaches
 * `distanceKm` (rounded, min 1) to profiles that have one.
 *
 * Never throws and never drops a profile.
 */
export async function rankByProximity<T extends Locatable>(profiles: T[]): Promise<T[]> {
  if (!profiles || profiles.length < 2) return profiles;

  const me = await getOwnLocation();
  if (!me) return profiles;

  for (const p of profiles) {
    if (p.approxLocation) {
      p.distanceKm = Math.max(1, Math.round(haversineKm(me, p.approxLocation)));
    }
  }

  return [...profiles].sort((a, b) => {
    const da = a.distanceKm ?? Number.POSITIVE_INFINITY;
    const db = b.distanceKm ?? Number.POSITIVE_INFINITY;
    return da - db;
  });
}

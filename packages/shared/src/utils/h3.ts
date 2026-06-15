import { latLngToCell, kRing, cellToLatLng, cellToBoundary, gridDistance } from 'h3-js';

// ─── Resolution Constants ────────────────────────────────

/**
 * Resolution 7 cell characteristics:
 * - Average edge length: ~0.244 km (244 meters)
 * - Average area: ~0.2 km²
 * - Ideal for city-level hyperlocal matching
 */
export const H3_MATCH_RESOLUTION = 7;

/**
 * Resolution 9 cell characteristics:
 * - Average edge length: ~0.037 km (37 meters)
 * - Average area: ~0.004 km²
 * - Ideal for precise venue-level geofencing
 */
export const H3_VENUE_RESOLUTION = 9;

// ─── Density Thresholds ──────────────────────────────────

/**
 * High-density threshold: >5,000 active users in the search area.
 * When exceeded, tighten the search radius for quality matching.
 */
export const H3_HIGH_DENSITY_THRESHOLD = 5000;

/**
 * Search ring radius for high-density areas.
 * Resolution 7 cells with ring radius 1 covers ~7 cells ≈ 0.5km²
 */
export const H3_TIGHT_RING_RADIUS = 1;

/**
 * Search ring radius for low-density areas.
 * Resolution 7 cells with ring radius 3 covers ~37 cells ≈ 7km²
 */
export const H3_EXPANDED_RING_RADIUS = 3;

// ─── Core Functions ──────────────────────────────────────

/**
 * Convert latitude/longitude to an H3 cell index at match resolution.
 * 
 * @param lat - Latitude in decimal degrees
 * @param lng - Longitude in decimal degrees
 * @param resolution - H3 resolution (default: 7 for hyperlocal matching)
 * @returns H3 cell index string
 */
export function geoToH3(lat: number, lng: number, resolution: number = H3_MATCH_RESOLUTION): string {
  return latLngToCell(lat, lng, resolution);
}

/**
 * Get all H3 cell indices within k-ring distance of the origin cell.
 * k=1 returns 7 cells (origin + 6 neighbors)
 * k=2 returns 19 cells
 * k=3 returns 37 cells
 * 
 * @param origin - Origin H3 cell index
 * @param radius - Ring radius (k value)
 * @returns Array of H3 cell indices
 */
export function getNeighborCells(origin: string, radius: number = H3_TIGHT_RING_RADIUS): string[] {
  return kRing(origin, radius);
}

/**
 * Get the center coordinates of an H3 cell.
 * 
 * @param h3Index - H3 cell index
 * @returns {latitude, longitude} object
 */
export function h3ToGeo(h3Index: string): { latitude: number; longitude: number } {
  const [lat, lng] = cellToLatLng(h3Index);
  return { latitude: lat, longitude: lng };
}

/**
 * Get the polygon boundary vertices of an H3 cell.
 * Useful for rendering hexagonal cells on maps.
 * 
 * @param h3Index - H3 cell index
 * @returns Array of {lat, lng} vertices
 */
export function h3ToBoundary(h3Index: string): Array<{ latitude: number; longitude: number }> {
  const boundary = cellToBoundary(h3Index, true); // true = geo JSON format
  return boundary.map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
}

/**
 * Calculate the grid distance between two H3 cells.
 * Returns -1 if cells are not in the same resolution or are incomparable.
 * 
 * @param origin - Origin H3 cell index
 * @param destination - Destination H3 cell index
 * @returns Number of cell steps between the two cells, or -1
 */
export function h3GridDistance(origin: string, destination: string): number {
  try {
    return gridDistance(origin, destination);
  } catch {
    return -1;
  }
}

/**
 * Determine the appropriate search ring radius based on area density.
 * Implements the Dynamic Liquidity Balancer concept from the Kinetik design doc.
 * 
 * @param activeUserCount - Number of active users in the local area
 * @returns Appropriate ring radius
 */
export function getAdaptiveRingRadius(activeUserCount: number): number {
  if (activeUserCount > H3_HIGH_DENSITY_THRESHOLD) {
    // High density: Tighten search for quality matching
    return H3_TIGHT_RING_RADIUS;
  } else if (activeUserCount < 100) {
    // Very low density: Expand search significantly
    return H3_EXPANDED_RING_RADIUS + 2;
  } else if (activeUserCount < 500) {
    // Low density: Expand search
    return H3_EXPANDED_RING_RADIUS;
  }
  // Medium density: Standard search
  return H3_TIGHT_RING_RADIUS + 1;
}

/**
 * Estimate the area covered by an H3 cell in square kilometers.
 * 
 * @param h3Index - H3 cell index
 * @returns Approximate area in km² (calculated from boundary)
 */
export function estimateCellAreaKm2(h3Index: string): number {
  const boundary = h3ToBoundary(h3Index);
  if (boundary.length < 3) return 0;

  // Shoelace formula for polygon area
  let area = 0;
  const n = boundary.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += boundary[i].latitude * boundary[j].longitude;
    area -= boundary[j].latitude * boundary[i].longitude;
  }
  area = Math.abs(area) / 2;

  // Rough conversion from degree² to km² (at mid-latitudes)
  return area * 111 * 111 * Math.cos(boundary[0].latitude * Math.PI / 180);
}

/**
 * Check if a string is a valid H3 cell index format.
 * Real h3-js indices are 15-character hexadecimal strings.
 */
export function isValidH3Index(value: string): boolean {
  return /^[0-9a-f]{15}$/i.test(value);
}

/**
 * Geoapify Reverse Geocoding Service
 *
 * Converts GPS coordinates to a human-readable location name
 * (city, region, country) using the Geoapify Geocoding API.
 */

export interface ReverseGeocodeResult {
  city: string | null;
  county: string | null;
  region: string | null;
  country: string | null;
  formatted: string | null;
}

/**
 * Reverse-geocode a lat/lng pair into a human-readable location.
 *
 * Calls Geoapify's /v1/geocode/reverse endpoint and returns
 * location details including city, county, state, and country.
 *
 * Returns null if the API call fails or no results are found.
 */
export async function reverseGeocode(
  latitude: number,
  longitude: number,
): Promise<ReverseGeocodeResult | null> {
  const apiKey = process.env.GEOAPIFY_API;
  if (!apiKey) {
    console.warn('[geocoding] GEOAPIFY_API not configured — skipping reverse geocode');
    return null;
  }

  try {
    const url = `https://api.geoapify.com/v1/geocode/reverse?lat=${latitude}&lon=${longitude}&apiKey=${apiKey}&limit=1`;
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });

    if (!response.ok) {
      console.error(`[geocoding] Geoapify returned ${response.status} ${response.statusText}`);
      return null;
    }

    const data: any = await response.json();

    // Geoapify returns results in `features` array (GeoJSON format)
    // Each feature has properties with city, county, state, country, etc.
    if (!data?.features?.length) {
      console.warn('[geocoding] No features from Geoapify');
      return null;
    }

    const props = data.features[0].properties || data.features[0];

    return {
      city: props.city || null,
      county: props.county || null,
      region: props.state || null,
      country: props.country || null,
      formatted: props.formatted || null,
    };
  } catch (error: any) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      console.warn('[geocoding] Request timed out after 5s');
    } else {
      console.error('[geocoding] Error:', error?.message || error);
    }
    return null;
  }
}

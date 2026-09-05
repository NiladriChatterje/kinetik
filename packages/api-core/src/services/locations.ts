import { Country, City } from 'country-state-city';

// ─── Country / city dataset ────────────────────────────
// Offline list from country-state-city (~150k places, bundled in the image),
// so the signup and "preferred location" pickers need no third-party quota.
// Names come from the dataset as-is; coordinates are the place centre.

export interface CountryOption {
  /** ISO 3166-1 alpha-2, e.g. "IN" */
  code: string;
  name: string;
  flag: string;
}

export interface CityOption {
  name: string;
  /** Dataset state/province code — disambiguates same-named cities in one country */
  stateCode: string;
  latitude: number;
  longitude: number;
}

export interface ResolvedLocation extends CityOption {
  countryCode: string;
  countryName: string;
}

const COUNTRIES: CountryOption[] = Country.getAllCountries()
  .map((c) => ({ code: c.isoCode, name: c.name, flag: c.flag }))
  .sort((a, b) => a.name.localeCompare(b.name));

// getCitiesOfCountry filters the whole dataset per call — cache per country.
const cityCache = new Map<string, CityOption[]>();

function citiesOf(countryCode: string): CityOption[] {
  const cc = countryCode.toUpperCase();
  let list = cityCache.get(cc);
  if (!list) {
    list = (City.getCitiesOfCountry(cc) ?? []).flatMap((c) => {
      const latitude = Number(c.latitude);
      const longitude = Number(c.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
      return [{ name: c.name, stateCode: c.stateCode, latitude, longitude }];
    });
    list.sort((a, b) => a.name.localeCompare(b.name));
    cityCache.set(cc, list);
  }
  return list;
}

export function listCountries(): CountryOption[] {
  return COUNTRIES;
}

/** Typeahead: prefix matches first, then substring matches, capped at `limit`. */
export function searchCities(countryCode: string, q: string, limit = 20): CityOption[] {
  const all = citiesOf(countryCode);
  const needle = q.trim().toLowerCase();
  if (!needle) return all.slice(0, limit);

  const starts: CityOption[] = [];
  const contains: CityOption[] = [];
  for (const c of all) {
    const name = c.name.toLowerCase();
    if (name.startsWith(needle)) {
      starts.push(c);
      if (starts.length >= limit) break;
    } else if (contains.length < limit && name.includes(needle)) {
      contains.push(c);
    }
  }
  return [...starts, ...contains].slice(0, limit);
}

/**
 * Turn a picker selection into coordinates. Returns null for an unknown
 * country or a city not in the dataset, so callers never store free text.
 */
export function resolveCity(countryCode: string, city: string, stateCode?: string): ResolvedLocation | null {
  const cc = countryCode.trim().toUpperCase();
  const country = Country.getCountryByCode(cc);
  if (!country) return null;

  const wanted = city.trim().toLowerCase();
  const candidates = citiesOf(cc).filter((c) => c.name.toLowerCase() === wanted);
  if (candidates.length === 0) return null;

  const state = stateCode?.trim().toUpperCase();
  const hit = (state && candidates.find((c) => c.stateCode === state)) || candidates[0];
  return { ...hit, countryCode: cc, countryName: country.name };
}

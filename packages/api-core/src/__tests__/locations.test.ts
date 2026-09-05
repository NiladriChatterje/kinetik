import { describe, it, expect } from 'vitest';
import { listCountries, searchCities, resolveCity } from '../services/locations';

// Real dataset, no mocks: these guard the contract the pickers and the
// register / profile routes rely on.
describe('services/locations', () => {
  it('lists countries with ISO codes, sorted by name', () => {
    const countries = listCountries();
    const india = countries.find((c) => c.code === 'IN');
    expect(india?.name).toBe('India');
    expect(countries.length).toBeGreaterThan(200);
    const names = countries.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('typeahead returns prefix matches first and respects the limit', () => {
    const hits = searchCities('IN', 'kolk', 5);
    expect(hits.length).toBeLessThanOrEqual(5);
    expect(hits[0].name.toLowerCase().startsWith('kolk')).toBe(true);
    expect(hits.some((c) => c.name === 'Kolkata')).toBe(true);
    for (const c of hits) {
      expect(Number.isFinite(c.latitude)).toBe(true);
      expect(Number.isFinite(c.longitude)).toBe(true);
    }
  });

  it('an empty query returns the first cities of the country', () => {
    expect(searchCities('in', '', 3)).toHaveLength(3);
  });

  it('pages with offset and never overlaps between pages', () => {
    const first = searchCities('IN', '', 3, 0);
    const second = searchCities('IN', '', 3, 3);
    expect(second).toHaveLength(3);
    const firstKeys = new Set(first.map((c) => `${c.stateCode}:${c.name}:${c.latitude}`));
    for (const c of second) expect(firstKeys.has(`${c.stateCode}:${c.name}:${c.latitude}`)).toBe(false);
    // Same for a filtered search
    const p1 = searchCities('IN', 'ra', 5, 0);
    const p2 = searchCities('IN', 'ra', 5, 5);
    expect(p1).toHaveLength(5);
    expect(p2.length).toBeGreaterThan(0);
    expect(p2[0]).not.toEqual(p1[0]);
  });

  it('resolves a city case-insensitively to coordinates', () => {
    const loc = resolveCity('in', 'kolkata');
    expect(loc).not.toBeNull();
    expect(loc!.countryCode).toBe('IN');
    expect(loc!.countryName).toBe('India');
    expect(loc!.name).toBe('Kolkata');
    expect(loc!.latitude).toBeCloseTo(22.57, 0);
    expect(loc!.longitude).toBeCloseTo(88.36, 0);
  });

  it('rejects unknown countries and cities', () => {
    expect(resolveCity('ZZ', 'Kolkata')).toBeNull();
    expect(resolveCity('IN', 'Definitely Not A City')).toBeNull();
  });
});

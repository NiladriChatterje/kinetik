import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Input } from './Input';
import { api } from '../../services/api';
import { colors, typography, spacing, radius } from '../../theme';

/** A picked place. `countryName` is display-only and optional when hydrating from the server. */
export interface LocationSelection {
  countryCode: string;
  countryName?: string;
  city: string;
  stateCode?: string;
}

interface CountryOption { code: string; name: string; flag: string }
interface CityOption { name: string; stateCode: string; latitude: number; longitude: number }

// Countries never change — fetch once per app session
let countriesPromise: Promise<CountryOption[]> | null = null;
function loadCountries(): Promise<CountryOption[]> {
  if (!countriesPromise) {
    countriesPromise = api
      .getCountries()
      .then((r) => (r.success && Array.isArray(r.data) ? r.data : []))
      .catch(() => {
        countriesPromise = null; // let the next mount retry
        return [];
      });
  }
  return countriesPromise;
}

const MAX_SUGGESTIONS = 6;
const CITY_DEBOUNCE_MS = 250;

interface Props {
  value: LocationSelection | null;
  /** Called with the full selection once a city is picked; with null when the user starts editing. */
  onChange: (value: LocationSelection | null) => void;
  required?: boolean;
}

/**
 * Two typeable dropdowns: country first, then a city of that country. Both
 * lists come from the server's offline dataset, so a selection always maps
 * to coordinates the feed can use.
 */
export const LocationPicker: React.FC<Props> = ({ value, onChange, required }) => {
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [country, setCountry] = useState<CountryOption | null>(null);
  const [countryQuery, setCountryQuery] = useState('');
  const [countryOpen, setCountryOpen] = useState(false);
  const [cityQuery, setCityQuery] = useState('');
  const [cities, setCities] = useState<CityOption[]>([]);
  const [cityOpen, setCityOpen] = useState(false);
  const [loadingCities, setLoadingCities] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadCountries().then(setCountries);
  }, []);

  // Hydrate the inputs from an existing value (profile page)
  useEffect(() => {
    if (!value) return;
    const match = countries.find((c) => c.code === value.countryCode);
    if (match) {
      setCountry(match);
      setCountryQuery(match.name);
    } else if (value.countryName) {
      setCountryQuery(value.countryName);
    }
    setCityQuery(value.city);
  }, [value?.countryCode, value?.city, value?.countryName, countries]);

  const fetchCities = useCallback(async (countryCode: string, q: string) => {
    setLoadingCities(true);
    try {
      const res = await api.searchCities(countryCode, q);
      setCities(res.success && Array.isArray(res.data) ? res.data : []);
    } catch {
      setCities([]);
    } finally {
      setLoadingCities(false);
    }
  }, []);

  const handleCountryText = (text: string) => {
    setCountryQuery(text);
    setCountryOpen(true);
    if (country) {
      setCountry(null);
      setCities([]);
      setCityQuery('');
    }
    if (value) onChange(null);
  };

  const selectCountry = (c: CountryOption) => {
    setCountry(c);
    setCountryQuery(c.name);
    setCountryOpen(false);
    setCityQuery('');
    setCityOpen(true);
    fetchCities(c.code, '');
  };

  const handleCityText = (text: string) => {
    setCityQuery(text);
    setCityOpen(true);
    if (value) onChange(null);
    if (!country) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchCities(country.code, text), CITY_DEBOUNCE_MS);
  };

  const selectCity = (c: CityOption) => {
    if (!country) return;
    setCityQuery(c.name);
    setCityOpen(false);
    onChange({ countryCode: country.code, countryName: country.name, city: c.name, stateCode: c.stateCode });
  };

  const needle = countryQuery.trim().toLowerCase();
  const countrySuggestions = countryOpen && !country && needle
    ? [
        ...countries.filter((c) => c.name.toLowerCase().startsWith(needle)),
        ...countries.filter((c) => !c.name.toLowerCase().startsWith(needle) && c.name.toLowerCase().includes(needle)),
      ].slice(0, MAX_SUGGESTIONS)
    : [];

  const citySuggestions = cityOpen && country ? cities.slice(0, MAX_SUGGESTIONS) : [];

  return (
    <View>
      <Input
        label="Country"
        value={countryQuery}
        onChangeText={handleCountryText}
        placeholder="Start typing your country"
        autoCapitalize="words"
        required={required}
        syncOnChange
      />
      {countrySuggestions.length > 0 && (
        <View style={styles.list}>
          {countrySuggestions.map((c) => (
            <TouchableOpacity key={c.code} style={styles.row} onPress={() => selectCountry(c)}>
              <Text style={styles.rowText}>{c.flag}  {c.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {country && (
        <>
          <Input
            label="City, town or village"
            value={cityQuery}
            onChangeText={handleCityText}
            placeholder={`Start typing a place in ${country.name}`}
            autoCapitalize="words"
            required={required}
            syncOnChange
          />
          {loadingCities && <ActivityIndicator size="small" color={colors.textMuted} style={styles.spinner} />}
          {!loadingCities && citySuggestions.length > 0 && (
            <View style={styles.list}>
              {citySuggestions.map((c) => (
                <TouchableOpacity key={`${c.stateCode}-${c.name}-${c.latitude}`} style={styles.row} onPress={() => selectCity(c)}>
                  <Text style={styles.rowText}>{c.name}</Text>
                  {c.stateCode ? <Text style={styles.rowMeta}>{c.stateCode}</Text> : null}
                </TouchableOpacity>
              ))}
            </View>
          )}
          {!loadingCities && cityOpen && cityQuery.trim() && cities.length === 0 && (
            <Text style={styles.empty}>No matching place found. Try a nearby town.</Text>
          )}
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  // Pulls up under the Input (which carries its own bottom margin)
  list: {
    marginTop: -spacing.md,
    marginBottom: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.cardBorder,
  },
  rowText: { ...typography.body2, color: colors.textPrimary },
  rowMeta: { ...typography.caption, color: colors.textMuted },
  spinner: { marginTop: -spacing.sm, marginBottom: spacing.lg },
  empty: { ...typography.caption, color: colors.textMuted, marginTop: -spacing.sm, marginBottom: spacing.lg },
});

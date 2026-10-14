import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';
import { Input } from './Input';
import { api } from '../../services/api';
import { colors, typography, spacing, radius } from '../../theme';

// The dropdowns sit inside the screen's ScrollView, so they are plain nested
// ScrollViews, not FlatLists: a virtualized list inside a ScrollView of the
// same orientation cannot measure its viewport, and React Native reports
// that as an error. The lists are small (a filtered country list, city pages
// of CITY_PAGE rows) and capped at LIST_MAX_HEIGHT, so rendering every row
// is cheap; the next city page loads as the user nears the bottom.

/** A picked place. `countryName` is display-only and optional when hydrating from the server. */
export interface LocationSelection {
  countryCode: string;
  countryName?: string;
  city: string;
  stateCode?: string;
}

interface CountryOption { code: string; name: string; flag: string }
interface CityOption { name: string; stateCode: string; latitude: number; longitude: number }

// Countries never change — fetch once per app session (~250 small rows)
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

const CITY_PAGE = 30;
const CITY_DEBOUNCE_MS = 250;
const LIST_MAX_HEIGHT = 240;
// Load the next city page once the list is scrolled to within this many
// pixels of its end (half a list height, like FlatList's default threshold).
const LOAD_MORE_WITHIN_PX = LIST_MAX_HEIGHT / 2;

interface Props {
  value: LocationSelection | null;
  /** Called with the full selection once a city is picked; with null when the user starts editing. */
  onChange: (value: LocationSelection | null) => void;
  required?: boolean;
}

/**
 * Two typeable dropdowns: country first, then a city of that country. Both
 * lists come from the server's offline dataset, so a selection always maps
 * to coordinates the feed can use. Cities are paged from the server as the
 * user scrolls, so a country with tens of thousands of places costs the app
 * only the pages the user has scrolled through.
 */
export const LocationPicker: React.FC<Props> = ({ value, onChange, required }) => {
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [country, setCountry] = useState<CountryOption | null>(null);
  const [countryQuery, setCountryQuery] = useState('');
  const [countryOpen, setCountryOpen] = useState(false);
  const [cityQuery, setCityQuery] = useState('');
  const [cities, setCities] = useState<CityOption[]>([]);
  const [cityOpen, setCityOpen] = useState(false);
  const [cityHasMore, setCityHasMore] = useState(false);
  const [loadingCities, setLoadingCities] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Increments per search so a slow earlier page cannot overwrite a newer one
  const searchIdRef = useRef(0);

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

  /** First page of a (new) search. */
  const searchCities = useCallback(async (countryCode: string, q: string) => {
    const id = ++searchIdRef.current;
    setLoadingCities(true);
    try {
      const res = await api.searchCities(countryCode, q, 0, CITY_PAGE);
      if (id !== searchIdRef.current) return; // superseded by a newer keystroke
      const page = res.success && Array.isArray(res.data) ? res.data : [];
      setCities(page);
      setCityHasMore(page.length === CITY_PAGE);
    } catch {
      if (id === searchIdRef.current) {
        setCities([]);
        setCityHasMore(false);
      }
    } finally {
      if (id === searchIdRef.current) setLoadingCities(false);
    }
  }, []);

  /** Next page of the current search, appended as the list nears its end. */
  const loadMoreCities = useCallback(async () => {
    if (!country || !cityHasMore || loadingCities || loadingMore) return;
    const id = searchIdRef.current;
    setLoadingMore(true);
    try {
      const res = await api.searchCities(country.code, cityQuery, cities.length, CITY_PAGE);
      if (id !== searchIdRef.current) return;
      const page = res.success && Array.isArray(res.data) ? res.data : [];
      setCities((prev) => [...prev, ...page]);
      setCityHasMore(page.length === CITY_PAGE);
    } catch {
      if (id === searchIdRef.current) setCityHasMore(false);
    } finally {
      if (id === searchIdRef.current) setLoadingMore(false);
    }
  }, [country, cityHasMore, loadingCities, loadingMore, cityQuery, cities.length]);

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
    searchCities(c.code, '');
  };

  const handleCityText = (text: string) => {
    setCityQuery(text);
    setCityOpen(true);
    if (value) onChange(null);
    if (!country) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchCities(country.code, text), CITY_DEBOUNCE_MS);
  };

  const selectCity = (c: CityOption) => {
    if (!country) return;
    setCityQuery(c.name);
    setCityOpen(false);
    onChange({ countryCode: country.code, countryName: country.name, city: c.name, stateCode: c.stateCode });
  };

  /** Fetch the next page when the city list is scrolled near its end. */
  const handleCityScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const remaining = contentSize.height - layoutMeasurement.height - contentOffset.y;
    if (remaining <= LOAD_MORE_WITHIN_PX) loadMoreCities();
  };

  const needle = countryQuery.trim().toLowerCase();
  const countrySuggestions: CountryOption[] = countryOpen && !country && needle
    ? [
        ...countries.filter((c) => c.name.toLowerCase().startsWith(needle)),
        ...countries.filter((c) => !c.name.toLowerCase().startsWith(needle) && c.name.toLowerCase().includes(needle)),
      ]
    : [];

  const showCityList = cityOpen && !!country && !loadingCities && cities.length > 0;

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
        <ScrollView
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
          {countrySuggestions.map((item) => (
            <TouchableOpacity key={item.code} style={styles.row} onPress={() => selectCountry(item)}>
              <Text style={styles.rowText}>{item.flag}  {item.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
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
          {showCityList && (
            <ScrollView
              style={styles.list}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              onScroll={handleCityScroll}
              scrollEventThrottle={100}
            >
              {cities.map((item, i) => (
                <TouchableOpacity
                  key={`${item.stateCode}-${item.name}-${item.latitude}-${i}`}
                  style={styles.row}
                  onPress={() => selectCity(item)}
                >
                  <Text style={styles.rowText}>{item.name}</Text>
                  {item.stateCode ? <Text style={styles.rowMeta}>{item.stateCode}</Text> : null}
                </TouchableOpacity>
              ))}
              {loadingMore ? (
                <ActivityIndicator size="small" color={colors.textMuted} style={styles.footer} />
              ) : null}
            </ScrollView>
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
  // Pulls up under the Input (which carries its own bottom margin); the list
  // scrolls inside this height instead of growing the screen
  list: {
    maxHeight: LIST_MAX_HEIGHT,
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
  footer: { paddingVertical: spacing.md },
  empty: { ...typography.caption, color: colors.textMuted, marginTop: -spacing.sm, marginBottom: spacing.lg },
});

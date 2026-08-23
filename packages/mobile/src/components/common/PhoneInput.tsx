import React, { useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  FlatList,
  StyleSheet,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../../theme';

// ─── Country data ──────────────────────────────────────
export interface Country {
  code: string;
  flag: string;
  name: string;
}

const COUNTRIES: Country[] = [
  { code: '+1', flag: '🇺🇸', name: 'United States' },
  { code: '+44', flag: '🇬🇧', name: 'United Kingdom' },
  { code: '+91', flag: '🇮🇳', name: 'India' },
  { code: '+61', flag: '🇦🇺', name: 'Australia' },
  { code: '+1', flag: '🇨🇦', name: 'Canada' },
  { code: '+49', flag: '🇩🇪', name: 'Germany' },
  { code: '+33', flag: '🇫🇷', name: 'France' },
  { code: '+81', flag: '🇯🇵', name: 'Japan' },
  { code: '+82', flag: '🇰🇷', name: 'South Korea' },
  { code: '+86', flag: '🇨🇳', name: 'China' },
  { code: '+55', flag: '🇧🇷', name: 'Brazil' },
  { code: '+52', flag: '🇲🇽', name: 'Mexico' },
  { code: '+34', flag: '🇪🇸', name: 'Spain' },
  { code: '+39', flag: '🇮🇹', name: 'Italy' },
  { code: '+7', flag: '🇷🇺', name: 'Russia' },
  { code: '+27', flag: '🇿🇦', name: 'South Africa' },
  { code: '+971', flag: '🇦🇪', name: 'United Arab Emirates' },
  { code: '+966', flag: '🇸🇦', name: 'Saudi Arabia' },
  { code: '+65', flag: '🇸🇬', name: 'Singapore' },
  { code: '+60', flag: '🇲🇾', name: 'Malaysia' },
  { code: '+63', flag: '🇵🇭', name: 'Philippines' },
  { code: '+62', flag: '🇮🇩', name: 'Indonesia' },
  { code: '+66', flag: '🇹🇭', name: 'Thailand' },
  { code: '+84', flag: '🇻🇳', name: 'Vietnam' },
  { code: '+234', flag: '🇳🇬', name: 'Nigeria' },
  { code: '+254', flag: '🇰🇪', name: 'Kenya' },
  { code: '+20', flag: '🇪🇬', name: 'Egypt' },
  { code: '+90', flag: '🇹🇷', name: 'Turkey' },
  { code: '+48', flag: '🇵🇱', name: 'Poland' },
  { code: '+46', flag: '🇸🇪', name: 'Sweden' },
  { code: '+47', flag: '🇳🇴', name: 'Norway' },
  { code: '+45', flag: '🇩🇰', name: 'Denmark' },
  { code: '+31', flag: '🇳🇱', name: 'Netherlands' },
  { code: '+32', flag: '🇧🇪', name: 'Belgium' },
  { code: '+41', flag: '🇨🇭', name: 'Switzerland' },
  { code: '+43', flag: '🇦🇹', name: 'Austria' },
  { code: '+353', flag: '🇮🇪', name: 'Ireland' },
  { code: '+64', flag: '🇳🇿', name: 'New Zealand' },
  { code: '+54', flag: '🇦🇷', name: 'Argentina' },
  { code: '+57', flag: '🇨🇴', name: 'Colombia' },
  { code: '+56', flag: '🇨🇱', name: 'Chile' },
  { code: '+51', flag: '🇵🇪', name: 'Peru' },
  { code: '+92', flag: '🇵🇰', name: 'Pakistan' },
  { code: '+880', flag: '🇧🇩', name: 'Bangladesh' },
  { code: '+94', flag: '🇱🇰', name: 'Sri Lanka' },
  { code: '+977', flag: '🇳🇵', name: 'Nepal' },
];

// ─── Props ─────────────────────────────────────────────
interface PhoneInputProps {
  /** The phone number without the country code */
  phoneNumber: string;
  /** Callback when the phone number changes */
  onPhoneNumberChange: (text: string) => void;
  /** Selected country code e.g. "+1" */
  countryCode: string;
  /** Callback when country code changes */
  onCountryCodeChange: (country: Country) => void;
  placeholder?: string;
  error?: string;
  required?: boolean;
}

/**
 * Zero-re-render phone input with country code dropdown.
 *
 * Focus styling is applied via setNativeProps to avoid re-renders
 * that break Fabric's TextInput on React Native 0.85+ / New Architecture.
 */
export const PhoneInput: React.FC<PhoneInputProps> = React.memo(
  ({
    phoneNumber,
    onPhoneNumberChange,
    countryCode,
    onCountryCodeChange,
    placeholder = 'Phone number',
    error,
    required,
  }) => {
    const [modalVisible, setModalVisible] = React.useState(false);
    const [search, setSearch] = React.useState('');
    const inputRef = useRef<TextInput>(null);
    const containerRef = useRef<View>(null);
    const countryCodeTextRef = useRef<Text>(null);
    const dividerRef = useRef<View>(null);
    const isFocusedRef = useRef(false);
    const onChangeTextRef = useRef(onPhoneNumberChange);
    const latestValueRef = useRef(phoneNumber);
    const valueRef = useRef(phoneNumber);

    useEffect(() => {
      onChangeTextRef.current = onPhoneNumberChange;
    }, [onPhoneNumberChange]);

    useEffect(() => {
      latestValueRef.current = phoneNumber;
      valueRef.current = phoneNumber;
    }, [phoneNumber]);

    // Set initial text before paint
    useLayoutEffect(() => {
      if (inputRef.current) {
        inputRef.current.setNativeProps({ text: phoneNumber });
      }
    }, []);

    // Sync parent value when NOT focused
    useEffect(() => {
      if (inputRef.current && !isFocusedRef.current) {
        inputRef.current.setNativeProps({ text: phoneNumber });
      }
    }, [phoneNumber]);

    const selectedCountry = COUNTRIES.find((c) => c.code === countryCode) || COUNTRIES[0];

    const filtered = search
      ? COUNTRIES.filter(
          (c) =>
            c.name.toLowerCase().includes(search.toLowerCase()) ||
            c.code.includes(search),
        )
      : COUNTRIES;

    const handleOpenModal = useCallback(() => {
      Keyboard.dismiss();
      setSearch('');
      setModalVisible(true);
    }, []);

    const handleSelect = useCallback(
      (country: Country) => {
        onCountryCodeChange(country);
        setModalVisible(false);
        setTimeout(() => inputRef.current?.focus(), 150);
      },
      [onCountryCodeChange],
    );

    const handleFocus = useCallback(() => {
      isFocusedRef.current = true;
      containerRef.current?.setNativeProps({
        style: {
          borderColor: colors.inputFocusBorder,
          backgroundColor: '#000000',
        },
      });
      inputRef.current?.setNativeProps({
        style: { color: '#FFFFFF' },
      });
      countryCodeTextRef.current?.setNativeProps({
        style: { color: '#FFFFFF' },
      });
      dividerRef.current?.setNativeProps({
        style: { backgroundColor: 'rgba(255,255,255,0.3)' },
      });
    }, []);

    const handleBlur = useCallback(() => {
      isFocusedRef.current = false;
      containerRef.current?.setNativeProps({
        style: {
          borderColor: colors.inputBorder,
          backgroundColor: colors.inputBg,
        },
      });
      inputRef.current?.setNativeProps({
        style: { color: colors.textPrimary },
      });
      countryCodeTextRef.current?.setNativeProps({
        style: { color: colors.textPrimary },
      });
      dividerRef.current?.setNativeProps({
        style: { backgroundColor: colors.inputBorder },
      });
      if (inputRef.current) {
        inputRef.current.setNativeProps({ text: latestValueRef.current });
      }
    }, []);

    const handleChangeText = useCallback((text: string) => {
      latestValueRef.current = text;
      onChangeTextRef.current(text);
    }, []);

    return (
      <>
        <View style={styles.wrapper}>
          <Text style={styles.label}>
            Phone Number{required ? <Text style={styles.required}> *</Text> : null}
          </Text>
          <View
            ref={containerRef}
            style={styles.container}
          >
            {/* ── Left: Country Code Dropdown ── */}
            <TouchableOpacity
              style={styles.countryCodeButton}
              onPress={handleOpenModal}
              activeOpacity={0.7}
            >
              <Text style={styles.flag}>{selectedCountry.flag}</Text>
              <Text ref={countryCodeTextRef} style={styles.countryCodeText}>{selectedCountry.code}</Text>
              <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
            </TouchableOpacity>

            {/* ── Divider ── */}
            <View ref={dividerRef} style={styles.divider} />

            {/* ── Right: Phone Number Input ── */}
            <TextInput
              ref={inputRef}
              style={styles.phoneInput}
              onChangeText={handleChangeText}
              placeholder={placeholder}
              placeholderTextColor={colors.textMuted}
              keyboardType="phone-pad"
              maxLength={15}
              onFocus={handleFocus}
              onBlur={handleBlur}
            />
          </View>
          {error && <Text style={styles.error}>{error}</Text>}
        </View>

        {/* ── Country Picker Modal ── */}
        <Modal
          visible={modalVisible}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setModalVisible(false)}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Country</Text>
              <TouchableOpacity
                onPress={() => setModalVisible(false)}
                style={styles.modalClose}
              >
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={styles.searchContainer}>
              <Ionicons name="search" size={18} color={colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search countries..."
                placeholderTextColor={colors.textMuted}
                value={search}
                onChangeText={setSearch}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => setSearch('')}>
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            <FlatList
              data={filtered}
              keyExtractor={(item) => `${item.code}-${item.name}`}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.countryRow,
                    item.code === selectedCountry.code &&
                      item.name === selectedCountry.name &&
                      styles.countryRowActive,
                  ]}
                  onPress={() => handleSelect(item)}
                  activeOpacity={0.6}
                >
                  <Text style={styles.countryFlag}>{item.flag}</Text>
                  <Text style={styles.countryName}>{item.name}</Text>
                  <Text style={styles.countryDial}>{item.code}</Text>
                  {item.code === selectedCountry.code &&
                    item.name === selectedCountry.name && (
                      <Ionicons name="checkmark" size={18} color={colors.textPrimary} />
                    )}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              contentContainerStyle={styles.modalList}
            />
          </View>
        </Modal>
      </>
    );
  },
);
PhoneInput.displayName = 'PhoneInput';

// ─── Styles ────────────────────────────────────────────
const styles = StyleSheet.create({
  wrapper: {
    marginBottom: spacing.lg,
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  required: {
    color: colors.textPrimary,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.inputBg,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    minHeight: 50,
    overflow: 'hidden',
  },

  // ── Left: Country Code ──
  countryCodeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: 2,
  },
  flag: {
    fontSize: 18,
  },
  countryCodeText: {
    ...typography.body2,
    color: colors.textPrimary,
    fontWeight: '600',
  },

  // ── Divider ──
  divider: {
    width: 1,
    height: 24,
    backgroundColor: colors.inputBorder,
  },

  // ── Right: Phone Input ──
  phoneInput: {
    flex: 1,
    ...typography.body1,
    color: colors.textPrimary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },

  error: {
    ...typography.caption,
    color: colors.error,
    marginTop: spacing.xs,
  },

  // ── Modal ──
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.lg,
  },
  modalTitle: {
    ...typography.h2,
    color: colors.textPrimary,
  },
  modalClose: {
    padding: spacing.sm,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.inputBg,
    borderRadius: radius.full,
    marginHorizontal: spacing.xxl,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    minHeight: 44,
  },
  searchInput: {
    flex: 1,
    ...typography.body1,
    color: colors.textPrimary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  modalList: {
    paddingHorizontal: spacing.xxl,
  },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    gap: spacing.md,
  },
  countryRowActive: {
    backgroundColor: colors.surface,
  },
  countryFlag: {
    fontSize: 22,
  },
  countryName: {
    ...typography.body1,
    color: colors.textPrimary,
    flex: 1,
  },
  countryDial: {
    ...typography.body1,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.inputBorder,
    marginLeft: spacing.lg + 22 + spacing.md,
  },
});

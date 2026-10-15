import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, TouchableOpacity } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../../components/common/Button';
import { StepLabel } from '../../components/common/StepLabel';
import { useToast } from '../../hooks/useToast';
import { Input } from '../../components/common/Input';
import { useAuthStore } from '../../store/authStore';
import { api } from '../../services/api';
import { colors, typography, spacing, radius } from '../../theme';

const GENDER_OPTIONS = ['Male', 'Female', 'Non-binary', 'Other', 'Prefer not to say'] as const;
// What the server stores for each label (the gender_identity enum). Lowercasing
// the label gave "non-binary" and "prefer not to say", which the server rejects.
const GENDER_VALUES: Record<(typeof GENDER_OPTIONS)[number], string> = {
  Male: 'male',
  Female: 'female',
  'Non-binary': 'non_binary',
  Other: 'other',
  'Prefer not to say': 'prefer_not_to_say',
};
const DATING_CATEGORIES = [
  { value: 'casual', label: 'Casual', description: 'Fun dates, new connections' },
  { value: 'serious', label: 'Serious', description: 'Looking for something real' },
  { value: 'intimacy', label: 'Intimacy', description: 'Deep chemistry, no games' },
] as const;

/** Auto-format DOB input as DD/MM/YYYY
 *  Adds "/" the moment DD is complete (2 digits) and when MM is complete (2 more digits). */
function formatDob(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);

  const dd = digits.slice(0, 2);
  const mm = digits.slice(2, 4);
  const yyyy = digits.slice(4, 8);

  let formatted = dd;
  if (dd.length === 2) formatted += '/';
  formatted += mm;
  if (dd.length === 2 && mm.length === 2) formatted += '/';
  formatted += yyyy;

  return formatted;
}

/** Parse DD/MM/YYYY string and check age >= 18. */
function validateDob(dob: string): { valid: boolean; error?: string } {
  const parts = dob.split('/');
  if (parts.length !== 3) {
    return { valid: false, error: 'Please enter a complete date of birth (DD/MM/YYYY).' };
  }

  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);

  if (isNaN(day) || isNaN(month) || isNaN(year) || year < 1900 || year > new Date().getFullYear()) {
    return { valid: false, error: 'Please enter a valid date of birth.' };
  }

  if (month < 1 || month > 12) {
    return { valid: false, error: 'Month must be between 01 and 12.' };
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) {
    return { valid: false, error: `Invalid day for month ${String(month).padStart(2, '0')}.` };
  }

  const birthDate = new Date(year, month - 1, day);
  const today = new Date();

  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }

  if (age < 18) {
    return { valid: false, error: 'You must be at least 18 years old to use Kinetik.' };
  }

  return { valid: true };
}

export const IdentityScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState<string | null>(null);
  const [genderTouched, setGenderTouched] = useState(false);
  const [datingCategory, setDatingCategory] = useState<string | null>(null);
  const [datingCategoryTouched, setDatingCategoryTouched] = useState(false);
  const [pronouns, setPronouns] = useState('');
  const [loading, setLoading] = useState(false);
  const { user } = useAuthStore();
  const toast = useToast();

  // Prefill what this step already saved, so returning here to change one
  // answer does not mean re-entering all of them. Never overwrites input.
  useEffect(() => {
    let cancelled = false;
    api.getProfile().then((res: any) => {
      const p = res?.success ? res.data : null;
      if (cancelled || !p) return;
      const iso = typeof p.dateOfBirth === 'string' ? p.dateOfBirth.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
      if (iso) setDob((prev) => prev || `${iso[3]}/${iso[2]}/${iso[1]}`);
      const savedGender = GENDER_OPTIONS.find((g) => GENDER_VALUES[g] === p.gender);
      if (savedGender) setGender((prev) => prev ?? savedGender);
      if (DATING_CATEGORIES.some((c) => c.value === p.datingCategory)) {
        setDatingCategory((prev) => prev ?? p.datingCategory);
      }
      if (typeof p.pronouns === 'string') setPronouns((prev) => prev || p.pronouns);
    }).catch(() => {
      // Prefill is a convenience — an empty form still works
    });
    return () => { cancelled = true; };
  }, []);

  const handleDobChange = useCallback((text: string) => {
    setDob(formatDob(text));
  }, []);

  const handleGenderSelect = useCallback((g: string) => {
    setGenderTouched(true);
    setGender(g);
  }, []);

  const genderError = genderTouched && !gender ? 'Please select your gender' : undefined;
  const datingCategoryError = datingCategoryTouched && !datingCategory ? 'Please select your dating preference' : undefined;

  const handleSubmit = async () => {
    // Mark all fields as touched so inline errors show
    setGenderTouched(true);

    // Check all required fields are filled
    const dobFilled = dob.length >= 10;
    const genderFilled = gender !== null && gender.length > 0;
    const categoryFilled = datingCategory !== null && datingCategory.length > 0;
    const pronounsFilled = pronouns.trim().length > 0;

    if (!dobFilled || !genderFilled || !categoryFilled || !pronounsFilled) {
      toast.showGlass('Incomplete', 'Fill in all fields to continue.');
      return;
    }

    // Validate DOB (age >= 18)
    const validation = validateDob(dob);
    if (!validation.valid) {
      toast.showError('Invalid DOB', validation.error);
      return;
    }

    // Convert DD/MM/YYYY to YYYY-MM-DD for the API / PostgreSQL
    const parts = dob.split('/');
    const dobIso = `${parts[2]}-${parts[1]}-${parts[0]}`;

    setLoading(true);
    const res = await api.updateProfile({
      displayName: user?.displayName,
      dateOfBirth: dobIso,
      gender: GENDER_VALUES[gender as (typeof GENDER_OPTIONS)[number]],
      pronouns,
      datingCategory: datingCategory,
    });
    if (res.success) {
      await api.updateOnboardingStep('identity');
      navigation.navigate('About');
    } else {
      toast.showError('Save failed', res.error?.message || 'Try again.');
    }
    setLoading(false);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
      {/* Heading stays put; only the fields below scroll. */}
      <View style={styles.header}>
        <StepLabel label="Step 1 of 5" />
        <Text style={styles.title}>Who are you?</Text>
        <Text style={styles.subtitle}>This helps us find your best matches</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        <Input label="Date of Birth" value={dob} onChangeText={handleDobChange} placeholder="DD/MM/YYYY" keyboardType="numeric" maxLength={10} required syncOnChange />

        <Text style={styles.fieldLabel}>Gender *</Text>
        <View style={styles.genderGrid}>
          {GENDER_OPTIONS.map((g) => (
            <TouchableOpacity
              key={g}
              activeOpacity={0.7}
              style={[styles.genderChip, gender === g && styles.genderChipActive]}
              onPress={() => handleGenderSelect(g)}
            >
              <Text
                style={[styles.genderChipText, gender === g && styles.genderChipTextActive]}
              >
                {g}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {genderError && <Text style={styles.fieldError}>{genderError}</Text>}

        {/* Dating Category */}
        <Text style={styles.fieldLabel}>What are you looking for? *</Text>
        <View style={styles.categoryGrid}>
          {DATING_CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat.value}
              activeOpacity={0.7}
              style={[
                styles.categoryChip,
                datingCategory === cat.value && styles.categoryChipActive,
              ]}
              onPress={() => {
                setDatingCategoryTouched(true);
                setDatingCategory(cat.value);
              }}
            >
              <Text
                style={[
                  styles.categoryChipText,
                  datingCategory === cat.value && styles.categoryChipTextActive,
                ]}
              >
                {cat.label}
              </Text>
              <Text style={[styles.categoryChipDesc, datingCategory === cat.value && { color: 'rgba(255,255,255,0.7)' }]}>
                {cat.description}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {datingCategoryError && <Text style={styles.fieldError}>{datingCategoryError}</Text>}

        <Input label="Pronouns" value={pronouns} onChangeText={setPronouns} placeholder="they/them, she/her, he/him" required />
      </ScrollView>

      {/* Continue is pinned below the scroll area. The SafeAreaView only
        covers the top edge, so the footer pads past the bottom inset itself. */}
      <View style={[styles.footer, { paddingBottom: Math.max(spacing.lg, insets.bottom + spacing.sm) }]}>
        <Button title="Continue" onPress={handleSubmit} loading={loading} fullWidth />
      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.xxl, paddingTop: spacing.xxl, paddingBottom: spacing.lg },
  scroll: { flex: 1 },
  content: { paddingHorizontal: spacing.xxl, paddingTop: spacing.sm, paddingBottom: spacing.xxl },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm },
  subtitle: { ...typography.body1, color: colors.textSecondary },
  fieldLabel: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.sm },
  genderGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  genderChip: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderRadius: radius.full, backgroundColor: colors.inputBg,
    borderWidth: 1, borderColor: colors.inputBorder,
  },
  genderChipActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  genderChipText: { ...typography.body2, color: colors.textSecondary },
  fieldError: { ...typography.caption, color: colors.error, marginBottom: spacing.lg, marginTop: -spacing.sm },
  genderChipTextActive: { color: colors.textInverse },
  categoryGrid: { flexDirection: 'column', gap: spacing.sm, marginBottom: spacing.lg },
  categoryChip: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  categoryChipActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  categoryChipText: { ...typography.body1, color: colors.textPrimary, fontWeight: '600' },
  categoryChipTextActive: { color: colors.textInverse },
  categoryChipDesc: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  footer: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceHighlight,
    backgroundColor: colors.background,
  },
});

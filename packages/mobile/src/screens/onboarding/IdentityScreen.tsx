import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, TouchableOpacity } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../../components/common/Button';
import { StepLabel } from '../../components/common/StepLabel';
import { useToast } from '../../hooks/useToast';
import { Input } from '../../components/common/Input';
import { useAuthStore } from '../../store/authStore';
import { api } from '../../services/api';
import {
  GENDER_OPTIONS,
  GENDER_VALUES,
  GenderOption,
  DATING_CATEGORIES,
  genderOptionFor,
  isDatingCategoryValue,
} from '../../components/profile/profileOptions';
import { formatDob, validateDob, dobToIso, isoToDob } from '../../utils/dob';
import { colors, typography, spacing, radius } from '../../theme';

// The gender and dating-category choices and the date-of-birth rules are
// shared with Edit profile (components/profile/profileOptions, utils/dob).

export const IdentityScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState<string | null>(null);
  const [genderTouched, setGenderTouched] = useState(false);
  const [datingCategory, setDatingCategory] = useState<string | null>(null);
  const [datingCategoryTouched, setDatingCategoryTouched] = useState(false);
  const [pronouns, setPronouns] = useState('');
  const [loading, setLoading] = useState(false);
  const { user, logout } = useAuthStore();
  const toast = useToast();

  // Prefill what this step already saved, so returning here to change one
  // answer does not mean re-entering all of them. Never overwrites input.
  useEffect(() => {
    let cancelled = false;
    api.getProfile().then((res: any) => {
      const p = res?.success ? res.data : null;
      if (cancelled || !p) return;
      const savedDob = isoToDob(p.dateOfBirth);
      if (savedDob) setDob((prev) => prev || savedDob);
      const savedGender = genderOptionFor(p.gender);
      if (savedGender) setGender((prev) => prev ?? savedGender);
      if (isDatingCategoryValue(p.datingCategory)) {
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

    setLoading(true);
    const res = await api.updateProfile({
      displayName: user?.displayName,
      // DD/MM/YYYY to the YYYY-MM-DD the API / PostgreSQL take
      dateOfBirth: dobToIso(dob),
      gender: GENDER_VALUES[gender as GenderOption],
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
        <StepLabel label="Step 1 of 6" />
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
        {/* The app reopens on the saved step, so this is the way back to the
            sign-in screen, e.g. to use another account */}
        <TouchableOpacity onPress={logout} disabled={loading} style={styles.signOut} accessibilityRole="button">
          <Text style={styles.signOutText}>Not you? Sign out</Text>
        </TouchableOpacity>
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
  signOut: { alignSelf: 'center', paddingVertical: spacing.sm, marginTop: spacing.xs },
  signOutText: { ...typography.body2, color: colors.textSecondary },
});

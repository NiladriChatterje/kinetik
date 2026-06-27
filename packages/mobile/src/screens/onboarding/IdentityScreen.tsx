import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../../components/common/Button';
import { useToast } from '../../hooks/useToast';
import { Input } from '../../components/common/Input';
import { useAuthStore } from '../../store/authStore';
import { api } from '../../services/api';
import { colors, typography, spacing, radius } from '../../theme';

const GENDER_OPTIONS = ['Male', 'Female', 'Non-binary', 'Other', 'Prefer not to say'] as const;

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
  const [pronouns, setPronouns] = useState('');
  const [loading, setLoading] = useState(false);
  const { user, setUser } = useAuthStore();
  const toast = useToast();

  const handleDobChange = useCallback((text: string) => {
    setDob(formatDob(text));
  }, []);

  const handleGenderSelect = useCallback((g: string) => {
    setGenderTouched(true);
    setGender(g);
  }, []);

  const genderError = genderTouched && !gender ? 'Please select your gender' : undefined;

  const handleSubmit = async () => {
    // Mark all fields as touched so inline errors show
    setGenderTouched(true);

    // Check all required fields are filled
    const dobFilled = dob.length >= 10;
    const genderFilled = gender !== null && gender.length > 0;
    const pronounsFilled = pronouns.trim().length > 0;

    if (!dobFilled || !genderFilled || !pronounsFilled) {
      toast.showGlass('Must fill all the fields!', 'Please complete your profile information.');
      return;
    }

    // Validate DOB (age >= 18)
    const validation = validateDob(dob);
    if (!validation.valid) {
      toast.showError('Invalid Date of Birth', validation.error);
      return;
    }

    setLoading(true);
    const res = await api.updateProfile({ displayName: user?.displayName, dateOfBirth: dob, gender: gender.toLowerCase(), pronouns });
    if (res.success) {
      await api.updateOnboardingStep('identity');
      navigation.navigate('Location');
    } else {
      toast.showError('Update Failed', res.error?.message || 'Could not save your profile. Please try again.');
    }
    setLoading(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" bounces={false}>
        <Text style={styles.step}>Step 1 of 5</Text>
        <Text style={styles.title}>Who are you?</Text>
        <Text style={styles.subtitle}>This helps us find your best matches</Text>

        <Input label="Date of Birth" value={dob} onChangeText={handleDobChange} placeholder="DD/MM/YYYY" keyboardType="numeric" maxLength={10} required syncOnChange />

        <Text style={styles.fieldLabel}>Gender *</Text>
        <View style={styles.genderGrid}>
          {GENDER_OPTIONS.map((g) => (
            <View
              key={g}
              style={[styles.genderChip, gender === g && styles.genderChipActive]}
            >
              <Text
                style={[styles.genderChipText, gender === g && styles.genderChipTextActive]}
                onPress={() => handleGenderSelect(g)}
              >
                {g}
              </Text>
            </View>
          ))}
        </View>
        {genderError && <Text style={styles.fieldError}>{genderError}</Text>}

        <Input label="Pronouns" value={pronouns} onChangeText={setPronouns} placeholder="they/them, she/her, he/him" required />
      </ScrollView>

      <View style={[styles.footer, { bottom: insets.bottom + 40 }]}>
        <Button title="Continue" onPress={handleSubmit} loading={loading} fullWidth />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xxl, paddingBottom: 100, flexGrow: 1 },
  step: { ...typography.label, color: colors.textPrimary, marginBottom: spacing.sm },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm },
  subtitle: { ...typography.body1, color: colors.textSecondary, marginBottom: spacing.xxl },
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
  footer: { position: 'absolute', bottom: 40, left: spacing.xxl, right: spacing.xxl },
});

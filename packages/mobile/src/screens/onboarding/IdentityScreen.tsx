import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { useAuthStore } from '../../store/authStore';
import { api } from '../../services/api';
import { colors, typography, spacing, radius } from '../../theme';

const GENDER_OPTIONS = ['Male', 'Female', 'Non-binary', 'Other', 'Prefer not to say'] as const;

/** Auto-format DOB input as DD/MM/YYYY */
function formatDob(raw: string): string {
  // Strip everything except digits
  const digits = raw.replace(/\D/g, '');
  let formatted = '';
  for (let i = 0; i < digits.length && i < 8; i++) {
    if (i === 2 || i === 4) formatted += '/';
    formatted += digits[i];
  }
  return formatted;
}

export const IdentityScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');

  const handleDobChange = useCallback((text: string) => {
    setDob(formatDob(text));
  }, []);
  const [gender, setGender] = useState<string | null>(null);
  const [pronouns, setPronouns] = useState('');
  const [loading, setLoading] = useState(false);
  const { setUser } = useAuthStore();

  const handleSubmit = async () => {
    if (!name || !dob || !gender) return;
    setLoading(true);
    const res = await api.updateProfile({ displayName: name, dateOfBirth: dob, gender: gender.toLowerCase(), pronouns });
    if (res.success) {
      await api.updateOnboardingStep('identity');
      navigation.navigate('Location');
    }
    setLoading(false);
  };

  const canProceed = name.length >= 2 && dob.length >= 10 && gender !== null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" bounces={false}>
        <Text style={styles.step}>Step 1 of 5</Text>
        <Text style={styles.title}>Who are you?</Text>
        <Text style={styles.subtitle}>This helps us find your best matches</Text>

        <Input label="Full Name" value={name} onChangeText={setName} placeholder="Alex Johnson" autoCapitalize="words" required />
        <Input label="Date of Birth" value={dob} onChangeText={handleDobChange} placeholder="DD/MM/YYYY" keyboardType="numeric" maxLength={10} required />

        <Text style={styles.fieldLabel}>Gender *</Text>
        <View style={styles.genderGrid}>
          {GENDER_OPTIONS.map((g) => (
            <View
              key={g}
              style={[styles.genderChip, gender === g && styles.genderChipActive]}
            >
              <Text
                style={[styles.genderChipText, gender === g && styles.genderChipTextActive]}
                onPress={() => setGender(g)}
              >
                {g}
              </Text>
            </View>
          ))}
        </View>

        <Input label="Pronouns" value={pronouns} onChangeText={setPronouns} placeholder="they/them, she/her, he/him" required />
      </ScrollView>

      <View style={styles.footer}>
        <Button title="Continue" onPress={handleSubmit} disabled={!canProceed} loading={loading} fullWidth />
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
  genderChipTextActive: { color: colors.textInverse },
  footer: { position: 'absolute', bottom: 40, left: spacing.xxl, right: spacing.xxl },
});

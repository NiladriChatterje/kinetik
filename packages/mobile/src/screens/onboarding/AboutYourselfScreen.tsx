import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { StepLabel } from '../../components/common/StepLabel';
import { useToast } from '../../hooks/useToast';
import { api } from '../../services/api';
import { colors, typography, spacing, radius } from '../../theme';
import { BIO_MAX_CHARS, BIO_MAX_WORDS, countWords, sanitizeBio, validateBio } from '../../utils/bio';

const OCCUPATION_MAX = 100;
const EDUCATION_MAX = 255;

/**
 * Onboarding step 3: a short description, work and studies. Everything here
 * is optional and can be filled in later on Edit profile, so "Skip for now"
 * moves on without saving anything. The description is plain ASCII of at
 * most 120 words (utils/bio.ts); the server refuses anything else.
 */
export const AboutYourselfScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const toast = useToast();

  const [bio, setBio] = useState('');
  const [occupation, setOccupation] = useState('');
  const [education, setEducation] = useState('');
  const [bioFocused, setBioFocused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [skipping, setSkipping] = useState(false);

  // Prefill whatever was saved already, so coming back here keeps the text
  useEffect(() => {
    let cancelled = false;
    api.getProfile().then((res: any) => {
      if (cancelled || !res?.success || !res.data) return;
      const d = res.data;
      setBio((prev) => prev || sanitizeBio(typeof d.bio === 'string' ? d.bio : ''));
      setOccupation((prev) => prev || (typeof d.occupation === 'string' ? d.occupation : ''));
      setEducation((prev) => prev || (typeof d.education === 'string' ? d.education : ''));
    }).catch(() => {
      // Prefill is a convenience; an empty form still works
    });
    return () => { cancelled = true; };
  }, []);

  const words = countWords(bio);

  const advance = useCallback(async () => {
    await api.updateOnboardingStep('details');
    navigation.navigate('Location');
  }, [navigation]);

  const handleSkip = useCallback(async () => {
    if (saving || skipping) return;
    setSkipping(true);
    try {
      await advance();
    } finally {
      setSkipping(false);
    }
  }, [advance, saving, skipping]);

  const handleContinue = useCallback(async () => {
    if (saving || skipping) return;
    const check = validateBio(bio);
    if (!check.valid) {
      toast.showError('Check your description', check.error);
      return;
    }
    const changes: Record<string, string> = {};
    if (bio.trim()) changes.bio = bio.trim();
    if (occupation.trim()) changes.occupation = occupation.trim();
    if (education.trim()) changes.education = education.trim();

    setSaving(true);
    try {
      if (Object.keys(changes).length > 0) {
        const res = await api.updateProfile(changes);
        if (!res.success) {
          toast.showError('Could not save', res.error?.message || 'Try again.');
          return;
        }
      }
      await advance();
    } finally {
      setSaving(false);
    }
  }, [advance, bio, education, occupation, saving, skipping, toast]);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <StepLabel label="Step 3 of 6" onBack={() => navigation.goBack()} />
          <Text style={styles.title}>In your own words</Text>
          <Text style={styles.subtitle}>
            A short description, your work and where you studied. All optional, all shown on your card.
          </Text>

          <Text style={styles.fieldLabel}>About yourself</Text>
          <TextInput
            style={[styles.bioInput, bioFocused && styles.bioInputFocused]}
            value={bio}
            onChangeText={(t) => setBio(sanitizeBio(t))}
            placeholder="A few lines about you, in plain text"
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={BIO_MAX_CHARS}
            textAlignVertical="top"
            autoCapitalize="sentences"
            onFocus={() => setBioFocused(true)}
            onBlur={() => setBioFocused(false)}
          />
          <Text style={[styles.counter, words > BIO_MAX_WORDS && styles.counterOver]}>
            {words} / {BIO_MAX_WORDS} words
          </Text>

          <Input
            label="Work"
            value={occupation}
            onChangeText={setOccupation}
            placeholder="What you do"
            autoCapitalize="sentences"
            maxLength={OCCUPATION_MAX}
          />
          <Input
            label="Education"
            value={education}
            onChangeText={setEducation}
            placeholder="Where you studied"
            autoCapitalize="sentences"
            maxLength={EDUCATION_MAX}
          />
        </ScrollView>

        <View style={styles.footer}>
          <Button title="Continue" onPress={handleContinue} loading={saving} disabled={skipping} fullWidth />
          <Button
            title="Skip for now"
            variant="ghost"
            onPress={handleSkip}
            loading={skipping}
            disabled={saving}
            fullWidth
            style={styles.skipButton}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { paddingHorizontal: spacing.xxl, paddingTop: spacing.xxl, paddingBottom: spacing.xxl },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm },
  subtitle: { ...typography.body1, color: colors.textSecondary, lineHeight: 21, marginBottom: spacing.xxl },
  fieldLabel: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.sm },
  // The same box as Edit profile's bio: the Input's look, taller, black on white when focused
  bioInput: {
    ...typography.body1,
    color: colors.textPrimary,
    backgroundColor: colors.inputBg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    minHeight: 120,
    maxHeight: 200,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  bioInputFocused: {
    borderColor: colors.inputFocusBorder,
    backgroundColor: '#000000',
    color: '#FFFFFF',
  },
  counter: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'right',
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  counterOver: { color: colors.textPrimary, fontWeight: '700' },
  footer: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceHighlight,
    backgroundColor: colors.background,
  },
  skipButton: { marginTop: spacing.xs },
});

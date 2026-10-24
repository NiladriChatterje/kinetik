import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../../components/common/Button';
import { StepLabel } from '../../components/common/StepLabel';
import {
  AboutAnswersEditor,
  AboutAnswerMap,
  ABOUT_QUESTIONS,
  aboutAnswersFromProfile,
  emptyAboutAnswers,
  unansweredAboutQuestions,
} from '../../components/profile/AboutAnswersEditor';
import { useToast } from '../../hooks/useToast';
import { api } from '../../services/api';
import { colors, typography, spacing } from '../../theme';

// The questions, chips and custom-entry box live in AboutAnswersEditor,
// shared with Edit profile; this step only wraps them in the onboarding
// header, progress and Continue.

export const AboutYouScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const toast = useToast();

  const [answers, setAnswers] = useState<AboutAnswerMap>(emptyAboutAnswers);
  const [loading, setLoading] = useState(false);
  const [attempted, setAttempted] = useState(false);

  // Prefill saved answers, so returning here to change one section keeps the
  // rest. Only applied while nothing has been picked yet.
  useEffect(() => {
    let cancelled = false;
    api.getProfile().then((res: any) => {
      const loaded = aboutAnswersFromProfile(res?.success ? res.data?.aboutAnswers : null);
      if (cancelled || !loaded) return;
      setAnswers((prev) => (ABOUT_QUESTIONS.every((q) => prev[q.key].length === 0) ? loaded : prev));
    }).catch(() => {
      // Prefill is a convenience — empty sections still work
    });
    return () => { cancelled = true; };
  }, []);

  const answeredCount = useMemo(
    () => ABOUT_QUESTIONS.filter((q) => answers[q.key].length > 0).length,
    [answers],
  );

  const handleSubmit = useCallback(async () => {
    setAttempted(true);
    if (unansweredAboutQuestions(answers).length > 0) {
      toast.showGlass('Incomplete', 'Pick one answer per section.');
      return;
    }

    setLoading(true);
    const res = await api.updateProfile({ aboutAnswers: answers });
    if (res.success) {
      await api.updateOnboardingStep('about');
      navigation.navigate('Location');
    } else {
      toast.showError('Save failed', res.error?.message || 'Try again.');
    }
    setLoading(false);
  }, [answers, navigation, toast]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <StepLabel label="Step 2 of 5" onBack={() => navigation.goBack()} />
            <Text style={styles.title}>Knowing more about you</Text>
            <Text style={styles.subtitle}>
              Five quick questions so your matches get the real you, before the small talk
            </Text>
          </View>

          {/* Decorative ring motif — pure geometry, no icons */}
          <View style={styles.rings} pointerEvents="none">
            <View style={styles.ringOuter} />
            <View style={styles.ringInner} />
            <View style={styles.ringDot} />
          </View>
        </View>

        {/* Progress segments */}
        <View style={styles.progressRow}>
          {ABOUT_QUESTIONS.map((q) => {
            const done = answers[q.key].length > 0;
            return <View key={q.key} style={[styles.progressSegment, done && styles.progressSegmentDone]} />;
          })}
        </View>
        <Text style={styles.progressLabel}>
          {answeredCount} of {ABOUT_QUESTIONS.length} answered
        </Text>

        {/* Questions */}
        <AboutAnswersEditor answers={answers} onChange={setAnswers} showErrors={attempted} />
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { bottom: insets.bottom + 40 }]}>
        <Button title="Continue" onPress={handleSubmit} loading={loading} fullWidth />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xxl, paddingBottom: 140, flexGrow: 1 },

  // ─── Header ─────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  headerCopy: { flex: 1, paddingRight: spacing.lg },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm },
  subtitle: { ...typography.body1, color: colors.textSecondary, lineHeight: 21 },

  // Decorative concentric rings — abstract geometry, no icons
  rings: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  ringOuter: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  ringInner: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  ringDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.textPrimary,
  },

  // ─── Progress ───────────────────────────────────────────
  progressRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.inputBg,
  },
  progressSegmentDone: {
    backgroundColor: colors.textPrimary,
  },
  progressLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.xl,
  },

  // ─── Footer ─────────────────────────────────────────────
  footer: {
    position: 'absolute',
    left: spacing.xxl,
    right: spacing.xxl,
  },
});

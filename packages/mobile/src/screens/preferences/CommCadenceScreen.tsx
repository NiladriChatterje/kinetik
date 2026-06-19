import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { useAuthStore } from '../../store/authStore';
import { colors, typography, spacing, radius } from '../../theme';

const QUESTIONS = [
  { q: "How do you prefer to communicate?", a: ['Quick texts', 'Deep calls', 'Voice notes', 'In person'] },
  { q: "Your ideal first date is...", a: ['Coffee walk', 'Fancy dinner', 'Concert', 'Outdoor adventure'] },
  { q: "How fast should things move?", a: ['Slow burn', 'See where it goes', "Let's meet ASAP", 'Marathon not sprint'] },
];

export const CommCadenceScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);

  const selectAnswer = (idx: number) => {
    const newAnswers = [...answers, idx];
    setAnswers(newAnswers);
    if (qIndex < QUESTIONS.length - 1) {
      setQIndex(qIndex + 1);
    }
  };

  const handleFinish = () => {
    useAuthStore.getState().setOnboardingStep('complete');
    navigation.getParent()?.reset({ index: 0, routes: [{ name: 'Main' }] });
  };

  const done = answers.length === QUESTIONS.length;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.step}>Step 4 of 4</Text>
        <Text style={styles.title}>Your Style</Text>
        <Text style={styles.subtitle}>A few quick questions to calibrate your communication fit</Text>

        {!done ? (
          <Card style={styles.questionCard}>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${((qIndex + 1) / QUESTIONS.length) * 100}%` }]} />
            </View>
            <Text style={styles.questionCount}>{qIndex + 1} of {QUESTIONS.length}</Text>
            <Text style={styles.question}>{QUESTIONS[qIndex].q}</Text>
            {QUESTIONS[qIndex].a.map((answer, i) => (
              <TouchableOpacity key={i} style={styles.answerBtn} onPress={() => selectAnswer(i)}>
                <Text style={styles.answerText}>{answer}</Text>
              </TouchableOpacity>
            ))}
          </Card>
        ) : (
          <Card style={styles.doneCard}>
            <Ionicons name="checkmark-circle-outline" size={64} color={colors.primary} />
            <Text style={styles.doneText}>Profile Complete!</Text>
            <Text style={styles.doneDesc}>You're ready to join the next flash window</Text>
            <Button title="Enter Kinetik" onPress={handleFinish} fullWidth />
          </Card>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, padding: spacing.xxl },
  step: { ...typography.label, color: colors.primary, marginBottom: spacing.sm },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm },
  subtitle: { ...typography.body1, color: colors.textSecondary, marginBottom: spacing.xxl },
  questionCard: { padding: spacing.xl },
  progressBar: { height: 4, backgroundColor: colors.surfaceHighlight, borderRadius: 2, marginBottom: spacing.md },
  progressFill: { height: 4, backgroundColor: colors.primary, borderRadius: 2 },
  questionCount: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.lg },
  question: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.xl },
  answerBtn: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.surfaceHighlight, borderRadius: radius.md, marginBottom: spacing.sm },
  answerText: { ...typography.body1, color: colors.textPrimary },
  doneCard: { alignItems: 'center', padding: spacing.xxl },
  doneText: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.sm },
  doneDesc: { ...typography.body1, color: colors.textSecondary, marginBottom: spacing.xxl, textAlign: 'center' },
});

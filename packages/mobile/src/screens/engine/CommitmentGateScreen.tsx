import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../../theme';

interface Props { navigation: any; route: any; }

export const CommitmentGateScreen: React.FC<Props> = ({ navigation, route }) => {
  const { vibeId } = route.params || {};
  const [countdown, setCountdown] = useState(15);
  const [hasDecided, setHasDecided] = useState<'lock' | 'pass' | null>(null);

  useEffect(() => {
    if (countdown <= 0) { navigation.replace('LockStatus', { vibeId }); return; }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const decide = async (decision: 'lock' | 'pass') => {
    setHasDecided(decision);
    if (decision === 'lock') {
      setTimeout(() => navigation.replace('LockStatus', { vibeId, matched: true }), 1500);
    } else {
      setTimeout(() => navigation.navigate('Main'), 1500);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={StyleSheet.absoluteFill} />
      
      <View style={styles.content}>
        <Text style={styles.title}>Time to Decide</Text>
        <View style={styles.countdownCircle}>
          <Text style={styles.countdownText}>{countdown}</Text>
          <Text style={styles.countdownLabel}>seconds</Text>
        </View>
        <Text style={styles.subtitle}>Did you feel the spark?</Text>

        <View style={styles.decisionContainer}>
          <TouchableOpacity
            style={[styles.decisionBtn, styles.passBtn, hasDecided === 'pass' && styles.selectedBtn]}
            onPress={() => decide('pass')}
            disabled={hasDecided !== null}
          >
            <Ionicons name="close-outline" size={36} color={colors.error} />
            <Text style={styles.decisionLabel}>Pass</Text>
            <Text style={styles.decisionDesc}>Move to next match</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.decisionBtn, styles.lockBtn, hasDecided === 'lock' && styles.selectedBtn]}
            onPress={() => decide('lock')}
            disabled={hasDecided !== null}
          >
            <Ionicons name="lock-closed-outline" size={36} color={colors.vibeLock} />
            <Text style={styles.decisionLabel}>Lock It In</Text>
            <Text style={styles.decisionDesc}>Schedule a date</Text>
          </TouchableOpacity>
        </View>
      </View>

      {hasDecided && (
        <Text style={styles.waitingText}>
          {hasDecided === 'lock' ? 'Waiting for their response...' : 'Moving on...'}
        </Text>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  title: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.xxl },
  countdownCircle: { width: 120, height: 120, borderRadius: 60, backgroundColor: colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg, borderWidth: 3, borderColor: colors.textPrimary },
  countdownText: { ...typography.countdown, color: colors.textPrimary, fontSize: 48 },
  countdownLabel: { ...typography.caption, color: colors.textMuted },
  subtitle: { ...typography.h4, color: colors.textPrimary, marginBottom: spacing.xxl, marginTop: spacing.lg },
  decisionContainer: { flexDirection: 'row', gap: spacing.lg },
  decisionBtn: { flex: 1, padding: spacing.xxl, borderRadius: radius.xl, alignItems: 'center', borderWidth: 1 },
  passBtn: { backgroundColor: colors.surfaceHighlight, borderColor: colors.textMuted },
  lockBtn: { backgroundColor: colors.surfaceHighlight, borderColor: colors.textMuted },
  selectedBtn: { borderColor: colors.textPrimary, borderWidth: 2 },
  decisionLabel: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.xs, marginTop: spacing.sm },
  decisionDesc: { ...typography.caption, color: colors.textMuted },
  waitingText: { ...typography.body1, color: colors.textSecondary, textAlign: 'center', paddingBottom: spacing.huge },
});

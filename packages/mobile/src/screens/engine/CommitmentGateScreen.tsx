import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../../theme';
import { getVibeSocket, emitWhenConnected, closeVibeSocket } from '../../services/vibeSocket';

interface Props { navigation: any; route: any; }

export const CommitmentGateScreen: React.FC<Props> = ({ navigation, route }) => {
  const { vibeId, matched } = route.params || {};
  const [countdown, setCountdown] = useState(15);
  const [hasDecided, setHasDecided] = useState<'lock' | 'pass' | null>(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(getVibeSocket());
  const resolvedRef = useRef(false);

  const finish = useCallback((isMatch: boolean) => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    // Flow is over — safe to release the shared socket
    closeVibeSocket();
    if (isMatch) {
      navigation.replace('LockStatus', { vibeId, matched: true });
    } else {
      navigation.replace('Main');
    }
  }, [navigation, vibeId]);

  // ─── Connect ONCE on mount (shared socket, no churn) ─
  useEffect(() => {
    const socket = socketRef.current;

    const handleConnect = () => {
      setConnected(true);
      console.log('[CommitSocket] Connected');
    };

    socket.on('connect', handleConnect);

    // Server resolved the vibe check
    socket.on('vibe:end', (data: any) => {
      if (data?.mutualLock) finish(true);
      else finish(false);
    });

    // Direct mutual-lock signal
    socket.on('match:success', () => finish(true));

    let loggedConnectError = false;
    const handleConnectError = (err: any) => {
      if (!loggedConnectError) {
        loggedConnectError = true;
        console.warn('[CommitSocket] Connection error (will keep retrying):', err.message);
      }
    };
    socket.on('connect_error', handleConnectError);

    return () => {
      // Keep the socket alive — a later screen (LockStatus) may still need it
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleConnectError);
      socket.off('vibe:end');
      socket.off('match:success');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vibeId]);

  // ─── Countdown — server auto-resolves with no-match on timeout ─
  useEffect(() => {
    if (countdown <= 0) {
      finish(!!matched);
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, matched, finish]);

  // If we arrived already-matched (server resolved before navigation), go straight to LockStatus
  useEffect(() => {
    if (matched) {
      const t = setTimeout(() => finish(true), 1000);
      return () => clearTimeout(t);
    }
  }, [matched, finish]);

  const decide = useCallback((decision: 'lock' | 'pass') => {
    if (hasDecided !== null) return;
    setHasDecided(decision);
    emitWhenConnected(socketRef.current, 'vibe:decision', { vibeId, decision });
    if (decision === 'pass') {
      setTimeout(() => finish(false), 1200);
    }
    // 'lock' — wait for the server's vibe:end / match:success
  }, [hasDecided, vibeId, finish]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={StyleSheet.absoluteFill} />

      <View style={styles.content}>
        <Text style={styles.title}>Time to Decide</Text>

        {!connected && (
          <View style={styles.connectingRow}>
            <ActivityIndicator size="small" color={colors.textPrimary} />
            <Text style={styles.connectingText}>Syncing decision…</Text>
          </View>
        )}

        {hasDecided === null && (
          <View style={styles.countdownCircle}>
            <Text style={styles.countdownText}>{countdown}</Text>
            <Text style={styles.countdownLabel}>seconds</Text>
          </View>
        )}
        <Text style={styles.subtitle}>
          {hasDecided === 'lock'
            ? 'Waiting for their response...'
            : hasDecided === 'pass'
              ? 'Moving on...'
              : 'Did you feel the spark?'}
        </Text>

        {hasDecided === null ? (
          <View style={styles.decisionContainer}>
            <TouchableOpacity
              style={[styles.decisionBtn, styles.passBtn]}
              onPress={() => decide('pass')}
            >
              <Ionicons name="close-outline" size={36} color={colors.error} />
              <Text style={styles.decisionLabel}>Pass</Text>
              <Text style={styles.decisionDesc}>Move to next match</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.decisionBtn, styles.lockBtn]}
              onPress={() => decide('lock')}
            >
              <Ionicons name="lock-closed-outline" size={36} color={colors.vibeLock} />
              <Text style={styles.decisionLabel}>Lock It In</Text>
              <Text style={styles.decisionDesc}>Schedule a date</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.waitingIcon}>
            <Ionicons
              name={hasDecided === 'lock' ? 'lock-closed-outline' : 'close-outline'}
              size={56}
              color={hasDecided === 'lock' ? colors.vibeLock : colors.error}
            />
          </View>
        )}
      </View>

      {hasDecided === 'lock' && (
        <Text style={styles.waitingText}>
          The moment they respond, your result will appear here.
        </Text>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  title: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.xxl },
  connectingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  connectingText: { ...typography.caption, color: colors.textMuted },
  countdownCircle: { width: 120, height: 120, borderRadius: 60, backgroundColor: colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg, borderWidth: 3, borderColor: colors.textPrimary },
  countdownText: { ...typography.countdown, color: colors.textPrimary, fontSize: 48 },
  countdownLabel: { ...typography.caption, color: colors.textMuted },
  subtitle: { ...typography.h4, color: colors.textPrimary, marginBottom: spacing.xxl, marginTop: spacing.lg },
  decisionContainer: { flexDirection: 'row', gap: spacing.lg },
  decisionBtn: { flex: 1, padding: spacing.xxl, borderRadius: radius.xl, alignItems: 'center', borderWidth: 1 },
  passBtn: { backgroundColor: colors.surfaceHighlight, borderColor: colors.textMuted },
  lockBtn: { backgroundColor: colors.surfaceHighlight, borderColor: colors.textMuted },
  decisionLabel: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.xs, marginTop: spacing.sm },
  decisionDesc: { ...typography.caption, color: colors.textMuted },
  waitingIcon: { marginBottom: spacing.lg },
  waitingText: { ...typography.body1, color: colors.textSecondary, textAlign: 'center', paddingBottom: spacing.huge },
});

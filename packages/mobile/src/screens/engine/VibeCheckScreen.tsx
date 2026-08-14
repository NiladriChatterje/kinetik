import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../../theme';
import { getVibeSocket, emitWhenConnected, closeVibeSocket } from '../../services/vibeSocket';
import { useToast } from '../../hooks/useToast';

interface Props { navigation: any; route: any; }

type Phase = 'silhouette' | 'blurred' | 'revealed' | 'decision';

export const VibeCheckScreen: React.FC<Props> = ({ navigation, route }) => {
  const { vibeId, partnerId, partnerName } = route.params || {};
  const [timeLeft, setTimeLeft] = useState(180);
  const [phase, setPhase] = useState<Phase>('silhouette');
  const [isMuted, setIsMuted] = useState(false);
  const [partnerMuted, setPartnerMuted] = useState(false);
  const [connected, setConnected] = useState(false);
  const [decided, setDecided] = useState<'lock' | 'pass' | null>(null);
  const blurAnim = useRef(new Animated.Value(1)).current;
  const socketRef = useRef(getVibeSocket());
  const resolvedRef = useRef(false);
  const serverDrivenRef = useRef(false);
  const errorShownRef = useRef(false);
  const { showError } = useToast();

  // ─── Start the vibe on the shared socket (never disconnect mid-flow) ─
  useEffect(() => {
    const socket = socketRef.current;

    const handleConnect = () => setConnected(true);

    let loggedConnectError = false;
    const handleConnectError = (err: any) => {
      if (!loggedConnectError) {
        loggedConnectError = true;
        console.warn('[VibeSocket] Connection error (will keep retrying):', err.message);
      }
      if (!errorShownRef.current) {
        errorShownRef.current = true;
        showError('Disconnected', 'Vibe Check server unreachable — running locally.');
      }
    };

    socket.on('connect', handleConnect);

    // Start the check once the socket is ready
    if (vibeId && partnerId) {
      emitWhenConnected(socket, 'vibe:start', { vibeId, partnerId });
    }

    // Server echoes vibe:start to both users
    socket.on('vibe:start', (data: any) => {
      serverDrivenRef.current = true;
      setPhase('silhouette');
      if (typeof data.duration === 'number') setTimeLeft(data.duration);
    });

    socket.on('vibe:phase_change', (data: any) => {
      serverDrivenRef.current = true;
      const p = data.phase;
      if (p === 'silhouette' || p === 'blurred' || p === 'revealed' || p === 'decision') {
        setPhase(p);
        if (typeof data.duration === 'number') setTimeLeft(data.duration);
        if (p === 'revealed') {
          Animated.timing(blurAnim, { toValue: 0, duration: 2000, useNativeDriver: false }).start();
        }
      }
    });

    socket.on('vibe:audio_toggle', (data: any) => {
      setPartnerMuted(!!data.partnerMuted);
    });

    // Vibe resolved — mutual lock goes to the Commitment gate
    socket.on('vibe:end', (data: any) => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      if (data?.mutualLock) {
        navigation.replace('Commitment', { vibeId, matched: true });
      } else {
        closeVibeSocket();
        navigation.replace('Main');
      }
    });

    // Direct match:success signal (defensive)
    socket.on('match:success', () => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      navigation.replace('Commitment', { vibeId, matched: true });
    });

    socket.on('connect_error', handleConnectError);

    return () => {
      // Remove ONLY our listeners — keep the socket alive for the Commitment gate
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleConnectError);
      socket.off('vibe:start');
      socket.off('vibe:phase_change');
      socket.off('vibe:audio_toggle');
      socket.off('vibe:end');
      socket.off('match:success');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vibeId, partnerId]);

  // ─── Countdown display timer ──────────────────────────
  useEffect(() => {
    const timer = setInterval(() => setTimeLeft((t) => Math.max(0, t - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  // ─── Local fallback phase progression (only if server never responds) ─
  useEffect(() => {
    if (serverDrivenRef.current) return;
    const phase1 = setTimeout(() => { if (!serverDrivenRef.current) setPhase('blurred'); }, 60000);
    const phase2 = setTimeout(() => {
      if (!serverDrivenRef.current) {
        setPhase('revealed');
        Animated.timing(blurAnim, { toValue: 0, duration: 2000, useNativeDriver: false }).start();
      }
    }, 120000);
    const phase3 = setTimeout(() => { if (!serverDrivenRef.current) setPhase('decision'); }, 180000);
    return () => { clearTimeout(phase1); clearTimeout(phase2); clearTimeout(phase3); };
  }, [blurAnim]);

  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;

  const handleDecision = useCallback((decision: 'lock' | 'pass') => {
    if (decided || resolvedRef.current) return;
    setDecided(decision);
    const socket = socketRef.current;
    emitWhenConnected(socket, 'vibe:decision', { vibeId, decision });
    if (decision === 'lock') {
      // Wait for partner at the Commitment gate — server resolves when both decide
      navigation.replace('Commitment', { vibeId });
    } else {
      resolvedRef.current = true;
      closeVibeSocket();
      navigation.replace('Main');
    }
  }, [decided, vibeId, navigation]);

  const toggleMute = useCallback(() => {
    const next = !isMuted;
    setIsMuted(next);
    emitWhenConnected(socketRef.current, 'vibe:audio_toggle', { vibeId, muted: next });
  }, [isMuted, vibeId]);

  const handleEnd = useCallback(() => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    emitWhenConnected(socketRef.current, 'vibe:decision', { vibeId, decision: 'pass' });
    closeVibeSocket();
    navigation.replace('Main');
  }, [vibeId, navigation]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={StyleSheet.absoluteFill} />

      {/* Timer */}
      <View style={styles.timerSection}>
        {!connected && (
          <View style={styles.connectingRow}>
            <ActivityIndicator size="small" color={colors.textPrimary} />
            <Text style={styles.connectingText}>Connecting…</Text>
          </View>
        )}
        <Text style={styles.timer}>{mins}:{String(secs).padStart(2, '0')}</Text>
        <Text style={styles.phaseText}>
          {phase === 'silhouette' ? 'Audio Only' : phase === 'blurred' ? 'Visual Starting...' : phase === 'revealed' ? 'Connected' : 'Decision Time'}
        </Text>
        <View style={styles.phaseDots}>
          {['silhouette', 'blurred', 'revealed'].map((p) => (
            <View key={p} style={[styles.phaseDot, phase === p && styles.phaseDotActive]} />
          ))}
        </View>
      </View>

      {/* Partner Display */}
      <View style={styles.partnerSection}>
        <Animated.View style={[styles.partnerImage]}>
          {phase === 'silhouette' && (
            <View style={styles.silhouette}>
              <Ionicons name="person-outline" size={64} color={colors.textMuted} />
              <Text style={styles.silhouetteName}>{partnerName || 'Stranger'}</Text>
              <Text style={styles.silhouetteLabel}>Audio Only - 0:00 to 1:00</Text>
            </View>
          )}
          {phase === 'blurred' && (
            <View style={styles.blurredView}>
              <Ionicons name="person-outline" size={64} color={colors.textSecondary} />
              <Text style={styles.silhouetteName}>{partnerName || 'Stranger'}</Text>
              <Text style={styles.silhouetteLabel}>Image revealing... - 1:00 to 2:00</Text>
            </View>
          )}
          {phase === 'revealed' && (
            <View style={styles.revealedView}>
              <Ionicons name="happy-outline" size={64} color={colors.textPrimary} />
              <Text style={styles.silhouetteName}>{partnerName || 'Stranger'}</Text>
              <Text style={styles.silhouetteLabel}>Full profile visible - 2:00 to 3:00</Text>
            </View>
          )}
        </Animated.View>
        {partnerMuted && (
          <View style={styles.partnerMutedBadge}>
            <Ionicons name="volume-mute-outline" size={12} color={colors.textSecondary} />
            <Text style={styles.partnerMutedText}>Partner is muted</Text>
          </View>
        )}
      </View>

      {/* Audio Controls */}
      <View style={styles.controls}>
        <TouchableOpacity style={styles.controlBtn} onPress={toggleMute}>
          <Ionicons name={isMuted ? 'volume-mute-outline' : 'mic-outline'} size={28} color={isMuted ? colors.textMuted : colors.textPrimary} />
          <Text style={styles.controlLabel}>{isMuted ? 'Unmute' : 'Mute'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.controlBtn, styles.endCallBtn]} onPress={handleEnd}>
          <Ionicons name="stop-circle-outline" size={28} color={colors.error} />
          <Text style={styles.controlLabel}>End</Text>
        </TouchableOpacity>
        <View style={styles.controlBtn}>
          <Ionicons name="call-outline" size={28} color={colors.textPrimary} />
          <Text style={styles.controlLabel}>Speaker</Text>
        </View>
      </View>

      {/* Decision Phase */}
      {phase === 'decision' && (
        <View style={styles.decisionBar}>
          <Text style={styles.decisionLabel}>Mutual interest?</Text>
          <View style={styles.decisionBtns}>
            <TouchableOpacity
              style={[styles.decisionBtn, styles.passBtn]}
              onPress={() => handleDecision('pass')}
              disabled={decided !== null}
            >
              <Ionicons name="close-outline" size={20} color={colors.textInverse} style={{ marginRight: spacing.sm }} />
              <Text style={styles.decisionBtnText}>Pass</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.decisionBtn, styles.lockBtn]}
              onPress={() => handleDecision('lock')}
              disabled={decided !== null}
            >
              <Ionicons name="lock-closed-outline" size={20} color={colors.textInverse} style={{ marginRight: spacing.sm }} />
              <Text style={styles.decisionBtnText}>Lock It In</Text>
            </TouchableOpacity>
          </View>
          {decided === 'lock' && (
            <Text style={styles.waitingText}>Heading to the Commitment Gate…</Text>
          )}
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  timerSection: { alignItems: 'center', paddingTop: spacing.xxl },
  connectingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  connectingText: { ...typography.caption, color: colors.textMuted },
  timer: { ...typography.timer, color: colors.textPrimary },
  phaseText: { ...typography.body1, color: colors.textPrimary },
  phaseDots: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  phaseDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.surfaceHighlight },
  phaseDotActive: { backgroundColor: colors.textPrimary },
  partnerSection: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  partnerImage: { width: 200, height: 200, borderRadius: 100, backgroundColor: colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center' },
  silhouette: { alignItems: 'center' },
  silhouetteName: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.sm },
  silhouetteLabel: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  blurredView: { alignItems: 'center', opacity: 0.3 },
  revealedView: { alignItems: 'center' },
  partnerMutedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    marginTop: spacing.md, backgroundColor: colors.surfaceHighlight,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.full,
  },
  partnerMutedText: { ...typography.caption, color: colors.textSecondary },
  controls: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xxl, paddingBottom: spacing.xxl },
  controlBtn: { alignItems: 'center' },
  controlLabel: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  endCallBtn: {},
  decisionBar: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.huge },
  decisionLabel: { ...typography.h4, color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.lg },
  decisionBtns: { flexDirection: 'row', gap: spacing.lg },
  decisionBtn: { flex: 1, flexDirection: 'row', paddingVertical: spacing.lg, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  passBtn: { backgroundColor: colors.textPrimary },
  lockBtn: { backgroundColor: colors.textPrimary },
  decisionBtnText: { ...typography.button, color: colors.textInverse },
  waitingText: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.md },
});

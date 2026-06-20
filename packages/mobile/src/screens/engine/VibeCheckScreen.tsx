import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../../theme';

interface Props { navigation: any; route: any; }

export const VibeCheckScreen: React.FC<Props> = ({ navigation, route }) => {
  const { vibeId, partnerName } = route.params || {};
  const [timeLeft, setTimeLeft] = useState(180);
  const [phase, setPhase] = useState<'silhouette' | 'blurred' | 'revealed' | 'decision'>('silhouette');
  const [isMuted, setIsMuted] = useState(false);
  const blurAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const timer = setInterval(() => setTimeLeft((t) => Math.max(0, t - 1)), 1000);
    const phase1 = setTimeout(() => setPhase('blurred'), 60000);
    const phase2 = setTimeout(() => { setPhase('revealed'); Animated.timing(blurAnim, { toValue: 0, duration: 2000, useNativeDriver: false }).start(); }, 120000);
    const phase3 = setTimeout(() => setPhase('decision'), 180000);
    return () => { clearInterval(timer); clearTimeout(phase1); clearTimeout(phase2); clearTimeout(phase3); };
  }, []);

  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;

  const handleDecision = (decision: 'lock' | 'pass') => {
    if (decision === 'lock') {
      navigation.replace('Commitment', { vibeId });
    } else {
      navigation.goBack();
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={StyleSheet.absoluteFill} />

      {/* Timer */}
      <View style={styles.timerSection}>
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
        <Animated.View style={[styles.partnerImage, { opacity: phase === 'silhouette' ? 1 : 1 }]}>
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
              <Text style={styles.silhouetteName}>{partnerName}</Text>
              <Text style={styles.silhouetteLabel}>Image revealing... - 1:00 to 2:00</Text>
            </View>
          )}
          {phase === 'revealed' && (
            <View style={styles.revealedView}>
              <Ionicons name="happy-outline" size={64} color={colors.textPrimary} />
              <Text style={styles.silhouetteName}>{partnerName}</Text>
              <Text style={styles.silhouetteLabel}>Full profile visible - 2:00 to 3:00</Text>
            </View>
          )}
        </Animated.View>
      </View>

      {/* Audio Controls */}
      <View style={styles.controls}>
        <TouchableOpacity style={styles.controlBtn} onPress={() => setIsMuted(!isMuted)}>
          <Ionicons name={isMuted ? 'volume-mute-outline' : 'mic-outline'} size={28} color={isMuted ? colors.textMuted : colors.textPrimary} />
          <Text style={styles.controlLabel}>{isMuted ? 'Unmute' : 'Mute'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.controlBtn, styles.endCallBtn]}>
          <Ionicons name="stop-circle-outline" size={28} color={colors.error} />
          <Text style={styles.controlLabel}>End</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlBtn}>
          <Ionicons name="call-outline" size={28} color={colors.textPrimary} />
          <Text style={styles.controlLabel}>Speaker</Text>
        </TouchableOpacity>
      </View>

      {/* Decision Phase */}
      {phase === 'decision' && (
        <View style={styles.decisionBar}>
          <Text style={styles.decisionLabel}>Mutual interest?</Text>
          <View style={styles.decisionBtns}>
            <TouchableOpacity style={[styles.decisionBtn, styles.passBtn]} onPress={() => handleDecision('pass')}>
              <Ionicons name="close-outline" size={20} color={colors.textInverse} style={{ marginRight: spacing.sm }} />
              <Text style={styles.decisionBtnText}>Pass</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.decisionBtn, styles.lockBtn]} onPress={() => handleDecision('lock')}>
              <Ionicons name="lock-closed-outline" size={20} color={colors.textInverse} style={{ marginRight: spacing.sm }} />
              <Text style={styles.decisionBtnText}>Lock It In</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  timerSection: { alignItems: 'center', paddingTop: spacing.xxl },
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
});

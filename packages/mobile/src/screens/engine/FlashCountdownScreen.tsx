import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { colors, typography, spacing, radius } from '../../theme';
import { api } from '../../services/api';

export const FlashCountdownScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [timeLeft, setTimeLeft] = useState(47 * 60 + 32); // 47:32 until next window
  const [locationName, setLocationName] = useState<string | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const interval = setInterval(() => setTimeLeft((t) => Math.max(0, t - 1)), 1000);
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.05, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ]),
    );
    pulse.start();

    // Fetch user profile to get the reverse-geocoded location (county)
    api.getProfile().then((res) => {
      if (res.success && res.data) {
        const d = res.data as any;
        setLocationName(d.county || d.city || null);
      }
    }).catch(() => {});

    return () => { clearInterval(interval); pulse.stop(); };
  }, []);

  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;
  const displayLocation = locationName || 'Your Area';
  const participants = 1284;

  const handleJoin = () => navigation.navigate('ActiveRadar');

  return (
    <SafeAreaView style={styles.container}>
      <View style={StyleSheet.absoluteFill} />

      <View style={styles.header}>
        <Text style={styles.greeting}>Tonight's Window</Text>
        <View style={styles.locationBadge}>
          <Ionicons name="location-outline" size={16} color={colors.textSecondary} style={{ marginRight: 4 }} />
          <Text style={styles.locationText}>{displayLocation}</Text>
        </View>
      </View>

      <View style={styles.countdownSection}>
        <Animated.View style={[styles.countdownCircle, { transform: [{ scale: pulseAnim }] }]}>
          <View style={styles.countdownFace}>
            <Text style={styles.countdownTimer}>
              {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
            </Text>
            <Text style={styles.countdownLabel}>until flash window</Text>
          </View>
        </Animated.View>
      </View>

      <View style={styles.statsRow}>
        <Card style={styles.statCard}>
          <Text style={styles.statNumber}>{participants}</Text>
          <Text style={styles.statLabel}>Live Now</Text>
        </Card>
        <Card style={styles.statCard}>
          <Text style={styles.statNumber}>{Math.floor(participants * 0.6)}</Text>
          <Text style={styles.statLabel}>In Queue</Text>
        </Card>
        <Card style={styles.statCard}>
          <Text style={styles.statNumber}>{Math.floor(participants * 0.15)}</Text>
          <Text style={styles.statLabel}>Matches</Text>
        </Card>
      </View>

      <Text style={styles.infoText}>
        At 8:30 PM, the queue opens. You'll be matched live for{'\n'}
        3-minute Vibe Checks. No swiping, no texting.
      </Text>

      <View style={styles.bottomSection}>
        <Button
          title="Join the Queue"
          onPress={handleJoin}
          fullWidth
          size="lg"
          icon={<Ionicons name="enter-outline" size={20} color={colors.textPrimary} />}
        />
        <Text style={styles.hintText}>2,340 people are queued in your area</Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.xxl },
  header: { alignItems: 'center', marginTop: spacing.xxl },
  greeting: { ...typography.h2, color: colors.textPrimary },
  locationBadge: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, backgroundColor: colors.surfaceHighlight, borderRadius: radius.full },
  locationText: { ...typography.body2, color: colors.textSecondary },
  countdownSection: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  countdownCircle: { width: 220, height: 220, borderRadius: 110, overflow: 'hidden' },
  countdownFace: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.textPrimary },
  countdownTimer: { ...typography.countdown, color: colors.textPrimary },
  countdownLabel: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xxl },
  statCard: { flex: 1, marginHorizontal: spacing.xs, alignItems: 'center', padding: spacing.md },
  statNumber: { ...typography.h3, color: colors.textPrimary },
  statLabel: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  infoText: { ...typography.body2, color: colors.textMuted, textAlign: 'center', lineHeight: 22, marginBottom: spacing.xxl },
  bottomSection: { marginBottom: spacing.huge },
  hintText: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
});

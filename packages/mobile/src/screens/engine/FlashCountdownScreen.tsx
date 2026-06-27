import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, Animated, TouchableOpacity,
  Modal, ActivityIndicator, Dimensions, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { colors, typography, spacing, radius } from '../../theme';
import { api } from '../../services/api';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const MODAL_SHEET_HEIGHT = 400;

interface AreaDetails {
  latitude: number | null;
  longitude: number | null;
  h3Index: string | null;
  city: string | null;
  county: string | null;
  region: string | null;
  country: string | null;
  locationUpdatedAt: string | null;
}

export const FlashCountdownScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [timeLeft, setTimeLeft] = useState(47 * 60 + 32);
  const [locationName, setLocationName] = useState<string | null>(null);
  const [areaDetails, setAreaDetails] = useState<AreaDetails | null>(null);
  const [areaLoading, setAreaLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [lastPolled, setLastPolled] = useState<string | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(MODAL_SHEET_HEIGHT)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // ─── Fetch location on mount (single fetch — backend handles 3-min polling) ─
  const fetchAreaDetails = useCallback(async () => {
    try {
      const details = await api.getAreaDetails();
      setAreaDetails(details);
      setLocationName(details.county || details.city || 'Your Area');
      setLastPolled(new Date().toLocaleTimeString());
    } catch {
      setLocationName('Your Area');
    }
  }, []);

  useEffect(() => {
    fetchAreaDetails();
  }, [fetchAreaDetails]);

  // ─── Countdown timer ──────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => setTimeLeft((t) => Math.max(0, t - 1)), 1000);
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.05, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => { clearInterval(interval); pulse.stop(); };
  }, []);

  // ─── Modal animations ─────────────────────────────────
  useEffect(() => {
    if (modalVisible) {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0, damping: 20, stiffness: 200, mass: 1, useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: MODAL_SHEET_HEIGHT, duration: 200, useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      ]).start();
    }
  }, [modalVisible, slideAnim, fadeAnim]);

  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;
  const displayLocation = locationName || 'Your Area';
  const participants = 1284;

  const handleJoin = () => navigation.navigate('ActiveRadar');

  const openAreaModal = useCallback(() => {
    setModalVisible(true);
  }, []);

  const closeAreaModal = useCallback(() => {
    setModalVisible(false);
  }, []);

  // ─── Build location parts string ──────────────────────
  const locationParts = [
    areaDetails?.city,
    areaDetails?.county,
    areaDetails?.region,
  ].filter(Boolean);
  const locationFull = locationParts.length > 0 ? locationParts.join(', ') : null;

  return (
    <SafeAreaView style={styles.container}>
      <View style={StyleSheet.absoluteFill} />

      {/* Header with clickable location chip */}
      <View style={styles.header}>
        <Text style={styles.greeting}>Tonight's Window</Text>
        <TouchableOpacity
          style={styles.locationBadge}
          onPress={openAreaModal}
          activeOpacity={0.7}
        >
          <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.locationText}>{displayLocation}</Text>
          <Ionicons name="chevron-up" size={14} color={colors.textMuted} style={{ marginLeft: 4 }} />
        </TouchableOpacity>
      </View>

      {/* Countdown */}
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

      {/* Stats */}
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

      {/* ─── Area Details Bottom-Sheet Modal ──────────────── */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="none"
        onRequestClose={closeAreaModal}
        statusBarTranslucent
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={closeAreaModal}
        >
          <Animated.View
            style={[
              styles.sheet,
              { transform: [{ translateY: slideAnim }] },
            ]}
          >
            <TouchableOpacity activeOpacity={1} onPress={() => {}}>
              {/* Handle bar */}
              <View style={styles.handleBar} />

              <ScrollView
                bounces={false}
                showsVerticalScrollIndicator={false}
              >
                {/* Header */}
                <View style={styles.modalHeader}>
                  <View style={styles.modalIconRow}>
                    <Ionicons name="map-outline" size={22} color={colors.textPrimary} />
                    <Text style={styles.modalTitle}>Your Area</Text>
                  </View>
                </View>

                {/* Location details */}
                <View style={styles.detailCards}>
                  {/* City / County */}
                  <View style={styles.detailRow}>
                    <View style={styles.detailIconWrap}>
                      <Ionicons name="home-outline" size={18} color={colors.textPrimary} />
                    </View>
                    <View style={styles.detailContent}>
                      <Text style={styles.detailLabel}>Location</Text>
                      <Text style={styles.detailValue}>
                        {locationFull || 'Not available'}
                      </Text>
                    </View>
                  </View>

                  {/* Country */}
                  {areaDetails?.country && (
                    <View style={styles.detailRow}>
                      <View style={styles.detailIconWrap}>
                        <Ionicons name="globe-outline" size={18} color={colors.textPrimary} />
                      </View>
                      <View style={styles.detailContent}>
                        <Text style={styles.detailLabel}>Country</Text>
                        <Text style={styles.detailValue}>{areaDetails.country}</Text>
                      </View>
                    </View>
                  )}

                  {/* H3 hexagon */}
                  {areaDetails?.h3Index && (
                    <View style={styles.detailRow}>
                      <View style={styles.detailIconWrap}>
                        <Ionicons name="hexagon-outline" size={18} color={colors.textPrimary} />
                      </View>
                      <View style={styles.detailContent}>
                        <Text style={styles.detailLabel}>H3 Grid Cell</Text>
                        <Text style={styles.detailValueMono}>{areaDetails.h3Index}</Text>
                      </View>
                    </View>
                  )}

                  {/* Coordinates */}
                  <View style={styles.detailRow}>
                    <View style={styles.detailIconWrap}>
                      <Ionicons name="navigate-outline" size={18} color={colors.textPrimary} />
                    </View>
                    <View style={styles.detailContent}>
                      <Text style={styles.detailLabel}>Coordinates</Text>
                      <Text style={styles.detailValueMono}>
                        {areaDetails?.latitude?.toFixed(4)}, {areaDetails?.longitude?.toFixed(4)}
                      </Text>
                    </View>
                  </View>

                  {/* Last updated */}
                  <View style={styles.detailRow}>
                    <View style={styles.detailIconWrap}>
                      <Ionicons name="time-outline" size={18} color={colors.textPrimary} />
                    </View>
                    <View style={styles.detailContent}>
                      <Text style={styles.detailLabel}>Last Updated</Text>
                      <Text style={styles.detailValue}>
                        {lastPolled || 'Just now'}
                        {'  ·  '}Backend updates every 3 min
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Refresh button */}
                <TouchableOpacity
                  style={styles.refreshRow}
                  onPress={() => {
                    setAreaLoading(true);
                    fetchAreaDetails().finally(() => setAreaLoading(false));
                  }}
                  disabled={areaLoading}
                  activeOpacity={0.7}
                >
                  {areaLoading ? (
                    <ActivityIndicator size="small" color={colors.textPrimary} />
                  ) : (
                    <Ionicons name="refresh-outline" size={18} color={colors.textPrimary} />
                  )}
                  <Text style={styles.refreshText}>
                    {areaLoading ? 'Updating...' : 'Refresh Now'}
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            </TouchableOpacity>
          </Animated.View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.xxl },

  // Header
  header: { alignItems: 'center', marginTop: spacing.xxl },
  greeting: { ...typography.h2, color: colors.textPrimary },
  locationBadge: {
    flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceHighlight, borderRadius: radius.full,
  },
  locationText: { ...typography.body2, color: colors.textSecondary, marginHorizontal: spacing.xs },

  // Countdown
  countdownSection: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  countdownCircle: { width: 220, height: 220, borderRadius: 110, overflow: 'hidden' },
  countdownFace: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.textPrimary },
  countdownTimer: { ...typography.countdown, color: colors.textInverse },
  countdownLabel: { ...typography.caption, color: colors.textInverse, marginTop: spacing.xs, opacity: 0.7 },

  // Stats
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xxl },
  statCard: { flex: 1, marginHorizontal: spacing.xs, alignItems: 'center', padding: spacing.md },
  statNumber: { ...typography.h3, color: colors.textPrimary },
  statLabel: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },

  infoText: { ...typography.body2, color: colors.textMuted, textAlign: 'center', lineHeight: 22, marginBottom: spacing.xxl },
  bottomSection: { marginBottom: spacing.huge },
  hintText: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },

  // Modal
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.huge,
    paddingHorizontal: spacing.xxl,
    maxHeight: SCREEN_HEIGHT * 0.7,
  },
  handleBar: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: colors.surfaceHighlight,
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },

  // Modal header
  modalHeader: { marginBottom: spacing.lg },
  modalIconRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  modalTitle: { ...typography.h3, color: colors.textPrimary },

  // Detail cards
  detailCards: { gap: spacing.sm, marginBottom: spacing.lg },
  detailRow: {
    flexDirection: 'row', alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    gap: spacing.md,
  },
  detailIconWrap: {
    width: 36, height: 36, borderRadius: radius.sm,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center', justifyContent: 'center',
  },
  detailContent: { flex: 1 },
  detailLabel: { ...typography.caption, color: colors.textMuted, marginBottom: 2 },
  detailValue: { ...typography.body2, color: colors.textPrimary, fontWeight: '500' },
  detailValueMono: {
    ...typography.body2, color: colors.textPrimary, fontWeight: '500',
    fontFamily: 'monospace', fontSize: 12,
  },

  // Refresh
  refreshRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, paddingVertical: spacing.md,
    borderRadius: radius.md, backgroundColor: colors.surfaceHighlight,
  },
  refreshText: { ...typography.body2, color: colors.textSecondary, fontWeight: '600' },
});

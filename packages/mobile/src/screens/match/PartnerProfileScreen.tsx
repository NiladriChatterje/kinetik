import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../services/api';
import { Button } from '../../components/common/Button';
import { ReportBlockSheet } from '../../components/safety/ReportBlockSheet';
import { SwipeCard, SwipeProfile } from './MatchScreen';
import { colors, typography, spacing, radius } from '../../theme';

/**
 * A match partner's full profile, opened from the chat by tapping their
 * photo: the same card Discover shows, read only, with report / block.
 */
export const PartnerProfileScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { matchId, partnerId, partnerName } = useRoute<any>().params as {
    matchId: string;
    partnerId: string;
    partnerName: string;
  };
  const [profile, setProfile] = useState<SwipeProfile | null>(null);
  const [loading, setLoading] = useState(true);
  // The server said the profile is gone (match over, block, account closed)
  const [unavailable, setUnavailable] = useState(false);
  const [safetyVisible, setSafetyVisible] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getMatchPartnerProfile(matchId);
      if (res.success && res.data?.profile) {
        setProfile(res.data.profile);
      } else if (res.error?.code === 'NOT_FOUND') {
        setUnavailable(true);
      }
    } catch {
      // Shown as a failed load, with Try again
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{partnerName}</Text>
        <TouchableOpacity
          style={styles.safetyBtn}
          onPress={() => setSafetyVisible(true)}
          activeOpacity={0.7}
          accessibilityLabel="Report or block"
        >
          <Ionicons name="flag-outline" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : profile ? (
        <View style={styles.card}>
          <SwipeCard profile={profile} />
        </View>
      ) : (
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={28} color={colors.textSecondary} />
          <Text style={styles.noticeText}>
            {unavailable ? 'This profile is no longer available.' : "Couldn't load this profile."}
          </Text>
          {!unavailable && <Button title="Try again" onPress={load} variant="outline" size="sm" />}
        </View>
      )}

      {/* A block ends the chat underneath as well: both screens go */}
      <ReportBlockSheet
        visible={safetyVisible}
        userId={partnerId}
        name={partnerName}
        matchId={matchId}
        onClose={() => setSafetyVisible(false)}
        onBlocked={() => navigation.pop(2)}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { ...typography.h2, color: colors.textPrimary, flex: 1 },
  safetyBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The deck's card: rounded at the top, flat, running to the bottom
  card: {
    flex: 1,
    marginHorizontal: spacing.md,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xxl },
  noticeText: { ...typography.body2, color: colors.textSecondary, textAlign: 'center' },
});

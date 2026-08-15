import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Image, TouchableOpacity,
  ActivityIndicator, RefreshControl, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../services/api';
import { resolveUrl } from '../../config';
import { colors, typography, spacing, radius } from '../../theme';

interface GridProfile {
  userId: string;
  displayName: string;
  age: number;
  bio: string;
  occupation?: string;
  isVerified: boolean;
  photos: { id: string; url: string; thumbnailUrl?: string; isPrimary: boolean }[];
  interests: { id: string; name: string; emoji: string; category: string }[];
}

const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_GAP = spacing.md;
const CARD_WIDTH = (SCREEN_WIDTH - spacing.xxl * 2 - GRID_GAP) / 2;
// Alternating tall/short cards per column, offset between columns → staggered look
const TALL = Math.round(CARD_WIDTH * 1.45);
const SHORT = Math.round(CARD_WIDTH * 1.1);

export const ExploreScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [profiles, setProfiles] = useState<GridProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchProfiles = useCallback(async (asRefresh = false) => {
    asRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const res = await api.getSwipeProfiles();
      if (res.success && res.data) {
        setProfiles(res.data.profiles || []);
      }
    } catch {
      // Keep whatever is on screen — user can pull to retry
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  const openProfile = (profile: GridProfile) => {
    navigation.navigate('Match', { focusProfile: profile });
  };

  const primaryPhoto = (p: GridProfile) =>
    p.photos.find((ph) => ph.isPrimary) || p.photos[0];

  const renderCard = (profile: GridProfile, height: number) => {
    const photo = primaryPhoto(profile);
    return (
      <TouchableOpacity
        key={profile.userId}
        style={[styles.card, { height }]}
        activeOpacity={0.85}
        onPress={() => openProfile(profile)}
      >
        {photo ? (
          <Image
            source={{ uri: resolveUrl(photo.thumbnailUrl || photo.url) }}
            style={styles.cardImage}
          />
        ) : (
          <View style={[styles.cardImage, styles.noPhoto]}>
            <Ionicons name="person-outline" size={36} color={colors.textMuted} />
          </View>
        )}

        {profile.photos.length > 1 && (
          <View style={styles.photoCountBadge}>
            <Ionicons name="images-outline" size={11} color="#fff" />
            <Text style={styles.photoCountText}>{profile.photos.length}</Text>
          </View>
        )}

        <View style={styles.cardScrim}>
          <View style={styles.nameRow}>
            <Text style={styles.cardName} numberOfLines={1}>
              {profile.displayName}, {profile.age}
            </Text>
            {profile.isVerified && (
              <Ionicons name="checkmark-circle" size={14} color={colors.success} />
            )}
          </View>
          {profile.occupation ? (
            <Text style={styles.cardSub} numberOfLines={1}>{profile.occupation}</Text>
          ) : profile.interests.length > 0 ? (
            <Text style={styles.cardSub} numberOfLines={1}>
              {profile.interests.slice(0, 2).map((i) => i.name).join(' · ')}
            </Text>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  // Distribute into two columns; opposite tall/short phase per column staggers the rows
  const leftColumn = profiles.filter((_, i) => i % 2 === 0);
  const rightColumn = profiles.filter((_, i) => i % 2 === 1);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Explore</Text>
          <Text style={styles.headerSub}>Fresh faces, picked at random</Text>
        </View>
        <TouchableOpacity
          style={styles.shuffleBtn}
          onPress={() => fetchProfiles()}
          activeOpacity={0.7}
        >
          <Ionicons name="shuffle" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Gathering profiles…</Text>
        </View>
      ) : profiles.length === 0 ? (
        <View style={styles.centered}>
          <View style={styles.emptyCircle}>
            <Ionicons name="telescope-outline" size={40} color={colors.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>No one new right now</Text>
          <Text style={styles.emptySubtitle}>
            You've seen everyone nearby. Check back soon or widen your preferences.
          </Text>
          <TouchableOpacity style={styles.refreshBtn} onPress={() => fetchProfiles()}>
            <Text style={styles.refreshBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.gridContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchProfiles(true)}
              tintColor={colors.textPrimary}
            />
          }
        >
          <View style={styles.gridRow}>
            <View style={styles.gridColumn}>
              {leftColumn.map((p, i) => renderCard(p, i % 2 === 0 ? TALL : SHORT))}
            </View>
            <View style={styles.gridColumn}>
              {rightColumn.map((p, i) => renderCard(p, i % 2 === 0 ? SHORT : TALL))}
            </View>
          </View>
          <Text style={styles.footerHint}>Tap a profile to view and decide</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
  },
  headerTitle: { ...typography.h2, color: colors.textPrimary },
  headerSub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  shuffleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceHighlight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xxl },
  loadingText: { ...typography.body2, color: colors.textMuted, marginTop: spacing.lg },
  emptyCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.sm },
  emptySubtitle: {
    ...typography.body2,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacing.xl,
  },
  refreshBtn: {
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
  },
  refreshBtnText: { ...typography.button, color: colors.textInverse },
  gridContent: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxl },
  gridRow: { flexDirection: 'row', gap: GRID_GAP },
  gridColumn: { flex: 1, gap: GRID_GAP },
  card: {
    width: CARD_WIDTH,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceHighlight,
  },
  cardImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  noPhoto: { justifyContent: 'center', alignItems: 'center' },
  photoCountBadge: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  photoCountText: { ...typography.caption, fontSize: 10, color: '#fff', fontWeight: '600' },
  cardScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardName: { ...typography.body2, color: '#fff', fontWeight: '700', flexShrink: 1 },
  cardSub: { ...typography.caption, color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 1 },
  footerHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});

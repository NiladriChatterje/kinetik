import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../services/api';
import { ProgressiveImage } from '../../components/common/ProgressiveImage';
import { DatingCategoryBadge, DatingCategory } from '../../components/common/DatingCategoryBadge';
import { getPresenceSocket } from '../../services/presenceSocket';
import { onProfileLiked, onPremiumChanged } from '../../services/appEvents';
import { resolveUrl } from '../../config';
import { colors, typography, spacing, radius } from '../../theme';

interface GridProfile {
  userId: string;
  displayName: string;
  age: number;
  bio: string;
  occupation?: string;
  isVerified: boolean;
  datingCategory?: DatingCategory;
  photos: { id: string; url: string; thumbnailUrl?: string; isPrimary: boolean }[];
  interests: { id: string; name: string; emoji: string; category: string }[];
  /** Attached on-device by rankByProximity */
  distanceKm?: number;
  /** This person liked the viewer while the grid was open (live socket):
   *  the card is greyed and labelled, and leaves on the next load, where
   *  the server keeps pending likers out of Explore */
  likedYou?: boolean;
}

const PAGE_SIZE = 24;

// ─── Layout ───────────────────────────────────────────────
// The page reads top to bottom in distance bands ("Within 5 km", …). Inside
// a band the nearest person gets a full-width card, the next four come as
// two pairs, then the rhythm repeats: one big, two rows of two. Text sits
// under the photo in black on white, never printed over it, so the photo
// stays a photo and every name is readable whatever the picture.
const SCREEN_WIDTH = Dimensions.get('window').width;
const GAP = spacing.md;
const CONTENT_WIDTH = SCREEN_WIDTH - spacing.xxl * 2;
const PAIR_WIDTH = (CONTENT_WIDTH - GAP) / 2;
// A near-square hero and 5:6 pairs: a hero plus one pair fit on one screen
const HERO_PHOTO_H = Math.round(CONTENT_WIDTH * 0.9);
const PAIR_PHOTO_H = Math.round(PAIR_WIDTH * 1.2);
/** Profiles per rhythm inside a band: one hero, then two pairs */
const RHYTHM = 5;

type Row =
  | { kind: 'band'; key: string; label: string }
  | { kind: 'hero'; key: string; profile: GridProfile }
  | { kind: 'pair'; key: string; profiles: [GridProfile, GridProfile | undefined] };

/** The band a profile falls in; the server already orders nearest first, NULL last. */
function bandLabel(distanceKm: number | undefined): string {
  if (distanceKm == null) return 'Distance unknown';
  if (distanceKm < 5) return 'Within 5 km';
  if (distanceKm < 20) return '5 to 20 km';
  if (distanceKm < 50) return '20 to 50 km';
  return 'Further away';
}

/**
 * Profiles → rows for the list. Bands are shown only when the viewer has a
 * location (some distance is known); without one the list is a single
 * unlabelled rhythm. A dropped profile simply reflows the rows after it.
 */
function buildRows(profiles: GridProfile[]): Row[] {
  const withBands = profiles.some((p) => p.distanceKm != null);
  const rows: Row[] = [];
  let band: string | null = null;
  let posInBand = 0;
  let pending: GridProfile | null = null;

  const flushPair = () => {
    if (pending) {
      rows.push({ kind: 'pair', key: `pair:${pending.userId}`, profiles: [pending, undefined] });
      pending = null;
    }
  };

  for (const p of profiles) {
    const label = withBands ? bandLabel(p.distanceKm) : '';
    if (withBands && label !== band) {
      flushPair();
      band = label;
      posInBand = 0;
      rows.push({ kind: 'band', key: `band:${label}`, label });
    }
    if (posInBand % RHYTHM === 0) {
      flushPair();
      rows.push({ kind: 'hero', key: `hero:${p.userId}`, profile: p });
    } else if (pending) {
      rows.push({ kind: 'pair', key: `pair:${pending.userId}`, profiles: [pending, p] });
      pending = null;
    } else {
      pending = p;
    }
    posInBand += 1;
  }
  flushPair();
  return rows;
}

/** Cross on the Face unverified tag, as on the Discover card */
const UNVERIFIED_RED = '#E53935';

const primaryPhoto = (p: GridProfile) => p.photos.find((ph) => ph.isPrimary) || p.photos[0];

/** One person: photo on top, name and details underneath. */
const ProfileTile = React.memo(function ProfileTile({
  profile,
  hero,
  onPress,
}: {
  profile: GridProfile;
  hero: boolean;
  onPress: (profile: GridProfile) => void;
}) {
  const photo = primaryPhoto(profile);
  const width = hero ? CONTENT_WIDTH : PAIR_WIDTH;
  const photoHeight = hero ? HERO_PHOTO_H : PAIR_PHOTO_H;
  const details = [
    profile.occupation || profile.interests.slice(0, 2).map((i) => i.name).join(' · ') || null,
    profile.distanceKm != null ? `~${profile.distanceKm} km` : null,
  ].filter(Boolean).join(' · ');

  return (
    <TouchableOpacity
      style={{ width }}
      activeOpacity={0.85}
      onPress={() => onPress(profile)}
      accessibilityRole="button"
      accessibilityLabel={`${profile.displayName}, ${profile.age}`}
    >
      <View style={[styles.photoFrame, { height: photoHeight }]}>
        {photo ? (
          <ProgressiveImage
            uri={resolveUrl(photo.thumbnailUrl || photo.url)}
            style={[styles.photo, profile.likedYou && styles.likedYouPhoto]}
          />
        ) : (
          <View style={[styles.photo, styles.noPhoto, profile.likedYou && styles.likedYouPhoto]}>
            <Ionicons name="person-outline" size={hero ? 48 : 36} color={colors.textMuted} />
          </View>
        )}

        {profile.likedYou && (
          <View style={styles.likedYouPill}>
            <Ionicons name="heart" size={11} color="#fff" />
            <Text style={styles.badgeText}>Liked you</Text>
          </View>
        )}

        {profile.photos.length > 1 && (
          <View style={styles.photoCountBadge}>
            <Ionicons name="images-outline" size={11} color="#fff" />
            <Text style={styles.badgeText}>{profile.photos.length}</Text>
          </View>
        )}
      </View>

      <View style={styles.caption}>
        <View style={styles.nameRow}>
          <Text style={hero ? styles.heroName : styles.pairName} numberOfLines={1}>
            {profile.displayName}, {profile.age}
          </Text>
          {/* Face tag: tick when their selfie matched, cross when unverified or skipped */}
          <Ionicons
            name={profile.isVerified ? 'checkmark-circle' : 'close-circle'}
            size={hero ? 16 : 14}
            color={profile.isVerified ? colors.textPrimary : UNVERIFIED_RED}
            accessibilityLabel={profile.isVerified ? 'Face verified' : 'Face unverified'}
          />
          {hero && (
            <Text style={[styles.faceText, !profile.isVerified && styles.faceTextUnverified]}>
              {profile.isVerified ? 'Face verified' : 'Face unverified'}
            </Text>
          )}
        </View>
        <View style={styles.detailRow}>
          <DatingCategoryBadge category={profile.datingCategory} compact={!hero} />
          {details ? (
            <Text style={styles.detailText} numberOfLines={1}>{details}</Text>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
});

export const ExploreScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [profiles, setProfiles] = useState<GridProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const loadingMoreRef = useRef(false);
  const offsetRef = useRef(0);
  // Mirrors `profiles` for the socket/event handlers, which are set up once
  const profilesRef = useRef<GridProfile[]>([]);
  profilesRef.current = profiles;

  const fetchProfiles = useCallback(async (asRefresh = false) => {
    asRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const res = await api.getExploreProfiles(0, PAGE_SIZE);
      if (res.success && res.data) {
        setProfiles(res.data.profiles || []);
        offsetRef.current = (res.data.profiles || []).length;
        setHasMore(res.data.hasMore ?? false);
      }
    } catch {
      // Keep whatever is on screen — user can pull to retry
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  /** Infinite scroll: append the next page, deduped against the list. */
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    try {
      const res = await api.getExploreProfiles(offsetRef.current, PAGE_SIZE);
      if (res.success && res.data) {
        const page: GridProfile[] = res.data.profiles || [];
        offsetRef.current += page.length;
        setHasMore(res.data.hasMore ?? false);
        setProfiles((prev) => {
          const seen = new Set(prev.map((p) => p.userId));
          return [...prev, ...page.filter((p) => !seen.has(p.userId))];
        });
      }
    } catch {
      // Scroll again to retry
    } finally {
      loadingMoreRef.current = false;
    }
  }, [hasMore]);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  // Live updates from the shared /presence socket:
  //  - match:new → drop the profile (matched users leave Explore)
  //  - likes:new → grey the liker's card in place: they are in the Likes list
  //  - a like or pass sent from the deck → drop that card (the server leaves
  //    pending likes, and passes for a while, out of Explore)
  useEffect(() => {
    const socket = getPresenceSocket();
    // A loaded card the server now leaves out shifts every later row up one:
    // step the offset back with it so the next page does not skip a profile
    const dropProfile = (userId: string) => {
      if (profilesRef.current.some((p) => p.userId === userId)) {
        offsetRef.current = Math.max(0, offsetRef.current - 1);
      }
      setProfiles((prev) => prev.filter((p) => p.userId !== userId));
    };
    const offProfileLiked = onProfileLiked(dropProfile);
    const onMatchNew = (data: any) => {
      if (data?.partnerId) dropProfile(data.partnerId);
    };
    const onLikesNew = (data: any) => {
      // The id is present for Premium viewers and for a free viewer whose
      // lifetime reveal allowance had room; otherwise nothing is shown and
      // the list catches up on its next load.
      if (data?.likedByUserId) {
        setProfiles((prev) =>
          prev.map((p) => (p.userId === data.likedByUserId ? { ...p, likedYou: true } : p)),
        );
      }
    };
    socket.on('match:new', onMatchNew);
    socket.on('likes:new', onLikesNew);
    // Premium gained or lost: "Liked you" is only sent to Premium viewers,
    // so reload once, quietly, as a pull-to-refresh would
    const offPremiumChanged = onPremiumChanged(() => {
      fetchProfiles(true);
    });
    return () => {
      socket.off('match:new', onMatchNew);
      socket.off('likes:new', onLikesNew);
      offProfileLiked();
      offPremiumChanged();
    };
  }, [fetchProfiles]);

  const openProfile = useCallback((profile: GridProfile) => {
    navigation.navigate('Discover', { focusProfile: profile });
  }, [navigation]);

  const rows = useMemo(() => buildRows(profiles), [profiles]);

  const renderRow = useCallback(({ item }: { item: Row }) => {
    if (item.kind === 'band') {
      return <Text style={styles.bandLabel}>{item.label}</Text>;
    }
    if (item.kind === 'hero') {
      return (
        <View style={styles.row}>
          <ProfileTile profile={item.profile} hero onPress={openProfile} />
        </View>
      );
    }
    const [a, b] = item.profiles;
    return (
      <View style={[styles.row, styles.pairRow]}>
        <ProfileTile profile={a} hero={false} onPress={openProfile} />
        {b ? <ProfileTile profile={b} hero={false} onPress={openProfile} /> : <View style={{ width: PAIR_WIDTH }} />}
      </View>
    );
  }, [openProfile]);

  const keyExtractor = useCallback((row: Row) => row.key, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Explore</Text>
          <Text style={styles.headerSub}>Everyone on Kinetik — nearest first</Text>
        </View>
        <TouchableOpacity
          style={styles.shuffleBtn}
          onPress={() => fetchProfiles()}
          activeOpacity={0.7}
        >
          <Ionicons name="refresh" size={20} color={colors.textPrimary} />
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
          <Text style={styles.emptyTitle}>No one here yet</Text>
          <Text style={styles.emptySubtitle}>
            No profiles match your preferences right now. Check back soon or widen your preferences.
          </Text>
          <TouchableOpacity style={styles.refreshBtn} onPress={() => fetchProfiles()}>
            <Text style={styles.refreshBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={keyExtractor}
          renderItem={renderRow}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          maxToRenderPerBatch={6}
          windowSize={7}
          initialNumToRender={4}
          onEndReached={() => loadMore()}
          onEndReachedThreshold={1.5}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchProfiles(true)}
              tintColor={colors.textPrimary}
            />
          }
          ListFooterComponent={
            hasMore ? (
              <ActivityIndicator style={styles.footerHint} size="small" color={colors.textMuted} />
            ) : (
              <Text style={styles.footerHint}>That's everyone on Kinetik right now</Text>
            )
          }
        />
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

  // ─── The list ───────────────────────────────────────────
  listContent: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxl },
  bandLabel: {
    ...typography.label,
    color: colors.textMuted,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  row: { marginBottom: spacing.xl },
  pairRow: { flexDirection: 'row', gap: GAP },
  photoFrame: {
    width: '100%',
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceHighlight,
  },
  photo: { width: '100%', height: '100%' },
  noPhoto: { justifyContent: 'center', alignItems: 'center' },
  // "Liked you": the photo is greyed and a pill labels it; the caption below stays as it is
  likedYouPhoto: { opacity: 0.35 },
  likedYouPill: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
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
  badgeText: { ...typography.caption, fontSize: 10, color: '#fff', fontWeight: '600' },

  // ─── Under the photo ────────────────────────────────────
  caption: { paddingTop: spacing.sm, paddingHorizontal: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  heroName: { ...typography.h3, color: colors.textPrimary, flexShrink: 1 },
  pairName: { ...typography.body1, fontWeight: '700', color: colors.textPrimary, flexShrink: 1 },
  faceText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600', marginLeft: 2 },
  faceTextUnverified: { color: UNVERIFIED_RED },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 },
  detailText: { ...typography.caption, color: colors.textMuted, flexShrink: 1 },
  footerHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});

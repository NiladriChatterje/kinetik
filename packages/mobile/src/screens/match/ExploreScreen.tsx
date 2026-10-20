import React, { useState, useEffect, useCallback, useRef } from 'react';
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

const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_GAP = spacing.md;
const CARD_WIDTH = (SCREEN_WIDTH - spacing.xxl * 2 - GRID_GAP) / 2;
const TALL = Math.round(CARD_WIDTH * 1.45);
const SHORT = Math.round(CARD_WIDTH * 1.1);

/** Staggered height: tall–short per column, offset between columns */
const cardHeight = (index: number) => {
  const mod = index % 4;
  return mod === 0 || mod === 3 ? TALL : SHORT;
};

const COLS = 2;

/** Cross on the Face unverified tag, as on the Discover card */
const UNVERIFIED_RED = '#E53935';

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

  /** Infinite scroll: append the next page, deduped against the grid. */
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

  // Live grid updates from the shared /presence socket:
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
      // the grid catches up on its next load.
      if (data?.likedByUserId) {
        setProfiles((prev) =>
          prev.map((p) => (p.userId === data.likedByUserId ? { ...p, likedYou: true } : p)),
        );
      }
    };
    socket.on('match:new', onMatchNew);
    socket.on('likes:new', onLikesNew);
    // Premium gained or lost: "Liked you" is only sent to Premium viewers,
    // so reload the grid once, quietly, as a pull-to-refresh would
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

  const openProfile = (profile: GridProfile) => {
    navigation.navigate('Discover', { focusProfile: profile });
  };

  const primaryPhoto = (p: GridProfile) =>
    p.photos.find((ph) => ph.isPrimary) || p.photos[0];

  const renderItem = useCallback(({ item, index }: { item: GridProfile; index: number }) => {
    const photo = primaryPhoto(item);
    const height = cardHeight(index);

    return (
      <TouchableOpacity
        style={[styles.card, { height }]}
        activeOpacity={0.85}
        onPress={() => openProfile(item)}
      >
        {photo ? (
          <ProgressiveImage
            uri={resolveUrl(photo.thumbnailUrl || photo.url)}
            style={[styles.cardImage, item.likedYou && styles.likedYouImage]}
          />
        ) : (
          <View style={[styles.cardImage, styles.noPhoto, item.likedYou && styles.likedYouImage]}>
            <Ionicons name="person-outline" size={36} color={colors.textMuted} />
          </View>
        )}

        {item.likedYou && (
          <View style={styles.likedYouPill}>
            <Ionicons name="heart" size={11} color="#fff" />
            <Text style={styles.photoCountText}>Liked you</Text>
          </View>
        )}

        {item.photos.length > 1 && (
          <View style={styles.photoCountBadge}>
            <Ionicons name="images-outline" size={11} color="#fff" />
            <Text style={styles.photoCountText}>{item.photos.length}</Text>
          </View>
        )}

        {item.distanceKm != null && (
          <View style={styles.distanceBadge}>
            <Ionicons name="location-outline" size={11} color="#fff" />
            <Text style={styles.photoCountText}>~{item.distanceKm} km</Text>
          </View>
        )}

        <View style={styles.cardScrim}>
          <View style={styles.nameRow}>
            <Text style={styles.cardName} numberOfLines={1}>
              {item.displayName}, {item.age}
            </Text>
            {/* Face tag: tick when their selfie matched, cross when unverified or skipped */}
            <Ionicons
              name={item.isVerified ? 'checkmark-circle' : 'close-circle'}
              size={14}
              color={item.isVerified ? colors.success : UNVERIFIED_RED}
              accessibilityLabel={item.isVerified ? 'Face verified' : 'Face unverified'}
            />
          </View>
          {!item.isVerified && (
            <Text style={styles.cardUnverified} numberOfLines={1}>Face unverified</Text>
          )}
          <DatingCategoryBadge category={item.datingCategory} onDark compact style={styles.cardCategory} />
          {item.occupation ? (
            <Text style={styles.cardSub} numberOfLines={1}>{item.occupation}</Text>
          ) : item.interests.length > 0 ? (
            <Text style={styles.cardSub} numberOfLines={1}>
              {item.interests.slice(0, 2).map((i) => i.name).join(' · ')}
            </Text>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  }, []);

  const keyExtractor = useCallback((item: GridProfile) => item.userId, []);

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
          data={profiles}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          numColumns={COLS}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.gridContent}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          maxToRenderPerBatch={8}
          windowSize={9}
          initialNumToRender={6}
          getItemLayout={(_, index) => ({
            length: TALL + GRID_GAP,
            offset: (TALL + GRID_GAP) * Math.floor(index / COLS),
            index,
          })}
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
  gridContent: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxl },
  gridRow: { gap: GRID_GAP },
  card: {
    flex: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceHighlight,
  },
  cardImage: { width: '100%', height: '100%' },
  noPhoto: { justifyContent: 'center', alignItems: 'center' },
  // "Liked you" state — the photo is greyed and a pill labels it at the
  // top; badges and the scrim stay at full opacity above the photo
  likedYouImage: { opacity: 0.35 },
  likedYouPill: {
    position: 'absolute',
    top: spacing.sm,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    borderRadius: radius.full,
    zIndex: 2,
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
  photoCountText: { ...typography.caption, fontSize: 10, color: '#fff', fontWeight: '600' },
  distanceBadge: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
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
  cardUnverified: { ...typography.caption, color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: '600', marginTop: 1 },
  cardCategory: { marginTop: 3, marginBottom: 2 },
  cardSub: { ...typography.caption, color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 1 },
  footerHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});

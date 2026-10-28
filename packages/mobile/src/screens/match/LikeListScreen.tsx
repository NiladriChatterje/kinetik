import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, Image, TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../services/api';
import { getPresenceSocket } from '../../services/presenceSocket';
import { onLikeAnswered, onPremiumChanged } from '../../services/appEvents';
import { useToast } from '../../hooks/useToast';
import { useAuthStore } from '../../store/authStore';
import { resolveUrl } from '../../config';
import { colors, typography, spacing, radius } from '../../theme';
import { PaywallModal, PaywallReason } from '../../components/common/PaywallModal';
import { DatingCategoryBadge, DatingCategory } from '../../components/common/DatingCategoryBadge';
import { BounceSwipe } from '../../components/common/BounceSwipe';
import { getLikeSwipeCount, countLikeSwipe, LIKE_SWIPE_TOUR_SWIPES } from '../../services/likeSwipeTour';

interface IncomingLike {
  likedAt: string;
  userId: string;
  displayName: string;
  bio: string;
  age: number;
  photoUrl?: string;
  thumbnailUrl?: string;
  isVerified: boolean;
  datingCategory?: DatingCategory;
  isMutual: boolean;
  isSuperLike?: boolean;
}

/** Blurred placeholder cards shown to a free user; the rest is a "+N more" */
const BLURRED_CARDS_SHOWN = 6;

/** Cross on the Face unverified tag, as on the Discover card */
const UNVERIFIED_RED = '#E53935';

/** How long ago they liked: "now", "5m", "3h", "2d", "4w". */
function likedAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d` : `${Math.floor(days / 7)}w`;
}

export const LikeListScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [likes, setLikes] = useState<IncomingLike[]>([]);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState<string | null>(null);
  // The card whose full profile is being fetched for Discover
  const [opening, setOpening] = useState<string | null>(null);
  // The top card shows the like swipe by itself until this account has
  // answered three likes here (likeSwipeTour.ts); false until that is known
  const [swipeTour, setSwipeTour] = useState(false);
  const myUserId = useAuthStore((s) => s.user?.id);
  useEffect(() => {
    if (!myUserId) return;
    let cancelled = false;
    getLikeSwipeCount(myUserId).then((n) => {
      if (!cancelled) setSwipeTour(n < LIKE_SWIPE_TOUR_SWIPES);
    });
    return () => { cancelled = true; };
  }, [myUserId]);
  // Free account: the server sends the newest few likes in full and only a
  // count of the rest; the app shows that many blurred cards below them
  const [locked, setLocked] = useState(false);
  const [lockedCount, setLockedCount] = useState(0);
  const toast = useToast();
  const likesRef = useRef(likes);
  likesRef.current = likes;
  // Premium lists everyone, a page at a time: where the next page starts,
  // null once everyone is listed. A free account never has a second page.
  const nextCursorRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);

  // One fewer person waiting: drop the card, and the total with it
  // (otherwise a blurred "one more" card would appear)
  const dropLike = (userId: string) => {
    setLikes((prev) => prev.filter((l) => l.userId !== userId));
    setLockedCount((count) => Math.max(0, count - 1));
  };

  // Paywall modal state
  const [paywall, setPaywall] = useState<{
    visible: boolean;
    reason: PaywallReason;
    used: number;
    limit: number;
  }>({ visible: false, reason: 'chat_limit', used: 0, limit: 0 });

  const fetchLikes = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.getIncomingLikes();
      if (res.success && res.data) {
        setLocked(Boolean(res.data.locked));
        setLockedCount(res.data.totalCount || 0);
        setLikes(res.data.likes || []);
        nextCursorRef.current = res.data.nextCursor ?? null;
        setMoreFailed(false);
        // The tab badge shows how many people are waiting here, so it
        // follows the server's count rather than clearing on a visit
        useAuthStore.setState({ unreadLikeCount: res.data.totalCount || 0 });
      }
    } catch (err: any) {
      toast.showError('Load failed', 'Could not load likes.');
    } finally {
      setLoading(false);
    }
  }, []);

  // The next page, appended. One request at a time: onEndReached fires
  // repeatedly while the list settles. After a failure the footer offers a
  // retry instead of asking again on every scroll.
  const loadMore = useCallback(async () => {
    const cursor = nextCursorRef.current;
    if (!cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const res = await api.getIncomingLikes({ cursor });
      if (!res.success || !res.data) throw new Error(res.error?.message);
      // Already listed if the list was reloaded while this page was on its way
      const page = (res.data.likes || []).filter(
        (like: IncomingLike) => !likesRef.current.some((k) => k.userId === like.userId),
      );
      nextCursorRef.current = res.data.nextCursor ?? null;
      setLikes((prev) => [...prev, ...page]);
      setMoreFailed(false);
    } catch {
      setMoreFailed(true);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    fetchLikes();

    // Shared /presence socket — attach this screen's listener only
    const socket = getPresenceSocket();
    const onLikesNew = (data: any) => {
      console.log('[LikeList] New like received:', data.likedByName);
      // Re-fetch the likes list to get full details
      fetchLikes();
    };
    socket.on('likes:new', onLikesNew);

    // Premium gained or lost (e.g. bought from this screen's paywall): the
    // server now sends the full list, or the blurred one
    const offPremiumChanged = onPremiumChanged(() => {
      fetchLikes();
    });

    // Answered in Discover after opening the card there. Discover refreshes
    // the badge itself: this screen can be open twice (tab and pushed).
    const offLikeAnswered = onLikeAnswered((userId) => {
      if (likesRef.current.some((l) => l.userId === userId)) dropLike(userId);
    });

    return () => {
      socket.off('likes:new', onLikesNew);
      offPremiumChanged();
      offLikeAnswered();
    };
  }, []);

  const handleRespond = async (targetUserId: string, action: 'like' | 'discard') => {
    setResponding(targetUserId);
    // One more swipe towards the end of the tour, whatever the server answers
    if (swipeTour && myUserId) {
      countLikeSwipe(myUserId).then((n) => {
        if (n >= LIKE_SWIPE_TOUR_SWIPES) setSwipeTour(false);
      });
    }
    try {
      const res = await api.respondToLike(targetUserId, action);
      if (res.success && res.data) {
        // On a match, the match:new socket event drives the animated
        // MatchPopup — no extra dialog here.
        // Remove from list; one fewer person waiting, so the badge drops too
        dropLike(targetUserId);
        useAuthStore.setState((s) => ({ unreadLikeCount: Math.max(0, s.unreadLikeCount - 1) }));
      } else if (res.error?.code === 'NOT_FOUND') {
        // The like no longer exists for this viewer (withdrawn by a block,
        // or already answered elsewhere): drop the card quietly
        dropLike(targetUserId);
        useAuthStore.setState((s) => ({ unreadLikeCount: Math.max(0, s.unreadLikeCount - 1) }));
      } else if (res.error?.code === 'CHAT_LIMIT_REACHED') {
        const details = (res.error as any)?.details;
        setPaywall({
          visible: true,
          reason: 'chat_limit',
          used: details?.activeChats ?? 3,
          limit: details?.limit ?? 3,
        });
      }
    } catch (err: any) {
      toast.showError('Failed', err.message || 'Try again.');
    } finally {
      setResponding(null);
    }
  };

  // Tap a card: their whole profile in Discover (photos, interests, answers),
  // where swiping answers the like as it does here
  const openProfile = async (like: IncomingLike) => {
    if (opening || responding) return;
    setOpening(like.userId);
    try {
      const res = await api.getLikerProfile(like.userId);
      if (res.success && res.data?.profile) {
        navigation.navigate('Discover', { focusProfile: { ...res.data.profile, answersLike: true } });
      } else if (res.error?.code === 'NOT_FOUND') {
        // Answered elsewhere, withdrawn or blocked meanwhile
        dropLike(like.userId);
        toast.showError('Not available', 'This profile is no longer available.');
      } else {
        toast.showError('Could not open profile', res.error?.message || 'Try again.');
      }
    } finally {
      setOpening(null);
    }
  };

  // Likes the server counted but did not send (free account, beyond the
  // newest few). Zero for Premium.
  const hiddenCount = locked ? Math.max(0, lockedCount - likes.length) : 0;

  // Swipe right to like back, left to reject; the card bounces back and
  // leaves the list once the answer is recorded
  const renderLike = ({ item, index }: { item: IncomingLike; index: number }) => (
    <BounceSwipe
      cardStyle={styles.likeCard}
      onSwipe={(direction) => handleRespond(item.userId, direction === 'right' ? 'like' : 'discard')}
      enabled={responding !== item.userId}
      busy={responding === item.userId || opening === item.userId}
      demo={swipeTour && index === 0}
      labels={{ right: 'Like back', left: 'Reject' }}
    >
      {/* Tap for their full profile in Discover */}
      <TouchableOpacity
        style={styles.likeHeader}
        activeOpacity={0.7}
        onPress={() => openProfile(item)}
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.displayName}'s profile`}
      >
        {/* Photo with ring — super likes get a star badge on the corner */}
        <View style={styles.avatarWrap}>
          {item.thumbnailUrl || item.photoUrl ? (
            <Image
              source={{ uri: resolveUrl(item.thumbnailUrl || item.photoUrl!) }}
              style={styles.avatar}
              resizeMethod="resize"
            />
          ) : (
            <View style={[styles.avatar, styles.noAvatar]}>
              <Ionicons name="person-outline" size={26} color={colors.textMuted} />
            </View>
          )}
          {item.isSuperLike && (
            <View style={styles.superLikeStar}>
              <Ionicons name="star" size={10} color={colors.textInverse} />
            </View>
          )}
        </View>

        <View style={styles.likeInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {item.displayName}
              <Text style={styles.age}>  {item.age}</Text>
            </Text>
            {/* Their selfie matched their photos; unverified shows as a tag below */}
            {item.isVerified && (
              <Ionicons
                name="checkmark-circle"
                size={15}
                color={colors.textPrimary}
                style={styles.verifiedTick}
                accessibilityLabel="Face verified"
              />
            )}
            <Text style={styles.ago}>{likedAgo(item.likedAt)}</Text>
          </View>
          {item.bio ? <Text style={styles.bio} numberOfLines={2}>{item.bio}</Text> : null}
          {/* Tags in one row, so every card stays about the same height */}
          <View style={styles.tags}>
            <DatingCategoryBadge category={item.datingCategory} compact />
            {item.isSuperLike && (
              <View style={[styles.tag, styles.superLikeTag]}>
                <Ionicons name="star" size={10} color={colors.textInverse} />
                <Text style={[styles.tagText, styles.superLikeTagText]}>Super like</Text>
              </View>
            )}
            {item.isMutual && (
              <View style={styles.tag}>
                <Ionicons name="heart" size={10} color={colors.textSecondary} />
                <Text style={styles.tagText}>Liked each other</Text>
              </View>
            )}
            {!item.isVerified && (
              <View style={styles.tag}>
                <Ionicons name="close-circle" size={10} color={UNVERIFIED_RED} />
                <Text style={styles.tagText}>Face unverified</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    </BounceSwipe>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          {navigation.canGoBack() ? (
            <TouchableOpacity onPress={() => navigation.goBack()}>
              <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 24 }} />
          )}
          <Text style={styles.headerTitle}>Likes</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        {/* As the Match tab there is nothing to go back to; pushed from the
            deck's heart button there is */}
        {navigation.canGoBack() ? (
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 24 }} />
        )}
        <Text style={styles.headerTitle}>Likes</Text>
        <TouchableOpacity onPress={fetchLikes}>
          <Ionicons name="refresh" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {likes.length === 0 && hiddenCount === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="heart-outline" size={64} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No Likes Yet</Text>
          <Text style={styles.emptySubtitle}>When someone likes your profile, they'll appear here</Text>
        </View>
      ) : (
        <FlatList
          data={likes}
          keyExtractor={(item) => item.userId}
          renderItem={renderLike}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          maxToRenderPerBatch={10}
          windowSize={7}
          initialNumToRender={8}
          ListHeaderComponent={
            likes.length > 0 ? (
              <Text style={styles.swipeHint}>Swipe right to like back, left to reject</Text>
            ) : null
          }
          // Free account: the likes beyond the newest few are counted but not
          // sent. No names, photos or ids reach the app for them; tapping a
          // placeholder opens checkout, like the button below.
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={colors.primary} style={styles.footer} />
            ) : moreFailed ? (
              <TouchableOpacity style={styles.footer} onPress={loadMore} accessibilityRole="button">
                <Text style={styles.footerText}>Couldn't load more · Tap to retry</Text>
              </TouchableOpacity>
            ) : hiddenCount > 0 ? (
              <View style={styles.lockedWrap}>
                <Text style={styles.lockedTitle}>
                  {hiddenCount === 1 ? '1 more person likes you' : `${hiddenCount} more people like you`}
                </Text>
                <Text style={styles.lockedSubtitle}>Upgrade to Premium to see who they are and like them back.</Text>

                <View style={styles.blurGrid}>
                  {Array.from({ length: Math.min(hiddenCount, BLURRED_CARDS_SHOWN) }).map((_, i) => (
                    <TouchableOpacity
                      key={i}
                      style={styles.blurCard}
                      onPress={() => navigation.navigate('SubscriptionCheckout', { fromPaywall: true })}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel="Upgrade to Premium to see who likes you"
                    >
                      <View style={styles.blurAvatar}>
                        <Ionicons name="lock-closed" size={20} color={colors.textMuted} />
                      </View>
                      <View style={styles.blurLineWide} />
                      <View style={styles.blurLineShort} />
                    </TouchableOpacity>
                  ))}
                </View>
                {hiddenCount > BLURRED_CARDS_SHOWN && (
                  <Text style={styles.moreText}>+{hiddenCount - BLURRED_CARDS_SHOWN} more</Text>
                )}

                <TouchableOpacity
                  style={styles.upgradeButton}
                  onPress={() => navigation.navigate('SubscriptionCheckout', { fromPaywall: true })}
                  activeOpacity={0.8}
                >
                  <Ionicons name="eye-outline" size={18} color={colors.textInverse} />
                  <Text style={styles.upgradeText}>See everyone who likes you</Text>
                </TouchableOpacity>
              </View>
            ) : null
          }
        />
      )}

      {/* Paywall modal */}
      <PaywallModal
        visible={paywall.visible}
        reason={paywall.reason}
        used={paywall.used}
        limit={paywall.limit}
        onDismiss={() => setPaywall((prev) => ({ ...prev, visible: false }))}
        onUpgrade={() => {
          setPaywall((prev) => ({ ...prev, visible: false }));
          navigation.navigate('SubscriptionCheckout', { fromPaywall: true });
        }}
      />
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
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xxl },
  emptyTitle: { ...typography.h2, color: colors.textPrimary, marginTop: spacing.lg },
  emptySubtitle: { ...typography.body1, color: colors.textMuted, marginTop: spacing.sm, textAlign: 'center' },
  list: { padding: spacing.lg, gap: spacing.md },
  footer: { alignItems: 'center', paddingVertical: spacing.lg },
  footerText: { ...typography.body2, color: colors.textSecondary },

  // Locked (free account)
  lockedWrap: { flex: 1, paddingHorizontal: spacing.xxl, paddingTop: spacing.lg },
  lockedTitle: { ...typography.h2, color: colors.textPrimary, textAlign: 'center' },
  lockedSubtitle: { ...typography.body1, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm, marginBottom: spacing.xl },
  blurGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.md },
  blurCard: {
    width: '48%',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  blurAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blurLineWide: { width: '60%', height: 10, borderRadius: 5, backgroundColor: colors.surfaceHighlight },
  blurLineShort: { width: '35%', height: 10, borderRadius: 5, backgroundColor: colors.surfaceHighlight },
  moreText: { ...typography.body2, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
  upgradeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.full,
    backgroundColor: colors.textPrimary,
  },
  upgradeText: { ...typography.button, color: colors.textInverse },
  // White with a hairline, no fill or shadow
  likeCard: {
    backgroundColor: colors.background,
    borderRadius: radius.xl,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  likeHeader: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  noAvatar: { backgroundColor: colors.surfaceHighlight, justifyContent: 'center', alignItems: 'center' },
  superLikeStar: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.textPrimary,
    borderWidth: 2,
    borderColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  likeInfo: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  name: { ...typography.h3, color: colors.textPrimary, flexShrink: 1 },
  age: { ...typography.body1, color: colors.textMuted, fontWeight: '400' },
  verifiedTick: { marginLeft: 5 },
  ago: { ...typography.caption, color: colors.textMuted, marginLeft: 'auto', paddingLeft: spacing.sm },
  bio: { ...typography.body2, color: colors.textSecondary, marginTop: 3 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  // Same pill as the compact category tag beside it
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceHighlight,
  },
  tagText: { ...typography.caption, fontSize: 9, fontWeight: '600', color: colors.textSecondary },
  superLikeTag: { backgroundColor: colors.textPrimary },
  superLikeTagText: { color: colors.textInverse },
  swipeHint: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 0.2,
    textAlign: 'center',
  },
});

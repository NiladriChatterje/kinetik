import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, Image, TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../services/api';
import { getPresenceSocket } from '../../services/presenceSocket';
import { useToast } from '../../hooks/useToast';
import { useAuthStore } from '../../store/authStore';
import { resolveUrl } from '../../config';
import { colors, typography, spacing, radius } from '../../theme';
import { PaywallModal, PaywallReason } from '../../components/common/PaywallModal';
import { DatingCategoryBadge, DatingCategory } from '../../components/common/DatingCategoryBadge';

interface IncomingLike {
  likedAt: string;
  userId: string;
  displayName: string;
  bio: string;
  age: number;
  photoUrl?: string;
  isVerified: boolean;
  datingCategory?: DatingCategory;
  isMutual: boolean;
  isSuperLike?: boolean;
}

/** Blurred placeholder cards shown to a free user; the rest is a "+N more" */
const BLURRED_CARDS_SHOWN = 6;

export const LikeListScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [likes, setLikes] = useState<IncomingLike[]>([]);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState<string | null>(null);
  // Free account: the server sends only how many liked them, never who
  const [locked, setLocked] = useState(false);
  const [lockedCount, setLockedCount] = useState(0);
  const toast = useToast();

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
        // Reset unread badge count — user has now seen all likes
        useAuthStore.getState().resetUnreadLikeCount();
      }
    } catch (err: any) {
      toast.showError('Load failed', 'Could not load likes.');
    } finally {
      setLoading(false);
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

    return () => {
      socket.off('likes:new', onLikesNew);
    };
  }, []);

  // Reset unread count every time this screen comes into focus
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      useAuthStore.getState().resetUnreadLikeCount();
    });
    return unsubscribe;
  }, [navigation]);

  const handleRespond = async (targetUserId: string, action: 'like' | 'discard') => {
    setResponding(targetUserId);
    try {
      const res = await api.respondToLike(targetUserId, action);
      if (res.success && res.data) {
        // On a match, the match:new socket event drives the animated
        // MatchPopup — no extra dialog here.
        // Remove from list
        setLikes((prev) => prev.filter((l) => l.userId !== targetUserId));
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

  const renderLike = ({ item }: { item: IncomingLike }) => (
    <View style={styles.likeCard}>
      <View style={styles.likeHeader}>
        {/* Photo with ring — super likes get a star badge on the corner */}
        <View style={styles.avatarWrap}>
          {item.photoUrl ? (
            <Image source={{ uri: resolveUrl(item.photoUrl) }} style={styles.avatar} />
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
            {item.isVerified && (
              <Ionicons name="checkmark-circle" size={16} color={colors.textPrimary} style={{ marginLeft: 5 }} accessibilityLabel="Face verified" />
            )}
          </View>
          <DatingCategoryBadge category={item.datingCategory} compact style={styles.categoryBadge} />
          {item.bio ? <Text style={styles.bio} numberOfLines={2}>{item.bio}</Text> : null}
          {item.isSuperLike && (
            <View style={styles.superLikeBadge}>
              <Ionicons name="star" size={11} color={colors.textInverse} />
              <Text style={styles.superLikeBadgeText}>Super Like</Text>
            </View>
          )}
          {item.isMutual && (
            <View style={styles.mutualPill}>
              <Ionicons name="heart" size={11} color={colors.textPrimary} />
              <Text style={styles.mutualPillText}>You liked each other</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.discardBtn]}
          onPress={() => handleRespond(item.userId, 'discard')}
          disabled={responding === item.userId}
          activeOpacity={0.7}
        >
          {responding === item.userId ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : (
            <Ionicons name="close" size={24} color={colors.textPrimary} />
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.likeBackBtn]}
          onPress={() => handleRespond(item.userId, 'like')}
          disabled={responding === item.userId}
          activeOpacity={0.7}
        >
          {responding === item.userId ? (
            <ActivityIndicator size="small" color={colors.textInverse} />
          ) : (
            <Ionicons name="heart" size={24} color={colors.textInverse} />
          )}
        </TouchableOpacity>
      </View>
    </View>
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

      {locked ? (
        lockedCount === 0 ? (
          <View style={styles.centered}>
            <Ionicons name="heart-outline" size={64} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No Likes Yet</Text>
            <Text style={styles.emptySubtitle}>When someone likes your profile, it will show here</Text>
          </View>
        ) : (
          <View style={styles.lockedWrap}>
            <Text style={styles.lockedTitle}>
              {lockedCount === 1 ? '1 person likes you' : `${lockedCount} people like you`}
            </Text>
            <Text style={styles.lockedSubtitle}>Upgrade to Premium to see who they are and like them back.</Text>

            {/* Placeholders only: no names, photos or ids reach the app.
                Tapping one opens checkout, like the button below. */}
            <View style={styles.blurGrid}>
              {Array.from({ length: Math.min(lockedCount, BLURRED_CARDS_SHOWN) }).map((_, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.blurCard}
                  onPress={() => navigation.navigate('SubscriptionCheckout')}
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
            {lockedCount > BLURRED_CARDS_SHOWN && (
              <Text style={styles.moreText}>+{lockedCount - BLURRED_CARDS_SHOWN} more</Text>
            )}

            <TouchableOpacity
              style={styles.upgradeButton}
              onPress={() => navigation.navigate('SubscriptionCheckout')}
              activeOpacity={0.8}
            >
              <Ionicons name="eye-outline" size={18} color={colors.textInverse} />
              <Text style={styles.upgradeText}>See who likes you</Text>
            </TouchableOpacity>
          </View>
        )
      ) : likes.length === 0 ? (
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
          navigation.navigate('SubscriptionCheckout');
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
  likeCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  likeHeader: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: colors.background,
  },
  noAvatar: { backgroundColor: colors.surfaceHighlight, justifyContent: 'center', alignItems: 'center' },
  superLikeStar: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.textPrimary,
    borderWidth: 2,
    borderColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  likeInfo: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  name: { ...typography.h3, color: colors.textPrimary },
  age: { ...typography.body1, color: colors.textMuted, fontWeight: '400' },
  bio: { ...typography.body2, color: colors.textSecondary, marginTop: spacing.xs },
  categoryBadge: { marginTop: spacing.xs },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xl,
    marginTop: spacing.lg,
  },
  actionBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    justifyContent: 'center',
    alignItems: 'center',
  },
  discardBtn: {
    backgroundColor: colors.surfaceHighlight,
    borderWidth: 1.5,
    borderColor: colors.cardBorder,
  },
  likeBackBtn: {
    backgroundColor: colors.textPrimary,
  },
  superLikeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    backgroundColor: colors.textPrimary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  superLikeBadgeText: { ...typography.caption, fontSize: 9, color: colors.textInverse, fontWeight: '700' },
  mutualPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.surfaceHighlight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  mutualPillText: { ...typography.caption, fontSize: 9, color: colors.textSecondary, fontWeight: '600' },
});

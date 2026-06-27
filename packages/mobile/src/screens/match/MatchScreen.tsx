import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, Image, Dimensions, TouchableOpacity,
  Animated, PanResponder, ActivityIndicator, SafeAreaView, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/authStore';
import { api } from '../../services/api';
import { useToast } from '../../hooks/useToast';
import { colors, typography, spacing, radius } from '../../theme';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;
const CARD_WIDTH = SCREEN_WIDTH - spacing.xxl * 2;
const CARD_HEIGHT = SCREEN_HEIGHT * 0.65;
const SWIPE_THRESHOLD = 120;

interface SwipeProfile {
  userId: string;
  displayName: string;
  age: number;
  bio: string;
  occupation?: string;
  education?: string;
  photos: { id: string; url: string; thumbnailUrl?: string; isPrimary: boolean }[];
  interests: { id: string; name: string; emoji: string; category: string }[];
  isVerified: boolean;
}

function SwipeCard({
  profile,
  isTop,
  onSwipe,
  onLike,
  onPass,
}: {
  profile: SwipeProfile;
  isTop: boolean;
  onSwipe: (direction: 'left' | 'right') => void;
  onLike: () => void;
  onPass: () => void;
}) {
  const position = useRef(new Animated.ValueXY()).current;
  const likeOpacity = useRef(new Animated.Value(0)).current;
  const passOpacity = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: () => isTop,
      onPanResponderMove: (_, gesture) => {
        position.setValue({ x: gesture.dx, y: gesture.dy });
        if (gesture.dx > 0) {
          likeOpacity.setValue(Math.min(gesture.dx / 150, 1));
          passOpacity.setValue(0);
        } else {
          passOpacity.setValue(Math.min(Math.abs(gesture.dx) / 150, 1));
          likeOpacity.setValue(0);
        }
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx > SWIPE_THRESHOLD) {
          Animated.spring(position, {
            toValue: { x: SCREEN_WIDTH + 100, y: gesture.dy },
            useNativeDriver: true,
          }).start(() => onSwipe('right'));
        } else if (gesture.dx < -SWIPE_THRESHOLD) {
          Animated.spring(position, {
            toValue: { x: -SCREEN_WIDTH - 100, y: gesture.dy },
            useNativeDriver: true,
          }).start(() => onSwipe('left'));
        } else {
          Animated.spring(position, {
            toValue: { x: 0, y: 0 },
            friction: 5,
            useNativeDriver: true,
          }).start();
          Animated.timing(likeOpacity, { toValue: 0, duration: 200, useNativeDriver: true }).start();
          Animated.timing(passOpacity, { toValue: 0, duration: 200, useNativeDriver: true }).start();
        }
      },
    }),
  ).current;

  const rotate = position.x.interpolate({
    inputRange: [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2],
    outputRange: ['-15deg', '0deg', '15deg'],
  });

  const mainPhoto = profile.photos.find(p => p.isPrimary) || profile.photos[0];

  return (
    <Animated.View
      style={[
        styles.card,
        {
          transform: [...position.getTranslateTransform(), { rotate }],
        },
      ]}
      {...panResponder.panHandlers}
    >
      {/* Photo */}
      <View style={styles.cardImageContainer}>
        {mainPhoto ? (
          <Image source={{ uri: mainPhoto.url }} style={styles.cardImage} />
        ) : (
          <View style={[styles.cardImage, styles.noPhoto]}>
            <Ionicons name="person-outline" size={48} color={colors.textMuted} />
          </View>
        )}

        {/* Like / Pass stickers */}
        <Animated.View style={[styles.sticker, styles.likeSticker, { opacity: likeOpacity }]}>
          <Text style={styles.stickerText}>LIKE</Text>
        </Animated.View>
        <Animated.View style={[styles.sticker, styles.passSticker, { opacity: passOpacity }]}>
          <Text style={styles.stickerText}>PASS</Text>
        </Animated.View>
      </View>

      {/* Info */}
      <View style={styles.cardInfo}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>
            {profile.displayName}, {profile.age}
          </Text>
          {profile.isVerified && (
            <Ionicons name="checkmark-circle" size={18} color={colors.success} style={{ marginLeft: 6 }} />
          )}
        </View>

        {profile.bio ? <Text style={styles.bio} numberOfLines={2}>{profile.bio}</Text> : null}

        <View style={styles.detailsRow}>
          {profile.occupation ? (
            <View style={styles.detailChip}>
              <Ionicons name="briefcase-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.detailText}>{profile.occupation}</Text>
            </View>
          ) : null}
          {profile.education ? (
            <View style={styles.detailChip}>
              <Ionicons name="school-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.detailText}>{profile.education}</Text>
            </View>
          ) : null}
        </View>

        {profile.interests.length > 0 && (
          <View style={styles.interestsRow}>
            {profile.interests.slice(0, 4).map((interest) => (
              <View key={interest.id} style={styles.interestChip}>
                <Text style={styles.interestText}>
                  {interest.emoji} {interest.name}
                </Text>
              </View>
            ))}
            {profile.interests.length > 4 && (
              <Text style={styles.moreInterests}>+{profile.interests.length - 4}</Text>
            )}
          </View>
        )}
      </View>

      {/* Action buttons */}
      {isTop && (
        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.passBtn]}
            onPress={onPass}
          >
            <Ionicons name="close" size={28} color="#FF6B6B" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.likeBtn]}
            onPress={onLike}
          >
            <Ionicons name="heart" size={28} color="#4ECDC4" />
          </TouchableOpacity>
        </View>
      )}
    </Animated.View>
  );
}

export const MatchScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [profiles, setProfiles] = useState<SwipeProfile[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [swiping, setSwiping] = useState(false);
  const authUser = useAuthStore((s) => s.user);
  const toast = useToast();

  const fetchProfiles = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.getSwipeProfiles();
      if (res.success && res.data) {
        setProfiles(res.data.profiles || []);
        setCurrentIndex(0);
      } else {
        toast.showError('Could not load profiles');
      }
    } catch (err: any) {
      toast.showError(err.message || 'Failed to load profiles');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfiles();
  }, []);

  const handleSwipe = async (direction: 'left' | 'right') => {
    if (swiping) return;
    const profile = profiles[currentIndex];
    if (!profile) return;

    setSwiping(true);
    const action = direction === 'right' ? 'like' : 'pass';

    try {
      const res = await api.swipe(profile.userId, action);
      if (res.success && res.data) {
        const data = res.data;
        if (data.matched) {
          Alert.alert(
            'It\'s a Match! 🎉',
            `You matched with ${data.partnerName}! Start chatting now.`,
            [
              { text: 'Keep Swiping', style: 'cancel' },
              {
                text: 'Say Hello',
                onPress: () => navigation.navigate('Chat', { matchId: data.matchId, partnerName: data.partnerName }),
              },
            ],
          );
        }
      }
    } catch (err: any) {
      toast.showError(err.message || 'Swipe failed');
    }

    const nextIndex = currentIndex + 1;
    setCurrentIndex(nextIndex);
    setSwiping(false);

    // Fetch more when running low (using nextIndex to avoid stale closure)
    if (nextIndex >= profiles.length - 3) {
      const res = await api.getSwipeProfiles().catch(() => null);
      if (res?.success && res.data?.profiles) {
        setProfiles((prev) => [...prev, ...res.data!.profiles]);
      }
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Discover</Text>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Finding profiles near you...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const currentProfile = profiles[currentIndex];

  if (!currentProfile) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Discover</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Likes')}>
            <View style={styles.likesBadge}>
              <Ionicons name="heart-outline" size={22} color={colors.textPrimary} />
            </View>
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <Ionicons name="happy-outline" size={64} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No More Profiles</Text>
          <Text style={styles.emptySubtitle}>Check back later or expand your preferences</Text>
          <TouchableOpacity style={styles.refreshBtn} onPress={fetchProfiles}>
            <Text style={styles.refreshBtnText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Discover</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Likes')}>
          <View style={styles.likesBadge}>
            <Ionicons name="heart-outline" size={22} color={colors.textPrimary} />
          </View>
        </TouchableOpacity>
      </View>

      {/* Render cards stack */}
      <View style={styles.cardsContainer}>
        {/* Next card (shows behind) */}
        {profiles[currentIndex + 1] && (
          <View style={[styles.card, styles.nextCard]}>
            <View style={[styles.cardImageContainer, { opacity: 0.6 }]}>
              {(profiles[currentIndex + 1].photos.find(p => p.isPrimary) || profiles[currentIndex + 1].photos[0]) ? (
                <Image
                  source={{ uri: (profiles[currentIndex + 1].photos.find(p => p.isPrimary) || profiles[currentIndex + 1].photos[0])!.url }}
                  style={styles.cardImage}
                />
              ) : null}
            </View>
          </View>
        )}

        {/* Current swipeable card */}
        <SwipeCard
          key={currentProfile.userId}
          profile={currentProfile}
          isTop={true}
          onSwipe={handleSwipe}
          onLike={() => handleSwipe('right')}
          onPass={() => handleSwipe('left')}
        />
      </View>

      {/* Bottom navigation hint */}
      <TouchableOpacity style={styles.chatBtn} onPress={() => navigation.navigate('ChatList')}>
        <Ionicons name="chatbubbles-outline" size={22} color={colors.textPrimary} />
        <Text style={styles.chatBtnText}>Messages</Text>
      </TouchableOpacity>
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
  likesBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceHighlight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xxl },
  loadingText: { ...typography.body1, color: colors.textMuted, marginTop: spacing.lg },
  emptyTitle: { ...typography.h2, color: colors.textPrimary, marginTop: spacing.lg },
  emptySubtitle: { ...typography.body1, color: colors.textMuted, marginTop: spacing.sm, textAlign: 'center' },
  refreshBtn: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
  },
  refreshBtnText: { ...typography.button, color: colors.textPrimary },
  cardsContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceHighlight,
    position: 'absolute',
    overflow: 'hidden',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  nextCard: {
    transform: [{ scale: 0.95 }],
    top: 10,
  },
  cardImageContainer: {
    width: '100%',
    height: CARD_HEIGHT * 0.6,
    overflow: 'hidden',
  },
  cardImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  noPhoto: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surfaceHighlight,
  },
  sticker: {
    position: 'absolute',
    top: 30,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 3,
    transform: [{ rotate: '-20deg' }],
  },
  likeSticker: {
    right: 20,
    borderColor: '#4ECDC4',
    backgroundColor: 'rgba(78, 205, 196, 0.3)',
  },
  passSticker: {
    left: 20,
    borderColor: '#FF6B6B',
    backgroundColor: 'rgba(255, 107, 107, 0.3)',
  },
  stickerText: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 2,
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  cardInfo: {
    padding: spacing.lg,
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  name: { ...typography.h2, color: colors.textPrimary },
  bio: { ...typography.body2, color: colors.textSecondary, marginBottom: spacing.sm },
  detailsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  detailChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  detailText: { ...typography.caption, color: colors.textSecondary },
  interestsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  interestChip: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  interestText: { ...typography.caption, color: colors.textSecondary, fontSize: 11 },
  moreInterests: { ...typography.caption, color: colors.textMuted, alignSelf: 'center' },
  actionButtons: {
    position: 'absolute',
    bottom: spacing.lg,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xl,
  },
  actionBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  passBtn: { backgroundColor: '#fff' },
  likeBtn: { backgroundColor: '#fff' },
  chatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
  },
  chatBtnText: { ...typography.body1, color: colors.textSecondary },
});

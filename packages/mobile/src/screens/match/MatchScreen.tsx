import React, { useState, useEffect, useRef, useCallback } from 'react'; import {
  View, Text, StyleSheet, Dimensions, TouchableOpacity,
  ActivityIndicator, Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/authStore';
import { api } from '../../services/api';
import { useToast } from '../../hooks/useToast';
import { colors, typography, spacing, radius, shadows } from '../../theme';
import { getPresenceSocket } from '../../services/presenceSocket';
import {
  emitProfileLiked, emitProfilePassed, emitProfileBlocked, emitLikeAnswered, onPremiumChanged,
} from '../../services/appEvents';
import { ReportBlockSheet } from '../../components/safety/ReportBlockSheet';
import { resolveUrl } from '../../config';
import { MatchPopup } from '../../components/common/MatchPopup';
import { PaywallModal, PaywallReason } from '../../components/common/PaywallModal';
import { ProgressiveImage } from '../../components/common/ProgressiveImage';
import { DatingCategoryBadge, DatingCategory } from '../../components/common/DatingCategoryBadge';
import { BounceSwipe } from '../../components/common/BounceSwipe';
import { hapticSuccess, hapticImpact } from '../../utils/haptics';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;
const CARD_WIDTH = SCREEN_WIDTH - spacing.md * 2; // cardsContainer horizontal padding

interface SwipeProfile {
  userId: string;
  displayName: string;
  age: number;
  bio: string;
  occupation?: string;
  education?: string;
  pronouns?: string;
  datingCategory?: DatingCategory;
  photos: { id: string; url: string; thumbnailUrl?: string; isPrimary: boolean }[];
  interests: { id: string; name: string; emoji: string; category: string }[];
  /** Coarse H3 cell-center from the server; used for on-device ranking */
  approxLocation?: { latitude: number; longitude: number };
  /** Computed on-device by rankByProximity (utils/proximity.ts) */
  distanceKm?: number;
  /** This person already liked the viewer. The server sets it only for
   *  Premium viewers (free accounts see a likes count, never who). */
  likedYou?: boolean;
  /** Opened from the Likes list: a swipe answers their like (like back or
   *  reject) instead of being a new like or pass. */
  answersLike?: boolean;
  aboutAnswers?: {
    nature?: string[];
    hobbies?: string[];
    movieGenres?: string[];
    music?: string[];
    dateStyle?: string[];
  };
  isVerified: boolean;
}

// 'Knowing more about you' — monotone icon + label per question.
// Icons stay monochrome (outline, single tone) — no emojis, no color fills.
const ABOUT_SECTIONS: {
  key: keyof NonNullable<SwipeProfile['aboutAnswers']>;
  icon: 'leaf-outline' | 'fitness-outline' | 'film-outline' | 'musical-notes-outline' | 'cafe-outline';
  label: string;
}[] = [
    { key: 'nature', icon: 'leaf-outline', label: 'Nature' },
    { key: 'hobbies', icon: 'fitness-outline', label: 'Hobbies' },
    { key: 'movieGenres', icon: 'film-outline', label: 'Movies' },
    { key: 'music', icon: 'musical-notes-outline', label: 'Music' },
    { key: 'dateStyle', icon: 'cafe-outline', label: 'Dates' },
  ];

/** The top card's content; the swipe itself is BounceSwipe around it. */
function SwipeCard({ profile }: { profile: SwipeProfile }) {
  const [photoIndex, setPhotoIndex] = useState(0);

  const photoCount = profile.photos.length;
  const currentPhoto = profile.photos[photoIndex] || profile.photos[0];

  const goToNextPhoto = () => {
    if (photoCount <= 1) return;
    setPhotoIndex((prev) => (prev + 1) % photoCount);
  };

  const goToPrevPhoto = () => {
    if (photoCount <= 1) return;
    setPhotoIndex((prev) => (prev - 1 + photoCount) % photoCount);
  };

  // Scrollable card content — the card fills the page and scrolls to the end
  // of the view (no fixed height).
  return (
      <ScrollView
        style={styles.cardScroll}
        contentContainerStyle={styles.cardScrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* Photo Gallery */}
        <View style={styles.cardImageContainer}>
          {currentPhoto ? (<TouchableOpacity
            activeOpacity={1}
            // On release, so a swipe that starts on the photo doesn't flip it
            onPress={(e) => {
              // Tap left half = prev, right half = next
              const { locationX } = e.nativeEvent;
              if (locationX < CARD_WIDTH / 2) {
                goToPrevPhoto();
              } else {
                goToNextPhoto();
              }
            }}
            style={styles.photoWrapper}
          >
            <ProgressiveImage
              key={currentPhoto.id}
              thumbnailUri={currentPhoto.thumbnailUrl ? resolveUrl(currentPhoto.thumbnailUrl) : undefined}
              uri={resolveUrl(currentPhoto.url)}
              style={styles.cardImage}
              resizeMode="contain"
            />

            {/* Left/Right tap hints */}
            {photoCount > 1 && (
              <>
                <View style={styles.photoTapLeft}>
                  <Ionicons name="chevron-back" size={20} color="rgba(255,255,255,0.5)" />
                </View>
                <View style={styles.photoTapRight}>
                  <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.5)" />
                </View>
              </>
            )}

            {/* Photo dots indicator */}
            {photoCount > 1 && (
              <View style={styles.photoDots}>
                {profile.photos.map((_, idx) => (
                  <View
                    key={idx}
                    style={[
                      styles.photoDot,
                      idx === photoIndex && styles.photoDotActive,
                    ]}
                  />
                ))}
              </View>
            )}
          </TouchableOpacity>
          ) : (
            <View style={[styles.cardImage, styles.noPhoto]}>
              <Ionicons name="person-outline" size={48} color={colors.textMuted} />
            </View>
          )}

          {/* Photo count badge */}
          {photoCount > 1 && (
            <View style={styles.photoCountBadge}>
              <Ionicons name="images-outline" size={12} color={colors.textInverse} />
              <Text style={styles.photoCountText}>{photoIndex + 1}/{photoCount}</Text>
            </View>
          )}

          {/* Primary photo — the one their selfie check is made against */}
          {currentPhoto?.isPrimary && (
            <View style={styles.primaryBadge} pointerEvents="none" accessibilityLabel="Primary photo">
              <Ionicons name="star" size={12} color={colors.textInverse} />
              <Text style={styles.photoCountText}>Primary</Text>
            </View>
          )}

          {/* Already liked the viewer — same pill as the Explore grid */}
          {profile.likedYou && (
            <View style={styles.likedYouPill} pointerEvents="none">
              <Ionicons name="heart" size={11} color="#fff" />
              <Text style={styles.likedYouText}>Liked you</Text>
            </View>
          )}
        </View>

        {/* Info */}
        <View style={styles.cardInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>
              {profile.displayName}, {profile.age}
            </Text>
            {/* Whether their latest selfie matched their own photos */}
            <View
              style={styles.faceVerified}
              accessibilityLabel={profile.isVerified ? 'Face verified' : 'Face unverified'}
            >
              <Ionicons
                name={profile.isVerified ? 'checkmark-circle' : 'close-circle'}
                size={16}
                color={profile.isVerified ? colors.success : UNVERIFIED_RED}
              />
              <Text style={styles.faceVerifiedText}>
                {profile.isVerified ? 'Face verified' : 'Face unverified'}
              </Text>
            </View>
          </View>

          {profile.pronouns ? (
            <Text style={styles.pronounsText}>{profile.pronouns}</Text>
          ) : null}

          <DatingCategoryBadge category={profile.datingCategory} style={styles.categoryBadge} />

          {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

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
            {profile.distanceKm != null ? (
              <View style={styles.detailChip}>
                <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
                <Text style={styles.detailText}>~{profile.distanceKm} km away</Text>
              </View>
            ) : null}
          </View>

          {profile.interests.length > 0 && (
            <View style={styles.interestsRow}>
              {profile.interests.map((interest) => (
                <View key={interest.id} style={styles.interestChip}>
                  <Text style={styles.interestText}>
                    {interest.name}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* 'Knowing more about you' answers */}
          {(() => {
            const answered = ABOUT_SECTIONS.filter(({ key }) => (profile.aboutAnswers?.[key] ?? []).length > 0);
            if (answered.length === 0) return null;
            return (
              <View style={styles.aboutSection}>
                <Text style={styles.aboutHeading}>More about {profile.displayName}</Text>
                {answered.map(({ key, icon, label }) => {
                  const items = profile.aboutAnswers?.[key] ?? [];
                  return (
                    <View key={key} style={styles.aboutRow}>
                      <Ionicons name={icon} size={15} color={colors.textSecondary} />
                      <View style={styles.aboutRowBody}>
                        <Text style={styles.aboutLabel}>{label}</Text>
                        <View style={styles.aboutChips}>
                          {items.map((item) => (
                            <View key={item} style={styles.aboutChip}>
                              <Text style={styles.aboutChipText}>{item}</Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            );
          })()}
        </View>
      </ScrollView>
  );
}

export const MatchScreen: React.FC<{ navigation: any; route?: any }> = ({ navigation, route }) => {
  const [profiles, setProfiles] = useState<SwipeProfile[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentIndexRef = useRef(0);
  currentIndexRef.current = currentIndex;
  // Profile tapped on the Explore grid — kept until swiped so a concurrent
  // profile fetch can't knock it off the top of the deck
  const pendingFocusRef = useRef<SwipeProfile | null>(null);
  // Users swiped or matched this session — never re-shown, even if a stale
  // in-flight fetch (issued before the match/swipe was recorded) returns them
  const removedIdsRef = useRef<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [swiping, setSwiping] = useState(false);
  // Lifetime swipe budget (free accounts) — shown quietly once it runs low,
  // so the paywall never lands as a surprise. null until the first swipe reports it.
  const [swipesRemaining, setSwipesRemaining] = useState<number | null>(null);
  const unreadLikeCount = useAuthStore((s) => s.unreadLikeCount);
  const fetchUnreadLikeCount = useAuthStore((s) => s.fetchUnreadLikeCount);
  const toast = useToast();

  // Match popup state
  const [matchPopup, setMatchPopup] = useState<{
    visible: boolean;
    matchId: string;
    partnerId: string;
    partnerName: string;
    partnerPhotoUrl?: string;
  }>({ visible: false, matchId: '', partnerId: '', partnerName: '' });

  // Paywall modal state
  const [paywall, setPaywall] = useState<{
    visible: boolean;
    reason: PaywallReason;
    used: number;
    limit: number;
  }>({ visible: false, reason: 'swipe_limit', used: 0, limit: 0 });

  const fetchProfiles = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.getSwipeProfiles();
      if (res.success && res.data) {
        const list: SwipeProfile[] = (res.data.profiles || []).filter(
          (p: SwipeProfile) => !removedIdsRef.current.has(p.userId),
        );
        const fp = pendingFocusRef.current;
        setProfiles(fp ? [fp, ...list.filter((p) => p.userId !== fp.userId)] : list);
        setCurrentIndex(0);
      } else {
        toast.showError('Load failed', 'Could not load profiles.');
      }
    } catch (err: any) {
      toast.showError('Load failed', err.message || 'Try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfiles();
    fetchUnreadLikeCount();

    // Shared /presence socket — listen for match:new to show the match popup
    const socket = getPresenceSocket();

    const onMatchNew = (data: any) => {
      console.log('[MatchScreen] New match:', data.matchId, 'with', data.partnerName);
      // The matched partner must never reappear in the deck — drop them from
      // the unswiped tail now and from every future fetch (covers matches made
      // on the Likes screen while this deck was already loaded)
      if (data.partnerId) {
        removedIdsRef.current.add(data.partnerId);
        if (pendingFocusRef.current?.userId === data.partnerId) {
          pendingFocusRef.current = null;
        }
        setProfiles((prev) =>
          prev.filter((p, i) => i < currentIndexRef.current || p.userId !== data.partnerId),
        );
      }
      // The animated MatchPopup is only for the user who completed the match
      // (the one who liked back / swiped last — `initiatorId`). The other
      // side — the user whose profile was liked back — gets no modal; the
      // chat badge signals the new conversation instead. If `initiatorId` is
      // missing (pre-update server), fall back to the old show-to-both
      // behavior. Read the id via getState() so this mount-time closure never
      // goes stale.
      const myUserId = useAuthStore.getState().user?.id;
      const isMatchInitiator = !data.initiatorId || data.initiatorId === myUserId;
      if (isMatchInitiator) {
        hapticSuccess();
        setMatchPopup({
          visible: true,
          matchId: data.matchId,
          partnerId: data.partnerId || '',
          partnerName: data.partnerName || 'Someone',
          partnerPhotoUrl: data.partnerPhotoUrl || undefined,
        });
      }
      // Fetch profiles again to refresh
      fetchProfiles();
      fetchUnreadLikeCount();
    };

    // A like that arrives while the deck is open tags that person's card at
    // once. For a free viewer the server sends no id, so nothing changes.
    const onLikesNew = (data: any) => {
      if (!data?.likedByUserId) return;
      setProfiles((prev) =>
        prev.map((p) => (p.userId === data.likedByUserId ? { ...p, likedYou: true } : p)),
      );
    };

    socket.on('match:new', onMatchNew);
    socket.on('likes:new', onLikesNew);

    // Premium gained or lost: "Liked you" tags come only to Premium viewers,
    // so reload the deck once (as a new match does), and drop the free
    // account's swipe counter; the next swipe reports it again if it applies
    const offPremiumChanged = onPremiumChanged(() => {
      setSwipesRemaining(null);
      fetchProfiles();
    });

    return () => {
      // Shared socket — detach this screen's listeners only
      socket.off('match:new', onMatchNew);
      socket.off('likes:new', onLikesNew);
      offPremiumChanged();
    };
  }, []);

  // Dismiss the match popup
  const handleKeepSwiping = () => {
    setMatchPopup((prev) => ({ ...prev, visible: false }));
  };

  // Navigate to chat on match
  const handleSayHello = () => {
    const { matchId, partnerId, partnerName, partnerPhotoUrl } = matchPopup;
    setMatchPopup((prev) => ({ ...prev, visible: false }));
    navigation.navigate('Chat', {
      matchId,
      partnerName,
      partnerId,
      partnerPhotoUrl,
    });
  };

  // Refresh like count when returning from Likes screen
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      fetchUnreadLikeCount();
    });
    return unsubscribe;
  }, [navigation]);

  // A profile tapped on the Explore grid arrives via route params —
  // show it as the top card, keeping the rest of the unswiped deck behind it
  useEffect(() => {
    const fp: SwipeProfile | undefined = route?.params?.focusProfile;
    if (!fp?.userId) return;
    navigation.setParams({ focusProfile: undefined });
    pendingFocusRef.current = fp;
    setProfiles((prev) => [
      fp,
      ...prev.slice(currentIndexRef.current).filter((p) => p.userId !== fp.userId),
    ]);
    setCurrentIndex(0);
  }, [route?.params?.focusProfile]);

  // ─── Report / block the profile on top ───────────────
  // Held in state (not read from the deck) so the sheet keeps its person
  // while the deck changes underneath it.
  const [safetyProfile, setSafetyProfile] = useState<SwipeProfile | null>(null);

  // A blocked person leaves the deck at once, the same way a new match does:
  // dropped from the current card onward and from every later fetch, and
  // from the Explore grid
  const removeBlockedProfile = (userId: string) => {
    removedIdsRef.current.add(userId);
    if (pendingFocusRef.current?.userId === userId) {
      pendingFocusRef.current = null;
    }
    setProfiles((prev) =>
      prev.filter((p, i) => i < currentIndexRef.current || p.userId !== userId),
    );
    emitProfileBlocked(userId);
  };

  const handleSwipe = async (direction: 'left' | 'right') => {
    if (swiping) return;
    const profile = profiles[currentIndex];
    if (!profile) return;

    setSwiping(true);
    const action = direction === 'right' ? 'like' : 'pass';

    let shouldAdvance = false;
    try {
      // A liker opened from the Likes list is answered as the list would:
      // like back (a match, using no free like) or reject (off the list)
      const res = profile.answersLike
        ? await api.respondToLike(profile.userId, direction === 'right' ? 'like' : 'discard')
        : await api.swipe(profile.userId, action);
      if (res.success && res.data) {
        shouldAdvance = true;
        const data: { matched: boolean; swipesRemaining?: number } = res.data;
        if (typeof data.swipesRemaining === 'number') {
          setSwipesRemaining(data.swipesRemaining);
        }
        // On a match, the match:new socket event drives the animated MatchPopup
        if (!data.matched && direction === 'right') {
          toast.showSuccess('Like sent!', 'Visible in their likes.');
        }
        // The Explore grid drops this person's card at once (the server
        // leaves pending likes, and passes for a while, out of Explore anyway)
        if (direction === 'right') emitProfileLiked(profile.userId);
        else emitProfilePassed(profile.userId);
      } else if (res.error?.code === 'ALREADY_MATCHED' || res.error?.code === 'NOT_FOUND') {
        // Stale card — the interaction/match already exists on the server
        // (e.g. matched via the Likes screen), or the profile is no longer
        // available to this viewer (a block either way). Skip past it
        // silently: a pass would be refused too, so the card would stick.
        shouldAdvance = true;
      } else {
        // API returned an error — don't advance, show feedback
        if (res.error?.code === 'SWIPE_LIMIT_REACHED') {
          const details = (res.error as any)?.details;
          setPaywall({
            visible: true,
            reason: 'swipe_limit',
            used: details?.used ?? 30,
            limit: details?.limit ?? 30,
          });
        } else {
          toast.showError('Swipe failed', res.error?.message || 'Try again.');
        }
      }
    } catch (err: any) {
      toast.showError('Swipe failed', err.message || 'Try again.');
    }

    if (!shouldAdvance) {
      setSwiping(false);
      return;
    }

    // Answered here: off the Likes list, and the badge re-read from the server
    if (profile.answersLike) {
      emitLikeAnswered(profile.userId);
      fetchUnreadLikeCount();
    }

    removedIdsRef.current.add(profile.userId);
    if (pendingFocusRef.current?.userId === profile.userId) {
      pendingFocusRef.current = null;
    }
    const nextIndex = currentIndex + 1;
    setCurrentIndex(nextIndex);
    setSwiping(false);

    // Fetch more when running low (using nextIndex to avoid stale closure)
    if (nextIndex >= profiles.length - 3) {
      const res = await api.getSwipeProfiles().catch(() => null);
      if (res?.success && res.data?.profiles) {
        // Dedupe against the deck and drop already-swiped/matched users —
        // the fetch may have been issued before those were recorded
        setProfiles((prev) => {
          const seen = new Set(prev.map((p) => p.userId));
          return [
            ...prev,
            ...res.data!.profiles.filter(
              (p: SwipeProfile) => !seen.has(p.userId) && !removedIdsRef.current.has(p.userId),
            ),
          ];
        });
      }
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {navigation.canGoBack() && (
              <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
            )}
            <Text style={styles.headerTitle}>Discover</Text>
          </View>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Finding profiles near you...</Text>
        </View>

        {/* Match Popup overlay */}
        <MatchPopup
          visible={matchPopup.visible}
          partnerName={matchPopup.partnerName}
          partnerPhotoUrl={matchPopup.partnerPhotoUrl}
          onKeepSwiping={handleKeepSwiping}
          onSayHello={handleSayHello}
        />

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
  }

  const currentProfile = profiles[currentIndex];

  if (!currentProfile) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {navigation.canGoBack() && (
              <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
            )}
            <Text style={styles.headerTitle}>Discover</Text>
          </View>
          <TouchableOpacity onPress={() => navigation.navigate('Likes')}>
            <View style={styles.likesBadge}>
              <Ionicons name="heart-outline" size={22} color={colors.textPrimary} />
              {unreadLikeCount > 0 && (
                <View style={styles.likesBadgeCount}>
                  <Text style={styles.likesBadgeCountText}>
                    {unreadLikeCount > 9 ? '9+' : unreadLikeCount}
                  </Text>
                </View>
              )}
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

        {/* Match Popup overlay */}
        <MatchPopup
          visible={matchPopup.visible}
          partnerName={matchPopup.partnerName}
          partnerPhotoUrl={matchPopup.partnerPhotoUrl}
          onKeepSwiping={handleKeepSwiping}
          onSayHello={handleSayHello}
        />

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
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
            {navigation.canGoBack() && (
              <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
            )}
            <Text style={styles.headerTitle}>Discover</Text>
          </View>
        {/* Quiet swipe-budget counter — appears only when the free
              lifetime allowance runs low, so the paywall isn't a surprise */}
        {swipesRemaining !== null && swipesRemaining <= 5 && (
          <View style={styles.swipeBudgetPill}>
            <Text style={styles.swipeBudgetText}>
              {swipesRemaining === 0
                ? 'No swipes left'
                : `${swipesRemaining} swipe${swipesRemaining === 1 ? '' : 's'} left`}
            </Text>
          </View>
        )}
        <TouchableOpacity onPress={() => navigation.navigate('Likes')}>
          <View style={styles.likesBadge}>
            <Ionicons name="heart-outline" size={22} color={colors.textPrimary} />
            {unreadLikeCount > 0 && (
              <View style={styles.likesBadgeCount}>
                <Text style={styles.likesBadgeCountText}>
                  {unreadLikeCount > 9 ? '9+' : unreadLikeCount}
                </Text>
              </View>
            )}
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
                <ProgressiveImage
                  thumbnailUri={(() => {
                    const p = profiles[currentIndex + 1].photos.find(ph => ph.isPrimary) || profiles[currentIndex + 1].photos[0];
                    return p?.thumbnailUrl ? resolveUrl(p.thumbnailUrl) : undefined;
                  })()}
                  uri={resolveUrl((profiles[currentIndex + 1].photos.find(p => p.isPrimary) || profiles[currentIndex + 1].photos[0])!.url)}
                  style={styles.cardImage}
                  resizeMode="contain"
                />
              ) : null}
            </View>
          </View>
        )}

        {/* Current card: slides sideways and bounces back; the deck
            moves on once the swipe is recorded. It grows from the back
            card's 0.96 as it takes the top. */}
        <BounceSwipe
          key={currentProfile.userId}
          style={StyleSheet.absoluteFill}
          cardStyle={styles.card}
          onSwipe={handleSwipe}
          enabled={!swiping}
          busy={swiping}
          enterFrom={0.96}
          labels={currentProfile.answersLike ? { right: 'Like back', left: 'Reject' } : { right: 'Like', left: 'Pass' }}
        >
          <SwipeCard profile={currentProfile} />
        </BounceSwipe>
      </View>

      {/* How to answer, with report / block beside it */}
      {currentProfile && (
        <View style={styles.actionBar}>
          <TouchableOpacity
            style={styles.safetyBtn}
            onPress={() => setSafetyProfile(currentProfile)}
            activeOpacity={0.7}
            accessibilityLabel="Report or block"
          >
            <Ionicons name="flag-outline" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
          <Text style={styles.swipeHint}>
            {currentProfile.answersLike
              ? 'Swipe right to like back, left to reject'
              : 'Swipe right to like, left to pass'}
          </Text>
          {/* Balances the report button so the hint stays centred */}
          <View style={styles.safetySpacer} />
        </View>
      )}

      {/* Match Popup overlay */}
      <MatchPopup
        visible={matchPopup.visible}
        partnerName={matchPopup.partnerName}
        partnerPhotoUrl={matchPopup.partnerPhotoUrl}
        onKeepSwiping={handleKeepSwiping}
        onSayHello={handleSayHello}
      />

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

      {/* Report / block — last, so it covers the whole screen */}
      {safetyProfile ? (
        <ReportBlockSheet
          visible
          userId={safetyProfile.userId}
          name={safetyProfile.displayName}
          onClose={() => setSafetyProfile(null)}
          onBlocked={() => removeBlockedProfile(safetyProfile.userId)}
        />
      ) : null}
    </SafeAreaView>
  );
};

/** Cross on the Face unverified label */
const UNVERIFIED_RED = '#E53935';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerTitle: { ...typography.h2, color: colors.textPrimary },
  swipeBudgetPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceHighlight,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  swipeBudgetText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  likesBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceHighlight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  likesBadgeCount: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#FF6B6B',
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  likesBadgeCountText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
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
  refreshBtnText: { ...typography.button, color: colors.textInverse },
  cardsContainer: {
    flex: 1,
    paddingHorizontal: spacing.md,
  },
  card: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.xl,
    backgroundColor: colors.background,
    overflow: 'hidden',
    ...shadows.sm,
  },
  nextCard: {
    transform: [{ scale: 0.96 }],
    top: 8,
  },
  cardScroll: {
    flex: 1,
  },
  cardScrollContent: {
    paddingBottom: spacing.lg,
  },
  cardImageContainer: {
    width: '100%',
    height: SCREEN_HEIGHT * 0.52,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: colors.surface,
  },
  photoWrapper: {
    width: '100%',
    height: '100%',
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  noPhoto: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  photoTapLeft: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '30%',
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingLeft: 8,
  },
  photoTapRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: '30%',
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: 8,
  },
  photoDots: {
    position: 'absolute',
    bottom: 10,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
  },
  photoDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  photoDotActive: {
    width: 16,
    borderRadius: 2.5,
    backgroundColor: colors.textInverse,
  },
  primaryBadge: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  photoCountBadge: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  photoCountText: { ...typography.caption, fontSize: 10, color: colors.textInverse, fontWeight: '600' },
  likedYouPill: {
    position: 'absolute',
    top: spacing.sm,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.full,
    zIndex: 2,
  },
  likedYouText: { ...typography.caption, color: '#fff', fontWeight: '700' },
  cardInfo: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  nameRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginBottom: 2,
  },
  name: { ...typography.h3, color: colors.textPrimary },
  faceVerified: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: spacing.sm },
  faceVerifiedText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  pronounsText: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.xs, fontSize: 11 },
  categoryBadge: { marginBottom: spacing.sm },
  bio: { ...typography.body2, color: colors.textSecondary, marginBottom: spacing.sm, lineHeight: 19 },
  detailsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  detailChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'transparent',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  detailText: { ...typography.caption, color: colors.textSecondary },
  interestsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  interestChip: {
    backgroundColor: 'transparent',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  interestText: { ...typography.caption, color: colors.textSecondary, fontSize: 11 },
  aboutSection: {
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.cardBorder,
  },
  aboutHeading: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  aboutRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  aboutRowBody: { flex: 1 },
  aboutLabel: { ...typography.caption, color: colors.textMuted, marginBottom: 4 },
  aboutChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  aboutChip: {
    backgroundColor: 'transparent',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  aboutChipText: { ...typography.caption, color: colors.textSecondary, fontSize: 11 },
  actionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.background,
  },
  swipeHint: { ...typography.caption, color: colors.textMuted, letterSpacing: 0.2 },
  safetyBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  safetySpacer: { width: 40, height: 40 },
});

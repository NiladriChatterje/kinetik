import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  Image, KeyboardAvoidingView, Platform, Keyboard, ActivityIndicator,
  Modal, Alert, Dimensions, Linking, Pressable, Clipboard,
  StatusBar, Animated, ScrollView, Easing, PanResponder, AppState,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useAudioRecorder, createAudioPlayer, AudioPlayer, setAudioModeAsync, requestRecordingPermissionsAsync, RecordingPresets } from 'expo-audio';
import { usePreventScreenCapture } from 'expo-screen-capture';

import * as FileSystem from 'expo-file-system/legacy';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { Socket } from 'socket.io-client';
import { api } from '../../services/api';
import { prepareChatImage, discardPreparedChatImage, ChatImageError, type PreparedChatImage } from '../../services/chatImage';
import { ensureChatPhoto, keepSentChatPhoto, deleteChatPhotos } from '../../services/chatPhotoStore';
import { getChatSocket } from '../../services/chatSocket';
import { onPremiumChanged } from '../../services/appEvents';
import { useAuthStore } from '../../store/authStore';
import { useToast } from '../../hooks/useToast';
import { LockedChatView } from '../../components/chat/LockedChatView';
import { LinkText } from '../../components/chat/LinkText';
import { LinkChooser } from '../../components/chat/LinkChooser';
import { ReportBlockSheet } from '../../components/safety/ReportBlockSheet';
import { findLinks, openLink } from '../../utils/links';
import { suggestReplies } from '../../services/replySuggestions';
import { hapticImpact, hapticLight } from '../../utils/haptics';
import { GamePickerSheet } from '../../components/games/GamePickerSheet';
import { DotsBoxesPanel } from '../../components/games/DotsBoxesPanel';
import { ReversiBar, ReversiScreen } from '../../components/games/ReversiGame';
import { CheckersBar, CheckersScreen } from '../../components/games/ChineseCheckersGame';
import type { MiniChatLine } from '../../components/games/FullScreenGame';
import { isKnownGame } from '../../components/games/gameTypes';
import type { ChatGame, CheckersMove, DotsEdge, ReversiCell } from '../../components/games/gameTypes';
import { resolveUrl } from '../../config';
import { colors, typography, spacing, radius } from '../../theme';

interface ChatMedia {
  id: string;
  messageId: string;
  senderId: string;
  mediaType: 'image' | 'video' | 'audio' | 'file';
  url: string;
  thumbnailUrl?: string;
  /** A photo's tiny blurred preview (base64 WebP), drawn when the photo is not on this phone */
  preview?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  width?: number;
  height?: number;
  durationSecs?: number;
  isViewOnce?: boolean;
  viewedAt?: string;
}

/** What a reply shows of the message it answers (swipe-to-reply) */
interface ReplyQuote {
  id: string;
  senderId: string;
  content: string;
  mediaType?: string | null;
}

interface Message {
  id: string;
  matchId: string;
  senderId: string;
  content: string;
  createdAt: string;
  readAt: string | null;
  media?: ChatMedia;
  /** A text the server did not take (timeout, no network, error): tap to retry */
  failed?: boolean;
  /** The message this one answers; the bubble shows it above its own text */
  replyTo?: ReplyQuote | null;
}

/** The line a quote shows: the text, or what kind of media it was */
function quoteLabel(q: ReplyQuote): string {
  if (q.content) return q.content;
  if (q.mediaType === 'image') return 'Photo';
  if (q.mediaType === 'video') return 'Video';
  if (q.mediaType === 'audio') return 'Voice message';
  if (q.mediaType) return 'Attachment';
  return '';
}

/** Finger travel to the right that sets a reply; the row follows at REPLY_FOLLOW of it */
const REPLY_AT = 64;
const REPLY_FOLLOW = 0.55;

/** The not-sent icon, the same red as the Face unverified tag */
const NOT_SENT_RED = '#E53935';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;

// ─── Fix-a-Date helpers ──────────────────────────────────
// The scheduled date is stored as a plain 'YYYY-MM-DD' (the sender's local
// calendar day) so BOTH users see the same day regardless of timezone — the
// string is never round-tripped through a Date that could shift a day.
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayDateStr(): string {
  return toDateStr(new Date());
}

/**
 * A plan belongs to its day. Once that day is over, the plan is dropped: its
 * date, activities and notes go, and the planner opens empty for the next one.
 * A plan with no date yet (only ideas so far) is kept. The server keeps the
 * row, so a date that happened still counts on the profile.
 */
function isPastDay(dateStr: string | null | undefined, today: string): boolean {
  return !!dateStr && dateStr < today;
}

/** Milliseconds until the next local midnight, plus a second's margin */
function msUntilMidnight(): number {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime() + 1000;
}

// 'YYYY-MM-DD' → 'Fri, Aug 21' (built from the string's parts — no drift)
function formatScheduledDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

// Calendar helpers — swipeable month view for date selection

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// `today` is 'YYYY-MM-DD'. It is passed in, not read once when the module
// loads: the app can stay open past midnight, and yesterday must not stay
// pickable.
function getMonthDays(year: number, month: number, today: string): { date: Date; dateStr: string; day: number; isCurrentMonth: boolean; isPast: boolean }[] {
  const firstDay = new Date(year, month, 1);
  const startDow = firstDay.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const cells: { date: Date; dateStr: string; day: number; isCurrentMonth: boolean; isPast: boolean }[] = [];

  // Previous month fill
  for (let i = startDow - 1; i >= 0; i--) {
    const d = new Date(year, month - 1, prevMonthDays - i);
    cells.push({ date: d, dateStr: toDateStr(d), day: prevMonthDays - i, isCurrentMonth: false, isPast: toDateStr(d) < today });
  }

  // Current month
  for (let i = 1; i <= daysInMonth; i++) {
    const d = new Date(year, month, i);
    cells.push({ date: d, dateStr: toDateStr(d), day: i, isCurrentMonth: true, isPast: toDateStr(d) < today });
  }

  // Next month fill
  const remaining = 42 - cells.length; // 6 rows
  for (let i = 1; i <= remaining; i++) {
    const d = new Date(year, month + 1, i);
    cells.push({ date: d, dateStr: toDateStr(d), day: i, isCurrentMonth: false, isPast: false });
  }

  return cells;
}

// Rose accent used for the pinned-date banner + picker (matches the app's
// existing like/badge accent — the theme itself is monochrome)
const ROSE = '#FF6B6B';

// ─── Date Planner: Activity Suggestions ──────────────────
// Grouped so a long list stays scannable. Every id from the original flat
// list is preserved — planner data already saved on the server stores ids,
// so renaming or dropping one would orphan an existing plan.
const ACTIVITY_GROUPS: {
  title: string;
  items: { id: string; label: string; icon: keyof typeof Ionicons.glyphMap }[];
}[] = [
  {
    title: 'The classics',
    items: [
      { id: 'coffee', label: 'Coffee', icon: 'cafe-outline' },
      { id: 'dinner', label: 'Dinner', icon: 'restaurant-outline' },
      { id: 'walk', label: 'Walk', icon: 'walk-outline' },
      { id: 'movie', label: 'Movie', icon: 'film-outline' },
      { id: 'cooking', label: 'Cooking', icon: 'nutrition-outline' },
      { id: 'streetfood', label: 'Street Food', icon: 'fast-food-outline' },
      { id: 'icecream', label: 'Ice Cream', icon: 'ice-cream-outline' },
    ],
  },
  {
    title: 'Out and about',
    items: [
      { id: 'park', label: 'Park', icon: 'leaf-outline' },
      { id: 'beach', label: 'Beach', icon: 'water-outline' },
      { id: 'museum', label: 'Museum', icon: 'library-outline' },
      { id: 'art', label: 'Art', icon: 'color-palette-outline' },
      { id: 'shopping', label: 'Shopping', icon: 'bag-outline' },
      { id: 'sports', label: 'Sports', icon: 'football-outline' },
      { id: 'fleamarket', label: 'Flea Market', icon: 'pricetags-outline' },
      { id: 'cycling', label: 'Cycling', icon: 'bicycle-outline' },
      { id: 'daytrip', label: 'Day Trip', icon: 'train-outline' },
    ],
  },
  {
    title: 'After dark',
    items: [
      { id: 'music', label: 'Live Music', icon: 'musical-notes-outline' },
      { id: 'karaoke', label: 'Karaoke', icon: 'mic-outline' },
      { id: 'comedy', label: 'Comedy Night', icon: 'happy-outline' },
      { id: 'stargazing', label: 'Stargazing', icon: 'moon-outline' },
      { id: 'bonfire', label: 'Bonfire', icon: 'bonfire-outline' },
      { id: 'longdrive', label: 'Long Drive', icon: 'car-outline' },
    ],
  },
  {
    title: 'Off the beaten path',
    items: [
      { id: 'bookstore', label: 'Bookstore', icon: 'book-outline' },
      { id: 'arcade', label: 'Arcade', icon: 'game-controller-outline' },
      { id: 'boardgames', label: 'Board Games', icon: 'dice-outline' },
      { id: 'photowalk', label: 'Photo Walk', icon: 'camera-outline' },
      { id: 'pottery', label: 'Pottery', icon: 'brush-outline' },
      { id: 'picnic', label: 'Picnic', icon: 'basket-outline' },
      { id: 'sunrise', label: 'Sunrise', icon: 'sunny-outline' },
      { id: 'rainwalk', label: 'Rain Walk', icon: 'rainy-outline' },
    ],
  },
];

// ─── Date Planner: Notes ────────────────────────────────
// Bounded so planner_data stays small — the whole blob is rewritten on
// every save, so an unbounded notes field grows the row without limit.
const MAX_NOTES = 5;
/** Destructive red, matching the Delete buttons elsewhere in the app */
const UNMATCH_RED = '#E53935';
const MAX_NOTE_LEN = 200;

/**
 * Notes used to be one free-text string. Accept both shapes when loading so
 * plans saved before the change still open, and clamp to the current limits.
 */
function normalizeNotes(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
      .map((n) => n.trim().slice(0, MAX_NOTE_LEN))
      .slice(0, MAX_NOTES);
  }
  if (typeof raw === 'string' && raw.trim()) return [raw.trim().slice(0, MAX_NOTE_LEN)];
  return [];
}

// ─── Vibe Check Options ─────────────────────────────────
// Each button shows the emoji a tap sends as the message. The faces have no
// line icon (no icon set draws heart eyes), so the row shows the emoji
// themselves. 🌚 is the cheeky one.
const VIBE_OPTIONS = ['❤️', '👍', '🔥', '😂', '😍', '😢', '🌚'] as const;

/**
 * Minimum clearance between the input bar and the bottom of the screen,
 * counting whatever the device's safe-area inset already provides. Keeps the
 * bar off the edge on phones that report no bottom inset without adding a
 * second gap on phones that do.
 */
const MIN_INPUT_BOTTOM_GAP = spacing.md;

/**
 * How far left the finger holding the mic must travel to throw the take
 * away. Far enough that a wobble while holding cannot reach it.
 */
const RECORD_CANCEL_DISTANCE = 100;

// ─── Recording Indicators ───────────────────────────────
// Both are purely decorative and hold no recording state, so they cannot
// affect capture — they only mount while `isRecording` is already true.

const WAVEFORM_HEIGHT = 26;
/** Spikes per tile. Must be even so the two tiles meet without a kink. */
const SPIKES_PER_TILE = 28;
/** Time for the trace to travel exactly one tile. */
const WAVEFORM_SCROLL_MS = 1700;

/**
 * Build a seamless two-tile spike trace as an SVG path.
 *
 * The same spike heights are laid down twice end to end, and the path closes
 * on the value it opened with. Scrolling by exactly one tile width therefore
 * lands on an identical picture, so the loop has no visible seam.
 */
function buildSpikePath(tileWidth: number, height: number, amps: number[]): string {
  const mid = height / 2;
  const peak = mid - 1; // keep the stroke inside the box rather than clipped
  const step = tileWidth / amps.length;
  // Alternating direction is what makes it read as spikes rather than a wave.
  const yAt = (i: number) => mid + (i % 2 === 0 ? -1 : 1) * amps[i] * peak;

  let d = `M0 ${yAt(0).toFixed(1)}`;
  for (let tile = 0; tile < 2; tile++) {
    for (let i = tile === 0 ? 1 : 0; i < amps.length; i++) {
      d += ` L${(tile * tileWidth + i * step).toFixed(1)} ${yAt(i).toFixed(1)}`;
    }
  }
  return `${d} L${(2 * tileWidth).toFixed(1)} ${yAt(0).toFixed(1)}`;
}

/**
 * Live spike trace for an in-progress voice note.
 *
 * A jagged SVG path scrolls right to left while its amplitude breathes, which
 * reads as a recording being drawn. It is not driven by real amplitude — the
 * recorder exposes no metering here — so treat it as an activity indicator,
 * not a signal display.
 *
 * The path itself is static; all motion is `translateX` and `scaleY` on the
 * wrapper, so it runs entirely on the native driver. Animating the `d`
 * attribute instead would re-render on the JS thread every frame while a
 * recording is in flight, which is exactly what this screen cannot afford.
 *
 * Memoised because the parent re-renders once a second as the timer ticks.
 */
const RecordingWaveform: React.FC = React.memo(() => {
  const [width, setWidth] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;
  const amplitude = useRef(new Animated.Value(0.7)).current;

  // Fixed for the life of the bar — the movement comes from scrolling, so a
  // fresh set of heights per take is enough to keep takes from looking alike.
  const amps = useRef(
    Array.from({ length: SPIKES_PER_TILE }, () => 0.25 + Math.random() * 0.75),
  ).current;

  const path = useMemo(
    () => (width > 0 ? buildSpikePath(width, WAVEFORM_HEIGHT, amps) : ''),
    [width, amps],
  );

  // Scroll one tile, then snap back to an identical frame and repeat.
  useEffect(() => {
    if (width <= 0) return;
    scrollX.setValue(0);
    const scroll = Animated.loop(
      Animated.timing(scrollX, {
        toValue: -width,
        duration: WAVEFORM_SCROLL_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    scroll.start();
    return () => scroll.stop();
  }, [width, scrollX]);

  // Independent amplitude jumps, so the trace does not look like a loop.
  useEffect(() => {
    let cancelled = false;
    const breathe = () => {
      if (cancelled) return;
      Animated.timing(amplitude, {
        toValue: 0.4 + Math.random() * 0.6,
        duration: 170 + Math.random() * 230,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) breathe();
      });
    };
    breathe();
    return () => {
      cancelled = true;
      amplitude.stopAnimation();
    };
  }, [amplitude]);

  return (
    <View
      style={styles.waveform}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
      pointerEvents="none"
    >
      {width > 0 && (
        <Animated.View
          style={{
            width: width * 2,
            height: WAVEFORM_HEIGHT,
            transform: [{ translateX: scrollX }, { scaleY: amplitude }],
          }}
        >
          <Svg width={width * 2} height={WAVEFORM_HEIGHT}>
            <Path
              d={path}
              stroke="#FF6B6B"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </Svg>
        </Animated.View>
      )}
    </View>
  );
});
RecordingWaveform.displayName = 'RecordingWaveform';

/** Slow blink on the REC dot — the conventional "we are live" cue. */
const RecordingDot: React.FC = React.memo(() => {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.2, duration: 550, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 550, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return <Animated.View style={[styles.recordingDot, { opacity }]} pointerEvents="none" />;
});
RecordingDot.displayName = 'RecordingDot';

// ─── Message row ─────────────────────────────────────
// Memoised so the list redraws only the rows whose props changed, instead of
// every mounted row on each keystroke or recording tick. Everything a row
// shows arrives through these props. Every update to a message (read
// receipt, view-once opened, temp id swapped for the real one) replaces the
// message object rather than mutating it, so a changed message always
// arrives as a new `item` and its row redraws.
interface MessageRowProps {
  item: Message;
  isMine: boolean;
  avatarUri?: string;
  isAudioPlaying: boolean;
  onOpenOneTimeView: (media: ChatMedia) => void;
  /** Full-size photo, and its thumbnail to show while the full one loads. */
  onPreviewPhoto: (url: string, thumbnailUrl?: string) => void;
  /**
   * A photo's file on this phone: a uri once saved, null when it is neither
   * here nor on the server, undefined while that is being found out.
   */
  localPhoto?: string | null;
  onToggleAudio: (messageId: string, url: string) => void;
  onRetry: (message: Message) => void;
  /** A tap on a text with links: one opens, several ask which */
  onOpenLinks: (urls: string[]) => void;
  /** A long press on a text: copy it */
  onCopyText: (text: string) => void;
  /** A swipe to the right on the row: answer this message */
  onReply: (message: Message) => void;
  /** Names the quoted sender in a reply bubble */
  partnerName: string;
}

const MessageRow = React.memo(function MessageRow({
  item,
  isMine,
  avatarUri,
  isAudioPlaying,
  onOpenOneTimeView,
  onPreviewPhoto,
  localPhoto,
  onToggleAudio,
  onRetry,
  onOpenLinks,
  onCopyText,
  onReply,
  partnerName,
}: MessageRowProps) {
  const renderMediaContent = (item: Message, isMine: boolean) => {
    if (!item.media) return null;
    const media = item.media;

    // View-once media that has been viewed — show "Opened" placeholder
    if (media.isViewOnce && media.viewedAt) {
      return (
        <View style={[styles.viewOnceViewed, isMine && styles.viewOnceViewedMine]}>
          <Ionicons
            name="lock-open-outline"
            size={isMine ? 12 : 14}
            color={isMine ? 'rgba(255,255,255,0.55)' : colors.textMuted}
          />
          <Text style={[styles.viewOnceViewedText, isMine && styles.viewOnceViewedTextMine]}>
            {isMine ? 'Opened' : 'Viewed'}
          </Text>
        </View>
      );
    }

    // View-once media NOT yet viewed (receiver side) — show "View once" card
    if (media.isViewOnce && !media.viewedAt && !isMine) {
      return (
        <TouchableOpacity
          onPress={() => onOpenOneTimeView(media)}
          activeOpacity={0.85}
          style={styles.viewOnceCard}
        >
          <Ionicons name="eye-outline" size={16} color={colors.textPrimary} />
          <Text style={styles.viewOnceCardLabel}>Tap to open</Text>
        </TouchableOpacity>
      );
    }

    // A photo: drawn from this phone (chat photos live on the phones, the
    // server keeps one only until the receiver's phone has saved it). Until
    // it is here, or when it never will be, its blurred preview holds the
    // place. A one-time photo stays on the server and is drawn below.
    if (media.mediaType === 'image' && !media.isViewOnce) {
      // Saved here, or (download failed) still on the server
      const source = localPhoto || (localPhoto === null && media.url ? resolveUrl(media.url) : null);
      if (source) {
        return (
          <TouchableOpacity onPress={() => onPreviewPhoto(source)} activeOpacity={0.9}>
            <View style={styles.mediaImageWrap}>
              <Image source={{ uri: source }} style={styles.mediaImage} resizeMode="cover" />
            </View>
          </TouchableOpacity>
        );
      }
      const missing = localPhoto === null;
      return (
        <View style={[styles.mediaImageWrap, styles.mediaImage, styles.photoPlaceholder]}>
          {media.preview ? (
            <Image
              source={{ uri: `data:image/webp;base64,${media.preview}` }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              blurRadius={6}
            />
          ) : null}
          {missing ? (
            <View style={styles.photoMissing}>
              <Ionicons name="image-outline" size={16} color="#fff" />
              <Text style={styles.photoMissingText}>Not on this phone</Text>
            </View>
          ) : (
            <ActivityIndicator color={media.preview ? '#fff' : colors.textMuted} />
          )}
        </View>
      );
    }

    // Regular media content (including sender's own view-once)
    if (media.mediaType === 'image') {
      return (
        <TouchableOpacity
          onPress={() => {
            // Sender can preview their own view-once images normally.
            // Full size in the viewer; the bubble keeps the thumbnail.
            onPreviewPhoto(
              resolveUrl(media.url || media.thumbnailUrl || ''),
              media.thumbnailUrl ? resolveUrl(media.thumbnailUrl) : undefined,
            );
          }}
          activeOpacity={0.9}
        >
          <View style={styles.mediaImageWrap}>
            <Image
              source={{
                uri: resolveUrl(media.thumbnailUrl || media.url),
              }}
              style={styles.mediaImage}
              resizeMode="cover"
            />
            {media.isViewOnce && (
              <View style={styles.viewOnceOverlay}>
                <Ionicons name={isMine ? 'time-outline' : 'eye-outline'} size={16} color="#fff" />
                <Text style={styles.viewOnceOverlayText}>
                  {isMine ? 'Not opened' : 'View once'}
                </Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      );
    }

    if (media.mediaType === 'video') {
      return (
        <TouchableOpacity
          onPress={async () => {
            // For view-once video on receiver side, this shouldn't be reached
            // as we show the viewOnceCta above instead
            const baseUrl = resolveUrl(media.url);
            const token = await api.getFreshToken();
            const separator = baseUrl.includes('?') ? '&' : '?';
            const videoUrl = token
              ? `${baseUrl}${separator}token=${encodeURIComponent(token)}`
              : baseUrl;
            Linking.openURL(videoUrl).catch(() =>
              Alert.alert('Error', 'Could not open video player.')
            );
          }}
          activeOpacity={0.8}
        >
          <View style={[styles.videoThumbContainer, isMine && styles.videoThumbMine]}>
            <Ionicons name="videocam" size={28} color="#fff" />
            <View style={styles.videoPlayBadge}>
              <Ionicons name="play" size={14} color="#fff" />
            </View>
            <Text style={styles.videoThumbText}>Tap to play</Text>
          </View>
        </TouchableOpacity>
      );
    }

    if (media.mediaType === 'audio') {
      return (
        <TouchableOpacity
          onPress={() => onToggleAudio(item.id, media.url)}
          activeOpacity={0.7}
          style={styles.audioPlayer}
        >
          <Ionicons
            name={isAudioPlaying ? 'pause-circle' : 'play-circle'}
            size={36}
            color={isMine ? colors.textInverse : colors.textPrimary}
          />
          <View style={styles.audioWaveform}>
            <View style={[styles.audioWaveBar, { backgroundColor: isMine ? 'rgba(255,255,255,0.5)' : colors.textMuted }]} />
            <View style={[styles.audioWaveBar, styles.audioWaveBarTall, { backgroundColor: isMine ? 'rgba(255,255,255,0.6)' : colors.textSecondary }]} />
            <View style={[styles.audioWaveBar, { backgroundColor: isMine ? 'rgba(255,255,255,0.5)' : colors.textMuted }]} />
            <View style={[styles.audioWaveBar, styles.audioWaveBarTall, { backgroundColor: isMine ? 'rgba(255,255,255,0.6)' : colors.textSecondary }]} />
            <View style={[styles.audioWaveBar, { backgroundColor: isMine ? 'rgba(255,255,255,0.5)' : colors.textMuted }]} />
          </View>
          {media.durationSecs ? (
            <Text style={[styles.audioDuration, isMine && { color: 'rgba(255,255,255,0.7)' }]}>
              {media.durationSecs}s
            </Text>
          ) : null}
        </TouchableOpacity>
      );
    }

    if (media.mediaType === 'file') {
      return (
        <TouchableOpacity onPress={() => Alert.alert('File', resolveUrl(media.url))} activeOpacity={0.7}>
          <View style={styles.mediaFileContainer}>
            <Ionicons name="document" size={32} color={isMine ? colors.textInverse : colors.textPrimary} />
            <Text style={[styles.mediaFileText, isMine && styles.myMessageText]} numberOfLines={1}>
              {media.fileName || 'File'}
            </Text>
          </View>
        </TouchableOpacity>
      );
    }

    return null;
  };

  // Swipe right to reply: the row follows the finger a little, a reply cue
  // fades in at the left, and letting go past REPLY_AT answers this
  // message. Only a clear sideways drag claims the touch, so the list still
  // scrolls and taps and long presses on the bubble still land.
  const dragX = useRef(new Animated.Value(0)).current;
  const latest = useRef({ item, onReply });
  latest.current = { item, onReply };
  const armedRef = useRef(false);
  const settle = () => {
    armedRef.current = false;
    Animated.spring(dragX, { toValue: 0, friction: 7, tension: 120, useNativeDriver: true }).start();
  };
  const replyPan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dx > 10 && g.dx > Math.abs(g.dy) * 1.5,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => {
        dragX.setValue(Math.max(0, Math.min(g.dx, REPLY_AT * 1.6)) * REPLY_FOLLOW);
        const armed = g.dx >= REPLY_AT;
        if (armed !== armedRef.current) {
          armedRef.current = armed;
          if (armed) hapticLight();
        }
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx >= REPLY_AT) latest.current.onReply(latest.current.item);
        settle();
      },
      onPanResponderTerminate: settle,
    }),
  ).current;
  const cueOpacity = dragX.interpolate({
    inputRange: [0, REPLY_AT * REPLY_FOLLOW],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const showAvatar = !isMine;
  const isTemp = item.id.startsWith('temp-');
  const isRead = !!item.readAt;
  const hasMedia = !!item.media;

  const metaIconColor = isMine ? 'rgba(255,255,255,0.65)' : colors.textMuted;
  const readIconColor = isMine ? colors.textInverse : colors.success;

  const displayContent = item.content;
  // The links in a text message, found once per message
  const links = useMemo(
    () => (hasMedia || item.failed ? [] : findLinks(displayContent)),
    [hasMedia, item.failed, displayContent],
  );
  // The whole bubble answers touches, the same size either way: a failed
  // text is tapped to send it again, a text with a link is tapped to open
  // it, and any text is held to copy it. A press on the underlined run
  // itself is not relied on (nested text presses are unreliable on
  // Android's new architecture). Media bubbles keep their own controls.
  const canCopy = !hasMedia && displayContent.trim().length > 0;
  const onPress = item.failed
    ? () => onRetry(item)
    : links.length > 0
      ? () => onOpenLinks(links)
      : undefined;
  const onLongPress = canCopy ? () => onCopyText(displayContent) : undefined;
  const bubbleLabel = item.failed
    ? 'Message not sent. Tap to retry'
    : links.length > 0
      ? 'Message with a link. Tap to open it, hold to copy the text'
      : canCopy
        ? 'Hold to copy the text'
        : undefined;

  return (
    <View style={styles.messageRow} {...replyPan.panHandlers}>
      <Animated.View style={[styles.replyCue, { opacity: cueOpacity }]} pointerEvents="none">
        <View style={styles.replyCueDisc}>
          <Ionicons name="arrow-undo-outline" size={15} color={colors.textSecondary} />
        </View>
      </Animated.View>
      <Animated.View style={[styles.messageRowInner, isMine && styles.messageRowMine, { transform: [{ translateX: dragX }] }]}>
      {showAvatar && avatarUri ? (
        <Image source={{ uri: resolveUrl(avatarUri) }} style={styles.messageAvatar} resizeMethod="resize" />
      ) : showAvatar ? (
        <View style={[styles.messageAvatar, styles.noMsgAvatar]}>
          <Ionicons name="person-outline" size={16} color={colors.textMuted} />
        </View>
      ) : null}

      <Pressable
        style={({ pressed }) => [
          styles.messageBubble,
          isMine ? styles.myBubble : styles.theirBubble,
          pressed && onPress !== undefined && styles.bubblePressed,
        ]}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={400}
        accessibilityRole={onPress || onLongPress ? 'button' : undefined}
        accessibilityLabel={bubbleLabel}
      >
        {/* The message this one answers */}
        {item.replyTo ? (
          <View style={[styles.quote, isMine ? styles.quoteMine : styles.quoteTheirs]}>
            <Text style={[styles.quoteName, isMine && styles.quoteTextMine]} numberOfLines={1}>
              {item.replyTo.senderId === item.senderId ? (isMine ? 'You' : partnerName) : (isMine ? partnerName : 'You')}
            </Text>
            <Text style={[styles.quoteText, isMine && styles.quoteTextMine]} numberOfLines={2}>
              {quoteLabel(item.replyTo)}
            </Text>
          </View>
        ) : null}

        {/* Media attachment */}
        {hasMedia && renderMediaContent(item, isMine)}

        {/* Text content (caption or description) — hidden for view-once media.
            Links in it open on tap; a failed message keeps its whole bubble
            for the retry tap instead */}
        {hasMedia && item.media?.isViewOnce && item.media?.viewedAt ? null : hasMedia ? null : item.failed ? (
          <Text style={[styles.messageText, isMine && styles.myMessageText]}>
            {displayContent}
          </Text>
        ) : (
          <LinkText text={displayContent} style={[styles.messageText, isMine && styles.myMessageText]} />
        )}

        {/* Read receipt */}
        {isMine && (
          <View style={styles.messageMeta}>
            {item.failed ? (
              <>
                <Ionicons name="alert-circle" size={13} color={NOT_SENT_RED} />
                <Text style={styles.notSentText}>Not sent · Tap to retry</Text>
              </>
            ) : isTemp ? (
              <Ionicons name="time-outline" size={12} color={metaIconColor} />
            ) : isRead ? (
              <Ionicons name="checkmark-done" size={14} color={readIconColor} />
            ) : (
              <Ionicons name="checkmark" size={14} color={metaIconColor} />
            )}
          </View>
        )}
      </Pressable>
      </Animated.View>
    </View>
  );
});
MessageRow.displayName = 'MessageRow';

/** Waits between automatic retries of a chat's first load that failed */
const FIRST_LOAD_RETRY_DELAYS_MS = [3000, 6000, 12000];

export const ChatScreen: React.FC<{ navigation: any; route: any }> = ({ navigation, route }) => {
  const {
    matchId,
    partnerName: pName,
    partnerPhotoUrl: pPhoto,
    partnerThumbnailUrl: pThumb,
    partnerId,
    locked: lockedParam,
  } = route.params || {};
  // The 300px thumbnail serves the small header and message avatars; the
  // full photo is only the fallback for callers that do not have one
  const pAvatar: string | undefined = pThumb || pPhoto;
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  // ─── Older history (scroll-up paging) ────────────────
  // The server returns the newest page; scrolling to the top fetches the
  // page before the oldest message on screen until hasMore is false.
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const hasMoreHistoryRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  // The list is inverted: it renders newest first, from the bottom up, so
  // it opens on the latest message with nothing to scroll, a new message
  // lands at offset 0, and older pages append at the far end without
  // moving what is on screen.
  const newestFirst = useMemo(() => [...messages].reverse(), [messages]);
  const [inputText, setInputText] = useState('');
  // The message a swipe picked to answer; cleared on send or by its cross
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [loading, setLoading] = useState(true);
  // Whether this chat is locked (free account: chat is Premium only).
  // null = not known yet. The chat interface is never rendered while it is
  // unknown: a free account must not glimpse it before the lock arrives.
  // The chat list already knows and passes it in, so a locked chat opened
  // from there shows the lock immediately; otherwise the first history
  // response decides.
  const [locked, setLocked] = useState<boolean | null>(lockedParam === true ? true : null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [sending, setSending] = useState(false);
  // A tapped vibe fills in rose, pops and ticks, so the tap reads before the
  // bubble lands (sending alone was too instant to notice)
  const [pressedVibe, setPressedVibe] = useState<number | null>(null);
  const vibeScale = useRef(new Animated.Value(1)).current;
  const popVibe = (idx: number) => {
    hapticLight();
    setPressedVibe(idx);
    vibeScale.setValue(1);
    Animated.sequence([
      Animated.timing(vibeScale, { toValue: 1.35, duration: 160, easing: Easing.out(Easing.back(2)), useNativeDriver: true }),
      Animated.timing(vibeScale, { toValue: 1, duration: 220, delay: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start(() => setPressedVibe((cur) => (cur === idx ? null : cur)));
  };
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [previewPhoto, setPreviewPhoto] = useState<{ url: string; thumbnailUrl?: string } | null>(null);
  // The full-size photo loads over its thumbnail: loading, shown, or failed (thumbnail stays)
  const [previewState, setPreviewState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const openPhotoPreview = useCallback((url: string, thumbnailUrl?: string) => {
    if (!url) return;
    setPreviewState('loading');
    setPreviewPhoto({ url, thumbnailUrl });
  }, []);
  const closePhotoPreview = useCallback(() => setPreviewPhoto(null), []);
  // Chat photos on this phone, by media id: a file uri, or null when a photo
  // is neither here nor on the server (services/chatPhotoStore.ts)
  const [localPhotos, setLocalPhotos] = useState<Record<string, string | null>>({});
  const photoJobsRef = useRef(new Set<string>());
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);

  // ─── Fix-a-Date State ────────────────────────────────
  const [scheduledDate, setScheduledDate] = useState<string | null>(null); // 'YYYY-MM-DD'
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [settingDate, setSettingDate] = useState(false);

  // ─── View-Once Media State ────────────────────────────
  const [viewOnce, setViewOnce] = useState(false); // Toggle in media picker
  const [viewingOnceMedia, setViewingOnceMedia] = useState<{
    mediaId: string;
    url: string;
    mediaType: 'image' | 'video';
  } | null>(null); // Currently being viewed in one-time viewer

  // ─── Date Planner State ────────────────────────────────
  // Today's local date, kept fresh: it moves at midnight and when the app
  // comes back to the foreground, so a plan whose day is over drops even
  // from a chat left open overnight.
  const [today, setToday] = useState(todayDateStr);
  const [plannerDate, setPlannerDate] = useState<string | null>(null); // YYYY-MM-DD
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().getMonth());
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());
  const [plannerActivities, setPlannerActivities] = useState<string[]>([]);
  const [plannerNotes, setPlannerNotes] = useState<string[]>([]);
  const [newNoteText, setNewNoteText] = useState('');
  const [savingPlanner, setSavingPlanner] = useState(false);

  // ─── Icebreaker State ──────────────────────────────────

  // ─── Vibe Check State ──────────────────────────────────
  const [showVibeCheck, setShowVibeCheck] = useState(false);

  // ─── Leaving the chat ─────────────────────────────────────
  // Unmatch, block and the server's match:unmatched event (which also reaches
  // the person who unmatched or blocked) can each end this chat. Go back once,
  // whichever comes first; a second goBack would pop the screen underneath.
  // With another screen on top (the partner's profile, where a block can
  // also happen) goBack would pop that one instead: that screen removes both.
  const leavingRef = useRef(false);
  const leaveChat = () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    // The chat is over: its photos leave this phone too
    const owner = useAuthStore.getState().user?.id;
    if (owner) deleteChatPhotos(owner, matchId);
    if (navigation.isFocused()) navigation.goBack();
  };

  // ─── Report / block sheet ────────────────────────────────
  const [safetyVisible, setSafetyVisible] = useState(false);

  // ─── Game inside the chat ─────────────────────────────
  // The chat's current game. Dots and Boxes shows above the messages; its
  // board folds away on its header, and while the keyboard is up.
  const [game, setGame] = useState<ChatGame | null>(null);
  const [gamePickerVisible, setGamePickerVisible] = useState(false);
  const [gameCollapsed, setGameCollapsed] = useState(false);
  const [pendingEdge, setPendingEdge] = useState<DotsEdge | null>(null);
  // Reversi opens full screen over the chat; the chat keeps a slim bar
  const [reversiOpen, setReversiOpen] = useState(false);
  const [pendingSquare, setPendingSquare] = useState<ReversiCell | null>(null);
  // Chinese Checkers too
  const [checkersOpen, setCheckersOpen] = useState(false);
  const [pendingHop, setPendingHop] = useState<CheckersMove | null>(null);

  // ─── Unmatch confirmation modal state ────────────────────
  const [unmatchModalVisible, setUnmatchModalVisible] = useState(false);
  const unmatchOverlayOpacity = useRef(new Animated.Value(0)).current;
  const unmatchSheetY = useRef(new Animated.Value(1)).current;
  const unmatchContentScale = useRef(new Animated.Value(1)).current;
  const { height: SCREEN_HEIGHT } = Dimensions.get('window');

  const openUnmatchModal = () => {
    setUnmatchModalVisible(true);
    Animated.parallel([
      Animated.timing(unmatchOverlayOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.spring(unmatchSheetY, { toValue: 0, speed: 50, bounciness: 4, useNativeDriver: true }),
      Animated.timing(unmatchContentScale, { toValue: 0.85, duration: 250, useNativeDriver: true }),
    ]).start();
  };

  const closeUnmatchModal = (cb?: () => void) => {
    Animated.parallel([
      Animated.timing(unmatchOverlayOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(unmatchSheetY, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(unmatchContentScale, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      setUnmatchModalVisible(false);
      cb?.();
    });
  };

  const confirmUnmatch = async () => {
    closeUnmatchModal(async () => {
      try {
        const res = await api.unmatchUser(matchId);
        if (!res.success) {
          toast.showGlass('Server busy', res.error?.message || 'Try again.');
          return;
        }
        leaveChat();
      } catch {
        toast.showGlass('Server busy', 'Try again.');
      }
    });
  };

  // ─── Date Planner modal animations ───────────────────────
  const plannerOverlayOpacity = useRef(new Animated.Value(0)).current;
  const plannerContentScale = useRef(new Animated.Value(1)).current;

  const openDatePicker = () => {
    setShowDatePicker(true);
    Animated.parallel([
      Animated.timing(plannerOverlayOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.timing(plannerContentScale, { toValue: 0.85, duration: 250, useNativeDriver: true }),
    ]).start();
  };

  const closeDatePicker = (cb?: () => void) => {
    Animated.parallel([
      Animated.timing(plannerOverlayOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(plannerContentScale, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      setShowDatePicker(false);
      cb?.();
    });
  };

  // ─── Media picker modal animations ──────────────────────
  const mediaOverlayOpacity = useRef(new Animated.Value(0)).current;
  const mediaSheetY = useRef(new Animated.Value(1)).current;
  const contentScale = useRef(new Animated.Value(1)).current;

  const openMediaPicker = () => {
    setShowMediaPicker(true);
    Animated.parallel([
      Animated.timing(mediaOverlayOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.spring(mediaSheetY, { toValue: 0, speed: 50, bounciness: 4, useNativeDriver: true }),
      Animated.timing(contentScale, { toValue: 0.85, duration: 250, useNativeDriver: true }),
    ]).start();
  };

  const closeMediaPicker = (cb?: () => void) => {
    Animated.parallel([
      Animated.timing(mediaOverlayOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(mediaSheetY, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(contentScale, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      setShowMediaPicker(false);
      setViewOnce(false);
      cb?.();
    });
  };

  // ─── Prevent screenshots on this screen ───────────────
  // This applies FLAG_SECURE on Android to prevent both screenshots and screen recording.
  // On iOS, prevention is best-effort (black screen in recordings).
  usePreventScreenCapture();

  const flatListRef = useRef<FlatList>(null);
  const socketRef = useRef<Socket | null>(null);
  const authUser = useAuthStore((s) => s.user);

  // Every photo in the chat is drawn from this phone: found here, or saved
  // from the server once (which, for a received photo, lets the server
  // delete its copy). Each photo is looked up once per visit; a failed
  // download is tried again the next time the messages change.
  useEffect(() => {
    const myId = authUser?.id;
    if (!myId) return;
    for (const m of messages) {
      const media = m.media;
      if (!media || media.mediaType !== 'image' || media.isViewOnce || !media.id) continue;
      if (photoJobsRef.current.has(media.id)) continue;
      photoJobsRef.current.add(media.id);
      const mediaId = media.id;
      ensureChatPhoto({ owner: myId, matchId, mediaId, url: media.url || '', received: media.senderId !== myId })
        .then((uri) => {
          if (!uri && media.url) photoJobsRef.current.delete(mediaId); // download failed: retry later
          setLocalPhotos((prev) => (prev[mediaId] === uri ? prev : { ...prev, [mediaId]: uri }));
        });
    }
  }, [messages, matchId, authUser?.id]);
  // Reply chips from the shape of their latest message (a greeting, a when /
  // where question, thanks, a photo…), in their language; none when there is
  // nothing to answer (replySuggestions.ts)
  const suggestions = useMemo(
    () => suggestReplies(
      messages.map((m) => ({ senderId: m.senderId, content: m.content, mediaType: m.media?.mediaType })),
      authUser?.id,
    ),
    [messages, authUser?.id],
  );
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentRef = useRef(0);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const audioRecorderRef = useRef(audioRecorder);
  audioRecorderRef.current = audioRecorder;
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastCacheUriRef = useRef<string | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  // Recording lifecycle guards. startRecording (onPressIn) has several awaits
  // before record() fires; without these, a release during that window let
  // stopRecording run first and the pending start then began a recording that
  // nothing would ever stop — mic stuck on, and the orphaned session's
  // unfinalized file could get picked up and sent as an unplayable voice note.
  const micPressActiveRef = useRef(false);          // mic button currently held
  const startTaskRef = useRef<Promise<void> | null>(null); // in-flight startRecording
  const isRecordingActiveRef = useRef(false);       // native session actually capturing

  // The mic is held, not tapped: the finger going down starts capture,
  // lifting it sends, and sliding it left past RECORD_CANCEL_DISTANCE throws
  // the take away. A pan responder replaces press handling because a press
  // ended (and sent the clip) as soon as the finger drifted off the button,
  // which also left the cancel button unreachable while holding.
  // The responder is created once; it reaches the current handlers (which
  // close over the current state) through this ref.
  const recordHandlersRef = useRef<{
    start: () => Promise<void>;
    stop: () => Promise<void>;
    cancel: () => Promise<void>;
    disabled: boolean;
  }>({ start: async () => {}, stop: async () => {}, cancel: async () => {}, disabled: false });
  const recordCancelledRef = useRef(false);         // this hold slid left past the threshold
  // Finger travel while holding, for the "slide to cancel" hint
  const recordSlideX = useRef(new Animated.Value(0)).current;
  const micPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !recordHandlersRef.current.disabled,
      // Nothing takes the touch away while the mic is held
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        recordCancelledRef.current = false;
        recordSlideX.setValue(0);
        recordHandlersRef.current.start().catch(() => {});
      },
      onPanResponderMove: (_, g) => {
        if (recordCancelledRef.current) return;
        recordSlideX.setValue(Math.min(0, g.dx));
        if (g.dx <= -RECORD_CANCEL_DISTANCE) {
          recordCancelledRef.current = true;
          recordSlideX.setValue(0);
          recordHandlersRef.current.cancel().catch(() => {});
        }
      },
      onPanResponderRelease: () => {
        recordSlideX.setValue(0);
        if (!recordCancelledRef.current) recordHandlersRef.current.stop().catch(() => {});
      },
      // The system took the touch (a call, the app sent to the background):
      // treated as a release, as the press handling did
      onPanResponderTerminate: () => {
        recordSlideX.setValue(0);
        if (!recordCancelledRef.current) recordHandlersRef.current.stop().catch(() => {});
      },
    }),
  ).current;

  const partnerName = pName || 'Stranger';

  // ─── Load the pinned scheduled date (if any) ────────────
  // Fetched on mount and on every socket (re)connect so a date fixed by the
  // partner shows up even if this DM was opened before they set it.
  const syncScheduledDate = useCallback(async () => {
    try {
      const res = await api.getMatchDetail(matchId);
      if (res.success && res.data?.dateScheduled && !isPastDay(res.data.dateScheduled, todayDateStr())) {
        setScheduledDate(res.data.dateScheduled);
      }
    } catch {
      // Silent — retried on the next (re)connect
    }
  }, [matchId]);

  // ─── Load the date planner data ─────────────────────────
  // A plan whose day is over loads as an empty planner (see isPastDay)
  const applyPlanner = useCallback((pd: any) => {
    if (!pd || isPastDay(pd.date, todayDateStr())) {
      setPlannerDate(null);
      setPlannerActivities([]);
      setPlannerNotes([]);
      return;
    }
    setPlannerDate(pd.date || null);
    setPlannerActivities(pd.activities || []);
    setPlannerNotes(normalizeNotes(pd.notes));
  }, []);

  const syncPlanner = useCallback(async () => {
    try {
      const res = await api.getMatchPlanner(matchId);
      if (res.success) applyPlanner(res.data?.plannerData ?? null);
    } catch {
      // Silent
    }
  }, [matchId, applyPlanner]);

  // ─── Load the chat's game ───────────────────────────────
  const syncGame = useCallback(async () => {
    try {
      const res = await api.getMatchGame(matchId);
      // A game this version cannot draw (started from a newer app) is left out
      if (res.success) setGame(isKnownGame(res.data?.game) ? res.data!.game : null);
    } catch {
      // Silent: retried on the next (re)connect
    }
  }, [matchId]);

  const startDotsGame = useCallback(async (rows: number, cols: number): Promise<boolean> => {
    try {
      const res = await api.startDotsGame(matchId, rows, cols);
      if (res.success && res.data?.game) {
        setGame(res.data.game);
        setGameCollapsed(false);
        setPendingEdge(null);
        return true;
      }
      toast.showError('Could not start the game', res.error?.message || 'Please try again.');
      // Someone started one a moment ago: show theirs
      syncGame();
    } catch (err: any) {
      toast.showError('Could not start the game', err?.message || 'Check your connection and try again.');
    }
    return false;
  }, [matchId, toast, syncGame]);

  const startReversiGame = useCallback(async (): Promise<boolean> => {
    try {
      const res = await api.startReversiGame(matchId);
      if (res.success && res.data?.game) {
        setGame(res.data.game);
        setPendingSquare(null);
        Keyboard.dismiss();
        setReversiOpen(true);
        return true;
      }
      toast.showError('Could not start the game', res.error?.message || 'Please try again.');
      syncGame();
    } catch (err: any) {
      toast.showError('Could not start the game', err?.message || 'Check your connection and try again.');
    }
    return false;
  }, [matchId, toast, syncGame]);

  const startCheckersGame = useCallback(async (): Promise<boolean> => {
    try {
      const res = await api.startCheckersGame(matchId);
      if (res.success && res.data?.game) {
        setGame(res.data.game);
        setPendingHop(null);
        Keyboard.dismiss();
        setCheckersOpen(true);
        return true;
      }
      toast.showError('Could not start the game', res.error?.message || 'Please try again.');
      syncGame();
    } catch (err: any) {
      toast.showError('Could not start the game', err?.message || 'Check your connection and try again.');
    }
    return false;
  }, [matchId, toast, syncGame]);

  const playCheckersMove = useCallback(async (move: CheckersMove) => {
    if (!game || game.type !== 'chinese_checkers' || pendingHop) return;
    hapticLight();
    setPendingHop(move);
    try {
      const res = await api.playCheckersMove(matchId, game.id, move);
      if (res.success && res.data?.game) {
        setGame(res.data.game);
      } else {
        toast.showError('Move not played', res.error?.message || 'Please try again.');
        syncGame();
      }
    } catch (err: any) {
      toast.showError('Move not played', err?.message || 'Check your connection and try again.');
    } finally {
      setPendingHop(null);
    }
  }, [matchId, game, pendingHop, toast, syncGame]);

  const playReversiMove = useCallback(async (cell: ReversiCell) => {
    if (!game || game.type !== 'reversi' || pendingSquare) return;
    hapticLight();
    setPendingSquare(cell);
    try {
      const res = await api.playReversiMove(matchId, game.id, cell);
      if (res.success && res.data?.game) {
        setGame(res.data.game);
      } else {
        toast.showError('Move not played', res.error?.message || 'Please try again.');
        syncGame();
      }
    } catch (err: any) {
      toast.showError('Move not played', err?.message || 'Check your connection and try again.');
    } finally {
      setPendingSquare(null);
    }
  }, [matchId, game, pendingSquare, toast, syncGame]);

  const playDotsMove = useCallback(async (edge: DotsEdge) => {
    if (!game || game.type !== 'dots_boxes' || pendingEdge) return;
    hapticLight();
    setPendingEdge(edge);
    try {
      const res = await api.playDotsMove(matchId, game.id, edge);
      if (res.success && res.data?.game) {
        setGame(res.data.game);
      } else {
        toast.showError('Move not played', res.error?.message || 'Please try again.');
        syncGame();
      }
    } catch (err: any) {
      toast.showError('Move not played', err?.message || 'Check your connection and try again.');
    } finally {
      setPendingEdge(null);
    }
  }, [matchId, game, pendingEdge, toast, syncGame]);

  const endGame = useCallback(async () => {
    if (!game) return;
    try {
      const res = await api.endMatchGame(matchId, game.id);
      if (res.success && res.data?.game) setGame(res.data.game);
      else syncGame();
    } catch (err: any) {
      toast.showError('Could not end the game', err?.message || 'Check your connection and try again.');
    }
  }, [matchId, game, toast, syncGame]);

  const closeGame = useCallback(async () => {
    if (!game) return;
    const closing = game;
    setGame(null);
    setReversiOpen(false);
    setCheckersOpen(false);
    try {
      await api.hideMatchGame(matchId, closing.id);
    } catch {
      // Still closed here; it may show again on the next open
    }
  }, [matchId, game]);

  // The gamepad: a game going on unfolds; otherwise choose one to start
  const openGames = useCallback(() => {
    if (game?.status === 'active') {
      Keyboard.dismiss();
      if (game.type === 'reversi') setReversiOpen(true);
      else if (game.type === 'chinese_checkers') setCheckersOpen(true);
      else setGameCollapsed(false);
      return;
    }
    setGamePickerVisible(true);
  }, [game]);

  // Keep `today` true: a timer to the next midnight, and a check whenever
  // the app returns to the foreground (a timer does not run while the phone
  // sleeps)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => setToday(todayDateStr());
    const arm = () => {
      timer = setTimeout(() => {
        refresh();
        arm();
      }, msUntilMidnight());
    };
    arm();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, []);

  // The day turned over with the chat open: drop a plan that is now past
  useEffect(() => {
    if (isPastDay(plannerDate, today)) {
      setPlannerDate(null);
      setPlannerActivities([]);
      setPlannerNotes([]);
    }
    if (isPastDay(scheduledDate, today)) setScheduledDate(null);
  }, [today, plannerDate, scheduledDate]);

  // ─── Add one planner note ───────────────────────────────
  const addPlannerNote = useCallback(() => {
    const text = newNoteText.trim();
    if (!text) return;
    setPlannerNotes((prev) =>
      prev.length >= MAX_NOTES ? prev : [...prev, text.slice(0, MAX_NOTE_LEN)],
    );
    setNewNoteText('');
  }, [newNoteText]);

  // ─── Save planner data to server ────────────────────────
  const savePlanner = useCallback(async () => {
    if (savingPlanner) return;
    setSavingPlanner(true);

    // Flush a note that was typed but never added with +, so closing the
    // planner does not silently discard it.
    const pending = newNoteText.trim();
    const notes =
      pending && plannerNotes.length < MAX_NOTES
        ? [...plannerNotes, pending.slice(0, MAX_NOTE_LEN)]
        : plannerNotes;
    if (notes !== plannerNotes) {
      setPlannerNotes(notes);
      setNewNoteText('');
    }

    try {
      const data = {
        date: plannerDate,
        activities: plannerActivities,
        notes,
      };
      await api.updateMatchPlanner(matchId, data);
    } catch {
      // Silent - partner will see stale data until next sync
    } finally {
      setSavingPlanner(false);
    }
  }, [matchId, plannerDate, plannerActivities, plannerNotes, newNoteText, savingPlanner]);

  // ─── Fetch & merge message history ─────────────────────
  // Merges server history with what's already in state (live-arrived
  // messages, pending temp-* sends) so a refetch never wipes anything.
  // Called on mount AND on every socket (re)connect so messages missed
  // during a disconnect / dropped broadcast show up without leaving the DM.
  /** True when the server answered (messages, or the lock). */
  const syncMessages = useCallback(async (): Promise<boolean> => {
    try {
      const res = await api.getMessages(matchId);
      if (!res.success && res.error?.code === 'CHAT_LOCKED') {
        setLocked(true);
        setLoadFailed(false);
        return true;
      }
      if (!res.success || !res.data) return false;
      setLocked(false);
      // The server answered, so any earlier failed load is over (this also
      // runs when the socket's resync succeeds after the first load gave up)
      setLoadFailed(false);
      const fetched = res.data.messages || [];
      hasMoreHistoryRef.current = Boolean(res.data.hasMore);
      setHasMoreHistory(hasMoreHistoryRef.current);
      setMessages((prev) => {
        // Keep only THIS match's pending sends — if the screen was re-used
        // with a new matchId param, temps from the previous DM must not leak
        const temps = prev.filter((m) => m.id.startsWith('temp-') && m.matchId === matchId);
        // Older pages already scrolled into on this screen stay in place; a
        // resync only refreshes the newest page.
        const oldestFetchedAt = fetched.length > 0 ? fetched[0].createdAt : null;
        const olderLoaded = oldestFetchedAt
          ? prev.filter((m) => !m.id.startsWith('temp-') && m.matchId === matchId && m.createdAt < oldestFetchedAt)
          : [];
        const merged = [...olderLoaded, ...fetched, ...temps];
        const seen = new Set<string>();
        return merged.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
      });
      return true;
    } catch {
      // Retried by the first-load loop below and on the next (re)connect
      return false;
    }
  }, [matchId]);

  // A locked chat offers Premium. Coming back to it (from the checkout) asks
  // again, so a new subscriber gets the chat at once instead of after leaving
  // and reopening it. Loading the history marks it read; joining the room,
  // which the server refused while locked, brings live messages. Unlocked
  // chats are kept fresh by the socket.
  useEffect(() => {
    if (!locked) return;
    return navigation.addListener('focus', async () => {
      if (await syncMessages()) getChatSocket().emit('chat:join', { matchId });
    });
  }, [navigation, locked, syncMessages, matchId]);

  // Premium gained or lost while this chat is on screen (a UPI mandate
  // confirmed, an expiry): ask again the same way. A locked answer shows the
  // lock; an open one loads the history, and the join (refused while locked,
  // harmless when repeated) brings live messages.
  useEffect(() => onPremiumChanged(async () => {
    if (await syncMessages()) getChatSocket().emit('chat:join', { matchId });
  }), [syncMessages, matchId]);

  /** The page of messages before the oldest one on screen, prepended. */
  const loadOlderMessages = useCallback(async () => {
    if (loadingOlderRef.current || !hasMoreHistoryRef.current) return;
    const oldest = messagesRef.current.find((m) => !m.id.startsWith('temp-') && m.matchId === matchId);
    if (!oldest) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const res = await api.getMessages(matchId, oldest.id);
      if (!res.success || !res.data) return;
      const older: Message[] = res.data.messages || [];
      hasMoreHistoryRef.current = Boolean(res.data.hasMore);
      setHasMoreHistory(hasMoreHistoryRef.current);
      if (older.length === 0) return;
      setMessages((prev) => {
        const merged = [...older, ...prev];
        const seen = new Set<string>();
        return merged.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
      });
    } catch {
      // Silent — the next scroll to the top tries again
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [matchId]);

  // ─── Socket Connection ──────────────────────────────
  useEffect(() => {
    // App-wide shared /chat socket — this screen attaches its own listeners
    // and detaches them on unmount; the connection itself stays up
    const socket = getChatSocket();

    const onConnect = () => {
      setSocketConnected(true);
      socket.emit('chat:join', { matchId });
      socket.emit('chat:read', { matchId });
      // Re-sync history on every (re)connect — heals any message missed
      // while the socket was down or a broadcast was dropped
      syncMessages();
      syncScheduledDate();
      syncPlanner();
      syncGame();
    };

    // Incoming message — from partner OR our own broadcast.
    // Scoped to THIS match: the shared socket receives every joined room, so
    // the guard keeps other conversations' events out of this DM.
    const onChatMessage = (data: any) => {
      if (data?.matchId !== matchId) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === data.id)) return prev;

        // Our own message — replace the bubble it belongs to: a media one for
        // media, else one with the same text, preferring one still sending
        // (a failed one with that text means the server saved it late)
        if (data.senderId === authUser?.id) {
          const ownTemp = (m: Message) =>
            m.id.startsWith('temp-') && (data.media ? !!m.media : !m.media && m.content === data.content);
          let idx = prev.findIndex((m) => ownTemp(m) && !m.failed);
          if (idx === -1) idx = prev.findIndex((m) => ownTemp(m) && !!m.failed);
          if (idx !== -1) {
            const updated = [...prev];
            updated[idx] = {
              ...updated[idx],
              id: data.id,
              content: data.content,
              createdAt: data.createdAt || updated[idx].createdAt,
              media: data.media || updated[idx].media,
              replyTo: data.replyTo ?? updated[idx].replyTo,
              failed: false,
            };
            return updated;
          }
        }

        // New message from partner
        return [...prev, {
          id: data.id || `temp-${Date.now()}`,
          matchId: data.matchId,
          senderId: data.senderId,
          content: data.content,
          createdAt: data.createdAt || new Date().toISOString(),
          readAt: null,
          media: data.media || undefined,
          replyTo: data.replyTo || undefined,
        }];
      });

      if (data.senderId !== authUser?.id && socket.connected) {
        socket.emit('chat:read', { matchId });
      }
    };

    const onChatRead = (data: any) => {
      if (data?.matchId !== matchId) return;
      if (data.userId !== authUser?.id) {
        setMessages((prev) =>
          prev.map((m) =>
            m.senderId === authUser?.id && !m.readAt
              ? { ...m, readAt: data.readAt }
              : m,
          ),
        );
      }
    };

    const onChatTyping = (data: any) => {
      if (data?.matchId !== matchId) return;
      if (data.userId !== authUser?.id) {
        setPartnerTyping(data.isTyping);
      }
    };

    // Handle media:viewed event to update view-once status
    // Also clears URL/thumbnail so the media can never be re-viewed even if
    // state gets stale (socket reconnection, stale broadcast replay, etc.)
    const onMediaViewed = (data: any) => {
      if (data.mediaId && data.viewedAt) {
        setMessages((prev) =>
          prev.map((m) =>
            m.media?.id === data.mediaId
              ? {
                ...m,
                media: {
                  ...m.media!,
                  viewedAt: data.viewedAt,
                  url: '',
                  thumbnailUrl: undefined,
                },
              }
              : m,
          ),
        );
      }
    };

    const onDisconnect = () => {
      setSocketConnected(false);
    };

    // A date was fixed (by either side) — update the pinned banner live
    const onDateSet = (data: any) => {
      if (data?.matchId !== matchId) return;
      const date = data.dateScheduled || null;
      setScheduledDate(isPastDay(date, todayDateStr()) ? null : date);
    };

    // Planner data updated by the partner -- sync live
    const onPlannerUpdate = (data: any) => {
      if (data?.matchId !== matchId) return;
      if (data.plannerData) applyPlanner(data.plannerData);
    };

    // The game changed (started, a line drawn, ended) — redraw it. A game
    // that is over arrives only from a move or an end, so it stays shown
    // until this player closes it.
    const onGameUpdate = (data: any) => {
      if (data?.matchId !== matchId || !isKnownGame(data.game)) return;
      setGame((current) => {
        const incoming = data.game as ChatGame;
        // An older game's late update never replaces a newer one
        if (current && current.id !== incoming.id && current.createdAt > incoming.createdAt) return current;
        return incoming;
      });
    };

    // Partner unmatched — pop back to the chat list
    const onMatchUnmatched = (data: any) => {
      if (data?.matchId !== matchId) return;
      leaveChat();
    };

    socket.on('connect', onConnect);
    socket.on('chat:message', onChatMessage);
    socket.on('chat:read', onChatRead);
    socket.on('chat:typing', onChatTyping);
    socket.on('media:viewed', onMediaViewed);
    socket.on('date:set', onDateSet);
    socket.on('planner:update', onPlannerUpdate);
    socket.on('game:update', onGameUpdate);
    socket.on('match:unmatched', onMatchUnmatched);
    socket.on('disconnect', onDisconnect);
    // The shared socket is usually already connected when this screen mounts,
    // so 'connect' won't fire — run the join/read/sync sequence now
    if (socket.connected) onConnect();

    socketRef.current = socket;

    return () => {
      // Detach this screen's listeners only. No chat:leave — the badge and
      // chat list still need this room's messages on the shared socket.
      socket.off('connect', onConnect);
      socket.off('chat:message', onChatMessage);
      socket.off('chat:read', onChatRead);
      socket.off('chat:typing', onChatTyping);
      socket.off('media:viewed', onMediaViewed);
      socket.off('date:set', onDateSet);
      socket.off('planner:update', onPlannerUpdate);
      socket.off('game:update', onGameUpdate);
      socket.off('match:unmatched', onMatchUnmatched);
      socket.off('disconnect', onDisconnect);
      socketRef.current = null;
    };
  }, [matchId, syncMessages, syncScheduledDate, syncPlanner, syncGame]);

  // ─── Signal to ChatListScreen that this DM is open ──
  // So the chat list doesn't inflate the unread badge for messages
  // the user is actively viewing.
  useEffect(() => {
    useAuthStore.getState().setOpenChatMatchId(matchId);
    return () => useAuthStore.getState().setOpenChatMatchId(null);
  }, [matchId]);

  // ─── Fetch message history ─────────────────────────
  // The first load is retried on its own (the database may still be waking
  // up) while the spinner shows; only then is "Try again" offered. Messages
  // that arrive in the meantime through the socket's resync count as loaded.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attempt = async (n: number) => {
      const ok = await syncMessages();
      if (cancelled) return;
      if (ok || messagesRef.current.length > 0 || n >= FIRST_LOAD_RETRY_DELAYS_MS.length) {
        setLoading(false);
        setLoadFailed(!ok && messagesRef.current.length === 0);
        return;
      }
      timer = setTimeout(() => attempt(n + 1), FIRST_LOAD_RETRY_DELAYS_MS[n]);
    };
    setLoading(true);
    setLoadFailed(false);
    attempt(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [syncMessages]);

  const retryFirstLoad = async () => {
    setLoadFailed(false);
    setLoading(true);
    const ok = await syncMessages();
    setLoading(false);
    setLoadFailed(!ok && messagesRef.current.length === 0);
  };

  // ─── Fetch the pinned scheduled date on mount ───────
  useEffect(() => {
    syncScheduledDate();
  }, [syncScheduledDate]);

  // ─── Fetch planner data on mount ─────────────────────
  useEffect(() => {
    syncPlanner();
  }, [syncPlanner]);

  // A full screen belongs to its game; with none (closed, or the chat's
  // game is another one now) it is shut, so it never pops up later
  useEffect(() => {
    if (!game || game.type !== 'reversi') setReversiOpen(false);
    if (!game || game.type !== 'chinese_checkers') setCheckersOpen(false);
  }, [game]);

  // The last few messages, for the chat under a full-screen game
  const recentChatLines = useMemo<MiniChatLine[]>(() => {
    const label: Record<string, string> = { image: '📷 Photo', video: '🎥 Video', audio: '🎤 Voice message', file: '📎 File' };
    return messages.slice(-4).map((m) => ({
      id: m.id,
      mine: m.senderId === authUser?.id,
      text: m.content?.trim() ? m.content : m.media ? label[m.media.mediaType] ?? 'Attachment' : '',
    }));
  }, [messages, authUser?.id]);

  // ─── Fetch the chat's game on mount ──────────────────
  useEffect(() => {
    syncGame();
  }, [syncGame]);

  // ─── Track keyboard state for dynamic padding ──────
  // Both edges matter: with only a show listener this latched on the first
  // focus and never released, so the input bar kept the tight keyboard-open
  // padding for the rest of the session even after the keyboard closed.
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardVisible(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // ─── Send a text message ───────────────────────────
  /**
   * The server refused a send because this chat is locked (Premium ended
   * while it was open). Take the message back, return typed text to the
   * input so nothing is lost, and show the lock with its Upgrade button.
   */
  const handleSendLocked = (tempId: string, text?: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== tempId));
    if (text) setInputText((current) => current || text);
    setLocked(true);
    toast.showError('Message not sent', 'Chatting with this match needs Premium.');
  };

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || sending) return;

    setInputText('');
    await sendText(text);
  };

  // Sends a text bubble straight away (the input bar and the vibe row share
  // this; callers check `sending` first)
  const sendText = async (text: string) => {
    setSending(true);
    // Your own message always comes into view, even while reading history
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });

    // A pending reply goes with this text and is then done with
    const quoted = replyTo;
    if (quoted) setReplyTo(null);
    const quote: ReplyQuote | undefined = quoted
      ? { id: quoted.id, senderId: quoted.senderId, content: quoted.content, mediaType: quoted.media?.mediaType ?? null }
      : undefined;

    const tempId = `temp-${Date.now()}`;
    setMessages((prev) => [...prev, {
      id: tempId,
      matchId,
      senderId: authUser?.id || '',
      content: text,
      createdAt: new Date().toISOString(),
      readAt: null,
      replyTo: quote,
    }]);

    if (socketRef.current?.connected) {
      socketRef.current.emit('chat:message', { matchId, content: text });
    }

    try {
      await deliverText(tempId, text, quote?.id);
    } finally {
      setSending(false);
    }
  };

  /**
   * Sends a text bubble and settles it: the real id once the server has it,
   * the lock for a locked chat, otherwise marked failed so the user can tap
   * to retry (it used to sit on its clock and vanish on the next send).
   */
  const deliverText = async (tempId: string, text: string, replyToId?: string) => {
    const markFailed = () =>
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, failed: true } : m)));
    try {
      const res = await api.sendMessage(matchId, text, replyToId);
      if (res.success && res.data) {
        // If the real id already arrived (socket echo / reconnect sync), drop the temp
        setMessages((prev) => prev.some((m) => m.id === res.data!.id)
          ? prev.filter((m) => m.id !== tempId)
          : prev.map((m) => (m.id === tempId ? { ...m, id: res.data!.id } : m)));
      } else if (res.error?.code === 'CHAT_LOCKED') {
        handleSendLocked(tempId, text);
      } else {
        markFailed();
      }
    } catch {
      markFailed();
    }
  };

  // Tap a failed text: send it again in place. One retry at a time per
  // bubble, so a double tap cannot send it twice.
  const retryingRef = useRef(new Set<string>());
  const retrySendRef = useRef<(message: Message) => void>(() => {});
  retrySendRef.current = (message: Message) => {
    if (!message.failed || retryingRef.current.has(message.id)) return;
    retryingRef.current.add(message.id);
    setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, failed: false } : m)));
    void deliverText(message.id, message.content, message.replyTo?.id).finally(() => retryingRef.current.delete(message.id));
  };
  const handleRetry = useCallback((message: Message) => retrySendRef.current(message), []);

  // ─── Links and copy in message bubbles ─────────────
  // A message with several links asks which to open (LinkChooser)
  const [linkChoices, setLinkChoices] = useState<string[] | null>(null);
  const openLinkOrSay = useCallback(async (url: string) => {
    const ok = await openLink(url);
    if (!ok) toast.showError("Couldn't open link", 'No app on this phone can open it.');
  }, [toast]);
  const handleOpenLinks = useCallback((urls: string[]) => {
    if (urls.length === 1) {
      openLinkOrSay(urls[0]);
    } else if (urls.length > 1) {
      setLinkChoices(urls);
    }
  }, [openLinkOrSay]);
  const handleCopyText = useCallback((text: string) => {
    Clipboard.setString(text);
    hapticImpact();
    toast.showGlass('Copied', 'The message text is on your clipboard.');
  }, [toast]);

  // ─── Send a media message ──────────────────────────
  const sendMedia = async (uri: string, mediaType: string, durationSecs?: number) => {
    if (sending) return;
    setSending(true);
    closeMediaPicker();

    // View-once only applies to visual media — a stale toggle must never
    // flag a voice note, which would render as an unopenable card
    const applyViewOnce = viewOnce && (mediaType === 'image' || mediaType === 'video');

    const tempId = `temp-${Date.now()}`;
    const previewText = applyViewOnce
      ? `Sent a view-once ${mediaType === 'video' ? 'video' : 'photo'}`
      : mediaType === 'image'
        ? 'Sent a photo'
        : `Sent ${mediaType}`;

    // Optimistically add a temp message, and bring it into view
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    setMessages((prev) => [...prev, {
      id: tempId,
      matchId,
      senderId: authUser?.id || '',
      content: previewText,
      createdAt: new Date().toISOString(),
      readAt: null,
    }]);

    let prepared: PreparedChatImage | null = null;
    try {
      // Photos are compressed, with the metadata (GPS, camera details)
      // removed, on the phone; see services/chatImage.ts. A photo that cannot
      // be prepared is not sent at all, never as the untouched original.
      let uploadUri = uri;
      let contentType: string | undefined;
      if (mediaType === 'image') {
        prepared = await prepareChatImage(uri);
        uploadUri = prepared.uri;
        contentType = prepared.mimeType;
      }

      const res = await api.sendMediaMessage(matchId, uploadUri, mediaType, undefined, applyViewOnce, durationSecs, contentType);
      if (res.success && res.data) {
        // This phone keeps the photo it sent (the server copy goes once the
        // receiver has it). A one-time photo is not kept.
        const sentMedia = res.data.media;
        if (prepared && sentMedia?.id && !applyViewOnce) {
          const kept = authUser?.id ? keepSentChatPhoto(authUser.id, matchId, sentMedia.id, prepared.uri) : null;
          if (kept) {
            prepared = null; // moved, nothing left to discard
            photoJobsRef.current.add(sentMedia.id);
            setLocalPhotos((prev) => ({ ...prev, [sentMedia.id]: kept }));
          }
        }
        // Replace temp with confirmed message; drop the temp if the real id already arrived
        setMessages((prev) => prev.some((m) => m.id === res.data.id)
          ? prev.filter((m) => m.id !== tempId)
          : prev.map((m) =>
            m.id === tempId ? {
              id: res.data.id,
              matchId: res.data.matchId,
              senderId: res.data.senderId,
              content: res.data.content,
              createdAt: res.data.createdAt,
              readAt: null,
              media: res.data.media,
            } : m,
          ));
      }
    } catch (err: any) {
      if (err?.code === 'CHAT_LOCKED') {
        handleSendLocked(tempId);
        return;
      }
      // Remove failed temp message and show error
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      if (err instanceof ChatImageError) {
        Alert.alert('Photo not sent', err.message);
      } else {
        Alert.alert('Send Failed', err.message || 'Could not send media. Please try again.');
      }
    } finally {
      discardPreparedChatImage(prepared);
      setSending(false);
    }
  };

  // ─── One-Time View Handler ─────────────────────────
  const openOneTimeView = useCallback((media: ChatMedia) => {
    // For sender, we show the media normally (they don't need view-once behavior)
    if (media.senderId === authUser?.id) return;

    // If already viewed, don't allow opening
    if (media.viewedAt) {
      Alert.alert('Media viewed', 'This media has already been viewed.');
      return;
    }

    // Guard: URL might be empty if an optimistic clear is in-flight from
    // closeOneTimeView (rapid close + reopen before API completes).
    if (!media.url) return;

    if (media.mediaType === 'image') {
      setViewingOnceMedia({
        mediaId: media.id,
        url: resolveUrl(media.url),
        mediaType: 'image',
      });
    } else if (media.mediaType === 'video') {
      setViewingOnceMedia({
        mediaId: media.id,
        url: resolveUrl(media.url),
        mediaType: 'video',
      });
    }
  }, [authUser?.id]);

  const closeOneTimeView = useCallback(async () => {
    if (!viewingOnceMedia) return;

    const { mediaId } = viewingOnceMedia;

    // Do NOT optimistically clear the URL — doing so creates a transition where
    // the message has url='' but viewedAt is not yet set, causing the render to
    // show a broken "empty" message on the sender's side until the API confirms.
    // Instead, only update state AFTER the backend confirms success.
    const res = await api.markMediaViewed(mediaId);

    if (res.success && res.data?.viewedAt) {
      // Backend confirmed: set viewedAt + clear URL in one atomic update.
      // The message now shows the "Viewed" or "Opened" placeholder.
      setMessages((prev) =>
        prev.map((m) =>
          m.media?.id === mediaId
            ? { ...m, media: { ...m.media!, viewedAt: res.data!.viewedAt, url: '', thumbnailUrl: undefined } }
            : m,
        ),
      );
    } else {
      // Backend failed — media stays intact for retry. No state change needed.
      Alert.alert(
        'Failed to confirm view',
        res.error?.message || 'Could not reach the server. Please try again.',
      );
    }

    // Close the viewer regardless
    setViewingOnceMedia(null);
  }, [viewingOnceMedia]);

  // ─── Audio Recording ──────────────────────────────
  const startRecording = async () => {
    micPressActiveRef.current = true;
    // A start is already in flight or a session is live — never stack sessions
    if (startTaskRef.current || isRecordingActiveRef.current) return;

    const task = (async () => {
      try {
        const { granted } = await requestRecordingPermissionsAsync();
        if (!granted) {
          Alert.alert('Permission needed', 'Allow microphone access to record voice.');
          return;
        }
        // Finger already lifted (e.g. while the permission dialog was up) —
        // abort before touching the recorder
        if (!micPressActiveRef.current) return;

        // Clean up previous cached voice file
        if (lastCacheUriRef.current) {
          FileSystem.deleteAsync(lastCacheUriRef.current).catch(() => { });
          lastCacheUriRef.current = null;
        }

        // Dismiss keyboard and close picker when starting recording
        Keyboard.dismiss();
        closeMediaPicker();

        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });

        const recorder = audioRecorderRef.current;

        // Release any previous session before preparing a new one
        try {
          await recorder.stop();
        } catch {
          // Ignore — stop() throws if no session is active
        }

        await recorder.prepareToRecordAsync();

        // Last checkpoint: if the press ended during the awaits above, do NOT
        // begin capture — this was the race that left the mic recording forever
        if (!micPressActiveRef.current) {
          setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => { });
          return;
        }

        recorder.record();
        isRecordingActiveRef.current = true;
        setIsRecording(true);
        setRecordingDuration(0);

        recordingTimerRef.current = setInterval(() => {
          setRecordingDuration((prev) => prev + 1);
        }, 1000);
      } catch (err: any) {
        console.error('[ChatAudio] Recording error:', err);
        Alert.alert('Recording Error', err.message || 'Could not start recording.');
      }
    })();

    startTaskRef.current = task;
    try {
      await task;
    } finally {
      startTaskRef.current = null;
    }
  };

  const stopRecording = async () => {
    micPressActiveRef.current = false;

    // If a start is still in flight, let it settle first — stopping mid-start
    // is what used to orphan the native session
    if (startTaskRef.current) {
      try { await startTaskRef.current; } catch { }
    }
    // Start aborted (quick tap / permission denied) — nothing is recording
    if (!isRecordingActiveRef.current) return;
    isRecordingActiveRef.current = false;

    try {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      const recorder = audioRecorderRef.current;
      const duration = recordingDuration;
      setIsRecording(false);
      setRecordingDuration(0);

      await recorder.stop();

      // Return the audio session to playback mode. startRecording set
      // allowsRecording: true; leaving it set keeps the mic/earpiece routing
      // active so the recorded note plays back silent or via the earpiece.
      // playsInSilentMode keeps playback audible with the iOS silent switch on.
      setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => { });

      // Ignore very short taps (< 1 second) — likely accidental
      if (duration < 1) return;

      const sourceUri = recorder.uri;
      if (!sourceUri) {
        console.error('[ChatAudio] recorder.uri is null after stop');
        Alert.alert('Send Failed', 'Recording did not produce an audio file. Please try again.');
        return;
      }

      console.log('[ChatAudio] Recording URI:', sourceUri);

      // Pause briefly for the file system to finalize the recording
      await new Promise((r) => setTimeout(r, 200));

      // ─── Android: guard against the expo-audio zero-byte bug ──
      // Known expo-audio Android issue: recorder.uri can point to an EMPTY
      // file while the actual recording is written to a sibling file in the
      // cache "Audio" directory. If the reported file is empty, fall back to
      // the newest non-empty recording in that directory.
      let uploadSourceUri = sourceUri;
      if (Platform.OS === 'android') {
        try {
          const info = await FileSystem.getInfoAsync(sourceUri);
          if (!info.exists || !('size' in info) || (info.size ?? 0) === 0) {
            const audioDir = `${FileSystem.cacheDirectory}Audio/`;
            const names = await FileSystem.readDirectoryAsync(audioDir);
            const candidates = await Promise.all(
              names.map(async (name) => {
                const uri = `${audioDir}${name}`;
                const fi = await FileSystem.getInfoAsync(uri).catch(() => null);
                return {
                  uri,
                  size: fi?.exists ? fi.size ?? 0 : 0,
                  mod: fi?.exists ? fi.modificationTime ?? 0 : 0,
                };
              }),
            );
            const actual = candidates
              .filter((f) => f.size > 0)
              .sort((a, b) => b.mod - a.mod)[0];
            if (actual) {
              console.log('[ChatAudio] Reported URI is empty — using actual recording:', actual.uri);
              uploadSourceUri = actual.uri;
            }
          }
        } catch (err) {
          console.warn('[ChatAudio] Zero-byte check failed, using reported URI:', err);
        }
      }

      // ─── Platform-specific file copy ─────────────────────────
      // On Android 10+, FileSystem.uploadAsync uses FileInputStream
      // which cannot read files created by expo-audio in the sandbox.
      // We work around this by reading the file through the native
      // filesystem and writing a copy to the app's cache dir.
      //
      // NOTE: this used to read the file via fetch(), but fetch does NOT
      // support file:// URIs on Android — instead of the audio bytes it
      // resolves with an error body ("File not found"), so the uploaded
      // "voice note" was 14 bytes of that text and could never play.
      // readAsStringAsync reads the file directly (same native IO the
      // rest of this module uses).
      //
      // On iOS, there is no sandbox read restriction — the expo-audio
      // file is directly accessible to NSURLSession, so
      // FileSystem.uploadAsync works with the original URI directly.
      let uploadUri: string;

      if (Platform.OS === 'android') {
        try {
          console.log('[ChatAudio] Android: copying audio to cache...');
          const base64Content = await FileSystem.readAsStringAsync(uploadSourceUri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          if (!base64Content) throw new Error('Read produced empty content');

          const cacheDir = FileSystem.cacheDirectory;
          if (!cacheDir) throw new Error('cacheDirectory is null');

          const cacheUri = `${cacheDir}voice_${Date.now()}.m4a`;
          await FileSystem.writeAsStringAsync(cacheUri, base64Content, {
            encoding: FileSystem.EncodingType.Base64,
          });
          console.log('[ChatAudio] Android: wrote cache copy:', cacheUri);
          uploadUri = cacheUri;
          lastCacheUriRef.current = cacheUri;
        } catch (err) {
          console.warn('[ChatAudio] Android: cache copy failed, falling back to source URI:', err);
          uploadUri = uploadSourceUri;
        }
      } else {
        // iOS: no sandbox issue, upload the original file directly
        console.log('[ChatAudio] iOS: uploading original file directly');
        uploadUri = sourceUri;
      }

      // Refuse to send an empty file — would produce a voice note with no sound
      const finalInfo = await FileSystem.getInfoAsync(uploadUri).catch(() => null);
      if (!finalInfo?.exists || !('size' in finalInfo) || (finalInfo.size ?? 0) === 0) {
        console.error('[ChatAudio] Refusing to send empty recording:', uploadUri);
        Alert.alert('Send Failed', 'Recording produced an empty audio file. Please try again.');
        return;
      }

      await sendMedia(uploadUri, 'audio', duration);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not stop recording.');
      setIsRecording(false);
    }
  };

  const cancelRecording = async () => {
    micPressActiveRef.current = false;
    if (startTaskRef.current) {
      try { await startTaskRef.current; } catch { }
    }
    isRecordingActiveRef.current = false;
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    const recorder = audioRecorderRef.current;
    try {
      await recorder.stop();
    } catch { }
    // Return the audio session to playback mode (same as in stopRecording)
    setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => { });
    setIsRecording(false);
    setRecordingDuration(0);
  };

  // The mic's pan responder calls whichever handlers this render produced
  recordHandlersRef.current = {
    start: startRecording,
    stop: stopRecording,
    cancel: cancelRecording,
    disabled: sending,
  };

  // ─── Audio Playback ────────────────────────────────
  // Players from createAudioPlayer must be remove()d to free the native
  // instance (per expo-audio docs) — pause() alone leaks it
  const discardPlayer = () => {
    if (playerRef.current) {
      try {
        playerRef.current.pause();
        (playerRef.current as any).remove?.();
      } catch { }
      playerRef.current = null;
    }
  };

  const togglePlayAudio = async (messageId: string, url: string) => {
    if (playingAudioId === messageId) {
      discardPlayer();
      setPlayingAudioId(null);
      return;
    }

    discardPlayer();

    try {
      // Ensure the session is in playback mode — a stale recording mode routes
      // playback to the earpiece / mutes it under the iOS silent switch
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => { });

      // Append auth token as query param — native media players (AVPlayer,
      // ExoPlayer) cannot send custom HTTP headers, so we pass the JWT
      // token directly in the URL. The server extracts and verifies it.
      const baseUrl = resolveUrl(url);
      const token = await api.getFreshToken();
      const separator = baseUrl.includes('?') ? '&' : '?';
      const audioUrl = token
        ? `${baseUrl}${separator}token=${encodeURIComponent(token)}`
        : baseUrl;

      const player = createAudioPlayer(audioUrl);
      player.addListener('playbackStatusUpdate', (status: any) => {
        // Surface load/playback failures instead of leaving the bubble
        // stuck in a silent "playing" state (AudioStatus.error — emitted
        // e.g. when the media can't be fetched or decoded)
        if (status.error) {
          setPlayingAudioId(null);
          discardPlayer();
          Alert.alert('Playback Error', status.error);
          return;
        }
        if (status.didJustFinish) {
          setPlayingAudioId(null);
          discardPlayer();
        }
      });
      player.play();
      playerRef.current = player;
      setPlayingAudioId(messageId);
    } catch (err: any) {
      Alert.alert('Playback Error', err.message || 'Could not play audio.');
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (playerRef.current) {
        try {
          playerRef.current.pause();
          (playerRef.current as any).remove?.();
        } catch { }
        playerRef.current = null;
      }
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      // Leaving the screen mid-recording must not keep the mic capturing
      if (isRecordingActiveRef.current) {
        isRecordingActiveRef.current = false;
        micPressActiveRef.current = false;
        try {
          audioRecorderRef.current.stop();
        } catch { }
        setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => { });
      }
    };
  }, []);

  // ─── Media picker handlers ─────────────────────────
  const pickFromGallery = async () => {
    // The system photo picker needs no storage permission (and the build
    // declares none: Play's photo/video policy reserves READ_MEDIA_* for
    // gallery-type apps), so launch it directly.
    // quality 1: the picker hands over the original file unchanged (any lower
    // value re-encodes it); chatImage.ts strips its metadata before sending
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsEditing: false,
    });

    if (!result.canceled && result.assets[0]) {
      await sendMedia(result.assets[0].uri, 'image');
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow access to your camera to take photos.');
      return;
    }

    // quality 1: the camera's own JPEG, not a re-encoded copy
    const result = await ImagePicker.launchCameraAsync({
      quality: 1,
    });

    if (!result.canceled && result.assets[0]) {
      await sendMedia(result.assets[0].uri, 'image');
    }
  };

  // ─── Typing indicator ──────────────────────────────
  // Throttled: "typing" is sent at most once per 2.5s (each event fans out
  // through Redis + every room socket server-side); the trailing "stopped"
  // after 2s idle is unchanged, so the partner's view looks identical.
  const handleInputChange = (text: string) => {
    setInputText(text);

    if (socketRef.current?.connected) {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

      if (text.length === 0) {
        lastTypingSentRef.current = 0;
        socketRef.current.emit('chat:typing', { matchId, isTyping: false });
        return;
      }

      const now = Date.now();
      if (now - lastTypingSentRef.current >= 2500) {
        lastTypingSentRef.current = now;
        socketRef.current.emit('chat:typing', { matchId, isTyping: true });
      }

      typingTimeoutRef.current = setTimeout(() => {
        lastTypingSentRef.current = 0;
        socketRef.current?.emit('chat:typing', { matchId, isTyping: false });
      }, 2000);
    }
  };

  // ─── Fix a date ────────────────────────────────────
  const handleFixDate = async (dateToFix?: string) => {
    const dateToSet = dateToFix || plannerDate || selectedDate;
    if (!dateToSet || settingDate) return;
    setSettingDate(true);
    try {
      const res = await api.setMatchDate(matchId, dateToSet);
      if (res.success && res.data?.dateScheduled) {
        setScheduledDate(res.data.dateScheduled);
      } else {
        Alert.alert('Could not fix date', res.error?.message || 'Please try again.');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not fix the date. Please try again.');
    } finally {
      setSettingDate(false);
    }
  };

  // ─── Render message ────────────────────────────────
  // togglePlayAudio is recreated on every render (it reads playingAudioId),
  // but the memoised rows need a stable callback. The ref is refreshed after
  // every commit, before the user can tap, so a tap always runs the latest one.
  const togglePlayAudioRef = useRef(togglePlayAudio);
  useLayoutEffect(() => {
    togglePlayAudioRef.current = togglePlayAudio;
  });
  const handleToggleAudio = useCallback((messageId: string, url: string) => {
    void togglePlayAudioRef.current(messageId, url);
  }, []);

  // A swipe on a bubble: answer it. Not one the server has no id for yet.
  const handleReply = useCallback((message: Message) => {
    if (message.failed || message.id.startsWith('temp-')) return;
    setReplyTo(message);
  }, []);

  const myUserId = authUser?.id;
  const renderMessage = useCallback(({ item }: { item: Message }) => (
    <MessageRow
      item={item}
      isMine={item.senderId === myUserId}
      avatarUri={pAvatar}
      isAudioPlaying={playingAudioId === item.id}
      onOpenOneTimeView={openOneTimeView}
      onPreviewPhoto={openPhotoPreview}
      localPhoto={item.media ? localPhotos[item.media.id] : undefined}
      onToggleAudio={handleToggleAudio}
      onRetry={handleRetry}
      onOpenLinks={handleOpenLinks}
      onCopyText={handleCopyText}
      onReply={handleReply}
      partnerName={partnerName}
    />
  ), [myUserId, pAvatar, playingAudioId, openOneTimeView, openPhotoPreview, localPhotos, handleToggleAudio, handleRetry, handleOpenLinks, handleCopyText, handleReply, partnerName]);

  // ─── Input bar bottom spacing ──────────────────────
  // The SafeAreaView deliberately excludes the bottom edge, so this is the
  // only place the bottom inset is applied. The inset is ~34px on a gesture
  // phone, ~48px under an edge-to-edge 3-button bar and 0 when the system bar
  // is hidden, so a fixed value looked wrong somewhere. Sit a constant small
  // gap above whatever the system draws, never less than MIN_INPUT_BOTTOM_GAP.
  //
  // While the keyboard is open it covers that area entirely, so the inset is
  // irrelevant and the bar hugs the keyboard instead.
  const inputBarPaddingBottom = keyboardVisible
    ? spacing.xs
    : Math.max(MIN_INPUT_BOTTOM_GAP, insets.bottom + spacing.xs);

  // A first load that failed even after its retries: say so, never show an
  // empty chat that looks like the messages are gone
  const renderLoadFailed = () => (
    <View style={styles.centered}>
      <Ionicons name="cloud-offline-outline" size={48} color={colors.textMuted} />
      <Text style={styles.loadFailedTitle}>Couldn't load this chat</Text>
      <Text style={styles.loadFailedText}>The connection is slow right now. Your messages are safe.</Text>
      <TouchableOpacity style={styles.loadFailedBtn} onPress={retryFirstLoad} accessibilityRole="button">
        <Text style={styles.loadFailedBtnText}>Try again</Text>
      </TouchableOpacity>
    </View>
  );

  if (locked === null) {
    // Access not known yet: a loader with a way back, nothing of the chat
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerInfo}>
            <Text style={styles.headerName}>{partnerName}</Text>
          </View>
        </View>
        {loadFailed ? (
          renderLoadFailed()
        ) : (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        )}
      </SafeAreaView>
    );
  }

  if (locked) {
    return (
      <View style={{ flex: 1 }}>
        <LockedChatView
          partnerName={partnerName}
          onBack={() => navigation.goBack()}
          onUpgrade={() => navigation.navigate('SubscriptionCheckout', { fromPaywall: true })}
          onSafety={partnerId ? () => setSafetyVisible(true) : undefined}
        />
        {partnerId ? (
          <ReportBlockSheet
            visible={safetyVisible}
            userId={partnerId}
            name={partnerName}
            matchId={matchId}
            onClose={() => setSafetyVisible(false)}
            onBlocked={leaveChat}
          />
        ) : null}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <Animated.View style={{ flex: 1, transform: [{ scale: contentScale }] }}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>

          {/* Their photo and name open their full profile */}
          <TouchableOpacity
            style={styles.headerPartner}
            onPress={() => navigation.navigate('PartnerProfile', { matchId, partnerId, partnerName })}
            disabled={!partnerId}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Open ${partnerName}'s profile`}
          >
            {pAvatar ? (
              <Image source={{ uri: resolveUrl(pAvatar) }} style={styles.headerAvatar} resizeMethod="resize" />
            ) : (
              <View style={[styles.headerAvatar, styles.noHeaderAvatar]}>
                <Ionicons name="person-outline" size={20} color={colors.textMuted} />
              </View>
            )}
            <View style={styles.headerInfo}>
              <Text style={styles.headerName} numberOfLines={1}>{partnerName}</Text>
            </View>
          </TouchableOpacity>

          {/* Date Planner — opens the planner modal */}
          <TouchableOpacity
            style={styles.callBtn}
            onPress={() => openDatePicker()}
            activeOpacity={0.7}
          >
            <Ionicons name="calendar-outline" size={20} color={colors.textPrimary} />
          </TouchableOpacity>

          {/* Games — a game going on unfolds, otherwise pick one to start */}
          <TouchableOpacity
            style={styles.callBtn}
            onPress={openGames}
            activeOpacity={0.7}
            accessibilityLabel="Games"
          >
            <Ionicons name="game-controller-outline" size={20} color={colors.textPrimary} />
          </TouchableOpacity>

          {/* Report or block — Play requires both for profiles and chat */}
          {partnerId ? (
            <TouchableOpacity
              style={styles.callBtn}
              onPress={() => setSafetyVisible(true)}
              activeOpacity={0.7}
              accessibilityLabel="Report or block"
            >
              <Ionicons name="flag-outline" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
          ) : null}

          {/* Unmatch — red so it reads as the destructive action it is */}
          <TouchableOpacity
            style={[styles.callBtn, styles.unmatchBtn]}
            onPress={openUnmatchModal}
            activeOpacity={0.7}
            accessibilityLabel="Unmatch"
          >
            <Ionicons name="heart-dislike-outline" size={20} color={UNMATCH_RED} />
          </TouchableOpacity>
        </View>

        {/* Pinned scheduled date / planner — sticky under the header, visible on both
          ends. Gone once the date has passed. Tapping opens the planner. */}
        {scheduledDate && !isPastDay(scheduledDate, today) && (
          <TouchableOpacity
            style={styles.dateBanner}
            onPress={() => openDatePicker()}
            activeOpacity={0.7}
          >
            <Ionicons name="rose" size={15} color={ROSE} />
            <Text style={styles.dateBannerText}>
              {plannerActivities.length > 0
                ? 'Plan set for ' + formatScheduledDate(scheduledDate)
                : 'Date fixed for ' + formatScheduledDate(scheduledDate)}
            </Text>
            <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
          </TouchableOpacity>
        )}

        {/* Messages. Both platforms pad for the keyboard: Android used to
            rely on the window resizing (adjustResize), which edge-to-edge
            turned off, so the keyboard covered the input bar. The offset is
            this view's distance from the top of the window: it measures
            its frame relative to its parent, which the SafeAreaView starts
            below the status bar, while the keyboard reports a window
            position. */}
        <KeyboardAvoidingView
          style={styles.chatArea}
          behavior="padding"
          keyboardVerticalOffset={insets.top}
        >
          {game && game.type === 'dots_boxes' && authUser?.id && game.state.players.includes(authUser.id) ? (
            <DotsBoxesPanel
              game={game}
              myId={authUser.id}
              partnerName={partnerName}
              collapsed={gameCollapsed || keyboardVisible}
              onToggleCollapsed={() => {
                if (keyboardVisible) {
                  Keyboard.dismiss();
                  setGameCollapsed(false);
                } else {
                  setGameCollapsed((c) => !c);
                }
              }}
              pending={pendingEdge}
              onMove={playDotsMove}
              onEnd={endGame}
              onClose={closeGame}
            />
          ) : null}
          {game && game.type === 'reversi' && authUser?.id && game.state.players.includes(authUser.id) ? (
            <ReversiBar
              game={game}
              myId={authUser.id}
              partnerName={partnerName}
              onOpen={() => {
                Keyboard.dismiss();
                setReversiOpen(true);
              }}
              onClose={closeGame}
            />
          ) : null}
          {game && game.type === 'chinese_checkers' && authUser?.id && game.state.players.includes(authUser.id) ? (
            <CheckersBar
              game={game}
              myId={authUser.id}
              partnerName={partnerName}
              onOpen={() => {
                Keyboard.dismiss();
                setCheckersOpen(true);
              }}
              onClose={closeGame}
            />
          ) : null}
          {loading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : loadFailed && messages.length === 0 ? (
            renderLoadFailed()
          ) : (
            <FlatList
              ref={flatListRef}
              data={newestFirst}
              // Not while empty, or the empty state renders upside down
              inverted={messages.length > 0}
              keyExtractor={(item) => item.id}
              renderItem={renderMessage}
              // A tap on a bubble (open a link, retry) must land while the
              // keyboard is up, not only close it; a tap on empty space
              // still closes it
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.messagesList}
              showsVerticalScrollIndicator={false}
              maxToRenderPerBatch={12}
              windowSize={9}
              initialNumToRender={15}
              // At the bottom, a new message scrolls into view; a reader
              // further up keeps their place
              maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 80 }}
              // The far end of an inverted list is the oldest message
              onEndReached={hasMoreHistory ? loadOlderMessages : undefined}
              onEndReachedThreshold={0.5}
              ListFooterComponent={
                loadingOlder ? (
                  <ActivityIndicator size="small" color={colors.textMuted} style={styles.olderSpinner} />
                ) : null
              }
              ListEmptyComponent={
                <View style={styles.emptyChat}>
                  <Ionicons name="chatbubble-ellipses-outline" size={48} color={colors.textMuted} />
                  <Text style={styles.emptyText}>Say hello to {partnerName}!</Text>
                </View>
              }
            />
          )}

          {/* Recording bar — shown while recording audio */}
          {isRecording ? (
            <View style={styles.recordingBar}>
              <TouchableOpacity
                onPress={cancelRecording}
                style={styles.recordingCancelBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={20} color="#FF6B6B" />
              </TouchableOpacity>

              <View style={styles.recordingCenter}>
                <RecordingWaveform />
                <Animated.View
                  style={[
                    styles.recordingSlideHint,
                    {
                      transform: [{ translateX: recordSlideX }],
                      opacity: recordSlideX.interpolate({
                        inputRange: [-RECORD_CANCEL_DISTANCE, 0],
                        outputRange: [0.15, 1],
                        extrapolate: 'clamp',
                      }),
                    },
                  ]}
                >
                  <Ionicons name="chevron-back" size={12} color={colors.textMuted} />
                  <Text style={styles.recordingHint}>Slide to cancel</Text>
                </Animated.View>
              </View>

              <View style={styles.recordingIndicator}>
                <RecordingDot />
                <Text style={styles.recordingTimer}>
                  {String(Math.floor(recordingDuration / 60)).padStart(2, '0')}:
                  {String(recordingDuration % 60).padStart(2, '0')}
                </Text>
              </View>
            </View>
          ) : null}

          {/* Reply chips — only while their latest message gives something
              to answer and nothing is typed yet; a tap fills the input */}
          {!isRecording && inputText.trim().length === 0 && suggestions.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              // Exactly as tall as its chips: a ScrollView grows and shrinks
              // by default and would share the column with the message list
              style={styles.suggestionScroll}
              contentContainerStyle={styles.suggestionRow}
            >
              {suggestions.map((chip) => (
                <TouchableOpacity
                  key={chip}
                  style={styles.suggestionChip}
                  onPress={() => setInputText(chip)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                >
                  <Text style={styles.suggestionText} numberOfLines={1}>{chip}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* Vibe check row — shown when not recording and no text input */}
          {!isRecording && inputText.trim().length === 0 && (
            <View style={styles.vibeCheckRow}>
              {VIBE_OPTIONS.map((emoji, idx) => {
                const pressed = pressedVibe === idx;
                return (
                  <Animated.View key={emoji} style={pressed ? { transform: [{ scale: vibeScale }] } : undefined}>
                    <TouchableOpacity
                      style={[styles.vibeCheckBtn, pressed && styles.vibeCheckBtnPressed]}
                      onPress={() => {
                        if (sending) return;
                        popVibe(idx);
                        void sendText(emoji);
                      }}
                      activeOpacity={0.6}
                      accessibilityRole="button"
                      accessibilityLabel={`Send ${emoji}`}
                    >
                      <Text style={styles.vibeCheckEmoji}>{emoji}</Text>
                    </TouchableOpacity>
                  </Animated.View>
                );
              })}
            </View>
          )}

          {/* Replying to: the quoted message above the input, with a cross to drop it */}
          {replyTo && !isRecording ? (
            <View style={styles.replyBar}>
              <View style={styles.replyBarBody}>
                <Text style={styles.replyBarName} numberOfLines={1}>
                  Replying to {replyTo.senderId === authUser?.id ? 'yourself' : partnerName}
                </Text>
                <Text style={styles.replyBarText} numberOfLines={1}>
                  {quoteLabel({ id: replyTo.id, senderId: replyTo.senderId, content: replyTo.content, mediaType: replyTo.media?.mediaType ?? null })}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.replyBarClose}
                onPress={() => setReplyTo(null)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Cancel reply"
              >
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Input bar */}
          <View style={[styles.inputBar, { paddingBottom: inputBarPaddingBottom }]}>
            <TouchableOpacity
              style={styles.attachBtn}
              onPress={openMediaPicker}
            >
              <Ionicons name="add" size={24} color={colors.textSecondary} />
            </TouchableOpacity>

            <TextInput
              style={styles.input}
              placeholder="Message..."
              placeholderTextColor={colors.textMuted}
              value={inputText}
              onChangeText={handleInputChange}
              multiline
              maxLength={2000}
            />
            {inputText.trim().length > 0 ? (
              <TouchableOpacity
                style={styles.sendBtn}
                onPress={handleSend}
                disabled={sending}
              >
                <Ionicons name="send" size={20} color={colors.textInverse} />
              </TouchableOpacity>
            ) : (
              <View
                {...micPanResponder.panHandlers}
                style={[styles.micBtn, isRecording && styles.micBtnActive]}
                accessible
                accessibilityRole="button"
                accessibilityLabel="Hold to record a voice message, slide left to cancel"
              >
                <Ionicons
                  name="mic"
                  size={22}
                  color={isRecording ? colors.textInverse : colors.textSecondary}
                />
              </View>
            )}
          </View>
        </KeyboardAvoidingView>

      </Animated.View>

      {/* Full-Screen Photo Preview Modal */}
      <Modal
        visible={previewPhoto !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closePhotoPreview}
      >
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <View style={styles.previewOverlay}>
          <TouchableOpacity
            style={styles.previewCloseBtn}
            onPress={closePhotoPreview}
            activeOpacity={0.7}
          >
            <View style={styles.previewCloseBtnInner}>
              <Ionicons name="close" size={24} color="#fff" />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.previewImageContainer}
            activeOpacity={1}
            onPress={closePhotoPreview}
          >
            {previewPhoto && (
              <View style={styles.previewImage}>
                {/* The thumbnail holds the place until the full photo is in */}
                {previewPhoto.thumbnailUrl && previewState !== 'loaded' ? (
                  <Image
                    source={{ uri: previewPhoto.thumbnailUrl }}
                    style={StyleSheet.absoluteFill}
                    resizeMode="contain"
                  />
                ) : null}
                <Image
                  source={{ uri: previewPhoto.url }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="contain"
                  onLoad={() => setPreviewState('loaded')}
                  onError={() => setPreviewState('failed')}
                />
                {previewState === 'loading' ? (
                  <ActivityIndicator style={styles.previewSpinner} color="#fff" />
                ) : null}
              </View>
            )}
          </TouchableOpacity>

          <View style={styles.previewHint}>
            <Ionicons name="hand-left-outline" size={16} color="rgba(255,255,255,0.5)" />
            <Text style={styles.previewHintText}>Tap to close</Text>
          </View>
        </View>
      </Modal>

      {/* ─── One-Time View Media Modal ─────────────────── */}
      <Modal
        visible={viewingOnceMedia !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeOneTimeView}
      >
        {/* Black overlay with 100% opacity — no background see-through */}
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <View style={styles.onceViewOverlay}>
          {/* Close / burn button */}
          <TouchableOpacity
            style={styles.onceViewCloseBtn}
            onPress={closeOneTimeView}
            activeOpacity={0.7}
          >
            <View style={styles.onceViewCloseBtnInner}>
              <Ionicons name="close" size={24} color="#fff" />
            </View>
          </TouchableOpacity>

          {/* View-once warning banner */}
          <View style={styles.onceViewWarning}>
            <Ionicons name="eye-off-outline" size={16} color="rgba(255,255,255,0.7)" />
            <Text style={styles.onceViewWarningText}>
              This media can only be viewed once
            </Text>
          </View>

          {/* The actual media content */}
          <TouchableOpacity
            style={styles.onceViewContent}
            activeOpacity={1}
            onPress={closeOneTimeView}
          >
            {viewingOnceMedia?.mediaType === 'image' && (
              <Image
                source={{ uri: viewingOnceMedia.url }}
                style={styles.onceViewImage}
                resizeMode="contain"
              />
            )}
            {viewingOnceMedia?.mediaType === 'video' && (
              <View style={styles.onceViewVideoPlaceholder}>
                <Ionicons name="videocam" size={48} color="rgba(255,255,255,0.5)" />
                <Text style={styles.onceViewVideoText}>
                  Video will open in your default player
                </Text>
                <TouchableOpacity
                  style={styles.onceViewVideoBtn}
                  onPress={async () => {
                    const mediaUrl = viewingOnceMedia.url;
                    const token = await api.getFreshToken();
                    const separator = mediaUrl.includes('?') ? '&' : '?';
                    const videoUrl = token
                      ? `${mediaUrl}${separator}token=${encodeURIComponent(token)}`
                      : mediaUrl;
                    Linking.openURL(videoUrl).catch(() => {
                      Alert.alert('Error', 'Could not open video player.');
                    });
                    // Close the viewer immediately since we're handing off to external player
                    closeOneTimeView();
                  }}
                >
                  <Ionicons name="play" size={20} color="#fff" />
                  <Text style={styles.onceViewVideoBtnText}>Play video</Text>
                </TouchableOpacity>
              </View>
            )}
          </TouchableOpacity>

          {/* Bottom burn hint */}
          <View style={styles.onceViewFooter}>
            <Ionicons name="flame-outline" size={14} color="rgba(255,255,255,0.4)" />
            <Text style={styles.onceViewFooterText}>
              Tap anywhere or press close to burn this media
            </Text>
          </View>
        </View>
      </Modal>

      {/* Media Picker — animated overlay with 0.85 content scale-down */}
      {showMediaPicker && (
        <TouchableOpacity
          style={[styles.mediaPickerOverlay, { opacity: mediaOverlayOpacity }]}
          activeOpacity={1}
          onPress={() => closeMediaPicker()}
        >
          <Animated.View
            style={[
              styles.mediaPickerSheet,
              { paddingBottom: insets.bottom + spacing.xl },
              { transform: [{ translateY: mediaSheetY.interpolate({ inputRange: [0, 1], outputRange: [0, 300] }) }] },
            ]}
          >
            <View style={styles.mediaPickerHandle} />
            <Text style={styles.mediaPickerTitle}>Share</Text>

            <View style={styles.mediaPickerOptions}>
              <TouchableOpacity style={styles.mediaOption} onPress={() => closeMediaPicker(() => pickFromGallery())} activeOpacity={0.6}>
                <View style={styles.mediaOptionIcon}>
                  <Ionicons name="images-outline" size={24} color={colors.textPrimary} />
                </View>
                <Text style={styles.mediaOptionLabel}>Gallery</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.mediaOption} onPress={() => closeMediaPicker(() => takePhoto())} activeOpacity={0.6}>
                <View style={styles.mediaOptionIcon}>
                  <Ionicons name="camera-outline" size={24} color={colors.textPrimary} />
                </View>
                <Text style={styles.mediaOptionLabel}>Camera</Text>
              </TouchableOpacity>
            </View>

            {/* View-Once Toggle — applies to photos only */}
            <TouchableOpacity
              style={[styles.viewOnceToggle, viewOnce && styles.viewOnceToggleActive]}
              onPress={() => setViewOnce(!viewOnce)}
              activeOpacity={0.7}
            >
              <View style={styles.viewOnceToggleLeft}>
                <Ionicons
                  name={viewOnce ? 'eye-off' : 'eye-outline'}
                  size={20}
                  color={viewOnce ? colors.primary : colors.textSecondary}
                />
                <View style={styles.viewOnceToggleTextWrap}>
                  <Text style={styles.viewOnceToggleLabel}>View once</Text>
                  <Text style={styles.viewOnceToggleDesc}>
                    Photo disappears after it's opened
                  </Text>
                </View>
              </View>
              <Ionicons
                name={viewOnce ? 'checkbox' : 'square-outline'}
                size={22}
                color={viewOnce ? colors.primary : colors.textMuted}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.mediaCancelBtn}
              onPress={() => closeMediaPicker()}
            >
              <Text style={styles.mediaCancelText}>Cancel</Text>
            </TouchableOpacity>
          </Animated.View>
        </TouchableOpacity>
      )}

      {/* Unmatch Confirmation Modal */}
      {unmatchModalVisible && (
        <Animated.View style={[styles.unmatchOverlay, { opacity: unmatchOverlayOpacity }]}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => closeUnmatchModal()}
          />
          <Animated.View
            style={[styles.unmatchSheet, { transform: [{ translateY: unmatchSheetY.interpolate({ inputRange: [0, 1], outputRange: [0, SCREEN_HEIGHT] }) }] }]}
          >
            <View style={styles.unmatchIcon}>
              <Ionicons name="warning-outline" size={28} color="#E53935" />
            </View>
            <Text style={styles.unmatchTitle}>Unmatch {partnerName}?</Text>
            <Text style={styles.unmatchBody}>
              This will permanently delete all messages and media exchanged. This cannot be undone. If either of you reported the other, the chat is kept for review instead.
            </Text>

            <TouchableOpacity
              style={styles.unmatchConfirmBtn}
              onPress={confirmUnmatch}
            >
              <Text style={styles.unmatchConfirmBtnText}>Unmatch</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.unmatchCancel}
              onPress={() => closeUnmatchModal()}
            >
              <Text style={styles.unmatchCancelText}>Cancel</Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      )}

      {/* ─── Date Planner Modal ─────────────────────────── */}
      <Modal
        visible={showDatePicker}
        transparent
        animationType="none"
        onRequestClose={() => closeDatePicker()}
      >
        <Animated.View style={[styles.plannerOverlay, { opacity: plannerOverlayOpacity }]}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => closeDatePicker()}
          />
          <Animated.View style={[styles.plannerCard, { transform: [{ scale: plannerContentScale }] }]}>
            {/* Header */}
            <View style={styles.plannerHeader}>
              <View style={styles.plannerHeaderLeft}>
                <Ionicons name="calendar-outline" size={18} color={colors.textPrimary} />
                <Text style={styles.plannerTitle}>Plan Your Date</Text>
              </View>
              <TouchableOpacity
                onPress={() => closeDatePicker(() => savePlanner())}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Scrollable content: date picker + activities */}
            <ScrollView style={styles.plannerScroll} showsVerticalScrollIndicator={false} bounces={false}>

              {/* Date Picker — month calendar */}
              <View style={styles.plannerDateSection}>
                <View style={styles.calMonthHeader}>
                  <TouchableOpacity
                    onPress={() => {
                      if (calendarMonth === 0) { setCalendarMonth(11); setCalendarYear((y) => y - 1); }
                      else setCalendarMonth((m) => m - 1);
                    }}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="chevron-back" size={18} color={colors.textPrimary} />
                  </TouchableOpacity>
                  <Text style={styles.calMonthText}>{MONTH_NAMES[calendarMonth]} {calendarYear}</Text>
                  <TouchableOpacity
                    onPress={() => {
                      if (calendarMonth === 11) { setCalendarMonth(0); setCalendarYear((y) => y + 1); }
                      else setCalendarMonth((m) => m + 1);
                    }}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="chevron-forward" size={18} color={colors.textPrimary} />
                  </TouchableOpacity>
                </View>

                {/* Weekday labels */}
                <View style={styles.calWeekdays}>
                  {WEEKDAYS.map((wd, i) => (
                    <Text key={i} style={styles.calWeekdayText}>{wd}</Text>
                  ))}
                </View>

                {/* Day grid */}
                <View style={styles.calGrid}>
                  {getMonthDays(calendarYear, calendarMonth, today).map((cell, i) => {
                    const selected = plannerDate === cell.dateStr;
                    const isToday = cell.dateStr === today;
                    return (
                      <TouchableOpacity
                        key={i}
                        style={[
                          styles.calDay,
                          selected && styles.calDaySelected,
                          isToday && !selected && styles.calDayToday,
                        ]}
                        onPress={() => !cell.isPast && setPlannerDate(cell.dateStr)}
                        disabled={cell.isPast || !cell.isCurrentMonth}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.calDayText,
                            !cell.isCurrentMonth && styles.calDayOutside,
                            cell.isPast && styles.calDayPast,
                            selected && styles.calDayTextSelected,
                            isToday && !selected && styles.calDayTodayText,
                          ]}
                        >
                          {cell.day}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Selected date — centred readout, echoes the black selected day cell */}
                {plannerDate && (() => {
                  const picked = new Date(plannerDate + 'T12:00:00');
                  return (
                    <View style={styles.calSelectedWrap}>
                      <View style={styles.calSelectedCard}>
                        <Text style={styles.calSelectedWeekday}>
                          {picked.toLocaleDateString(undefined, { weekday: 'long' }).toUpperCase()}
                        </Text>
                        <Text style={styles.calSelectedDay}>{picked.getDate()}</Text>
                        <Text style={styles.calSelectedMonth}>
                          {picked.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                        </Text>
                      </View>
                    </View>
                  );
                })()}
              </View>

              {/* Activities */}
              <View style={styles.plannerContent}>
                  <View style={styles.plannerRowHeader}>
                    <Text style={styles.plannerSectionLabel}>What to do</Text>
                    {plannerActivities.length > 0 && (
                      <Text style={styles.plannerRowCount}>{plannerActivities.length} picked</Text>
                    )}
                  </View>

                  {ACTIVITY_GROUPS.map((group) => (
                    <View key={group.title} style={styles.activityGroup}>
                      <Text style={styles.activityGroupTitle}>{group.title}</Text>
                      <View style={styles.activitiesGrid}>
                        {group.items.map((activity) => {
                          const selected = plannerActivities.includes(activity.id);
                          return (
                            <TouchableOpacity
                              key={activity.id}
                              style={[styles.activityCard, selected && styles.activityCardActive]}
                              onPress={() => {
                                setPlannerActivities((prev) =>
                                  selected
                                    ? prev.filter((a) => a !== activity.id)
                                    : [...prev, activity.id]
                                );
                              }}
                              activeOpacity={0.7}
                            >
                              <Ionicons
                                name={activity.icon}
                                size={20}
                                color={selected ? colors.textInverse : colors.textSecondary}
                              />
                              <Text style={[styles.activityLabel, selected && styles.activityLabelActive]}>
                                {activity.label}
                              </Text>
                              {selected && (
                                <Ionicons name="checkmark" size={12} color={colors.textInverse} style={styles.activityCheck} />
                              )}
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  ))}

                  {/* Notes — up to MAX_NOTES short entries */}
                  <View style={[styles.plannerRowHeader, { marginTop: spacing.md }]}>
                    <Text style={styles.plannerSectionLabel}>Notes</Text>
                    <Text style={styles.plannerRowCount}>
                      {plannerNotes.length}/{MAX_NOTES}
                    </Text>
                  </View>

                  {plannerNotes.length > 0 && (
                    <View style={styles.noteList}>
                      {plannerNotes.map((note, i) => (
                        <View key={`${i}-${note}`} style={styles.noteItem}>
                          <Text style={styles.noteText}>{note}</Text>
                          <TouchableOpacity
                            onPress={() =>
                              setPlannerNotes((prev) => prev.filter((_, j) => j !== i))
                            }
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Ionicons name="close" size={14} color={colors.textMuted} />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}

                  {plannerNotes.length < MAX_NOTES ? (
                    <>
                      <View style={styles.noteAddRow}>
                        <TextInput
                          style={styles.noteAddInput}
                          placeholder="Time, meeting point, what to bring..."
                          placeholderTextColor={colors.textMuted}
                          value={newNoteText}
                          onChangeText={setNewNoteText}
                          maxLength={MAX_NOTE_LEN}
                          multiline
                          returnKeyType="done"
                          blurOnSubmit
                          onSubmitEditing={addPlannerNote}
                        />
                        <TouchableOpacity
                          style={[
                            styles.noteAddBtn,
                            !newNoteText.trim() && styles.noteAddBtnDisabled,
                          ]}
                          onPress={addPlannerNote}
                          disabled={!newNoteText.trim()}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="add" size={18} color={colors.textInverse} />
                        </TouchableOpacity>
                      </View>
                      {newNoteText.length > 0 && (
                        <Text style={styles.noteCharCount}>
                          {newNoteText.length}/{MAX_NOTE_LEN}
                        </Text>
                      )}
                    </>
                  ) : (
                    <Text style={styles.noteCharCount}>
                      That is all {MAX_NOTES} notes. Remove one to add another.
                    </Text>
                  )}
              </View>

            </ScrollView>

            {/* Confirm Button */}
            <TouchableOpacity
              style={[styles.dateConfirmBtn, savingPlanner && styles.dateConfirmBtnDisabled]}
              onPress={() => closeDatePicker(() => {
                savePlanner();
                if (plannerDate && plannerDate !== scheduledDate) {
                  handleFixDate();
                }
              })}
              disabled={savingPlanner}
              activeOpacity={0.7}
            >
              {savingPlanner && (
                <ActivityIndicator size="small" color={colors.textMuted} />
              )}
              <Text style={[styles.dateConfirmText, savingPlanner && styles.dateConfirmTextDisabled]}>
                Save Plan
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      </Modal>

      {/* Which of a message's links to open */}
      <LinkChooser
        visible={linkChoices !== null}
        links={linkChoices ?? []}
        onPick={(url) => {
          setLinkChoices(null);
          openLinkOrSay(url);
        }}
        onClose={() => setLinkChoices(null)}
      />

      {/* Reversi, full screen over the chat */}
      {game && game.type === 'reversi' && authUser?.id && game.state.players.includes(authUser.id) ? (
        <ReversiScreen
          visible={reversiOpen}
          game={game}
          myId={authUser.id}
          partnerName={partnerName}
          pending={pendingSquare}
          onMove={playReversiMove}
          onEnd={endGame}
          onClose={closeGame}
          onMinimize={() => {
            Keyboard.dismiss();
            setReversiOpen(false);
          }}
          recent={recentChatLines}
          onSend={(text) => {
            if (sending) return false;
            void sendText(text);
            return true;
          }}
        />
      ) : null}

      {/* Chinese Checkers, full screen over the chat */}
      {game && game.type === 'chinese_checkers' && authUser?.id && game.state.players.includes(authUser.id) ? (
        <CheckersScreen
          visible={checkersOpen}
          game={game}
          myId={authUser.id}
          partnerName={partnerName}
          pending={pendingHop}
          onMove={playCheckersMove}
          onEnd={endGame}
          onClose={closeGame}
          onMinimize={() => {
            Keyboard.dismiss();
            setCheckersOpen(false);
          }}
          recent={recentChatLines}
          onSend={(text) => {
            if (sending) return false;
            void sendText(text);
            return true;
          }}
        />
      ) : null}

      {/* Games to start, from the gamepad in the header */}
      <GamePickerSheet
        visible={gamePickerVisible}
        onClose={() => setGamePickerVisible(false)}
        onStartDots={startDotsGame}
        onStartReversi={startReversiGame}
        onStartCheckers={startCheckersGame}
      />

      {/* Report / block — last, so it covers the whole screen */}
      {partnerId ? (
        <ReportBlockSheet
          visible={safetyVisible}
          userId={partnerId}
          name={partnerName}
          matchId={matchId}
          onClose={() => setSafetyVisible(false)}
          onBlocked={leaveChat}
        />
      ) : null}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  loadFailedTitle: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.md, textAlign: 'center' },
  loadFailedText: { ...typography.body2, color: colors.textMuted, marginTop: spacing.xs, textAlign: 'center' },
  loadFailedBtn: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: 9999,
    backgroundColor: colors.primary,
  },
  loadFailedBtnText: { ...typography.button, color: colors.textInverse },
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceHighlight,
  },
  backBtn: { marginRight: spacing.sm },
  headerPartner: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  headerAvatar: { width: 40, height: 40, borderRadius: 20, marginRight: spacing.sm },
  noHeaderAvatar: { backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' },
  headerInfo: { flex: 1 },
  headerName: { ...typography.body1, color: colors.textPrimary, fontWeight: '600' },
  headerStatus: { ...typography.caption, color: colors.textMuted, fontSize: 11 },
  callBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  unmatchBtn: {
    backgroundColor: 'rgba(229, 57, 53, 0.12)',
  },
  chatArea: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  // Inverted list: paddingTop is the gap above the input bar, paddingBottom the top of the chat
  messagesList: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg },
  olderSpinner: { paddingVertical: spacing.md },
  messageRow: {
    width: '100%',
    marginBottom: spacing.sm,
    justifyContent: 'center',
  },
  messageRowInner: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
  },
  messageRowMine: { justifyContent: 'flex-end' },
  // The reply arrow a swipe to the right uncovers at the left of the row
  replyCue: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  replyCueDisc: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The quoted message at the top of a reply bubble
  quote: {
    borderLeftWidth: 3,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    marginBottom: 6,
  },
  quoteTheirs: { borderLeftColor: colors.textPrimary, backgroundColor: 'rgba(0,0,0,0.06)' },
  quoteMine: { borderLeftColor: colors.textInverse, backgroundColor: 'rgba(255,255,255,0.16)' },
  quoteName: { ...typography.caption, fontWeight: '700', color: colors.textPrimary },
  quoteText: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
  quoteTextMine: { color: 'rgba(255,255,255,0.85)' },
  // "Replying to" above the input bar
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.textPrimary,
  },
  replyBarBody: { flex: 1 },
  replyBarName: { ...typography.caption, fontWeight: '700', color: colors.textPrimary },
  replyBarText: { ...typography.body2, color: colors.textSecondary, marginTop: 1 },
  replyBarClose: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  messageAvatar: { width: 28, height: 28, borderRadius: 14, marginBottom: 4, flexShrink: 0 },
  noMsgAvatar: { backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' },
  messageBubble: {
    maxWidth: '75%',
    flexShrink: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
  },
  myBubble: {
    marginLeft: 'auto',
    backgroundColor: colors.primary,
    borderBottomRightRadius: radius.sm,
  },
  theirBubble: {
    marginRight: 'auto',
    backgroundColor: colors.surfaceHighlight,
    borderBottomLeftRadius: radius.sm,
  },
  // While a bubble that answers a tap is held down
  bubblePressed: { opacity: 0.7 },
  messageText: { ...typography.body2, color: colors.textPrimary, flexShrink: 1 },
  myMessageText: { color: colors.textInverse },
  notSentText: { ...typography.caption, color: 'rgba(255,255,255,0.85)' },
  messageMeta: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 2,
    gap: 2,
    minHeight: 16,
  },
  // Media styles
  mediaImageWrap: {
    position: 'relative',
    marginVertical: 2,
  },
  mediaImage: {
    width: 200,
    height: 200,
    borderRadius: radius.md,
    marginVertical: 2,
  },
  // A photo not (yet) on this phone: its blurred preview, with a spinner or a note
  photoPlaceholder: {
    overflow: 'hidden',
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoMissing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  photoMissingText: { ...typography.caption, color: '#fff', fontWeight: '600' },
  mediaFileContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  mediaFileText: { ...typography.body2, color: colors.textPrimary, flexShrink: 1 },
  // Audio player styles
  audioPlayer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    minWidth: 140,
  },
  audioWaveform: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flex: 1,
    height: 24,
  },
  audioWaveBar: {
    width: 3,
    height: 14,
    borderRadius: 1.5,
  },
  audioWaveBarTall: {
    height: 22,
  },
  audioDuration: { ...typography.caption, color: colors.textMuted, fontSize: 11 },
  // Recording bar styles
  recordingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceHighlight,
    borderTopWidth: 1,
    borderTopColor: colors.primary,
    gap: spacing.md,
  },
  recordingCenter: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  // Clips the double-width trace so only one tile is ever on screen.
  waveform: {
    alignSelf: 'stretch',
    height: WAVEFORM_HEIGHT,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF3B30',
  },
  recordingTimer: {
    ...typography.h3,
    color: '#FF3B30',
    fontSize: 15,
    // Tabular-ish minimum so the row does not jitter as digits change
    minWidth: 42,
    textAlign: 'right',
  },
  recordingHint: { ...typography.caption, color: colors.textMuted },
  // Follows the finger left while the mic is held
  recordingSlideHint: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  recordingCancelBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Empty state
  emptyChat: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: { ...typography.body1, color: colors.textMuted, marginTop: spacing.md },
  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceHighlight,
    gap: spacing.sm,
  },
  attachBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceHighlight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body2,
    color: colors.textPrimary,
    maxHeight: 100,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  micBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceHighlight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  micBtnActive: {
    backgroundColor: '#FF3B30',
    transform: [{ scale: 1.1 }],
  },
  // Video thumbnail in message bubble
  videoThumbContainer: {
    width: 180,
    height: 120,
    borderRadius: radius.md,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
    marginVertical: 2,
  },
  videoThumbMine: {
    backgroundColor: '#2a2a3e',
  },
  videoPlayBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoThumbText: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.7)',
    fontSize: 10,
  },
  // Full-screen photo preview
  previewOverlay: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewCloseBtn: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 40,
    right: spacing.md,
    zIndex: 10,
  },
  previewCloseBtnInner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewImageContainer: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
  previewSpinner: {
    position: 'absolute',
    alignSelf: 'center',
    top: SCREEN_HEIGHT / 2 - 12,
  },
  previewHint: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 44 : 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    opacity: 0.6,
  },
  previewHintText: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.5)',
  },
  // ─── View-Once Media Styles ──────────────────────────
  // Overlay badge on sender's view-once image
  viewOnceOverlay: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  viewOnceOverlayText: {
    ...typography.caption,
    color: '#fff',
    fontSize: 10,
  },
  // "View once" card for received view-once media
  viewOnceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    marginVertical: 2,
  },
  viewOnceCardLabel: {
    ...typography.body2,
    color: colors.textPrimary,
    fontWeight: '600',
    fontSize: 13,
  },
  // "Viewed" / "Opened" state after one-time media is consumed
  viewOnceViewed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 3,
    paddingHorizontal: 2,
  },
  viewOnceViewedText: {
    ...typography.caption,
    color: colors.textMuted,
    fontStyle: 'italic',
    fontSize: 12,
    // The italic slant pushes the ascender of the last letter past the
    // measured text width, so it clips without a trailing pad
    paddingRight: 6,
  },
  viewOnceViewedMine: {
    paddingVertical: 0,
    paddingHorizontal: 8,
  },
  viewOnceViewedTextMine: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    // No lineHeight/includeFontPadding here — cropping the line box clips the
    // ascender of the italic d. Height comes from the row padding instead.
    lineHeight: 15,
  },
  // One-Time Viewer Modal
  onceViewOverlay: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  onceViewCloseBtn: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 40,
    right: spacing.md,
    zIndex: 10,
  },
  onceViewCloseBtnInner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  onceViewWarning: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 110 : 90,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    opacity: 0.7,
  },
  onceViewWarningText: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
  },
  onceViewContent: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  onceViewImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
  onceViewVideoPlaceholder: {
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.xxl,
  },
  onceViewVideoText: {
    ...typography.body2,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
  },
  onceViewVideoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
  },
  onceViewVideoBtnText: {
    ...typography.button,
    color: '#fff',
  },
  onceViewFooter: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 44 : 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    opacity: 0.4,
  },
  onceViewFooterText: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
  },
  // Media picker modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  mediaPickerOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 100,
  },
  mediaPickerSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
  },
  mediaPickerHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textMuted,
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  mediaPickerTitle: { ...typography.h3, color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.lg },
  // View-once toggle in picker
  viewOnceToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginBottom: spacing.lg,
  },
  viewOnceToggleActive: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceLight,
  },
  viewOnceToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  viewOnceToggleTextWrap: {
    gap: 1,
  },
  viewOnceToggleLabel: {
    ...typography.body2,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  viewOnceToggleDesc: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
  },
  mediaPickerOptions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  // Monotone tiles — outline icons on neutral surfaces, no color fills
  mediaOption: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
  },
  mediaOptionIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surfaceHighlight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediaOptionLabel: { ...typography.body2, color: colors.textPrimary, fontWeight: '500' },
  mediaCancelBtn: {
    paddingVertical: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
  },
  mediaCancelText: { ...typography.button, color: colors.textPrimary },
  // ─── Unmatch Confirmation Modal ─────────────────────────
  unmatchOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
    paddingBottom: spacing.xxl,
  },
  unmatchSheet: {
    marginHorizontal: spacing.lg,
    backgroundColor: colors.background,
    borderRadius: radius.xl,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
  },
  unmatchIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(229, 57, 53, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  unmatchTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  unmatchBody: {
    ...typography.body2,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.sm,
  },
  unmatchConfirmBtn: {
    width: '100%',
    paddingVertical: spacing.md + 2,
    backgroundColor: '#E53935',
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  unmatchConfirmBtnText: {
    ...typography.button,
    color: colors.textInverse,
  },
  unmatchCancel: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  unmatchCancelText: {
    ...typography.body1,
    color: colors.textMuted,
    fontWeight: '500',
  },

  // ─── Fix-a-Date banner + picker ──────────────────────
  dateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: '#FFF1F1',
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceHighlight,
  },
  dateBannerText: {
    ...typography.body2,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  datePickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
  },
  datePickerCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    padding: spacing.xl,
  },
  datePickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  datePickerTitle: { ...typography.h3, color: colors.textPrimary },
  // ─── Month Calendar ────────────────────────────────────
  calMonthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  calMonthText: {
    ...typography.h4,
    color: colors.textPrimary,
  },
  calWeekdays: {
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  calWeekdayText: {
    flex: 1,
    textAlign: 'center',
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
  },
  calGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calDay: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  calDaySelected: {
    backgroundColor: colors.textPrimary,
  },
  calDayToday: {
    backgroundColor: colors.surfaceHighlight,
  },
  calDayText: {
    ...typography.body2,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  calDayOutside: {
    color: colors.textMuted,
    opacity: 0.3,
  },
  calDayPast: {
    color: colors.textMuted,
    opacity: 0.35,
  },
  calDayTextSelected: {
    color: colors.textInverse,
    fontWeight: '700',
  },
  calDayTodayText: {
    fontWeight: '700',
  },
  calSelectedWrap: {
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  calSelectedCard: {
    backgroundColor: colors.textPrimary,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.huge,
    alignItems: 'center',
  },
  calSelectedWeekday: {
    ...typography.label,
    color: colors.textInverse,
    opacity: 0.55,
    letterSpacing: 2.5,
  },
  calSelectedDay: {
    fontFamily: typography.h1.fontFamily,
    fontSize: 46,
    lineHeight: 52,
    fontWeight: '700',
    color: colors.textInverse,
    letterSpacing: -1.5,
    marginVertical: 2,
  },
  calSelectedMonth: {
    ...typography.body2,
    color: colors.textInverse,
    opacity: 0.7,
  },
  dateConfirmBtn: {
    backgroundColor: colors.textPrimary,
    borderRadius: radius.full,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  dateConfirmBtnDisabled: { backgroundColor: colors.surfaceHighlight },
  dateConfirmText: { ...typography.button, color: colors.textInverse },
  dateConfirmTextDisabled: { color: colors.textMuted },

  // ─── Date Planner Modal ─────────────────────────────
  plannerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  plannerCard: {
    height: '88%',
    backgroundColor: colors.background,
    borderRadius: radius.xl,
    marginHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  plannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  plannerHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  plannerTitle: { ...typography.h3, color: colors.textPrimary },
  plannerDateSection: {
    marginBottom: spacing.md,
  },
  plannerSectionLabel: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  plannerScroll: {
    flex: 1,
  },
  plannerContent: {},
  plannerRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  plannerRowCount: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  activityGroup: {
    marginBottom: spacing.lg,
  },
  activityGroupTitle: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  activitiesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  activityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHighlight,
    minWidth: '30%',
  },
  activityCardActive: {
    backgroundColor: colors.textPrimary,
  },
  activityLabel: {
    ...typography.body2,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  activityLabelActive: {
    color: colors.textInverse,
  },
  activityCheck: {
    marginLeft: 'auto',
  },
  noteList: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  noteItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  noteText: {
    ...typography.body2,
    color: colors.textPrimary,
    flex: 1,
  },
  noteAddRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  noteAddInput: {
    flex: 1,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body2,
    color: colors.textPrimary,
    minHeight: 40,
    maxHeight: 96,
    textAlignVertical: 'top',
  },
  noteAddBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.textPrimary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noteAddBtnDisabled: { opacity: 0.4 },
  noteCharCount: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'right',
    marginTop: spacing.xs,
  },
  // ─── Icebreaker Bar ──────────────────────────────────
  // The chip row keeps the height of its chips and nothing else. A
  // ScrollView has flexGrow and flexShrink of 1 by default and so split the
  // chat column with the message list: in a long chat the row was squeezed
  // to a sliver and the text spilled over the outline, in a short one it
  // ballooned.
  suggestionScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  // Outlined in black on white, like the outline button: the light grey
  // fill with a hairline border all but vanished against the page and the
  // vibe row beneath it. A fixed height, the 36 of the vibe circles below,
  // with the text centred in it: an emoji or a Bengali or Devanagari word
  // stands taller than the Latin line box and still keeps clear of the
  // outline.
  suggestionChip: {
    height: 36,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.textPrimary,
  },
  suggestionText: {
    ...typography.body2,
    fontWeight: '600',
    color: colors.textPrimary,
  },

  // ─── Vibe Check Row ──────────────────────────────────
  // Seven 36 circles with 12 between them and 12 either side: 348, inside a
  // 360-wide phone.
  vibeCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  vibeCheckBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  vibeCheckBtnPressed: {
    borderColor: ROSE,
  },
  // Centred in the circle without the font's extra top padding, which
  // would push the emoji below the middle on Android
  vibeCheckEmoji: {
    fontSize: 18,
    lineHeight: 22,
    textAlign: 'center',
    includeFontPadding: false,
  },
});

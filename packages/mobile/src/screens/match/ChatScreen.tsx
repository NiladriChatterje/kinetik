import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  Image, KeyboardAvoidingView, Platform, Keyboard, ActivityIndicator,
  Modal, Alert, Dimensions, Linking,
  StatusBar, Animated, ScrollView, Easing,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useAudioRecorder, createAudioPlayer, AudioPlayer, setAudioModeAsync, requestRecordingPermissionsAsync, RecordingPresets } from 'expo-audio';
import { usePreventScreenCapture } from 'expo-screen-capture';

import * as FileSystem from 'expo-file-system/legacy';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Socket } from 'socket.io-client';
import { api } from '../../services/api';
import { compressPhoto } from '../../services/photoService';
import { getChatSocket } from '../../services/chatSocket';
import { useAuthStore } from '../../store/authStore';
import { useToast } from '../../hooks/useToast';
import { DmSuggestionChips } from '../../components/chat/DmSuggestionChips';
import { ReplyAssistantOffer } from '../../components/chat/ReplyAssistantOffer';
import { LockedChatView } from '../../components/chat/LockedChatView';
import { resolveUrl } from '../../config';
import { colors, typography, spacing, radius } from '../../theme';

interface ChatMedia {
  id: string;
  messageId: string;
  senderId: string;
  mediaType: 'image' | 'video' | 'audio' | 'file';
  url: string;
  thumbnailUrl?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  width?: number;
  height?: number;
  durationSecs?: number;
  isViewOnce?: boolean;
  viewedAt?: string;
}

interface Message {
  id: string;
  matchId: string;
  senderId: string;
  content: string;
  createdAt: string;
  readAt: string | null;
  media?: ChatMedia;
}

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
const TODAY = new Date();
const TODAY_STR = toDateStr(TODAY);

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function getMonthDays(year: number, month: number): { date: Date; dateStr: string; day: number; isCurrentMonth: boolean; isPast: boolean }[] {
  const firstDay = new Date(year, month, 1);
  const startDow = firstDay.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const cells: { date: Date; dateStr: string; day: number; isCurrentMonth: boolean; isPast: boolean }[] = [];

  // Previous month fill
  for (let i = startDow - 1; i >= 0; i--) {
    const d = new Date(year, month - 1, prevMonthDays - i);
    cells.push({ date: d, dateStr: toDateStr(d), day: prevMonthDays - i, isCurrentMonth: false, isPast: d < new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate()) });
  }

  // Current month
  for (let i = 1; i <= daysInMonth; i++) {
    const d = new Date(year, month, i);
    cells.push({ date: d, dateStr: toDateStr(d), day: i, isCurrentMonth: true, isPast: d < new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate()) });
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

// ─── Icebreaker Prompts ─────────────────────────────────
const ICEBREAKERS = [
  'What is the last show you binge-watched?',
  'If you could travel anywhere tomorrow, where would you go?',
  'What is your go-to comfort food?',
  'Morning person or night owl?',
  'What is the best compliment you have ever received?',
  'If you could have any superpower, what would it be?',
  'What is your most played song right now?',
  'Do you have a hidden talent?',
  'What is the worst first date you have heard of?',
  'Coffee or tea, and how do you take it?',
  'What is a movie you can watch over and over?',
  'What would your dream vacation look like?',
];

// ─── Vibe Check Options ─────────────────────────────────
const VIBE_OPTIONS = [
  { icon: 'heart-outline' as const, sentAs: 'Loved' },
  { icon: 'thumbs-up-outline' as const, sentAs: 'Approved' },
  { icon: 'star-outline' as const, sentAs: 'Excited' },
  { icon: 'flame-outline' as const, sentAs: 'On fire' },
  { icon: 'musical-notes-outline' as const, sentAs: 'Vibing' },
  { icon: 'sparkles-outline' as const, sentAs: 'Magical' },
];

/**
 * Minimum clearance between the input bar and the bottom of the screen,
 * counting whatever the device's safe-area inset already provides. Keeps the
 * bar off the edge on phones that report no bottom inset without adding a
 * second gap on phones that do.
 */
const MIN_INPUT_BOTTOM_GAP = spacing.md;

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

export const ChatScreen: React.FC<{ navigation: any; route: any }> = ({ navigation, route }) => {
  const {
    matchId,
    partnerName: pName,
    partnerPhotoUrl: pPhoto,
    partnerThumbnailUrl: pThumb,
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
  // The list scrolls to the end whenever its content changes (new message,
  // first load). While an older page is being prepended that must not
  // happen, or the view would jump away from what the user is reading.
  const suppressAutoScrollRef = useRef(false);
  // Until the first load has scrolled to the end, the list sits at offset 0
  // and must not be mistaken for the user scrolling up.
  const initialScrollDoneRef = useRef(false);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  // Whether this chat is locked (free account: chat is Premium only).
  // null = not known yet. The chat interface is never rendered while it is
  // unknown: a free account must not glimpse it before the lock arrives.
  // The chat list already knows and passes it in, so a locked chat opened
  // from there shows the lock immediately; otherwise the first history
  // response decides.
  const [locked, setLocked] = useState<boolean | null>(lockedParam === true ? true : null);
  const [sending, setSending] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);
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
  const [plannerDate, setPlannerDate] = useState<string | null>(null); // YYYY-MM-DD
  const [calendarMonth, setCalendarMonth] = useState(() => TODAY.getMonth());
  const [calendarYear, setCalendarYear] = useState(() => TODAY.getFullYear());
  const [plannerActivities, setPlannerActivities] = useState<string[]>([]);
  const [plannerNotes, setPlannerNotes] = useState<string[]>([]);
  const [newNoteText, setNewNoteText] = useState('');
  const [savingPlanner, setSavingPlanner] = useState(false);

  // ─── Icebreaker State ──────────────────────────────────
  const [icebreakerIndex, setIcebreakerIndex] = useState(() => Math.floor(Math.random() * ICEBREAKERS.length));

  // ─── Vibe Check State ──────────────────────────────────
  const [showVibeCheck, setShowVibeCheck] = useState(false);

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
        navigation.goBack();
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

  const partnerName = pName || 'Stranger';

  // ─── Load the pinned scheduled date (if any) ────────────
  // Fetched on mount and on every socket (re)connect so a date fixed by the
  // partner shows up even if this DM was opened before they set it.
  const syncScheduledDate = useCallback(async () => {
    try {
      const res = await api.getMatchDetail(matchId);
      if (res.success && res.data?.dateScheduled) {
        setScheduledDate(res.data.dateScheduled);
      }
    } catch {
      // Silent — retried on the next (re)connect
    }
  }, [matchId]);

  // ─── Load the date planner data ─────────────────────────
  const syncPlanner = useCallback(async () => {
    try {
      const res = await api.getMatchPlanner(matchId);
      if (res.success && res.data?.plannerData) {
        const pd = res.data.plannerData;
        setPlannerDate(pd.date || null);
        setPlannerActivities(pd.activities || []);
        setPlannerNotes(normalizeNotes(pd.notes));
      }
    } catch {
      // Silent
    }
  }, [matchId]);

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
  const syncMessages = useCallback(async () => {
    try {
      const res = await api.getMessages(matchId);
      if (!res.success && res.error?.code === 'CHAT_LOCKED') {
        setLocked(true);
        return;
      }
      if (!res.success || !res.data) return;
      setLocked(false);
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
    } catch {
      // Silent — retried on the next (re)connect
    }
  }, [matchId]);

  /** The page of messages before the oldest one on screen, prepended. */
  const loadOlderMessages = useCallback(async () => {
    if (loadingOlderRef.current || !hasMoreHistoryRef.current) return;
    const oldest = messagesRef.current.find((m) => !m.id.startsWith('temp-') && m.matchId === matchId);
    if (!oldest) return;
    loadingOlderRef.current = true;
    suppressAutoScrollRef.current = true;
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
    };

    // Incoming message — from partner OR our own broadcast.
    // Scoped to THIS match: the shared socket receives every joined room, so
    // the guard keeps other conversations' events out of this DM.
    const onChatMessage = (data: any) => {
      if (data?.matchId !== matchId) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === data.id)) return prev;

        // Our own message — replace temp message
        if (data.senderId === authUser?.id) {
          const idx = prev.findIndex((m) => m.id.startsWith('temp-'));
          if (idx !== -1) {
            const updated = [...prev];
            updated[idx] = {
              ...updated[idx],
              id: data.id,
              content: data.content,
              createdAt: data.createdAt || updated[idx].createdAt,
              media: data.media || updated[idx].media,
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
      setScheduledDate(data.dateScheduled || null);
    };

    // Planner data updated by the partner -- sync live
    const onPlannerUpdate = (data: any) => {
      if (data?.matchId !== matchId) return;
      if (data.plannerData) {
        setPlannerDate(data.plannerData.date || null);
        setPlannerActivities(data.plannerData.activities || []);
        setPlannerNotes(normalizeNotes(data.plannerData.notes));
      }
    };

    // Partner unmatched — pop back to the chat list
    const onMatchUnmatched = (data: any) => {
      if (data?.matchId !== matchId) return;
      navigation.goBack();
    };

    socket.on('connect', onConnect);
    socket.on('chat:message', onChatMessage);
    socket.on('chat:read', onChatRead);
    socket.on('chat:typing', onChatTyping);
    socket.on('media:viewed', onMediaViewed);
    socket.on('date:set', onDateSet);
    socket.on('planner:update', onPlannerUpdate);
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
      socket.off('match:unmatched', onMatchUnmatched);
      socket.off('disconnect', onDisconnect);
      socketRef.current = null;
    };
  }, [matchId, syncMessages, syncScheduledDate, syncPlanner]);

  // ─── Signal to ChatListScreen that this DM is open ──
  // So the chat list doesn't inflate the unread badge for messages
  // the user is actively viewing.
  useEffect(() => {
    useAuthStore.getState().setOpenChatMatchId(matchId);
    return () => useAuthStore.getState().setOpenChatMatchId(null);
  }, [matchId]);

  // ─── Fetch message history ─────────────────────────
  useEffect(() => {
    (async () => {
      setLoading(true);
      await syncMessages();
      setLoading(false);
    })();
  }, [syncMessages]);

  // ─── Fetch the pinned scheduled date on mount ───────
  useEffect(() => {
    syncScheduledDate();
  }, [syncScheduledDate]);

  // ─── Fetch planner data on mount ─────────────────────
  useEffect(() => {
    syncPlanner();
  }, [syncPlanner]);

  // ─── Scroll to bottom on new messages ──────────────
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

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
  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || sending) return;

    setInputText('');
    setSending(true);

    const tempId = `temp-${Date.now()}`;
    setMessages((prev) => [...prev, {
      id: tempId,
      matchId,
      senderId: authUser?.id || '',
      content: text,
      createdAt: new Date().toISOString(),
      readAt: null,
    }]);

    if (socketRef.current?.connected) {
      socketRef.current.emit('chat:message', { matchId, content: text });
    }

    try {
      const res = await api.sendMessage(matchId, text);
      if (res.success && res.data) {
        // If the real id already arrived (socket echo / reconnect sync), drop the temp
        setMessages((prev) => prev.some((m) => m.id === res.data!.id)
          ? prev.filter((m) => m.id !== tempId)
          : prev.map((m) => (m.id === tempId ? { ...m, id: res.data!.id } : m)));
      }
    } catch {
      // Keep the message
    } finally {
      setSending(false);
    }
  };

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

    // Optimistically add a temp message
    setMessages((prev) => [...prev, {
      id: tempId,
      matchId,
      senderId: authUser?.id || '',
      content: previewText,
      createdAt: new Date().toISOString(),
      readAt: null,
    }]);

    try {
      // Compress images client-side (resize to 1200px + WebP) — same pipeline
      // as profile photos. Full-resolution camera photos previously uploaded
      // as-is, tripping the gateway's 10MB body limit / 60s timeout (502).
      let uploadUri = uri;
      if (mediaType === 'image') {
        try {
          uploadUri = (await compressPhoto(uri)).uri;
        } catch (err) {
          console.warn('[ChatMedia] Compression failed — sending original:', err);
        }
      }

      const res = await api.sendMediaMessage(matchId, uploadUri, mediaType, undefined, applyViewOnce, durationSecs);
      if (res.success && res.data) {
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
      // Remove failed temp message and show error
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      Alert.alert('Send Failed', err.message || 'Could not send media. Please try again.');
    } finally {
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
      const token = api.getToken();
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
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
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

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      await sendMedia(result.assets[0].uri, 'image');
    }
  };

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        // Determine media type from mime type
        let mediaType = 'file';
        if (asset.mimeType?.startsWith('image/')) mediaType = 'image';
        else if (asset.mimeType?.startsWith('video/')) mediaType = 'video';
        else if (asset.mimeType?.startsWith('audio/')) mediaType = 'audio';

        await sendMedia(asset.uri, mediaType);
      }
    } catch {
      Alert.alert('Error', 'Could not pick document.');
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

  // ─── Render media content for a message ────────────
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
          onPress={() => openOneTimeView(media)}
          activeOpacity={0.85}
          style={styles.viewOnceCard}
        >
          <Ionicons name="eye-outline" size={16} color={colors.textPrimary} />
          <Text style={styles.viewOnceCardLabel}>Tap to open</Text>
        </TouchableOpacity>
      );
    }

    // Regular media content (including sender's own view-once)
    if (media.mediaType === 'image') {
      return (
        <TouchableOpacity
          onPress={() => {
            // Sender can preview their own view-once images normally
            setPreviewPhotoUrl(resolveUrl(media.thumbnailUrl || media.url));
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
          onPress={() => {
            // For view-once video on receiver side, this shouldn't be reached
            // as we show the viewOnceCta above instead
            const baseUrl = resolveUrl(media.url);
            const token = api.getToken();
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
          onPress={() => togglePlayAudio(item.id, media.url)}
          activeOpacity={0.7}
          style={styles.audioPlayer}
        >
          <Ionicons
            name={playingAudioId === item.id ? 'pause-circle' : 'play-circle'}
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

  // ─── Render message ────────────────────────────────
  const renderMessage = ({ item }: { item: Message }) => {
    const isMine = item.senderId === authUser?.id;
    const showAvatar = !isMine;
    const isTemp = item.id.startsWith('temp-');
    const isRead = !!item.readAt;
    const hasMedia = !!item.media;

    const metaIconColor = isMine ? 'rgba(255,255,255,0.65)' : colors.textMuted;
    const readIconColor = isMine ? colors.textInverse : colors.success;

    const displayContent = item.content;

    return (
      <View style={[styles.messageRow, isMine && styles.messageRowMine]}>
        {showAvatar && pAvatar ? (
          <Image source={{ uri: resolveUrl(pAvatar) }} style={styles.messageAvatar} resizeMethod="resize" />
        ) : showAvatar ? (
          <View style={[styles.messageAvatar, styles.noMsgAvatar]}>
            <Ionicons name="person-outline" size={16} color={colors.textMuted} />
          </View>
        ) : null}

        <View style={[styles.messageBubble, isMine ? styles.myBubble : styles.theirBubble]}>
          {/* Media attachment */}
          {hasMedia && renderMediaContent(item, isMine)}

          {/* Text content (caption or description) — hidden for view-once media */}
          {hasMedia && item.media?.isViewOnce && item.media?.viewedAt ? null : hasMedia ? null : (
            <Text style={[styles.messageText, isMine && styles.myMessageText]}>
              {displayContent}
            </Text>
          )}

          {/* Read receipt */}
          {isMine && (
            <View style={styles.messageMeta}>
              {isTemp ? (
                <Ionicons name="time-outline" size={12} color={metaIconColor} />
              ) : isRead ? (
                <Ionicons name="checkmark-done" size={14} color={readIconColor} />
              ) : (
                <Ionicons name="checkmark" size={14} color={metaIconColor} />
              )}
            </View>
          )}
        </View>
      </View>
    );
  };

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
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (locked) {
    return (
      <LockedChatView
        partnerName={partnerName}
        onBack={() => navigation.goBack()}
        onUpgrade={() => navigation.navigate('SubscriptionCheckout')}
      />
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

          {pAvatar ? (
            <Image source={{ uri: resolveUrl(pAvatar) }} style={styles.headerAvatar} resizeMethod="resize" />
          ) : (
            <View style={[styles.headerAvatar, styles.noHeaderAvatar]}>
              <Ionicons name="person-outline" size={20} color={colors.textMuted} />
            </View>
          )}

          <View style={styles.headerInfo}>
            <Text style={styles.headerName}>{partnerName}</Text>
          </View>

          {/* Date Planner — opens the planner modal */}
          <TouchableOpacity
            style={styles.callBtn}
            onPress={() => openDatePicker()}
            activeOpacity={0.7}
          >
            <Ionicons name="calendar-outline" size={20} color={colors.textPrimary} />
          </TouchableOpacity>

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
          ends. Hidden once the date has passed ("expired"). Tapping opens the planner. */}
        {scheduledDate && scheduledDate >= todayDateStr() && (
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

        {/* Messages */}
        <KeyboardAvoidingView
          style={styles.chatArea}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
          {loading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              data={messages}
              keyExtractor={(item) => item.id}
              renderItem={renderMessage}
              contentContainerStyle={styles.messagesList}
              showsVerticalScrollIndicator={false}
              removeClippedSubviews
              maxToRenderPerBatch={12}
              windowSize={9}
              initialNumToRender={15}
              onContentSizeChange={() => {
                if (suppressAutoScrollRef.current) {
                  // Older page prepended (or its spinner shown/hidden): hold
                  // the view. Release once the fetch is over and rendered.
                  if (!loadingOlderRef.current) suppressAutoScrollRef.current = false;
                  return;
                }
                if (messages.length > 0) initialScrollDoneRef.current = true;
                flatListRef.current?.scrollToEnd({ animated: false });
              }}
              // Keep what the user is reading in place while older rows are
              // inserted above it.
              maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
              onScroll={(e) => {
                if (!initialScrollDoneRef.current || !hasMoreHistory) return;
                if (e.nativeEvent.contentOffset.y < 120) loadOlderMessages();
              }}
              scrollEventThrottle={100}
              ListHeaderComponent={
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
                <Text style={styles.recordingHint}>Release to send</Text>
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

          {/* Icebreaker bar — shown when chat is not recording */}
          {!isRecording && (
            <TouchableOpacity
              style={styles.icebreakerBar}
              onPress={() => {
                // Send the icebreaker as a message
                const prompt = ICEBREAKERS[icebreakerIndex];
                setInputText(prompt);
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="chatbubbles-outline" size={14} color={colors.textMuted} />
              <Text style={styles.icebreakerText} numberOfLines={1}>
                {ICEBREAKERS[icebreakerIndex]}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setIcebreakerIndex((prev) => (prev + 1) % ICEBREAKERS.length);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="shuffle-outline" size={14} color={colors.textSecondary} />
              </TouchableOpacity>
            </TouchableOpacity>
          )}

          {/* Vibe check row — shown when not recording and no text input */}
          {!isRecording && inputText.trim().length === 0 && (
            <View style={styles.vibeCheckRow}>
              {VIBE_OPTIONS.map((vibe, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={styles.vibeCheckBtn}
                  onPress={() => {
                    // Send vibe as a message
                    setInputText(vibe.sentAs);
                    // Auto-send after a brief moment
                    setTimeout(() => handleSend(), 100);
                  }}
                  activeOpacity={0.6}
                >
                  <Ionicons name={vibe.icon} size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Offer to fetch the on-device reply assistant once the chat has
            some history; shows download progress while it runs */}
          <ReplyAssistantOffer
            messageCount={messages.length}
            visible={inputText.trim().length === 0}
          />

          {/* Ambient reply suggestions — refresh as the conversation evolves;
            tap inserts into the input, hidden while the user is typing */}
          <DmSuggestionChips
            messages={messages}
            partnerName={partnerName}
            visible={inputText.trim().length === 0}
            onPick={setInputText}
          />

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
              <TouchableOpacity
                style={[styles.micBtn, isRecording && styles.micBtnActive]}
                onPressIn={startRecording}
                onPressOut={stopRecording}
                disabled={sending}
              >
                <Ionicons
                  name="mic"
                  size={22}
                  color={isRecording ? colors.textInverse : colors.textSecondary}
                />
              </TouchableOpacity>
            )}
          </View>
        </KeyboardAvoidingView>

      </Animated.View>

      {/* Full-Screen Photo Preview Modal */}
      <Modal
        visible={previewPhotoUrl !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setPreviewPhotoUrl(null)}
      >
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <View style={styles.previewOverlay}>
          <TouchableOpacity
            style={styles.previewCloseBtn}
            onPress={() => setPreviewPhotoUrl(null)}
            activeOpacity={0.7}
          >
            <View style={styles.previewCloseBtnInner}>
              <Ionicons name="close" size={24} color="#fff" />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.previewImageContainer}
            activeOpacity={1}
            onPress={() => setPreviewPhotoUrl(null)}
          >
            {previewPhotoUrl && (
              <Image
                source={{ uri: previewPhotoUrl }}
                style={styles.previewImage}
                resizeMode="contain"
              />
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
                  onPress={() => {
                    const token = api.getToken();
                    const separator = viewingOnceMedia.url.includes('?') ? '&' : '?';
                    const videoUrl = token
                      ? `${viewingOnceMedia.url}${separator}token=${encodeURIComponent(token)}`
                      : viewingOnceMedia.url;
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

              <TouchableOpacity style={styles.mediaOption} onPress={() => closeMediaPicker(() => pickDocument())} activeOpacity={0.6}>
                <View style={styles.mediaOptionIcon}>
                  <Ionicons name="document-outline" size={24} color={colors.textPrimary} />
                </View>
                <Text style={styles.mediaOptionLabel}>Document</Text>
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
              This will permanently delete all messages and media exchanged. This cannot be undone.
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
                  {getMonthDays(calendarYear, calendarMonth).map((cell, i) => {
                    const selected = plannerDate === cell.dateStr;
                    const isToday = cell.dateStr === TODAY_STR;
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
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
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
  messagesList: { padding: spacing.lg, paddingBottom: spacing.md },
  olderSpinner: { paddingVertical: spacing.md },
  messageRow: {
    width: '100%',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
  },
  messageRowMine: { justifyContent: 'flex-end' },
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
  messageText: { ...typography.body2, color: colors.textPrimary, flexShrink: 1 },
  myMessageText: { color: colors.textInverse },
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
  icebreakerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  icebreakerText: {
    ...typography.body2,
    color: colors.textSecondary,
    flex: 1,
    fontStyle: 'italic',
  },

  // ─── Vibe Check Row ──────────────────────────────────
  vibeCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
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
});

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  Image, KeyboardAvoidingView, Platform, Keyboard, ActivityIndicator,
  Modal, Alert, Dimensions, Linking,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAudioRecorder, createAudioPlayer, AudioPlayer, setAudioModeAsync, requestRecordingPermissionsAsync, RecordingPresets } from 'expo-audio';
import { usePreventScreenCapture } from 'expo-screen-capture';

import * as FileSystem from 'expo-file-system/legacy';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Socket } from 'socket.io-client';
import { api } from '../../services/api';
import { getChatSocket } from '../../services/callSocket';
import { useAuthStore } from '../../store/authStore';
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

export const ChatScreen: React.FC<{ navigation: any; route: any }> = ({ navigation, route }) => {
  const { matchId, partnerName: pName, partnerId: pId, partnerPhotoUrl: pPhoto } = route.params || {};
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [keyboardWasActive, setKeyboardWasActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);

  // ─── View-Once Media State ────────────────────────────
  const [viewOnce, setViewOnce] = useState(false); // Toggle in media picker
  const [viewingOnceMedia, setViewingOnceMedia] = useState<{
    mediaId: string;
    url: string;
    mediaType: 'image' | 'video';
  } | null>(null); // Currently being viewed in one-time viewer

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

  const partnerName = pName || 'Stranger';

  // ─── Fetch & merge message history ─────────────────────
  // Merges server history with what's already in state (live-arrived
  // messages, pending temp-* sends) so a refetch never wipes anything.
  // Called on mount AND on every socket (re)connect so messages missed
  // during a disconnect / dropped broadcast show up without leaving the DM.
  const syncMessages = useCallback(async () => {
    try {
      const res = await api.getMessages(matchId);
      if (!res.success || !res.data) return;
      const fetched = res.data.messages || [];
      setMessages((prev) => {
        // Keep only THIS match's pending sends — if the screen was re-used
        // with a new matchId param, temps from the previous DM must not leak
        const temps = prev.filter((m) => m.id.startsWith('temp-') && m.matchId === matchId);
        const merged = [...fetched, ...temps];
        const seen = new Set<string>();
        return merged.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
      });
    } catch {
      // Silent — retried on the next (re)connect
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

    socket.on('connect', onConnect);
    socket.on('chat:message', onChatMessage);
    socket.on('chat:read', onChatRead);
    socket.on('chat:typing', onChatTyping);
    socket.on('media:viewed', onMediaViewed);
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
      socket.off('disconnect', onDisconnect);
      socketRef.current = null;
    };
  }, [matchId, syncMessages]);

  // ─── Fetch message history ─────────────────────────
  useEffect(() => {
    (async () => {
      setLoading(true);
      await syncMessages();
      setLoading(false);
    })();
  }, [syncMessages]);

  // ─── Scroll to bottom on new messages ──────────────
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  // ─── Track keyboard state for dynamic padding ──────
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardWasActive(true),
    );
    return () => show.remove();
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
        setMessages((prev) => prev.map((m) =>
          m.id === tempId ? { ...m, id: res.data!.id } : m,
        ));
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
    setShowMediaPicker(false);
    setViewOnce(false); // Reset the toggle

    // View-once only applies to visual media — a stale toggle must never
    // flag a voice note, which would render as an unopenable card
    const applyViewOnce = viewOnce && (mediaType === 'image' || mediaType === 'video');

    const tempId = `temp-${Date.now()}`;
    const previewText = applyViewOnce
      ? 'Sent a view-once photo'
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
      const res = await api.sendMediaMessage(matchId, uri, mediaType, undefined, applyViewOnce, durationSecs);
      if (res.success && res.data) {
        // Replace temp with confirmed message
        setMessages((prev) => prev.map((m) =>
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
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission needed', 'Allow microphone access to record voice.');
        return;
      }

      // Clean up previous cached voice file
      if (lastCacheUriRef.current) {
        FileSystem.deleteAsync(lastCacheUriRef.current).catch(() => {});
        lastCacheUriRef.current = null;
      }

      // Dismiss keyboard and close picker when starting recording
      Keyboard.dismiss();
      setShowMediaPicker(false);

      await setAudioModeAsync({ allowsRecording: true });

      const recorder = audioRecorderRef.current;

      // Release any previous session before preparing a new one
      try {
        await recorder.stop();
      } catch {
        // Ignore — stop() throws if no session is active
      }

      await recorder.prepareToRecordAsync();
      recorder.record();
      setIsRecording(true);
      setRecordingDuration(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.error('[ChatAudio] Recording error:', err);
      Alert.alert('Recording Error', err.message || 'Could not start recording.');
    }
  };

  const stopRecording = async () => {
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
      setAudioModeAsync({ allowsRecording: false }).catch(() => {});

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
      // We work around this by reading via fetch (which uses Android's
      // ContentResolver) and writing a copy to the app's cache dir.
      //
      // On iOS, fetch() does NOT support file:// URIs (it throws a
      // TypeError). But iOS has no sandbox read restriction — the
      // expo-audio file is directly accessible to NSURLSession, so
      // FileSystem.uploadAsync works with the original URI directly.
      let uploadUri: string;

      if (Platform.OS === 'android') {
        try {
          console.log('[ChatAudio] Android: copying via fetch to cache...');
          const response = await fetch(uploadSourceUri);
          const arrayBuffer = await response.arrayBuffer();
          console.log('[ChatAudio] Fetched ArrayBuffer size:', arrayBuffer.byteLength, 'bytes');

          // Convert ArrayBuffer to base64 (Hermes-compatible)
          const bytes = new Uint8Array(arrayBuffer);
          const chars = new Array(bytes.length);
          for (let i = 0; i < bytes.length; i++) {
            chars[i] = String.fromCharCode(bytes[i]);
          }
          const base64Content = btoa(chars.join(''));

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
          console.warn('[ChatAudio] Android: fetch copy failed, falling back to source URI:', err);
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
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    const recorder = audioRecorderRef.current;
    try {
      await recorder.stop();
    } catch {}
    // Return the audio session to playback mode (same as in stopRecording)
    setAudioModeAsync({ allowsRecording: false }).catch(() => {});
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
      } catch {}
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
        } catch {}
        playerRef.current = null;
      }
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    };
  }, []);

  // ─── Media picker handlers ─────────────────────────
  const pickFromGallery = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow access to your photo library to send images.');
      return;
    }

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

  // ─── Render media content for a message ────────────
  const renderMediaContent = (item: Message, isMine: boolean) => {
    if (!item.media) return null;
    const media = item.media;

    // View-once media that has been viewed — show "Opened" placeholder
    if (media.isViewOnce && media.viewedAt) {
      return (
        <View style={styles.viewOnceViewed}>
          <Ionicons
            name={isMine ? 'checkmark-done' : 'eye-outline'}
            size={20}
            color={isMine ? colors.textInverse : colors.textMuted}
          />
          <Text style={[styles.viewOnceViewedText, isMine && { color: colors.textInverse }]}>
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
          <View style={styles.viewOnceCardTop}>
            <View style={styles.viewOnceCardIconRow}>
              <View style={styles.viewOnceCardIconRing}>
                <Ionicons name="eye-outline" size={18} color={colors.primary} />
              </View>
              <View style={styles.viewOnceCardLabelGroup}>
                <Text style={styles.viewOnceCardLabel}>View once photo</Text>
                <Text style={styles.viewOnceCardSub}>
                  {media.mediaType === 'video' ? 'Video' : 'Photo'} — tap to view
                </Text>
              </View>
            </View>
            <View style={styles.viewOnceCardBadge}>
              <Ionicons name="lock-closed" size={12} color={colors.primary} />
              <Text style={styles.viewOnceCardBadgeText}>1</Text>
            </View>
          </View>
          <View style={styles.viewOnceCardDivider} />
          <View style={styles.viewOnceCardFooter}>
            <Ionicons name="information-circle-outline" size={12} color={colors.textMuted} />
            <Text style={styles.viewOnceCardFooterText}>
              This {media.mediaType === 'video' ? 'video' : 'photo'} will disappear after viewing
            </Text>
          </View>
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
                <Ionicons name="eye-outline" size={16} color="#fff" />
                <Text style={styles.viewOnceOverlayText}>View once</Text>
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
        {showAvatar && pPhoto ? (
          <Image source={{ uri: resolveUrl(pPhoto) }} style={styles.messageAvatar} />
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

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>

        {pPhoto ? (
          <Image source={{ uri: resolveUrl(pPhoto) }} style={styles.headerAvatar} />
        ) : (
          <View style={[styles.headerAvatar, styles.noHeaderAvatar]}>
            <Ionicons name="person-outline" size={20} color={colors.textMuted} />
          </View>
        )}

        <View style={styles.headerInfo}>
          <Text style={styles.headerName}>{partnerName}</Text>
          <Text style={styles.headerStatus}>
            {partnerTyping ? 'Typing...' : socketConnected ? 'Online' : 'Offline'}
          </Text>
        </View>

        {/* 1:1 voice/video call (private date call) */}
        <TouchableOpacity
          style={styles.callBtn}
          onPress={() =>
            navigation.navigate('Call', {
              matchId,
              partnerName,
              partnerPhotoUrl: pPhoto,
              partnerId: pId,
              mode: 'caller',
            })
          }
          activeOpacity={0.7}
        >
          <Ionicons name="call" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      {/* Messages */}
      <KeyboardAvoidingView
        style={styles.chatArea}
        behavior="padding"
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
            onContentSizeChange={() =>
              flatListRef.current?.scrollToEnd({ animated: false })
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
            <TouchableOpacity onPress={cancelRecording} style={styles.recordingCancelBtn}>
              <Ionicons name="close" size={22} color="#FF6B6B" />
            </TouchableOpacity>
            <Text style={styles.recordingHint}>Release to send</Text>
            <View style={styles.recordingIndicator}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingTimer}>
                {String(Math.floor(recordingDuration / 60)).padStart(2, '0')}:
                {String(recordingDuration % 60).padStart(2, '0')}
              </Text>
            </View>
          </View>
        ) : null}

        {/* Input bar */}
        <View style={[styles.inputBar, { paddingBottom: keyboardWasActive ? spacing.xs : spacing.sm }]}>
          <TouchableOpacity
            style={styles.attachBtn}
            onPress={() => setShowMediaPicker(true)}
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

      {/* Media Picker Modal */}
      <Modal
        visible={showMediaPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowMediaPicker(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowMediaPicker(false)}
        >
          <View style={styles.mediaPickerSheet}>
            <View style={styles.mediaPickerHandle} />
            <Text style={styles.mediaPickerTitle}>Send Media</Text>

            {/* View-Once Toggle */}
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
                  <Text style={[styles.viewOnceToggleLabel, viewOnce && { color: colors.primary }]}>
                    View once
                  </Text>
                  <Text style={styles.viewOnceToggleDesc}>
                    Media will disappear after viewing
                  </Text>
                </View>
              </View>
              <Ionicons
                name={viewOnce ? 'checkbox' : 'square-outline'}
                size={22}
                color={viewOnce ? colors.primary : colors.textMuted}
              />
            </TouchableOpacity>

            <View style={styles.mediaPickerOptions}>
              <TouchableOpacity style={styles.mediaOption} onPress={pickFromGallery}>
                <View style={[styles.mediaOptionIcon, { backgroundColor: '#4ECDC4' }]}>
                  <Ionicons name="images-outline" size={24} color="#fff" />
                </View>
                <Text style={styles.mediaOptionLabel}>Gallery</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.mediaOption} onPress={takePhoto}>
                <View style={[styles.mediaOptionIcon, { backgroundColor: '#1E90FF' }]}>
                  <Ionicons name="camera-outline" size={24} color="#fff" />
                </View>
                <Text style={styles.mediaOptionLabel}>Camera</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.mediaOption} onPress={pickDocument}>
                <View style={[styles.mediaOptionIcon, { backgroundColor: '#FF6B6B' }]}>
                  <Ionicons name="document-outline" size={24} color="#fff" />
                </View>
                <Text style={styles.mediaOptionLabel}>Document</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.mediaCancelBtn}
              onPress={() => {
                setShowMediaPicker(false);
                setViewOnce(false);
              }}
            >
              <Text style={styles.mediaCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
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
  chatArea: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  messagesList: { padding: spacing.lg, paddingBottom: spacing.md },
  messageRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    alignItems: 'flex-end',
  },
  messageRowMine: { justifyContent: 'flex-end' },
  messageAvatar: { width: 28, height: 28, borderRadius: 14, marginBottom: 4 },
  noMsgAvatar: { backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' },
  messageBubble: {
    maxWidth: '75%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
  },
  myBubble: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: radius.sm,
  },
  theirBubble: {
    backgroundColor: colors.surfaceHighlight,
    borderBottomLeftRadius: radius.sm,
  },
  messageText: { ...typography.body2, color: colors.textPrimary },
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
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceHighlight,
    borderTopWidth: 1,
    borderTopColor: colors.primary,
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FF3B30',
  },
  recordingTimer: { ...typography.h3, color: '#FF3B30', fontSize: 16 },
  recordingHint: { ...typography.caption, color: colors.textMuted, flex: 1, textAlign: 'center' },
  recordingCancelBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
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
    minWidth: 200,
    borderRadius: radius.md,
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.25)',
    overflow: 'hidden',
    marginVertical: 2,
  },
  viewOnceCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  viewOnceCardIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  viewOnceCardIconRing: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(99,102,241,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewOnceCardLabelGroup: {
    gap: 1,
  },
  viewOnceCardLabel: {
    ...typography.body2,
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  viewOnceCardSub: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
  },
  viewOnceCardBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(99,102,241,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  viewOnceCardBadgeText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  viewOnceCardDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  viewOnceCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  viewOnceCardFooterText: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.35)',
    fontSize: 10,
  },
  // "Viewed" / "Opened" state after one-time media is consumed
  viewOnceViewed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    minWidth: 100,
  },
  viewOnceViewedText: {
    ...typography.body2,
    color: colors.textMuted,
    fontStyle: 'italic',
    fontSize: 13,
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
  mediaPickerSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl,
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
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginBottom: spacing.lg,
  },
  viewOnceToggleActive: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: 'rgba(99,102,241,0.08)',
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
    justifyContent: 'space-around',
    marginBottom: spacing.xxl,
  },
  mediaOption: { alignItems: 'center', gap: spacing.sm },
  mediaOptionIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediaOptionLabel: { ...typography.body2, color: colors.textSecondary },
  mediaCancelBtn: {
    paddingVertical: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
  },
  mediaCancelText: { ...typography.button, color: colors.textPrimary },
});

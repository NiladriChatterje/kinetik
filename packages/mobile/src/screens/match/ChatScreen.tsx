import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  Image, KeyboardAvoidingView, Platform, ActivityIndicator, SafeAreaView,
  Modal, Alert,
} from 'react-native';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { io, Socket } from 'socket.io-client';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { WS_URL, resolveUrl } from '../../config';
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

export const ChatScreen: React.FC<{ navigation: any; route: any }> = ({ navigation, route }) => {
  const { matchId, partnerName: pName, partnerId: pId, partnerPhotoUrl: pPhoto } = route.params || {};
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const socketRef = useRef<Socket | null>(null);
  const authUser = useAuthStore((s) => s.user);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const partnerName = pName || 'Stranger';
  const partnerIdStr = pId || '';

  // ─── Socket Connection ──────────────────────────────
  useEffect(() => {
    const token = api.getToken();
    const socket = io(`${WS_URL}/chat`, {
      auth: { token },
      transports: ['websocket'],
    });

    socket.on('connect', () => {
      setSocketConnected(true);
      socket.emit('chat:join', { matchId });
      socket.emit('chat:read', { matchId });
    });

    // Incoming message — from partner OR our own broadcast
    socket.on('chat:message', (data: any) => {
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
    });

    socket.on('chat:read', (data: any) => {
      if (data.userId !== authUser?.id) {
        setMessages((prev) =>
          prev.map((m) =>
            m.senderId === authUser?.id && !m.readAt
              ? { ...m, readAt: data.readAt }
              : m,
          ),
        );
      }
    });

    socket.on('chat:typing', (data: any) => {
      if (data.userId !== authUser?.id) {
        setPartnerTyping(data.isTyping);
      }
    });

    socket.on('disconnect', () => {
      setSocketConnected(false);
    });

    socketRef.current = socket;

    return () => {
      socket.emit('chat:leave', { matchId });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [matchId]);

  // ─── Fetch message history ─────────────────────────
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const res = await api.getMessages(matchId);
        if (res.success && res.data) {
          setMessages(res.data.messages || []);
        }
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    })();
  }, [matchId]);

  // ─── Scroll to bottom on new messages ──────────────
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

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

    const tempId = `temp-${Date.now()}`;
    const previewText = mediaType === 'image' ? 'Sent a photo' : `Sent ${mediaType}`;

    // Optimistically add a temp message with duration if provided
    setMessages((prev) => [...prev, {
      id: tempId,
      matchId,
      senderId: authUser?.id || '',
      content: previewText,
      createdAt: new Date().toISOString(),
      readAt: null,
      media: durationSecs ? { mediaType: mediaType as any, durationSecs, url: '' } as any : undefined,
    }]);

    try {
      const res = await api.sendMediaMessage(matchId, uri, mediaType, undefined, durationSecs ? String(durationSecs) : undefined);
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

  // ─── Audio Recording ──────────────────────────────
  const startRecording = async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow microphone access to record audio.');
        return;
      }

      setShowMediaPicker(false);
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      recordingRef.current = recording;
      setIsRecording(true);
      setRecordingDuration(0);

      // Count up elapsed seconds
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      Alert.alert('Recording Error', err.message || 'Could not start recording.');
    }
  };

  const stopRecording = async () => {
    try {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      const recording = recordingRef.current;
      if (!recording) return;

      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      recordingRef.current = null;
      setIsRecording(false);

      if (uri) {
        await sendMedia(uri, 'audio', recordingDuration);
      }
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
    const recording = recordingRef.current;
    if (recording) {
      try {
        await recording.stopAndUnloadAsync();
      } catch {}
      recordingRef.current = null;
    }
    setIsRecording(false);
    setRecordingDuration(0);
  };

  // ─── Audio Playback ────────────────────────────────
  const togglePlayAudio = async (messageId: string, url: string) => {
    if (playingAudioId === messageId) {
      // Stop current
      if (soundRef.current) {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
      setPlayingAudioId(null);
      return;
    }

    // Stop previous sound if any
    if (soundRef.current) {
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
      soundRef.current = null;
    }

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });

      const { sound } = await Audio.Sound.createAsync(
        { uri: resolveUrl(url) },
        { shouldPlay: true },
        (status) => {
          if (status.isLoaded && 'didJustFinish' in status && status.didJustFinish) {
            setPlayingAudioId(null);
            soundRef.current = null;
          }
        },
      );
      soundRef.current = sound;
      setPlayingAudioId(messageId);
    } catch (err: any) {
      Alert.alert('Playback Error', err.message || 'Could not play audio.');
    }
  };

  // Cleanup sound on unmount
  useEffect(() => {
    return () => {
      if (soundRef.current) {
        soundRef.current.stopAsync().catch(() => {});
        soundRef.current.unloadAsync().catch(() => {});
      }
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
      }
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
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
  const handleInputChange = (text: string) => {
    setInputText(text);

    if (socketRef.current?.connected) {
      socketRef.current.emit('chat:typing', { matchId, isTyping: text.length > 0 });

      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        socketRef.current?.emit('chat:typing', { matchId, isTyping: false });
      }, 2000);
    }
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

    // Determine display content
    const displayContent = hasMedia ? item.content : item.content;

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
          {hasMedia && item.media && (
            <View style={styles.mediaContainer}>
              {item.media.mediaType === 'image' && (
                <TouchableOpacity
                  onPress={() => {
                    // Could open a full-screen image viewer
                    Alert.alert('Photo', resolveUrl(item.media!.url));
                  }}
                  activeOpacity={0.9}
                >
                  <Image
                    source={{
                      uri: resolveUrl(item.media.thumbnailUrl || item.media.url),
                    }}
                    style={styles.mediaImage}
                    resizeMode="cover"
                  />
                </TouchableOpacity>
              )}

              {item.media.mediaType === 'video' && (
                <TouchableOpacity onPress={() => Alert.alert('Video', resolveUrl(item.media!.url))} activeOpacity={0.7}>
                  <View style={styles.mediaFileContainer}>
                    <Ionicons name="videocam" size={32} color={isMine ? colors.textInverse : colors.textPrimary} />
                    <Text style={[styles.mediaFileText, isMine && styles.myMessageText]}>Video</Text>
                  </View>
                </TouchableOpacity>
              )}

              {item.media.mediaType === 'audio' && (
                <TouchableOpacity
                  onPress={() => togglePlayAudio(item.id, item.media!.url)}
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
                  {item.media.durationSecs ? (
                    <Text style={[styles.audioDuration, isMine && { color: 'rgba(255,255,255,0.7)' }]}>
                      {item.media.durationSecs}s
                    </Text>
                  ) : null}
                </TouchableOpacity>
              )}

              {item.media.mediaType === 'file' && (
                <TouchableOpacity onPress={() => Alert.alert('File', resolveUrl(item.media!.url))} activeOpacity={0.7}>
                  <View style={styles.mediaFileContainer}>
                    <Ionicons name="document" size={32} color={isMine ? colors.textInverse : colors.textPrimary} />
                    <Text style={[styles.mediaFileText, isMine && styles.myMessageText]} numberOfLines={1}>
                      {item.media.fileName || 'File'}
                    </Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Text content (caption or description) */}
          {!hasMedia && (
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
      </View>

      {/* Messages */}
      <KeyboardAvoidingView
        style={styles.chatArea}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
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
            <View style={styles.recordingIndicator}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingTimer}>
                {String(Math.floor(recordingDuration / 60)).padStart(2, '0')}:
                {String(recordingDuration % 60).padStart(2, '0')}
              </Text>
            </View>
            <TouchableOpacity onPress={stopRecording} style={styles.recordingStopBtn}>
              <Ionicons name="stop" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Input bar */}
        <View style={styles.inputBar}>
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
          <TouchableOpacity
            style={[styles.sendBtn, !inputText.trim() && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!inputText.trim() || sending}
          >
            <Ionicons
              name="send"
              size={20}
              color={inputText.trim() ? colors.textPrimary : colors.textMuted}
            />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

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

              <TouchableOpacity style={styles.mediaOption} onPress={startRecording}>
                <View style={[styles.mediaOptionIcon, { backgroundColor: '#FF6B6B' }]}>
                  <Ionicons name="mic-outline" size={24} color="#fff" />
                </View>
                <Text style={styles.mediaOptionLabel}>Record Audio</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.mediaCancelBtn}
              onPress={() => setShowMediaPicker(false)}
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
  mediaContainer: {
    marginBottom: 4,
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
  recordingCancelBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  recordingStopBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FF3B30',
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
    paddingVertical: spacing.sm,
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
  sendBtnDisabled: { backgroundColor: colors.surfaceHighlight },
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
  mediaPickerTitle: { ...typography.h3, color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.xxl },
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

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  Image, KeyboardAvoidingView, Platform, ActivityIndicator, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { io, Socket } from 'socket.io-client';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { WS_URL } from '../../config';
import { colors, typography, spacing, radius } from '../../theme';

interface Message {
  id: string;
  matchId: string;
  senderId: string;
  content: string;
  createdAt: string;
  readAt: string | null;
}

export const ChatScreen: React.FC<{ navigation: any; route: any }> = ({ navigation, route }) => {
  const { matchId, partnerName: pName, partnerId: pId, partnerPhotoUrl: pPhoto } = route.params || {};
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const socketRef = useRef<Socket | null>(null);
  const authUser = useAuthStore((s) => s.user);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const partnerName = pName || 'Stranger';
  const partnerIdStr = pId || '';

  // Connect to Socket.IO chat namespace
  useEffect(() => {
    const token = api.getToken();
    const socket = io(`${WS_URL}/chat`, {
      auth: { token },
      transports: ['websocket'],
    });

    socket.on('connect', () => {
      setSocketConnected(true);
      socket.emit('chat:join', { matchId });
    });

    socket.on('chat:message', (data: any) => {
      setMessages((prev) => {
        // Avoid duplicates
        if (prev.some((m) => m.id === data.id)) return prev;
        return [...prev, {
          id: data.id || `temp-${Date.now()}`,
          matchId: data.matchId,
          senderId: data.senderId,
          content: data.content,
          createdAt: data.createdAt || new Date().toISOString(),
          readAt: null,
        }];
      });
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

  // Fetch message history
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const res = await api.getMessages(matchId);
        if (res.success && res.data) {
          setMessages(res.data.messages || []);
        }
      } catch {
        // Silently fail - user can still send messages
      } finally {
        setLoading(false);
      }
    })();
  }, [matchId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || sending) return;

    setInputText('');
    setSending(true);

    // Optimistically add to UI
    const tempId = `temp-${Date.now()}`;
    setMessages((prev) => [...prev, {
      id: tempId,
      matchId,
      senderId: authUser?.id || '',
      content: text,
      createdAt: new Date().toISOString(),
      readAt: null,
    }]);

    // Emit via socket
    if (socketRef.current?.connected) {
      socketRef.current.emit('chat:message', { matchId, content: text });
    }

    // Persist via API
    try {
      const res = await api.sendMessage(matchId, text);
      if (res.success && res.data) {
        // Replace temp message with real one
        setMessages((prev) => prev.map((m) =>
          m.id === tempId ? { ...m, id: res.data!.id } : m
        ));
      }
    } catch {
      // Keep the message anyway
    } finally {
      setSending(false);
    }
  };

  const handleInputChange = (text: string) => {
    setInputText(text);

    // Emit typing indicator
    if (socketRef.current?.connected) {
      socketRef.current.emit('chat:typing', { matchId, isTyping: text.length > 0 });

      // Clear typing after 2s of inactivity
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        socketRef.current?.emit('chat:typing', { matchId, isTyping: false });
      }, 2000);
    }
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isMine = item.senderId === authUser?.id;
    const showAvatar = !isMine;
    const isTemp = item.id.startsWith('temp-');

    return (
      <View style={[styles.messageRow, isMine && styles.messageRowMine]}>
        {showAvatar && pPhoto ? (
          <Image source={{ uri: pPhoto }} style={styles.messageAvatar} />
        ) : showAvatar ? (
          <View style={[styles.messageAvatar, styles.noMsgAvatar]}>
            <Ionicons name="person-outline" size={16} color={colors.textMuted} />
          </View>
        ) : null}

        <View style={[styles.messageBubble, isMine ? styles.myBubble : styles.theirBubble]}>
          <Text style={[styles.messageText, isMine && styles.myMessageText]}>
            {item.content}
          </Text>
          <View style={styles.messageMeta}>
            {isTemp && (
              <Ionicons name="time-outline" size={12} color={colors.textMuted} />
            )}
            {item.readAt && (
              <Ionicons name="checkmark-done" size={12} color={colors.success} />
            )}
          </View>
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
          <Image source={{ uri: pPhoto }} style={styles.headerAvatar} />
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

        {/* Input bar */}
        <View style={styles.inputBar}>
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
  myMessageText: { color: colors.textPrimary },
  messageMeta: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 2,
    gap: 2,
  },
  emptyChat: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: { ...typography.body1, color: colors.textMuted, marginTop: spacing.md },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceHighlight,
    gap: spacing.sm,
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
});

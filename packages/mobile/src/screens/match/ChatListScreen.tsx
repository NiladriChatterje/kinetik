import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, Image, TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Socket } from 'socket.io-client';
import { useFocusEffect } from '@react-navigation/native';
import { preventScreenCaptureAsync, allowScreenCaptureAsync } from 'expo-screen-capture';
import { api } from '../../services/api';
import { getChatSocket } from '../../services/chatSocket';
import { onPremiumChanged } from '../../services/appEvents';
import { useAuthStore } from '../../store/authStore';
import { resolveUrl } from '../../config';
import { colors, typography, spacing } from '../../theme';

interface Conversation {
  matchId: string;
  partnerId: string;
  partnerName: string;
  partnerPhotoUrl?: string;
  partnerThumbnailUrl?: string;
  lastMessage?: string;
  lastMessageAt?: string;
  lastMessageSenderId?: string;
  unreadCount: number;
  /** Free account: chat is Premium only, the server sends no messages */
  locked?: boolean;
}

const CHAT_LIST_CAPTURE_KEY = 'chat-list';

/** Waits between automatic retries of a first load that failed */
const LOAD_RETRY_DELAYS_MS = [3000, 6000, 12000];

export const ChatListScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const authUser = useAuthStore((s) => s.user);
  const socketRef = useRef<Socket | null>(null);
  const conversationsRef = useRef<Conversation[]>([]);
  // The list is paged: where the next page starts, null once every chat is
  // listed. Every active match id, for the socket rooms, comes separately.
  const nextCursorRef = useRef<string | null>(null);
  const roomIdsRef = useRef<string[]>([]);
  const loadingMoreRef = useRef(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);

  // A list that could not be loaded at all (the database may still be waking
  // up) is retried on its own while the spinner shows, then offered as "Try
  // again", never shown as "No Conversations". A list already on screen stays.
  const [loadFailed, setLoadFailed] = useState(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
  }, []);

  const fetchConversations = useCallback(async () => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    let loaded = false;
    try {
      setLoading(true);
      const res = await api.getConversations();
      if (res.success && res.data) {
        loaded = true;
        const list = res.data.conversations || [];
        conversationsRef.current = list;
        setConversations(list);
        nextCursorRef.current = res.data.nextCursor ?? null;
        setMoreFailed(false);
        roomIdsRef.current = res.data.matchIds ?? list.map((conv: Conversation) => conv.matchId);
        // The tab badge counts the chats with unread messages, on any page.
        // Keep it in step on every load — the refresh button, a new
        // conversation's first message and a new match all reload the list
        // while this tab stays focused.
        useAuthStore.getState().syncChatBadge(res.data);
        // Join every match room on the socket for real-time updates
        if (socketRef.current?.connected) {
          roomIdsRef.current.forEach((matchId) => {
            socketRef.current!.emit('chat:join', { matchId });
          });
        }
      }
    } catch {
      // Handled below like any other failed load
    }
    if (!mountedRef.current) return;
    if (loaded || conversationsRef.current.length > 0) {
      retryAttemptRef.current = 0;
      setLoadFailed(false);
      setLoading(false);
      return;
    }
    const attempt = retryAttemptRef.current;
    if (attempt < LOAD_RETRY_DELAYS_MS.length) {
      retryAttemptRef.current = attempt + 1;
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        fetchConversations();
      }, LOAD_RETRY_DELAYS_MS[attempt]);
      return;
    }
    retryAttemptRef.current = 0;
    setLoading(false);
    setLoadFailed(true);
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
      const res = await api.getConversations({ cursor });
      if (!res.success || !res.data) throw new Error(res.error?.message);
      // A chat that moved up meanwhile is already listed
      const page = (res.data.conversations || []).filter(
        (conv: Conversation) => !conversationsRef.current.some((c) => c.matchId === conv.matchId),
      );
      nextCursorRef.current = res.data.nextCursor ?? null;
      conversationsRef.current = [...conversationsRef.current, ...page];
      if (!mountedRef.current) return;
      setConversations((prev) => [...prev, ...page]);
      setMoreFailed(false);
    } catch {
      if (mountedRef.current) setMoreFailed(true);
    } finally {
      loadingMoreRef.current = false;
      if (mountedRef.current) setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    fetchConversations();

    // App-wide shared /chat socket — attach this screen's listeners to it
    const socket = getChatSocket();

    // Join rooms on every (re)connect — rooms are per-socket on the server,
    // and the fetch above may resolve before the socket finishes connecting.
    const onConnect = () => {
      roomIdsRef.current.forEach((matchId) => {
        socket.emit('chat:join', { matchId });
      });
    };

    const onChatMessage = (data: any) => {
      // Message for a conversation we don't have yet (e.g. a brand-new
      // match's first message) — refetch the list instead of dropping it
      if (!conversationsRef.current.some((c) => c.matchId === data.matchId)) {
        fetchConversations();
        return;
      }
      // Update the conversation that received a new message
      setConversations((prev) =>
        prev.map((conv) =>
          conv.matchId === data.matchId
            ? {
                ...conv,
                lastMessage: data.content,
                lastMessageAt: data.createdAt,
                lastMessageSenderId: data.senderId,
                unreadCount: data.senderId !== authUser?.id && data.matchId !== useAuthStore.getState().openChatMatchId
                  ? conv.unreadCount + 1
                  : conv.unreadCount,
              }
            : conv,
        ),
      );
    };

    // A new match opens a new chat — join its room so its messages arrive
    // live, and refetch so the conversation shows up in the list
    const onMatchNew = (data: any) => {
      if (data?.matchId) {
        socket.emit('chat:join', { matchId: data.matchId });
        fetchConversations();
      }
    };

    socket.on('connect', onConnect);
    socket.on('chat:message', onChatMessage);
    socket.on('match:new', onMatchNew);
    if (socket.connected) onConnect();

    socketRef.current = socket;

    // Premium gained or lost: every chat's lock changes. The reload also joins
    // the rooms the server refused while they were locked.
    const offPremiumChanged = onPremiumChanged(() => {
      fetchConversations();
    });

    return () => {
      // Shared socket — detach this screen's listeners only, never disconnect
      socket.off('connect', onConnect);
      socket.off('chat:message', onChatMessage);
      socket.off('match:new', onMatchNew);
      offPremiumChanged();
      socketRef.current = null;
    };
  }, []);

  // ─── Prevent screenshots while the chat list is on screen ───
  // FLAG_SECURE on Android, as in ChatScreen. Tied to focus, not mount: the
  // list lives in a tab that stays mounted after the user switches tabs, and
  // a mount-scoped block would cover the whole app from then on. The key is
  // our own, and the library lifts the flag only once every key is released,
  // so opening a chat from here (ChatScreen holds its own key) stays blocked
  // throughout, and leaving the list never unblocks an open chat.
  useFocusEffect(
    useCallback(() => {
      preventScreenCaptureAsync(CHAT_LIST_CAPTURE_KEY).catch(() => {});
      return () => {
        allowScreenCaptureAsync(CHAT_LIST_CAPTURE_KEY).catch(() => {});
      };
    }, []),
  );

  // Re-fetch when screen comes into focus (to sync read status). The reload
  // also refreshes the tab badge — an unmatch on the way back lowers it here
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      fetchConversations();
    });
    return unsubscribe;
  }, [navigation]);

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString();
  };

  const renderConversation = ({ item }: { item: Conversation }) => (
    <TouchableOpacity
      style={styles.conversationCard}
      onPress={() => {
        // Opening the chat reads it, so drop its count here at once rather
        // than showing the old number on the way back until the reload lands.
        // Locked chats stay unread on the server; the reload restores theirs.
        if (item.unreadCount > 0) {
          setConversations((prev) =>
            prev.map((c) => (c.matchId === item.matchId ? { ...c, unreadCount: 0 } : c)),
          );
        }
        navigation.navigate('Chat', {
        matchId: item.matchId,
        partnerName: item.partnerName,
        partnerId: item.partnerId,
        partnerPhotoUrl: item.partnerPhotoUrl,
        partnerThumbnailUrl: item.partnerThumbnailUrl,
        // Known here already: a locked chat shows its lock at once, with
        // nothing of the chat interface in between
        locked: item.locked,
        });
      }}
      accessibilityHint={item.locked ? 'Locked. Upgrade to Premium to chat.' : undefined}
    >
      <View style={styles.avatarContainer}>
        {item.partnerThumbnailUrl || item.partnerPhotoUrl ? (
          // 300px thumbnail for a 56px circle; `resize` decodes it at the view
          // size instead of holding the full bitmap for every row
          <Image
            source={{ uri: resolveUrl(item.partnerThumbnailUrl || item.partnerPhotoUrl!) }}
            style={styles.avatar}
            resizeMethod="resize"
          />
        ) : (
          <View style={[styles.avatar, styles.noAvatar]}>
            <Ionicons name="person-outline" size={24} color={colors.textMuted} />
          </View>
        )}
        {item.unreadCount > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadText}>{item.unreadCount > 9 ? '9+' : item.unreadCount}</Text>
          </View>
        )}
      </View>

      <View style={styles.conversationInfo}>
        <View style={styles.conversationHeader}>
          <View style={styles.nameRow}>
            <Text style={styles.partnerName}>{item.partnerName}</Text>
            {item.locked && (
              <Ionicons name="lock-closed" size={13} color={colors.textMuted} />
            )}
          </View>
          {item.lastMessageAt && (
            <Text style={styles.time}>{formatTime(item.lastMessageAt)}</Text>
          )}
        </View>
        <Text
          style={[
            styles.lastMessage,
            item.unreadCount > 0 && styles.unreadMessage,
          ]}
          numberOfLines={1}
        >
          {item.locked
            ? 'Upgrade to Premium to chat'
            : `${item.lastMessageSenderId === authUser?.id ? 'You: ' : ''}${item.lastMessage || 'No messages yet'}`}
        </Text>
      </View>
    </TouchableOpacity>
  );

  // Hide back button when rendered as a tab (no route to go back to)
  const canGoBack = navigation.canGoBack?.() ?? false;

  if (loading && conversations.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          {canGoBack && (
            <TouchableOpacity onPress={() => navigation.goBack()}>
              <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          )}
          <Text style={styles.headerTitle}>Chat</Text>
          {!canGoBack && <View style={{ width: 24 }} />}
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
        {canGoBack && (
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        )}
        <Text style={styles.headerTitle}>Chat</Text>
        <TouchableOpacity onPress={fetchConversations}>
          <Ionicons name="refresh" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {conversations.length === 0 && loadFailed ? (
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={64} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Couldn't load your chats</Text>
          <Text style={styles.emptySubtitle}>The connection is slow right now. Your chats are safe.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => fetchConversations()} accessibilityRole="button">
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : conversations.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="chatbubbles-outline" size={64} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No Conversations</Text>
          <Text style={styles.emptySubtitle}>Match with someone to start chatting</Text>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.matchId}
          renderItem={renderConversation}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          maxToRenderPerBatch={10}
          windowSize={7}
          initialNumToRender={8}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={colors.primary} style={styles.footer} />
            ) : moreFailed ? (
              <TouchableOpacity style={styles.footer} onPress={loadMore} accessibilityRole="button">
                <Text style={styles.footerText}>Couldn't load more · Tap to retry</Text>
              </TouchableOpacity>
            ) : null
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
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xxl },
  emptyTitle: { ...typography.h2, color: colors.textPrimary, marginTop: spacing.lg },
  emptySubtitle: { ...typography.body1, color: colors.textMuted, marginTop: spacing.sm, textAlign: 'center' },
  retryBtn: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: 9999,
    backgroundColor: colors.primary,
  },
  retryText: { ...typography.button, color: colors.textInverse },
  list: { padding: spacing.xxl },
  footer: { alignItems: 'center', paddingVertical: spacing.lg },
  footerText: { ...typography.body2, color: colors.textSecondary },
  conversationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceHighlight,
  },
  avatarContainer: { position: 'relative' },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  noAvatar: { backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' },
  unreadBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: colors.primary,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  unreadText: { ...typography.caption, color: '#fff', fontSize: 11, fontWeight: '700' },
  conversationInfo: { flex: 1 },
  conversationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  partnerName: { ...typography.body1, color: colors.textPrimary, fontWeight: '600' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  time: { ...typography.caption, color: colors.textMuted, fontSize: 12 },
  lastMessage: { ...typography.body2, color: colors.textMuted },
  unreadMessage: { color: colors.textPrimary, fontWeight: '600' },
});

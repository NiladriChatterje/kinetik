import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, Image, TouchableOpacity,
  ActivityIndicator, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { io, Socket } from 'socket.io-client';
import { api } from '../../services/api';
import { useToast } from '../../hooks/useToast';
import { useAuthStore } from '../../store/authStore';
import { WS_URL } from '../../config';
import { colors, typography, spacing, radius } from '../../theme';

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
}

export const ChatListScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const authUser = useAuthStore((s) => s.user);
  const toast = useToast();
  const socketRef = useRef<Socket | null>(null);

  const fetchConversations = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.getConversations();
      if (res.success && res.data) {
        const list = res.data.conversations || [];
        setConversations(list);
        // Join all match rooms on the socket for real-time updates
        if (socketRef.current?.connected && list.length > 0) {
          list.forEach((conv: any) => {
            socketRef.current!.emit('chat:join', { matchId: conv.matchId });
          });
        }
      }
    } catch (err: any) {
      toast.showError('Failed to load conversations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConversations();

    // Connect to Socket.IO for real-time message updates
    const token = api.getToken();
    const socket = io(`${WS_URL}/chat`, {
      auth: { token },
      transports: ['websocket'],
    });

    socket.on('chat:message', (data: any) => {
      // Update the conversation that received a new message
      setConversations((prev) =>
        prev.map((conv) =>
          conv.matchId === data.matchId
            ? {
                ...conv,
                lastMessage: data.content,
                lastMessageAt: data.createdAt,
                lastMessageSenderId: data.senderId,
                unreadCount: data.senderId !== authUser?.id
                  ? conv.unreadCount + 1
                  : conv.unreadCount,
              }
            : conv,
        ),
      );
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  // Re-fetch when screen comes into focus (to sync read status)
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
      onPress={() => navigation.navigate('Chat', {
        matchId: item.matchId,
        partnerName: item.partnerName,
        partnerId: item.partnerId,
        partnerPhotoUrl: item.partnerPhotoUrl,
      })}
    >
      <View style={styles.avatarContainer}>
        {item.partnerPhotoUrl ? (
          <Image source={{ uri: item.partnerPhotoUrl }} style={styles.avatar} />
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
          <Text style={styles.partnerName}>{item.partnerName}</Text>
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
          {item.lastMessageSenderId === authUser?.id ? 'You: ' : ''}
          {item.lastMessage || 'No messages yet'}
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

      {conversations.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="chatbubbles-outline" size={64} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No Conversations</Text>
          <Text style={styles.emptySubtitle}>Match with someone to start chatting</Text>
          <TouchableOpacity
            style={styles.discoverBtn}
            onPress={() => canGoBack ? navigation.goBack() : navigation.navigate('Match')}
          >
            <Text style={styles.discoverBtnText}>Discover People</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.matchId}
          renderItem={renderConversation}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
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
  discoverBtn: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
  },
  discoverBtnText: { ...typography.button, color: colors.textPrimary },
  list: { padding: spacing.xxl },
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
  time: { ...typography.caption, color: colors.textMuted, fontSize: 12 },
  lastMessage: { ...typography.body2, color: colors.textMuted },
  unreadMessage: { color: colors.textPrimary, fontWeight: '600' },
});

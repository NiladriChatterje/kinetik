import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, Image, TouchableOpacity,
  ActivityIndicator, SafeAreaView, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../services/api';
import { useToast } from '../../hooks/useToast';
import { colors, typography, spacing, radius } from '../../theme';

interface IncomingLike {
  likedAt: string;
  userId: string;
  displayName: string;
  bio: string;
  age: number;
  photoUrl?: string;
  isVerified: boolean;
  isMutual: boolean;
}

export const LikeListScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [likes, setLikes] = useState<IncomingLike[]>([]);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState<string | null>(null);
  const toast = useToast();

  const fetchLikes = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.getIncomingLikes();
      if (res.success && res.data) {
        setLikes(res.data.likes || []);
      }
    } catch (err: any) {
      toast.showError('Failed to load likes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLikes();
  }, []);

  const handleRespond = async (targetUserId: string, action: 'like' | 'discard') => {
    setResponding(targetUserId);
    try {
      const res = await api.respondToLike(targetUserId, action);
      if (res.success && res.data) {
        const data = res.data;
        if (data.matched && action === 'like') {
          Alert.alert(
            'It\'s a Match! 🎉',
            `You matched with ${data.partnerName}! Start chatting now.`,
            [
              { text: 'Keep Browsing', style: 'cancel' },
              {
                text: 'Say Hello',
                onPress: () => navigation.navigate('Chat', {
                  matchId: data.matchId,
                  partnerName: data.partnerName,
                }),
              },
            ],
          );
        }
        // Remove from list
        setLikes((prev) => prev.filter((l) => l.userId !== targetUserId));
      }
    } catch (err: any) {
      toast.showError(err.message || 'Failed to respond');
    } finally {
      setResponding(null);
    }
  };

  const renderLike = ({ item }: { item: IncomingLike }) => (
    <View style={styles.likeCard}>
      <View style={styles.likeHeader}>
        {item.photoUrl ? (
          <Image source={{ uri: item.photoUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.noAvatar]}>
            <Ionicons name="person-outline" size={24} color={colors.textMuted} />
          </View>
        )}
        <View style={styles.likeInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{item.displayName}, {item.age}</Text>
            {item.isVerified && (
              <Ionicons name="checkmark-circle" size={16} color={colors.success} style={{ marginLeft: 4 }} />
            )}
          </View>
          {item.bio ? <Text style={styles.bio} numberOfLines={2}>{item.bio}</Text> : null}
        </View>
      </View>

      {item.isMutual ? (
        <View style={styles.mutualBadge}>
          <Ionicons name="heart" size={16} color={colors.success} />
          <Text style={styles.mutualText}>Matched</Text>
        </View>
      ) : (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.discardBtn]}
            onPress={() => handleRespond(item.userId, 'discard')}
            disabled={responding === item.userId}
          >
            {responding === item.userId ? (
              <ActivityIndicator size="small" color="#FF6B6B" />
            ) : (
              <Ionicons name="close" size={22} color="#FF6B6B" />
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.likeBackBtn]}
            onPress={() => handleRespond(item.userId, 'like')}
            disabled={responding === item.userId}
          >
            {responding === item.userId ? (
              <ActivityIndicator size="small" color="#4ECDC4" />
            ) : (
              <Ionicons name="heart" size={22} color="#4ECDC4" />
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
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
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Likes</Text>
        <TouchableOpacity onPress={fetchLikes}>
          <Ionicons name="refresh" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {likes.length === 0 ? (
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
  list: { padding: spacing.xxl, gap: spacing.md },
  likeCard: {
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  likeHeader: { flexDirection: 'row', gap: spacing.md },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  noAvatar: { backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' },
  likeInfo: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  name: { ...typography.body1, color: colors.textPrimary, fontWeight: '600' },
  bio: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  mutualBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: 'rgba(78, 205, 196, 0.15)',
    borderRadius: radius.full,
    alignSelf: 'flex-start',
  },
  mutualText: { ...typography.caption, color: colors.success, fontWeight: '600' },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xl,
    marginTop: spacing.md,
  },
  actionBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
  },
  discardBtn: {},
  likeBackBtn: {},
});

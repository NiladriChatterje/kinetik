import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Animated, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { io, Socket } from 'socket.io-client';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../components/common/Button';
import { colors, typography, spacing, radius } from '../../theme';
import { api } from '../../services/api';
import { WS_URL } from '../../config';
import { useAuthStore } from '../../store/authStore';
import { useToast } from '../../hooks/useToast';

const { width } = Dimensions.get('window');
const RADAR_SIZE = width * 0.7;

export const ActiveRadarScreen: React.FC<{ navigation: any; route: any }> = ({ navigation, route }) => {
  const { windowId } = route.params || {};
  const myUserId = useAuthStore((s) => s.user?.id);
  const [isInQueue, setIsInQueue] = useState(false);
  const [queueSize, setQueueSize] = useState(0);
  const [joining, setJoining] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const h3Ref = useRef<string | undefined>(undefined);
  const matchedRef = useRef(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const { showError, showInfo } = useToast();

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.8, duration: 1500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1500, useNativeDriver: true }),
      ]),
    ).start();

    Animated.loop(
      Animated.timing(rotateAnim, { toValue: 1, duration: 4000, useNativeDriver: true }),
    ).start();
  }, [pulseAnim, rotateAnim]);

  const rotation = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const handleMatchFound = useCallback((payload: any) => {
    if (matchedRef.current) return;
    matchedRef.current = true;
    const partnerId = payload.userAId === myUserId ? payload.userBId : payload.userAId;
    navigation.navigate('VibeCheck', {
      vibeId: payload.vibeId,
      partnerId,
      partnerName: payload.partnerName || '',
    });
  }, [myUserId, navigation]);

  const enterQueue = async () => {
    if (!windowId) {
      showError('No window', 'Join a flash window from the countdown screen first.');
      navigation.navigate('FlashCountdown');
      return;
    }
    setJoining(true);
    try {
      const res = await api.joinWindow(windowId);
      if (!res.success) {
        showError('Could not join', res.error?.message || 'Please try again.');
        return;
      }

      // Fetch the user's H3 cell so the match engine can find nearby users
      let h3: string | undefined;
      try {
        const area = await api.getAreaDetails();
        h3 = area.h3Index || undefined;
      } catch {
        h3 = undefined;
      }
      h3Ref.current = h3;

      const token = api.getToken();
      const socket = io(`${WS_URL}/flash-window`, {
        auth: { token },
        transports: ['websocket'],
        forceNew: true,
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        console.log('[FlashSocket] Connected');
        socket.emit('window:join', { windowId, h3Index: h3 });
      });

      socket.on('window:queue_size', (data: { windowId: string; size: number }) => {
        if (data.windowId === windowId) setQueueSize(data.size);
      });

      socket.on('presence:update', (data: { queueSize?: number }) => {
        if (typeof data.queueSize === 'number') setQueueSize(data.queueSize);
      });

      // Event-bus broadcast: { type: 'match.found', payload: { vibeId, userAId, userBId, ... } }
      socket.on('match:event', (event: any) => {
        if (!event || event.type !== 'match.found') return;
        const p = event.payload;
        if (!p || !p.vibeId) return;
        if (p.userAId !== myUserId && p.userBId !== myUserId) return;
        handleMatchFound(p);
      });

      // Direct emit from FlashWindowHandler.notifyMatch (defensive) —
      // notifyMatch sends `matchId`, the event-bus path sends `vibeId`
      socket.on('match:found', (p: any) => {
        if (!p || (!p.vibeId && !p.matchId)) return;
        if (p.userAId !== myUserId && p.userBId !== myUserId) return;
        handleMatchFound({ ...p, vibeId: p.vibeId || p.matchId });
      });

      socket.on('connect_error', (err) => {
        console.error('[FlashSocket] Connection error:', err.message);
      });

      setIsInQueue(true);
      showInfo('In the queue', 'The match engine is scanning your area…');
    } catch (e: any) {
      showError('Could not join', e?.message || 'Please try again.');
    } finally {
      setJoining(false);
    }
  };

  const leaveQueue = async () => {
    const socket = socketRef.current;
    if (socket?.connected) {
      socket.emit('window:leave', { windowId, h3Index: h3Ref.current });
    }
    socket?.disconnect();
    socketRef.current = null;
    setIsInQueue(false);
    setQueueSize(0);
    try {
      await api.leaveWindow(windowId);
    } catch {
      // Non-fatal — presence cleanup also happens on socket disconnect
    }
    navigation.navigate('FlashCountdown');
  };

  // Cleanup on unmount — leave the window room unless a match was found
  useEffect(() => {
    return () => {
      const socket = socketRef.current;
      if (socket) {
        if (socket.connected && !matchedRef.current) {
          socket.emit('window:leave', { windowId, h3Index: h3Ref.current });
        }
        socket.disconnect();
      }
      socketRef.current = null;
    };
  }, [windowId]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Live Radar</Text>
        <View style={styles.queueBadge}>
          <Text style={styles.queueText}>{isInQueue ? `${queueSize} in queue` : 'Not in queue'}</Text>
        </View>
      </View>

      <View style={styles.radarContainer}>
        <Animated.View style={[styles.radarRing, { opacity: pulseAnim }]} />
        <Animated.View style={[styles.radarSweep, { transform: [{ rotate: rotation }] }]}>
          <View style={styles.radarSweepFill} />
        </Animated.View>
        <View style={styles.radarCenter}>
          <View style={styles.centerDot} />
        </View>
        {isInQueue && [0, 1, 2, 3, 4].map((i) => (
          <Animated.View
            key={i}
            style={[
              styles.blip,
              {
                left: RADAR_SIZE / 2 + Math.cos((i * 72 * Math.PI) / 180) * 80,
                top: RADAR_SIZE / 2 + Math.sin((i * 72 * Math.PI) / 180) * 80,
                opacity: Animated.multiply(pulseAnim, 0.5 + Math.random() * 0.5),
              },
            ]}
          />
        ))}
      </View>

      <View style={styles.info}>
        {isInQueue ? (
          <>
            <Text style={styles.matchingText}>Searching for your match...</Text>
            <Text style={styles.avgText}>
              {queueSize > 0 ? `${queueSize} people live in your area` : 'Waiting for more people to join…'}
            </Text>
            <Button title="Leave Queue" onPress={leaveQueue} variant="outline" />
          </>
        ) : (
          <>
            <Text style={styles.matchingText}>Tap to enter the Flash Window</Text>
            <Text style={styles.avgText}>You'll be matched live for a 3-minute Vibe Check</Text>
            <Button
              title="Enter Queue"
              onPress={enterQueue}
              loading={joining}
              fullWidth
              icon={<Ionicons name="flash-outline" size={20} color={colors.textPrimary} />}
            />
          </>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.radarBg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xxl, paddingTop: spacing.lg },
  title: { ...typography.h2, color: colors.textPrimary },
  queueBadge: { backgroundColor: colors.surfaceHighlight, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, borderRadius: radius.full },
  queueText: { ...typography.body2, color: colors.textPrimary },
  radarContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  radarRing: { width: RADAR_SIZE, height: RADAR_SIZE, borderRadius: RADAR_SIZE / 2, borderWidth: 2, borderColor: colors.radarRing, position: 'absolute' },
  radarSweep: { width: RADAR_SIZE, height: RADAR_SIZE, borderRadius: RADAR_SIZE / 2, overflow: 'hidden', position: 'absolute' },
  radarSweepFill: { flex: 1, borderTopLeftRadius: RADAR_SIZE / 2, borderTopRightRadius: RADAR_SIZE / 2, opacity: 0.15, backgroundColor: colors.textPrimary },
  radarCenter: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', position: 'absolute' },
  centerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textPrimary },
  blip: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.vibeActive, position: 'absolute' },
  info: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.huge, alignItems: 'center' },
  matchingText: { ...typography.h4, color: colors.textPrimary, marginBottom: spacing.sm, textAlign: 'center' },
  avgText: { ...typography.body2, color: colors.textSecondary, marginBottom: spacing.xl, textAlign: 'center' },
});

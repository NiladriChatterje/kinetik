import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, Image, TouchableOpacity, Modal,
  Animated, Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import {
  onCallEvent,
  emitCallAccept,
  emitCallDecline,
  CallInvitePayload,
} from '../../services/callSocket';
import { resolveUrl } from '../../config';
import { colors, typography, spacing } from '../../theme';

const RING_TIMEOUT_MS = 45000; // auto-dismiss ringing after 45s

/**
 * Global incoming-call overlay. Rendered once inside the NavigationContainer
 * (in RootNavigator). Subscribes to `call:invite` on the shared call socket —
 * which is connected for the whole authenticated session — so a call can be
 * received on ANY screen. Shows a WhatsApp-style accept/decline sheet.
 */
interface Props {
  navigationRef: NavigationContainerRefWithCurrent<any>;
}

export function IncomingCallOverlay({ navigationRef }: Props): React.ReactElement | null {
  const [invite, setInvite] = useState<CallInvitePayload | null>(null);
  const pulse = useRef(new Animated.Value(0)).current;
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pulse animation while ringing
  useEffect(() => {
    if (!invite) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1200,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [invite]);

  // Ringing timeout — silently dismiss if never answered
  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (invite) {
      timeoutRef.current = setTimeout(() => setInvite(null), RING_TIMEOUT_MS);
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [invite]);

  // ─── Subscribe to call signaling events ────────────────
  useEffect(() => {
    const offInvite = onCallEvent('call:invite', (data: CallInvitePayload) => {
      setInvite(data);
    });
    // Caller hung up while ringing — dismiss
    const offCancel = onCallEvent('call:cancel', (data: { matchId: string }) => {
      setInvite((cur: CallInvitePayload | null) =>
        cur && cur.matchId === data.matchId ? null : cur,
      );
    });
    return () => {
      offInvite();
      offCancel();
    };
  }, []);

  const handleAccept = useCallback(() => {
    if (!invite) return;
    emitCallAccept(invite.matchId, invite.callerId);
    const payload = invite;
    setInvite(null);
    if (navigationRef.current?.isReady()) {
      navigationRef.current.navigate('Call', {
        matchId: payload.matchId,
        partnerName: payload.callerName,
        partnerPhotoUrl: payload.callerPhotoUrl,
        partnerId: payload.callerId,
        mode: 'callee',
      });
    }
  }, [invite, navigationRef]);

  const handleDecline = useCallback(() => {
    if (!invite) return;
    emitCallDecline(invite.matchId, invite.callerId);
    setInvite(null);
  }, [invite]);

  if (!invite) return null;

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] });

  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent>
      <View style={styles.overlay}>
        {/* Animated ring behind the avatar */}
        <View style={styles.avatarZone}>
          <Animated.View
            style={[styles.pulseRing, { transform: [{ scale }], opacity }]}
          />
          <View style={styles.avatarWrap}>
            {invite.callerPhotoUrl ? (
              <Image
                source={{ uri: resolveUrl(invite.callerPhotoUrl) }}
                style={styles.avatar}
              />
            ) : (
              <Ionicons name="person" size={56} color={colors.textMuted} />
            )}
          </View>
        </View>

        <Text style={styles.callerName}>{invite.callerName || 'Someone'}</Text>
        <Text style={styles.callingText}>Incoming video call…</Text>
        <Text style={styles.hint}>1:1 private call</Text>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.declineBtn} onPress={handleDecline} activeOpacity={0.8}>
            <Ionicons name="call" size={30} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
            <Text style={styles.actionLabel}>Decline</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.acceptBtn} onPress={handleAccept} activeOpacity={0.8}>
            <Ionicons name="call" size={30} color="#fff" />
            <Text style={styles.actionLabel}>Accept</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(10, 10, 15, 0.96)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  avatarZone: {
    width: 180,
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  pulseRing: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: colors.primary,
  },
  avatarWrap: {
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: colors.primary,
  },
  avatar: { width: 130, height: 130, borderRadius: 65 },
  callerName: {
    ...typography.h1,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  callingText: {
    ...typography.h3,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    width: '100%',
    marginTop: spacing.huge,
  },
  declineBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#E53935',
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#22A55C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    ...typography.caption,
    color: colors.textInverse,
    marginTop: spacing.sm,
  },
});

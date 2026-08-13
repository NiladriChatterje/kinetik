import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Room, RoomEvent, Track } from 'livekit-client';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import {
  onCallEvent,
  emitCallInvite,
  emitCallCancel,
  emitJoinActiveCall,
  emitLeaveActiveCall,
} from '../../services/callSocket';
import { resolveUrl } from '../../config';
import { colors, typography, spacing, radius } from '../../theme';

interface Props {
  navigation: any;
  route: any;
}

type CallPhase =
  | 'ringing'      // caller: waiting for accept/decline
  | 'connecting'   // fetching token + joining LiveKit room
  | 'active'       // in the call
  | 'declined'     // callee declined
  | 'noAnswer'     // ringing timed out
  | 'busy'         // callee already in another call
  | 'error';       // failed to start

const RING_TIMEOUT_MS = 45000; // aligned with the overlay's ring timeout

/**
 * VideoView from @livekit/react-native requires the react-native-webrtc native
 * module, which only ships in development/production builds — not Expo Go.
 * Importing it statically would crash the whole app at module load (this screen
 * is on the boot path via RootNavigator), so lazy-load it on first render and
 * render nothing when it's unavailable.
 */
function LiveKitVideoView(props: { videoTrack: any; style: any; mirror?: boolean }) {
  const [VideoView, setVideoView] = useState<React.ComponentType<any> | null>(null);

  useEffect(() => {
    let mounted = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { VideoView } = require('@livekit/react-native');
      if (mounted) setVideoView(() => VideoView);
    } catch (e) {
      console.warn('[webrtc] LiveKit unavailable — video preview disabled:', e);
    }
    return () => {
      mounted = false;
    };
  }, []);

  if (!VideoView) return null;
  return <VideoView {...props} />;
}

export const CallScreen: React.FC<Props> = ({ navigation, route }) => {
  const { matchId, partnerName: pName, partnerPhotoUrl: pPhoto, partnerId, mode } = route.params || {};
  const partnerName = pName || 'Stranger';
  const isCaller = mode === 'caller';
  const authUser = useAuthStore((s) => s.user);

  const [phase, setPhase] = useState<CallPhase>(isCaller ? 'ringing' : 'connecting');
  const [error, setError] = useState<string | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [camEnabled, setCamEnabled] = useState(true);
  const [localTrack, setLocalTrack] = useState<any>(null);
  const [remoteTrack, setRemoteTrack] = useState<any>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [partnerLeft, setPartnerLeft] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endedRef = useRef(false);
  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invitedRef = useRef(false);
  const startedRef = useRef(false);

  // ─── Mark this user as in an active call while this screen is mounted ─
  // The server replies `call:busy` to anyone else who rings this user.
  useEffect(() => {
    emitJoinActiveCall();
    return () => emitLeaveActiveCall();
  }, []);

  // ─── Caller: ring the partner via the shared call socket ─
  useEffect(() => {
    if (!isCaller || invitedRef.current) return;
    invitedRef.current = true;

    // Fetch own photo (best-effort) for the invite payload
    (async () => {
      let photo = '';
      try {
        const res = await api.getPhotos();
        if (res.success && Array.isArray(res.data) && res.data.length > 0) {
          photo = res.data[0]?.url || '';
        }
      } catch {
        // fall back to no photo
      }
      emitCallInvite(matchId, partnerId || '', authUser?.displayName || 'Someone', photo || undefined);
    })();

    // No answer after the ring window
    ringTimerRef.current = setTimeout(() => {
      ringTimerRef.current = null;
      if (!endedRef.current) {
        endedRef.current = true;
        emitCallCancel(matchId, partnerId || '');
        setPhase('noAnswer');
      }
    }, RING_TIMEOUT_MS);

    return () => {
      // Caller left while still ringing (e.g. hardware back) — cancel the call
      // so the callee's overlay dismisses instead of ringing until timeout.
      if (ringTimerRef.current) {
        clearTimeout(ringTimerRef.current);
        ringTimerRef.current = null;
        emitCallCancel(matchId, partnerId || '');
      }
    };
  }, [isCaller, matchId, partnerId, authUser?.displayName]);

  // ─── Listen for accept / decline / cancel ─────────────
  useEffect(() => {
    if (!isCaller) return;

    const offAccept = onCallEvent('call:accept', (data: any) => {
      if (data.matchId === matchId && !endedRef.current) {
        if (ringTimerRef.current) {
          clearTimeout(ringTimerRef.current);
          ringTimerRef.current = null;
        }
        setPhase('connecting');
        startCall();
      }
    });
    const offDecline = onCallEvent('call:decline', (data: any) => {
      if (data.matchId === matchId && !endedRef.current) {
        endedRef.current = true;
        setPhase('declined');
      }
    });
    const offBusy = onCallEvent('call:busy', (data: any) => {
      if (data.matchId === matchId && !endedRef.current) {
        endedRef.current = true;
        if (ringTimerRef.current) {
          clearTimeout(ringTimerRef.current);
          ringTimerRef.current = null;
        }
        setPhase('busy');
      }
    });
    return () => {
      offAccept();
      offDecline();
      offBusy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCaller, matchId]);

  // ─── Callee: join the room immediately (accept already sent) ─
  useEffect(() => {
    if (isCaller) return;
    startCall();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Callee: if the caller cancelled before we connected, back out ─
  useEffect(() => {
    if (isCaller) return;
    const offCancel = onCallEvent('call:cancel', (data: any) => {
      if (data.matchId === matchId && !endedRef.current && phase === 'connecting') {
        endedRef.current = true;
        navigation.goBack();
      }
    });
    return () => offCancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCaller, matchId, phase]);

  // ─── Fetch token + connect to the private 1:1 LiveKit room ─
  const startCall = useCallback(async () => {
    // Guard against re-entry (double accept event, dev StrictMode double-effects)
    if (startedRef.current) return;
    startedRef.current = true;
    try {
      const res = await api.getCallToken(matchId);
      if (!res.success || !res.data) {
        throw new Error(res.error?.message || 'Could not start the call');
      }
      const { url, token } = res.data;

      const room = new Room();
      roomRef.current = room;

      room.on(RoomEvent.TrackSubscribed, (track: any) => {
        if (track.kind === 'video' && !endedRef.current) setRemoteTrack(track);
      });
      room.on(RoomEvent.TrackUnsubscribed, (track: any) => {
        setRemoteTrack((cur: any) => (cur === track ? null : cur));
      });
      room.on(RoomEvent.ParticipantDisconnected, (participant: any) => {
        if (!endedRef.current && !participant.isLocal) {
          setRemoteTrack(null);
          setPartnerLeft(true);
          if (durationTimerRef.current) {
            clearInterval(durationTimerRef.current);
            durationTimerRef.current = null;
          }
        }
      });
      room.on(RoomEvent.Disconnected, () => {
        if (!endedRef.current) navigation.goBack();
      });

      await room.connect(url, token);
      await room.localParticipant.setCameraEnabled(true);
      await room.localParticipant.setMicrophoneEnabled(true);

      const localPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (localPub?.videoTrack && !endedRef.current) {
        setLocalTrack(localPub.videoTrack);
      }

      if (!endedRef.current) {
        setPhase('active');
        durationTimerRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
      }
    } catch (e: any) {
      if (!endedRef.current) {
        setError(e?.message || 'Call failed');
        setPhase('error');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, navigation]);

  // ─── Cleanup on unmount ───────────────────────────────
  useEffect(() => {
    return () => {
      endedRef.current = true;
      if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
        durationTimerRef.current = null;
      }
      roomRef.current?.disconnect();
      roomRef.current = null;
    };
  }, []);

  const cancelRinging = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    if (ringTimerRef.current) {
      clearTimeout(ringTimerRef.current);
      ringTimerRef.current = null;
    }
    emitCallCancel(matchId, partnerId || '');
    navigation.goBack();
  }, [matchId, partnerId, navigation]);

  const toggleMic = async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !micMuted;
    setMicMuted(next);
    await room.localParticipant.setMicrophoneEnabled(!next);
  };

  const toggleCam = async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !camEnabled;
    setCamEnabled(next);
    await room.localParticipant.setCameraEnabled(next);
    if (!next) setLocalTrack(null);
  };

  const endCall = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    roomRef.current?.disconnect();
    navigation.goBack();
  }, [navigation]);

  const durationStr =
    `${String(Math.floor(callDuration / 60)).padStart(2, '0')}:` +
    `${String(callDuration % 60).padStart(2, '0')}`;

  // ─── Ringing UI (caller) ─────────────────────────────
  if (phase === 'ringing') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerOverlay}>
          <View style={styles.ringAvatarWrap}>
            {pPhoto ? (
              <Image source={{ uri: resolveUrl(pPhoto) }} style={styles.ringAvatar} />
            ) : (
              <Ionicons name="person" size={64} color={colors.textMuted} />
            )}
          </View>
          <Text style={styles.ringName}>{partnerName}</Text>
          <Text style={styles.ringStatus}>Ringing…</Text>

          <TouchableOpacity style={styles.cancelBtn} onPress={cancelRinging} activeOpacity={0.8}>
            <Ionicons name="call" size={30} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
          </TouchableOpacity>
          <Text style={styles.cancelLabel}>Cancel</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Declined / no answer / busy ─────────────────────
  if (phase === 'declined' || phase === 'noAnswer' || phase === 'busy') {
    const busy = phase === 'busy';
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerOverlay}>
          <Ionicons
            name="call-outline"
            size={48}
            color={busy ? colors.textMuted : phase === 'declined' ? colors.error : colors.textMuted}
          />
          <Text style={styles.centerText}>
            {busy
              ? `${partnerName} is in another call`
              : phase === 'declined'
                ? `${partnerName} declined the call`
                : 'No answer'}
          </Text>
          <TouchableOpacity style={styles.errorBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.errorBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Error ───────────────────────────────────────────
  if (phase === 'error') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerOverlay}>
          <Ionicons name="call-outline" size={48} color={colors.error} />
          <Text style={styles.centerText}>{error}</Text>
          <TouchableOpacity style={styles.errorBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.errorBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Connecting / active ─────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      {/* Remote video (full screen) */}
      <View style={styles.remoteArea}>
        {remoteTrack ? (
          <LiveKitVideoView videoTrack={remoteTrack} style={styles.remoteVideo} />
        ) : (
          <View style={styles.remotePlaceholder}>
            <View style={styles.remoteAvatarWrap}>
              {pPhoto ? (
                <Image source={{ uri: resolveUrl(pPhoto) }} style={styles.remoteAvatar} />
              ) : (
                <Ionicons name="person" size={72} color={colors.textMuted} />
              )}
            </View>
            <Text style={styles.remoteName}>{partnerName}</Text>
            <Text style={styles.remoteStatus}>
              {phase === 'connecting' ? 'Connecting…' : 'Connected'}
            </Text>
          </View>
        )}
      </View>

      {/* Local preview (picture-in-picture) */}
      {phase === 'active' && (
        <View style={styles.localPip}>
          {localTrack ? (
            <LiveKitVideoView videoTrack={localTrack} style={styles.localVideo} mirror />
          ) : (
            <View style={[styles.localVideo, styles.localVideoOff]}>
              <Ionicons name="videocam-off-outline" size={20} color={colors.textMuted} />
            </View>
          )}
        </View>
      )}

      {/* Connecting overlay */}
      {phase === 'connecting' && (
        <View style={styles.centerOverlay}>
          <ActivityIndicator size="large" color={colors.textPrimary} />
          <Text style={styles.centerText}>Connecting to {partnerName}…</Text>
        </View>
      )}

      {/* Partner left the call */}
      {phase === 'active' && partnerLeft && (
        <View style={styles.centerOverlay}>
          <Ionicons name="call-outline" size={48} color={colors.textMuted} />
          <Text style={styles.centerText}>{partnerName} left the call</Text>
          <TouchableOpacity style={styles.errorBtn} onPress={endCall}>
            <Text style={styles.errorBtnText}>End call</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Controls */}
      {phase === 'active' && !partnerLeft && (
        <View style={styles.controls}>
          <Text style={styles.duration}>{durationStr}</Text>
          <View style={styles.controlsRow}>
            <TouchableOpacity style={styles.controlBtn} onPress={toggleMic}>
              <Ionicons
                name={micMuted ? 'mic-off' : 'mic'}
                size={26}
                color={micMuted ? colors.textMuted : colors.textPrimary}
              />
              <Text style={styles.controlLabel}>{micMuted ? 'Unmute' : 'Mute'}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.controlBtn, styles.endBtn]} onPress={endCall}>
              <Ionicons name="call" size={26} color={colors.textInverse} />
              <Text style={[styles.controlLabel, styles.endLabel]}>End</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.controlBtn} onPress={toggleCam}>
              <Ionicons
                name={camEnabled ? 'videocam' : 'videocam-off'}
                size={26}
                color={camEnabled ? colors.textPrimary : colors.textMuted}
              />
              <Text style={styles.controlLabel}>{camEnabled ? 'Camera' : 'Cam off'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  remoteArea: { flex: 1, backgroundColor: '#000' },
  remoteVideo: { flex: 1 },
  remotePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  remoteAvatarWrap: {
    width: 140, height: 140, borderRadius: 70,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  remoteAvatar: { width: 140, height: 140, borderRadius: 70 },
  remoteName: { ...typography.h3, color: '#fff', marginTop: spacing.lg },
  remoteStatus: { ...typography.body2, color: '#999', marginTop: spacing.xs },

  localPip: {
    position: 'absolute',
    top: 60,
    right: spacing.lg,
    width: 110,
    height: 160,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
    zIndex: 10,
  },
  localVideo: { flex: 1 },
  localVideoOff: { backgroundColor: '#222', alignItems: 'center', justifyContent: 'center' },

  centerOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#000',
    alignItems: 'center', justifyContent: 'center',
    gap: spacing.md,
  },
  centerText: { ...typography.body1, color: '#fff', textAlign: 'center', paddingHorizontal: spacing.xxl },

  errorBtn: {
    marginTop: spacing.lg,
    backgroundColor: colors.textPrimary,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
  },
  errorBtnText: { ...typography.button, color: colors.textInverse },

  // Ringing styles
  ringAvatarWrap: {
    width: 140, height: 140, borderRadius: 70,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    borderWidth: 2, borderColor: colors.primary,
  },
  ringAvatar: { width: 140, height: 140, borderRadius: 70 },
  ringName: { ...typography.h1, color: '#fff', marginTop: spacing.xl },
  ringStatus: { ...typography.body1, color: '#999', marginTop: spacing.xs },
  cancelBtn: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: '#E53935',
    alignItems: 'center', justifyContent: 'center',
    marginTop: spacing.huge,
  },
  cancelLabel: { ...typography.caption, color: '#ccc', marginTop: spacing.sm },

  controls: { paddingBottom: spacing.huge, paddingHorizontal: spacing.xxl, alignItems: 'center' },
  duration: { ...typography.caption, color: '#999', marginBottom: spacing.lg },
  controlsRow: { flexDirection: 'row', justifyContent: 'space-evenly', width: '100%' },
  controlBtn: { alignItems: 'center', gap: spacing.xs },
  controlLabel: { ...typography.caption, color: '#ccc' },
  endBtn: {
    backgroundColor: '#E53935',
    width: 64, height: 64, borderRadius: 32,
    alignItems: 'center', justifyContent: 'center',
    marginTop: -18,
  },
  endLabel: { color: '#fff' },
});

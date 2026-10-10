import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Image, ActivityIndicator, Dimensions, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useIsFocused } from '@react-navigation/native';
import * as ImageManipulator from 'expo-image-manipulator';
import { Button } from '../../components/common/Button';
import { StepLabel } from '../../components/common/StepLabel';
import { useToast } from '../../hooks/useToast';
import { useAuthStore } from '../../store/authStore';
import { markWelcomePending } from '../../services/welcomeNotice';
import { api } from '../../services/api';
import { resolveUrl, PRODUCTION_FACE_VERIFICATION } from '../../config';
import { embedProfilePhotos, verifySelfie, MIN_PROFILE_FACES } from '../../services/faceVerification';
import { hapticSuccess } from '../../utils/haptics';
import { colors, typography, spacing, radius } from '../../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
/** Camera box: full width, and at most 9:16 tall (it shrinks to fit shorter screens) */
const CAMERA_WIDTH = SCREEN_WIDTH - spacing.xxl * 2;
const CAMERA_HEIGHT = Math.round(CAMERA_WIDTH * (16 / 9));

type Phase = 'camera' | 'preview' | 'uploading' | 'success';

/** How much of the camera's zoom range (0–1) one full pinch spread covers */
const PINCH_ZOOM_SPEED = 0.4;

export const FaceVerificationScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>('camera');
  const [verified, setVerified] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);
  const [blocked, setBlocked] = useState(false);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0);
  const cameraRef = useRef<any>(null);
  const pinchStartZoomRef = useRef(0);
  const toast = useToast();
  // This screen stays mounted under KYC; release the camera while it is hidden
  const isFocused = useIsFocused();
  const goBack = useCallback(() => navigation.goBack(), [navigation]);

  // Instagram-style pinch-to-zoom on the front camera. expo-camera's `zoom`
  // is a 0–1 fraction of the device's max zoom; the pinch nudges it from
  // wherever the last pinch ended. runOnJS keeps the setState safe if
  // reanimated (which workletizes gesture callbacks) is ever added.
  const pinchGesture = Gesture.Pinch()
    .runOnJS(true)
    .onStart(() => {
      pinchStartZoomRef.current = zoom;
    })
    .onUpdate((e) => {
      const next = pinchStartZoomRef.current + (e.scale - 1) * PINCH_ZOOM_SPEED;
      setZoom(Math.max(0, Math.min(1, next)));
    });

  // Profile photo face embeddings, precomputed on-device while the user
  // lines up their selfie. null = still loading (or failed — treated as empty).
  const profileEmbeddingsRef = useRef<Promise<Float32Array[]> | null>(null);

  useEffect(() => {
    profileEmbeddingsRef.current = (async () => {
      try {
        const photosRes = await api.getPhotos();
        const urls: string[] = Array.isArray(photosRes.data)
          ? (photosRes.data as any[]).map((p) => resolveUrl(p.url)).filter(Boolean)
          : [];
        return await embedProfilePhotos(urls);
      } catch (err) {
        console.warn('[face] Failed to prepare profile embeddings:', err);
        return [];
      }
    })();
  }, []);

  /**
   * Capture a selfie from the front camera, compress it, and move to preview.
   */
  const handleCapture = useCallback(async () => {
    if (!cameraRef.current) return;

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.9,
        skipProcessing: true,
      });

      if (!photo?.uri) {
        toast.showError('Capture failed', 'Try again.');
        return;
      }

      // Compress and resize the captured selfie
      const manipulated = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ resize: { width: 800 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
      );

      setCapturedUri(manipulated.uri);
      setPhase('preview');
    } catch (err: any) {
      toast.showError('Capture failed', err?.message || 'Try again.');
    }
  }, [toast]);

  /**
   * Verify the captured selfie on-device against the user's profile photos
   * (face detection + MobileFaceNet embeddings), then self-report the result
   * to the backend. The selfie never leaves the device.
   */
  const handleConfirm = useCallback(async () => {
    if (!capturedUri) return;

    setPhase('uploading');
    let isVerified = false;
    try {
      const profileEmbeddings = (await profileEmbeddingsRef.current) ?? [];
      const result = await verifySelfie(capturedUri, profileEmbeddings);
      isVerified = result.verified;
      setReasons(result.rejectionReasons);

      // Enforce only a mismatch the user can fix by retaking. Too few profile
      // photos with faces is not retakeable — blocking on it would dead-end.
      const retakeable = result.profileFacesDetected >= MIN_PROFILE_FACES;
      setBlocked(PRODUCTION_FACE_VERIFICATION && !result.verified && retakeable);

      if (result.verified) {
        hapticSuccess();
        toast.showSuccess('Face verified!', 'Selfie matches your photos.');
      } else {
        console.log('[face] Not verified:', result.rejectionReasons.join('; '));
        if (PRODUCTION_FACE_VERIFICATION && retakeable) {
          toast.showError('Face not matched', 'Retake your selfie to continue.');
        } else {
          toast.showSuccess('Selfie submitted', 'Continue onboarding.');
        }
      }

      // Self-report the on-device result (fire-and-forget on failure)
      api
        .reportFaceVerification({ verified: result.verified, confidence: result.confidence })
        .catch((err) => console.warn('[face] Failed to report verification:', err));
    } catch (err: any) {
      // A technical failure never blocks, even under PRODUCTION_FACE_VERIFICATION — a
      // broken model or unlinked ML Kit must not stop every signup.
      console.warn('[face] On-device verification failed:', err?.message || err);
      setReasons([`Check failed: ${err?.message || 'unknown error'}`]);
      setBlocked(false);
      toast.showSuccess(
        'Selfie Submitted',
        'You can continue with onboarding.',
      );
    }
    setVerified(isVerified);
    setPhase('success');
  }, [capturedUri, toast]);

  /**
   * Retake — go back to camera phase.
   */
  const handleRetake = useCallback(() => {
    setCapturedUri(null);
    setZoom(0);
    setReasons([]);
    setBlocked(false);
    setPhase('camera');
  }, []);

  /**
   * Finish onboarding. The selfie is the last step while the KYC step is
   * commented out (see navigation/onboardingFlow.ts).
   */
  const handleContinue = useCallback(async () => {
    // await api.updateOnboardingStep('face');
    // navigation.navigate('KYC');
    const res = await api.updateOnboardingStep('complete');
    if (!res?.success) {
      toast.showError('Could not finish', res?.error?.message || 'Check your connection and try again.');
      return;
    }
    // Onboarding is done: show the one-time Welcome page before the app.
    // It stays pending until its Start Exploring button is tapped.
    const userId = useAuthStore.getState().user?.id;
    if (userId) await markWelcomePending(userId);
    useAuthStore.getState().setWelcomePending(true);
    useAuthStore.getState().setOnboardingStep('complete');
    navigation.getParent()?.reset({ index: 0, routes: [{ name: 'Welcome' }] });
  }, [navigation, toast]);

  /**
   * Skip the selfie and finish onboarding. Nothing is reported: a new account
   * starts unverified, so the profile shows the Face unverified tag.
   */
  const handleSkip = useCallback(() => {
    Alert.alert(
      'Skip face verification?',
      'Your profile will show a "Face unverified" tag to others.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Skip', onPress: handleContinue },
      ],
    );
  }, [handleContinue]);

  // ─── Permission states ──────────────────────────────────
  if (!permission) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.textPrimary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <StepLabel label="Step 5 of 5" onBack={goBack} />
          <Text style={styles.title}>Verify You're Real</Text>
          <Text style={styles.subtitle}>
            We need access to your camera to take a verification selfie.
          </Text>

          <View style={styles.cameraPlaceholder}>
            <Ionicons name="camera-outline" size={48} color={colors.textMuted} />
            <Text style={styles.placeholderText}>Camera access required</Text>
          </View>

          <Button title="Grant Camera Access" onPress={requestPermission} fullWidth />
          <Button title="Skip for now" variant="ghost" onPress={handleSkip} fullWidth style={styles.skipButton} />
        </View>
      </SafeAreaView>
    );
  }

  // ─── Success state ──────────────────────────────────────
  if (phase === 'success') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <StepLabel label="Step 5 of 5" onBack={goBack} />
          <Text style={styles.title}>Verify You're Real</Text>
          <Text style={styles.subtitle}>We match your selfie against the photos you uploaded</Text>

          <View style={styles.successContainer}>
            <Ionicons
              name={blocked ? 'alert-circle' : 'checkmark-circle'}
              size={64}
              color={colors.textPrimary}
            />
            <Text style={styles.successTitle}>
              {verified ? 'Face Verified!' : blocked ? 'Not Matched' : 'Selfie Submitted'}
            </Text>
            <Text style={styles.successSubtitle}>
              {verified
                ? 'Your selfie matches your profile photos.'
                : blocked
                  ? 'This selfie did not match your profile photos. Retake it to continue.'
                  : 'Your selfie has been submitted. You can continue with onboarding.'}
            </Text>
          </View>

          {!verified && reasons.length > 0 && (
            <View style={styles.reasonsBox}>
              <Text style={styles.reasonsTitle}>Why it didn't match</Text>
              {reasons.map((reason, i) => (
                <View key={i} style={styles.reasonRow}>
                  <Ionicons name="alert-circle-outline" size={14} color={colors.textMuted} />
                  <Text style={styles.reasonText}>{reason}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.footer}>
          {blocked ? (
            <>
              <Button title="Retake Selfie" onPress={handleRetake} fullWidth />
              <Button title="Skip for now" variant="ghost" onPress={handleSkip} fullWidth style={styles.skipButton} />
            </>
          ) : (
            <Button title="Continue" onPress={handleContinue} fullWidth />
          )}
        </View>
      </SafeAreaView>
    );
  }

  // ─── Uploading state ────────────────────────────────────
  if (phase === 'uploading') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <StepLabel label="Step 5 of 5" onBack={goBack} backDisabled />
          <Text style={styles.title}>Verify You're Real</Text>
          <Text style={styles.subtitle}>We match your selfie against the photos you uploaded</Text>

          <View style={styles.cameraContainer}>
            {capturedUri && (
              <Image source={{ uri: capturedUri }} style={[styles.capturedImage, styles.mirrored]} />
            )}
            <View style={styles.uploadOverlay}>
              <ActivityIndicator size="large" color={colors.textInverse} />
              <Text style={styles.uploadingText}>Verifying...</Text>
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Preview state ──────────────────────────────────────
  if (phase === 'preview') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <StepLabel label="Step 5 of 5" onBack={goBack} />
          <Text style={styles.title}>Verify You're Real</Text>
          <Text style={styles.subtitle}>Check your selfie before submitting</Text>

          <View style={styles.cameraContainer}>
            {/* Mirrored for DISPLAY only — matching the mirrored camera preview
                the user just saw; verification runs on the true (unmirrored) file */}
            {capturedUri && (
              <Image source={{ uri: capturedUri }} style={[styles.capturedImage, styles.mirrored]} />
            )}
          </View>

          <View style={styles.previewActions}>
            <TouchableOpacity style={styles.retakeButton} onPress={handleRetake}>
              <Ionicons name="refresh" size={20} color={colors.textPrimary} />
              <Text style={styles.retakeText}>Retake</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.footer}>
          <Button title="Use This Photo" onPress={handleConfirm} fullWidth />
        </View>
      </SafeAreaView>
    );
  }

  // ─── Camera phase (default) ─────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <StepLabel label="Step 5 of 5" onBack={goBack} />
        <Text style={styles.title}>Verify You're Real</Text>
        <Text style={styles.subtitle}>Take a clear selfie so we can match it to your photos</Text>

        <GestureDetector gesture={pinchGesture}>
          <View style={styles.cameraContainer}>
            {/* Mirror the front-camera preview so it behaves like a mirror */}
            {isFocused && (
              <CameraView
                ref={cameraRef}
                style={[styles.camera, { transform: [{ scaleX: -1 }] }]}
                facing="front"
                zoom={zoom}
              />
            )}

            {/* Zoom indicator — only while zoomed in */}
            {zoom > 0 && (
              <View style={styles.zoomBadge}>
                <Ionicons name="search" size={12} color={colors.textInverse} />
                <Text style={styles.zoomBadgeText}>{Math.round(zoom * 100)}%</Text>
              </View>
            )}

            {/* Capture instruction overlay */}
            <View style={styles.captureOverlay}>
              <Text style={styles.captureText}>Take a selfie</Text>
            </View>

            {/* Face guide frame */}
            <View style={styles.faceGuide}>
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
            </View>
          </View>
        </GestureDetector>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.captureButton} onPress={handleCapture}>
          <View style={styles.captureButtonInner} />
        </TouchableOpacity>
        <Text style={styles.captureHint}>Tap to capture</Text>
        <Button title="Skip for now" variant="ghost" onPress={handleSkip} fullWidth style={styles.skipButton} />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, paddingHorizontal: spacing.xxl, paddingTop: spacing.lg, paddingBottom: spacing.sm, alignItems: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Text
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm, alignSelf: 'flex-start' },
  subtitle: { ...typography.body1, color: colors.textSecondary, marginBottom: spacing.lg, alignSelf: 'flex-start' },

  // Camera placeholder (permission denied)
  // Both camera boxes are full width and take the height left between the
  // heading and the footer, up to 9:16, so the capture button always stays
  // on screen. The preview crops to fill whatever shape remains.
  cameraPlaceholder: {
    width: CAMERA_WIDTH,
    flex: 1,
    maxHeight: CAMERA_HEIGHT,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  placeholderText: { ...typography.body2, color: colors.textMuted, marginTop: spacing.md },

  // Camera
  cameraContainer: {
    width: CAMERA_WIDTH,
    flex: 1,
    maxHeight: CAMERA_HEIGHT,
    borderRadius: radius.xl,
    overflow: 'hidden',
    marginBottom: spacing.md,
    backgroundColor: colors.surfaceHighlight,
  },
  camera: {
    width: '100%',
    height: '100%',
  },

  // Zoom indicator
  zoomBadge: {
    position: 'absolute',
    top: spacing.md,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  zoomBadgeText: { ...typography.caption, color: colors.textInverse, fontWeight: '600' },

  // Capture instruction overlay
  captureOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: spacing.md,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  captureText: { ...typography.h3, color: colors.textInverse },

  // Face guide corners — centered in the 9:16 frame
  faceGuide: {
    position: 'absolute',
    top: '18%',
    left: '18%',
    right: '18%',
    bottom: '25%',
  },
  corner: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: colors.textInverse,
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },

  // Captured image
  capturedImage: {
    width: '100%',
    height: '100%',
    borderRadius: radius.xl,
  },
  // Front-camera selfies are shown mirrored, like the live preview was —
  // otherwise the photo looks "flipped" compared to what the user lined up
  mirrored: {
    transform: [{ scaleX: -1 }],
  },

  // Upload overlay
  uploadOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  uploadingText: { ...typography.body1, color: colors.textInverse },

  // Capture button
  captureButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  captureButtonInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.textPrimary,
  },
  captureHint: { ...typography.caption, color: colors.textMuted },

  // Success
  successContainer: {
    alignItems: 'center',
    marginTop: spacing.huge,
    gap: spacing.md,
  },
  successTitle: { ...typography.h2, color: colors.textPrimary },
  successSubtitle: { ...typography.body1, color: colors.textSecondary, textAlign: 'center' },

  // Rejection reasons — surfaced so a failed match is diagnosable
  reasonsBox: {
    alignSelf: 'stretch',
    marginTop: spacing.xxl,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  reasonsTitle: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.xs },
  reasonRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  reasonText: { ...typography.caption, color: colors.textSecondary, flex: 1 },

  // Preview actions
  previewActions: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  retakeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceHighlight,
  },
  retakeText: { ...typography.body2, color: colors.textPrimary, fontWeight: '600' },

  skipButton: { marginTop: spacing.sm },

  // Footer
  footer: { paddingHorizontal: spacing.xxl, paddingTop: spacing.sm, paddingBottom: spacing.lg, alignItems: 'center' },
});

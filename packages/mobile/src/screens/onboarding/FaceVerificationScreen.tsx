import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Image, ActivityIndicator, Dimensions, Alert, ScrollView,
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
import { resolveUrl } from '../../config';
import {
  embedProfilePhotos, verifySelfie, MIN_PROFILE_FACES, MIN_MATCH_THRESHOLD,
  FACE_ISSUE_TIPS, FaceIssue, ProfileEmbeddings,
} from '../../services/faceVerification';
import { hapticSuccess } from '../../utils/haptics';
import { colors, typography, spacing, radius } from '../../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
/** Camera box: full width, and at most 9:16 tall (it shrinks to fit shorter screens) */
const CAMERA_WIDTH = SCREEN_WIDTH - spacing.xxl * 2;
const CAMERA_HEIGHT = Math.round(CAMERA_WIDTH * (16 / 9));

type Phase = 'camera' | 'preview' | 'uploading' | 'result';

/**
 * What the result page shows. Every outcome but `matched` offers a way to try
 * again and Skip for now, so the step never dead-ends. Technical details stay
 * in the logs; the user only ever sees plain language.
 */
type Outcome =
  | { kind: 'matched'; confidence: number }
  | { kind: 'mismatch'; confidence: number; issues: FaceIssue[] } // fixable by a retake
  | { kind: 'no_face' } // no face in the selfie
  | { kind: 'photos'; found: number } // too few profile photos with a face
  | { kind: 'error' }; // the check itself failed (network, model, ML Kit)

const toPercent = (confidence: number) => Math.round(confidence * 100);

/** How much of the camera's zoom range (0–1) one full pinch spread covers */
const PINCH_ZOOM_SPEED = 0.4;

export const FaceVerificationScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>('camera');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
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
  // lines up their selfie. Never rejects: a failure comes back incomplete.
  const profileEmbeddingsRef = useRef<Promise<ProfileEmbeddings> | null>(null);

  const prepareProfileEmbeddings = useCallback(() => {
    const pending = (async (): Promise<ProfileEmbeddings> => {
      try {
        const photosRes = await api.getPhotos();
        if (!photosRes.success || !Array.isArray(photosRes.data)) {
          console.warn('[face] Could not load profile photos:', photosRes.error?.code);
          return { embeddings: [], incomplete: true };
        }
        const urls: string[] = (photosRes.data as any[]).map((p) => resolveUrl(p.url)).filter(Boolean);
        return await embedProfilePhotos(urls);
      } catch (err) {
        console.warn('[face] Failed to prepare profile embeddings:', err);
        return { embeddings: [], incomplete: true };
      }
    })();
    profileEmbeddingsRef.current = pending;
    return pending;
  }, []);

  useEffect(() => {
    prepareProfileEmbeddings();
  }, [prepareProfileEmbeddings]);

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
      console.warn('[face] Selfie capture failed:', err?.message || err);
      toast.showError('Capture failed', 'Try again.');
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
    let next: Outcome;
    try {
      const profiles = await (profileEmbeddingsRef.current ?? prepareProfileEmbeddings());
      const result = await verifySelfie(capturedUri, profiles.embeddings);
      const fewPhotos = result.issues.includes('few_profile_faces');

      if (fewPhotos && profiles.incomplete) {
        // A photo that failed to load may well show a face: retry, don't
        // tell the user their photos are the problem
        throw new Error('Profile photos could not all be processed');
      }

      if (result.verified) {
        next = { kind: 'matched', confidence: result.confidence };
        hapticSuccess();
        toast.showSuccess('Face verified!', 'Selfie matches your photos.');
      } else if (fewPhotos) {
        next = { kind: 'photos', found: result.profileFacesDetected };
      } else if (!result.faceDetectedInSelfie) {
        next = { kind: 'no_face' };
      } else {
        next = { kind: 'mismatch', confidence: result.confidence, issues: result.issues };
      }
      if (!result.verified) console.log('[face] Not verified:', result.issues.join(', '), result.confidence);

      // Self-report the on-device result (fire-and-forget on failure)
      api
        .reportFaceVerification({ verified: result.verified, confidence: result.confidence })
        .catch((err) => console.warn('[face] Failed to report verification:', err));
    } catch (err: any) {
      // The details stay in the log; the user gets Try Again or Skip
      console.warn('[face] On-device verification failed:', err?.message || err);
      next = { kind: 'error' };
    }
    setOutcome(next);
    setPhase('result');
  }, [capturedUri, prepareProfileEmbeddings, toast]);

  /**
   * Retake — go back to camera phase.
   */
  const handleRetake = useCallback(() => {
    setCapturedUri(null);
    setZoom(0);
    setOutcome(null);
    setPhase('camera');
  }, []);

  /**
   * After a technical failure: reload the profile photos (the failure may
   * have been there) and take a fresh selfie.
   */
  const handleTryAgain = useCallback(() => {
    prepareProfileEmbeddings();
    handleRetake();
  }, [prepareProfileEmbeddings, handleRetake]);

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
   * Skip the selfie and finish onboarding. The skip is recorded first so the
   * profile shows the Face unverified tag, even if an earlier selfie matched
   * (the user may have changed their photos since). Onboarding only finishes
   * once the server has it, like Continue.
   */
  const confirmSkip = useCallback(async () => {
    const res = await api.reportFaceVerification({ verified: false, skipped: true });
    if (!res?.success) {
      toast.showError('Could not finish', res?.error?.message || 'Check your connection and try again.');
      return;
    }
    await handleContinue();
  }, [handleContinue, toast]);

  const handleSkip = useCallback(() => {
    Alert.alert(
      'Skip face verification?',
      'Your profile will show a "Face unverified" tag to others.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Skip', onPress: confirmSkip },
      ],
    );
  }, [confirmSkip]);

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

  // ─── Result state ───────────────────────────────────────
  if (phase === 'result' && outcome) {
    const matched = outcome.kind === 'matched';
    const showScore = outcome.kind === 'matched' || outcome.kind === 'mismatch';
    const needed = toPercent(MIN_MATCH_THRESHOLD);

    let title: string;
    let message: string;
    let tips: string[] = [];
    switch (outcome.kind) {
      case 'matched':
        title = 'Face Verified!';
        message = 'Your selfie matches your profile photos.';
        break;
      case 'mismatch':
        title = 'Not Matched';
        message = outcome.issues.includes('low_match')
          ? `Your selfie needs at least a ${needed}% match with your photos. Retake it, or skip for now.`
          : 'Your face matched, but the selfie needs a retake. Retake it, or skip for now.';
        tips = outcome.issues.map((issue) => FACE_ISSUE_TIPS[issue]);
        break;
      case 'no_face':
        title = 'No Face Found';
        message = "We couldn't see a face in your selfie. Retake it, or skip for now.";
        tips = [FACE_ISSUE_TIPS.no_face, FACE_ISSUE_TIPS.head_turned];
        break;
      case 'photos':
        title = 'Check Your Photos';
        message = outcome.found > 0
          ? `We found a clear face in only ${outcome.found} of your photos, and need at least ${MIN_PROFILE_FACES}. Add clearer photos of yourself, or skip for now.`
          : `We couldn't find a clear face in your photos, and need at least ${MIN_PROFILE_FACES}. Add clearer photos of yourself, or skip for now.`;
        tips = [FACE_ISSUE_TIPS.few_profile_faces];
        break;
      case 'error':
        title = "Couldn't Check Your Selfie";
        message = 'Something went wrong while checking your selfie. Try again, or skip for now.';
        break;
    }

    return (
      <SafeAreaView style={styles.container}>
        {/* Scrolls so the tips stay reachable on short screens */}
        <ScrollView style={styles.resultScroll} contentContainerStyle={styles.resultContent}>
          <StepLabel label="Step 5 of 5" onBack={goBack} />
          <Text style={styles.title}>Verify You're Real</Text>
          <Text style={styles.subtitle}>We match your selfie against the photos you uploaded</Text>

          <View style={styles.successContainer}>
            <Ionicons
              name={matched ? 'checkmark-circle' : 'alert-circle'}
              size={64}
              color={colors.textPrimary}
            />
            <Text style={styles.successTitle}>{title}</Text>
            {showScore && (
              <View style={styles.scoreRow}>
                <Text style={styles.scoreValue}>{toPercent(outcome.confidence)}%</Text>
                <Text style={styles.scoreLabel}>
                  {matched ? 'match' : `match · ${needed}% needed`}
                </Text>
              </View>
            )}
            <Text style={styles.successSubtitle}>{message}</Text>
          </View>

          {tips.length > 0 && (
            <View style={styles.reasonsBox}>
              <Text style={styles.reasonsTitle}>
                {outcome.kind === 'photos' ? 'What helps' : 'Tips for your next selfie'}
              </Text>
              {tips.map((tip) => (
                <View key={tip} style={styles.reasonRow}>
                  <Ionicons name="bulb-outline" size={14} color={colors.textMuted} />
                  <Text style={styles.reasonText}>{tip}</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>

        <View style={styles.footer}>
          {matched ? (
            <Button title="Continue" onPress={handleContinue} fullWidth />
          ) : (
            <>
              {outcome.kind === 'photos' ? (
                <Button title="Change Photos" onPress={goBack} fullWidth />
              ) : outcome.kind === 'error' ? (
                <Button title="Try Again" onPress={handleTryAgain} fullWidth />
              ) : (
                <Button title="Retake Selfie" onPress={handleRetake} fullWidth />
              )}
              <Button title="Skip for now" variant="ghost" onPress={handleSkip} fullWidth style={styles.skipButton} />
            </>
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

  // Result
  resultScroll: { flex: 1 },
  resultContent: { paddingHorizontal: spacing.xxl, paddingTop: spacing.lg, paddingBottom: spacing.sm, alignItems: 'center' },
  successContainer: {
    alignItems: 'center',
    marginTop: spacing.xxxl,
    gap: spacing.md,
  },
  successTitle: { ...typography.h2, color: colors.textPrimary },
  successSubtitle: { ...typography.body1, color: colors.textSecondary, textAlign: 'center' },
  scoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  scoreValue: { ...typography.h1, color: colors.textPrimary },
  scoreLabel: { ...typography.body2, color: colors.textSecondary },

  // Plain-language tips for the next attempt (never raw error text)
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

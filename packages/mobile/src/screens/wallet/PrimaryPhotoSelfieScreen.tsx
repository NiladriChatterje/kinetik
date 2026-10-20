import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Image, ActivityIndicator, Dimensions, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import { Button } from '../../components/common/Button';
import { StepLabel } from '../../components/common/StepLabel';
import { useToast } from '../../hooks/useToast';
import { api } from '../../services/api';
import { resolveUrl } from '../../config';
import {
  embedProfilePhotos, verifySelfie, MIN_MATCH_THRESHOLD, FACE_ISSUE_TIPS, FaceIssue, ProfileEmbeddings,
} from '../../services/faceVerification';
import { hapticSuccess } from '../../utils/haptics';
import { colors, typography, spacing, radius } from '../../theme';

/**
 * Selfie check before a photo becomes the primary profile photo.
 *
 * The primary photo is the face other people see first, so making one
 * primary asks for a selfie and matches it against that photo on-device
 * (services/faceVerification.ts — the same ML Kit + MobileFaceNet pipeline
 * as onboarding). A match sets the photo and keeps the Face Verified badge.
 * On a mismatch the user can retake, or proceed: the photo is still set but
 * the badge is dropped, and the profile shows Face Unverified to others.
 */

const { width: SCREEN_WIDTH } = Dimensions.get('window');
/** Camera box: full width, and at most 9:16 tall (it shrinks to fit shorter screens) */
const CAMERA_WIDTH = SCREEN_WIDTH - spacing.xxl * 2;
const CAMERA_HEIGHT = Math.round(CAMERA_WIDTH * (16 / 9));

/** How much of the camera's zoom range (0–1) one full pinch spread covers */
const PINCH_ZOOM_SPEED = 0.4;

/** The new primary photo is checked on its own */
const MIN_FACES_IN_PHOTO = 1;

/** Mismatch icon red, matching the delete confirmations */
const DANGER = '#E53935';

type Phase = 'camera' | 'preview' | 'checking' | 'mismatch';

export const PrimaryPhotoSelfieScreen: React.FC<{ navigation: any; route: any }> = ({
  navigation,
  route,
}) => {
  const { photoId, photoUrl } = route.params as { photoId: string; photoUrl: string };
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>('camera');
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [issues, setIssues] = useState<FaceIssue[]>([]);
  // Match score (0–1), or null when nothing could be compared
  const [score, setScore] = useState<number | null>(null);
  // The check itself failed (network, model); details stay in the log
  const [checkFailed, setCheckFailed] = useState(false);
  // False when the photo itself has no usable face — retaking cannot help
  const [retakeable, setRetakeable] = useState(true);
  const [proceeding, setProceeding] = useState(false);
  const [zoom, setZoom] = useState(0);
  const cameraRef = useRef<any>(null);
  const pinchStartZoomRef = useRef(0);
  const toast = useToast();

  // Same pinch-to-zoom as the onboarding selfie
  const pinchGesture = Gesture.Pinch()
    .runOnJS(true)
    .onStart(() => {
      pinchStartZoomRef.current = zoom;
    })
    .onUpdate((e) => {
      const next = pinchStartZoomRef.current + (e.scale - 1) * PINCH_ZOOM_SPEED;
      setZoom(Math.max(0, Math.min(1, next)));
    });

  // Embed the photo while the user lines up the selfie
  const photoEmbeddingsRef = useRef<Promise<ProfileEmbeddings> | null>(null);
  const preparePhotoEmbeddings = useCallback(() => {
    const pending = embedProfilePhotos([resolveUrl(photoUrl)]).catch((err) => {
      console.warn('[primary-selfie] Failed to embed photo:', err);
      return { embeddings: [], incomplete: true };
    });
    photoEmbeddingsRef.current = pending;
    return pending;
  }, [photoUrl]);
  useEffect(() => {
    preparePhotoEmbeddings();
  }, [preparePhotoEmbeddings]);

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9, skipProcessing: true });
      if (!photo?.uri) {
        toast.showError('Capture failed', 'Try again.');
        return;
      }
      const manipulated = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ resize: { width: 800 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
      );
      setCapturedUri(manipulated.uri);
      setPhase('preview');
    } catch (err: any) {
      console.warn('[primary-selfie] Selfie capture failed:', err?.message || err);
      toast.showError('Capture failed', 'Try again.');
    }
  }, [toast]);

  const handleRetake = useCallback(() => {
    // After a failed check, reload the photo too: the failure may have been there
    if (checkFailed) preparePhotoEmbeddings();
    setCapturedUri(null);
    setZoom(0);
    setIssues([]);
    setScore(null);
    setCheckFailed(false);
    setRetakeable(true);
    setPhase('camera');
  }, [checkFailed, preparePhotoEmbeddings]);

  /** Make the photo primary, then record whether the selfie matched it. */
  const applyPrimary = useCallback(async (verified: boolean, confidence: number) => {
    const res = await api.setPrimaryPhoto(photoId);
    if (!res.success) {
      throw new Error(res.error?.message || 'Could not update primary photo.');
    }
    await api.reportFaceVerification({ verified, confidence });
  }, [photoId]);

  const handleConfirm = useCallback(async () => {
    if (!capturedUri) return;
    setPhase('checking');

    let verified = false;
    let confidence = 0;
    try {
      const photo = await (photoEmbeddingsRef.current ?? preparePhotoEmbeddings());
      const result = await verifySelfie(capturedUri, photo.embeddings, MIN_FACES_IN_PHOTO);
      const noPhotoFace = result.issues.includes('few_profile_faces');
      if (noPhotoFace && photo.incomplete) {
        // The photo failed to load, so it may well show a face: retry
        throw new Error('Photo could not be processed');
      }
      verified = result.verified;
      confidence = result.confidence;
      setIssues(result.issues);
      // A score is only meaningful when both images had a face to compare
      setScore(result.faceDetectedInSelfie && !noPhotoFace ? result.confidence : null);
      setCheckFailed(false);
      setRetakeable(!noPhotoFace);
    } catch (err: any) {
      // A broken model or ML Kit is a mismatch the user can retry or skip
      console.warn('[primary-selfie] On-device check failed:', err?.message || err);
      setIssues([]);
      setScore(null);
      setCheckFailed(true);
      setRetakeable(true);
    }

    if (!verified) {
      setPhase('mismatch');
      return;
    }

    try {
      await applyPrimary(true, confidence);
      hapticSuccess();
      toast.showSuccess('Primary photo set', 'Your selfie matched. Face Verified.');
      navigation.goBack();
    } catch (e: any) {
      toast.showError('Failed', e?.message || 'Try again.');
      setPhase('preview');
    }
  }, [capturedUri, preparePhotoEmbeddings, applyPrimary, toast, navigation]);

  const handleProceedUnverified = useCallback(async () => {
    setProceeding(true);
    try {
      await applyPrimary(false, 0);
      toast.showSuccess('Primary photo set', 'Your profile now shows Face Unverified.');
      navigation.goBack();
    } catch (e: any) {
      toast.showError('Failed', e?.message || 'Try again.');
    } finally {
      setProceeding(false);
    }
  }, [applyPrimary, toast, navigation]);

  const goBack = useCallback(() => navigation.goBack(), [navigation]);
  const busy = phase === 'checking' || proceeding;

  const heading = (subtitle: string) => (
    <>
      <StepLabel label="Primary photo" onBack={goBack} backDisabled={busy} />
      <Text style={styles.title}>Confirm it's you</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </>
  );

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
          {heading('We need your camera to take a selfie and match it to this photo.')}
          <View style={styles.cameraPlaceholder}>
            <Ionicons name="camera-outline" size={48} color={colors.textMuted} />
            <Text style={styles.placeholderText}>Camera access required</Text>
          </View>
          <Button title="Grant Camera Access" onPress={requestPermission} fullWidth />
        </View>
      </SafeAreaView>
    );
  }

  // ─── Mismatch ───────────────────────────────────────────
  if (phase === 'mismatch') {
    return (
      <SafeAreaView style={styles.container}>
        {/* Scrolls so the tips stay reachable on short screens */}
        <ScrollView style={styles.resultScroll} contentContainerStyle={styles.resultContent}>
          {heading('We match your selfie against the photo you chose')}

          <View style={styles.resultContainer}>
            <View style={styles.photoPair}>
              <Image source={{ uri: resolveUrl(photoUrl) }} style={styles.pairImage} />
              {capturedUri && (
                <Image source={{ uri: capturedUri }} style={[styles.pairImage, styles.mirrored]} />
              )}
            </View>
            <Ionicons name="close-circle" size={40} color={DANGER} />
            <Text style={styles.resultTitle}>
              {checkFailed ? "Couldn't check your selfie" : 'Selfie did not match'}
            </Text>
            {score !== null && (
              <View style={styles.scoreRow}>
                <Text style={styles.scoreValue}>{Math.round(score * 100)}%</Text>
                <Text style={styles.scoreLabel}>
                  match · {Math.round(MIN_MATCH_THRESHOLD * 100)}% needed
                </Text>
              </View>
            )}
            <Text style={styles.resultSubtitle}>
              {checkFailed
                ? 'Something went wrong while checking. Try again, or set this photo anyway. Your profile will then show Face Unverified.'
                : retakeable
                  ? 'Retake your selfie, or set this photo anyway. Your profile will then show Face Unverified.'
                  : 'This photo has no clear face to match. You can set it anyway, and your profile will show Face Unverified.'}
            </Text>
          </View>

          {/* Plain-language tips only, never raw error text */}
          {retakeable && issues.length > 0 && (
            <View style={styles.reasonsBox}>
              <Text style={styles.reasonsTitle}>Tips for your next selfie</Text>
              {issues.map((issue) => (
                <View key={issue} style={styles.reasonRow}>
                  <Ionicons name="bulb-outline" size={14} color={colors.textMuted} />
                  <Text style={styles.reasonText}>{FACE_ISSUE_TIPS[issue]}</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>

        <View style={[styles.footer, styles.footerStacked]}>
          {retakeable && (
            <Button
              title={checkFailed ? 'Try Again' : 'Retake Selfie'}
              onPress={handleRetake}
              disabled={proceeding}
              fullWidth
            />
          )}
          <Button
            title="Proceed Unverified"
            variant={retakeable ? 'ghost' : 'primary'}
            onPress={handleProceedUnverified}
            loading={proceeding}
            disabled={proceeding}
            fullWidth
          />
        </View>
      </SafeAreaView>
    );
  }

  // ─── Checking ───────────────────────────────────────────
  if (phase === 'checking') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          {heading('We match your selfie against the photo you chose')}
          <View style={styles.cameraContainer}>
            {capturedUri && (
              <Image source={{ uri: capturedUri }} style={[styles.capturedImage, styles.mirrored]} />
            )}
            <View style={styles.checkingOverlay}>
              <ActivityIndicator size="large" color={colors.textInverse} />
              <Text style={styles.checkingText}>Matching...</Text>
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Preview ────────────────────────────────────────────
  if (phase === 'preview') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          {heading('Check your selfie before matching')}
          <View style={styles.cameraContainer}>
            {/* Mirrored for display only, like the live preview */}
            {capturedUri && (
              <Image source={{ uri: capturedUri }} style={[styles.capturedImage, styles.mirrored]} />
            )}
          </View>
          <TouchableOpacity style={styles.retakeButton} onPress={handleRetake}>
            <Ionicons name="refresh" size={20} color={colors.textPrimary} />
            <Text style={styles.retakeText}>Retake</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.footer}>
          <Button title="Use This Photo" onPress={handleConfirm} fullWidth />
        </View>
      </SafeAreaView>
    );
  }

  // ─── Camera (default) ───────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {heading('Take a selfie so we can match it to this photo')}

        <GestureDetector gesture={pinchGesture}>
          <View style={styles.cameraContainer}>
            {/* Mirror the front-camera preview so it behaves like a mirror */}
            <CameraView
              ref={cameraRef}
              style={[styles.camera, { transform: [{ scaleX: -1 }] }]}
              facing="front"
              zoom={zoom}
            />

            {zoom > 0 && (
              <View style={styles.zoomBadge}>
                <Ionicons name="search" size={12} color={colors.textInverse} />
                <Text style={styles.zoomBadgeText}>{Math.round(zoom * 100)}%</Text>
              </View>
            )}

            {/* The photo being made primary, for reference */}
            <Image source={{ uri: resolveUrl(photoUrl) }} style={styles.referenceThumb} />

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
        <Text style={styles.captureHint}>Tap to capture · pinch to zoom</Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, paddingHorizontal: spacing.xxl, paddingTop: spacing.lg, paddingBottom: spacing.sm, alignItems: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm, alignSelf: 'flex-start' },
  subtitle: { ...typography.body1, color: colors.textSecondary, marginBottom: spacing.lg, alignSelf: 'flex-start' },

  // Camera boxes: full width, the height left above the footer, up to 9:16
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
  cameraContainer: {
    width: CAMERA_WIDTH,
    flex: 1,
    maxHeight: CAMERA_HEIGHT,
    borderRadius: radius.xl,
    overflow: 'hidden',
    marginBottom: spacing.md,
    backgroundColor: colors.surfaceHighlight,
  },
  camera: { width: '100%', height: '100%' },

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

  referenceThumb: {
    position: 'absolute',
    bottom: spacing.md,
    right: spacing.md,
    width: 56,
    height: 56,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.textInverse,
    backgroundColor: colors.surfaceHighlight,
  },

  faceGuide: { position: 'absolute', top: '18%', left: '18%', right: '18%', bottom: '25%' },
  corner: { position: 'absolute', width: 24, height: 24, borderColor: colors.textInverse },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },

  capturedImage: { width: '100%', height: '100%', borderRadius: radius.xl },
  // Front-camera selfies are shown mirrored, like the live preview was
  mirrored: { transform: [{ scaleX: -1 }] },

  checkingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  checkingText: { ...typography.body1, color: colors.textInverse },

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
  captureButtonInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.textPrimary },
  captureHint: { ...typography.caption, color: colors.textMuted },

  // Mismatch
  resultContainer: { alignItems: 'center', marginTop: spacing.xl, gap: spacing.md },
  photoPair: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm },
  pairImage: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: colors.surfaceHighlight },
  resultTitle: { ...typography.h2, color: colors.textPrimary, textAlign: 'center' },
  resultSubtitle: { ...typography.body1, color: colors.textSecondary, textAlign: 'center' },
  resultScroll: { flex: 1 },
  resultContent: { paddingHorizontal: spacing.xxl, paddingTop: spacing.lg, paddingBottom: spacing.sm, alignItems: 'center' },
  scoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  scoreValue: { ...typography.h1, color: colors.textPrimary },
  scoreLabel: { ...typography.body2, color: colors.textSecondary },

  reasonsBox: {
    alignSelf: 'stretch',
    marginTop: spacing.xl,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  reasonsTitle: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.xs },
  reasonRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  reasonText: { ...typography.caption, color: colors.textSecondary, flex: 1 },

  footer: { paddingHorizontal: spacing.xxl, paddingTop: spacing.sm, paddingBottom: spacing.lg, alignItems: 'center' },
  footerStacked: { alignItems: 'stretch', gap: spacing.sm },
});

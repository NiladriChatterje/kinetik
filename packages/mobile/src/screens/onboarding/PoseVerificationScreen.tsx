import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Image, ActivityIndicator, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import { Button } from '../../components/common/Button';
import { useToast } from '../../hooks/useToast';
import { api } from '../../services/api';
import { resolveUrl } from '../../config';
import { embedProfilePhotos, verifySelfie } from '../../services/faceVerification';
import { colors, typography, spacing, radius } from '../../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
/** 9:16 portrait camera — fills width, height = width × 16/9 */
const CAMERA_WIDTH = SCREEN_WIDTH - spacing.xxl * 2;
const CAMERA_HEIGHT = Math.round(CAMERA_WIDTH * (16 / 9));

type Phase = 'camera' | 'preview' | 'uploading' | 'success';

export const PoseVerificationScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>('camera');
  const [verified, setVerified] = useState(false);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const cameraRef = useRef<any>(null);
  const toast = useToast();

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
        console.warn('[pose] Failed to prepare profile embeddings:', err);
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
        toast.showError('Capture Failed', 'Could not capture photo. Please try again.');
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
      toast.showError('Capture Failed', err?.message || 'Could not take photo.');
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

      if (result.verified) {
        toast.showSuccess(
          'Face Verified!',
          'Your selfie matches your profile photos.',
        );
      } else {
        console.log('[pose] Not verified:', result.rejectionReasons.join('; '));
        toast.showSuccess(
          'Selfie Submitted',
          'You can continue with onboarding.',
        );
      }

      // Self-report the on-device result (fire-and-forget on failure)
      api
        .reportPoseVerification({ verified: result.verified, confidence: result.confidence })
        .catch((err) => console.warn('[pose] Failed to report verification:', err));
    } catch (err: any) {
      // Verification errors never block onboarding
      console.warn('[pose] On-device verification failed:', err?.message || err);
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
    setPhase('camera');
  }, []);

  /**
   * Continue to next onboarding step.
   */
  const handleContinue = useCallback(async () => {
    await api.updateOnboardingStep('pose');
    navigation.navigate('KYC');
  }, [navigation]);

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
          <Text style={styles.step}>Step 5 of 6</Text>
          <Text style={styles.title}>Verify You're Real</Text>
          <Text style={styles.subtitle}>
            We need access to your camera to take a verification selfie.
          </Text>

          <View style={styles.cameraPlaceholder}>
            <Ionicons name="camera-outline" size={48} color={colors.textMuted} />
            <Text style={styles.placeholderText}>Camera access required</Text>
          </View>

          <Button title="Grant Camera Access" onPress={requestPermission} fullWidth />
        </View>
      </SafeAreaView>
    );
  }

  // ─── Success state ──────────────────────────────────────
  if (phase === 'success') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.step}>Step 5 of 6</Text>
          <Text style={styles.title}>Verify You're Real</Text>
          <Text style={styles.subtitle}>Follow the prompts to complete liveness verification</Text>

          <View style={styles.successContainer}>
            <Ionicons name="checkmark-circle" size={64} color={colors.textPrimary} />
            <Text style={styles.successTitle}>
              {verified ? 'Identity Verified!' : 'Selfie Submitted'}
            </Text>
            <Text style={styles.successSubtitle}>
              {verified
                ? 'Your selfie matches your profile photos.'
                : 'Your selfie has been submitted. You can continue with onboarding.'}
            </Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Button title="Continue" onPress={handleContinue} fullWidth />
        </View>
      </SafeAreaView>
    );
  }

  // ─── Uploading state ────────────────────────────────────
  if (phase === 'uploading') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.step}>Step 5 of 6</Text>
          <Text style={styles.title}>Verify You're Real</Text>
          <Text style={styles.subtitle}>Follow the prompts to complete liveness verification</Text>

          <View style={styles.cameraContainer}>
            {capturedUri && (
              <Image source={{ uri: capturedUri }} style={styles.capturedImage} />
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
          <Text style={styles.step}>Step 5 of 6</Text>
          <Text style={styles.title}>Verify You're Real</Text>
          <Text style={styles.subtitle}>Check your selfie before submitting</Text>

          <View style={styles.cameraContainer}>
            {capturedUri && (
              <Image source={{ uri: capturedUri }} style={styles.capturedImage} />
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
        <Text style={styles.step}>Step 5 of 6</Text>
        <Text style={styles.title}>Verify You're Real</Text>
        <Text style={styles.subtitle}>Take a clear selfie for liveness verification</Text>

        <View style={styles.cameraContainer}>
          {/* Mirror the front-camera preview so it behaves like a mirror */}
          <CameraView
            ref={cameraRef}
            style={[styles.camera, { transform: [{ scaleX: -1 }] }]}
            facing="front"
          />

          {/* Pose instruction overlay */}
          <View style={styles.poseOverlay}>
            <Text style={styles.poseText}>Take a selfie</Text>
          </View>

          {/* Face guide frame */}
          <View style={styles.faceGuide}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>
        </View>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.captureButton} onPress={handleCapture}>
          <View style={styles.captureButtonInner} />
        </TouchableOpacity>
        <Text style={styles.captureHint}>Tap to capture</Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, padding: spacing.xxl, alignItems: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Text
  step: { ...typography.label, color: colors.textPrimary, marginBottom: spacing.sm, alignSelf: 'flex-start' },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm, alignSelf: 'flex-start' },
  subtitle: { ...typography.body1, color: colors.textSecondary, marginBottom: spacing.xxl, alignSelf: 'flex-start' },

  // Camera placeholder (permission denied)
  cameraPlaceholder: {
    width: CAMERA_WIDTH,
    height: CAMERA_HEIGHT,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xxl,
  },
  placeholderText: { ...typography.body2, color: colors.textMuted, marginTop: spacing.md },

  // Camera (9:16 portrait)
  cameraContainer: {
    width: CAMERA_WIDTH,
    height: CAMERA_HEIGHT,
    borderRadius: radius.xl,
    overflow: 'hidden',
    marginBottom: spacing.xxl,
    backgroundColor: colors.surfaceHighlight,
  },
  camera: {
    width: '100%',
    height: '100%',
  },

  // Pose overlay
  poseOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: spacing.md,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  poseText: { ...typography.h3, color: colors.textInverse },

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

  // Footer
  footer: { padding: spacing.xxl, paddingBottom: spacing.huge, alignItems: 'center' },
});

import React, { useState, useRef, useCallback } from 'react';
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
import { colors, typography, spacing, radius } from '../../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CAMERA_SIZE = Math.min(SCREEN_WIDTH - spacing.xxl * 2, 320);

type Phase = 'camera' | 'preview' | 'uploading' | 'success';

export const PoseVerificationScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>('camera');
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const cameraRef = useRef<any>(null);
  const toast = useToast();

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
   * Upload the captured selfie to the backend.
   */
  const handleConfirm = useCallback(async () => {
    if (!capturedUri) return;

    setPhase('uploading');
    try {
      await api.submitPoseVerification(capturedUri);
      setPhase('success');
      toast.showSuccess('Verified!', 'Your selfie has been submitted for verification.');
    } catch (err: any) {
      toast.showError('Upload Failed', err?.message || 'Something went wrong.');
      setPhase('preview');
    }
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
          <Text style={styles.step}>Step 4 of 5</Text>
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
          <Text style={styles.step}>Step 4 of 5</Text>
          <Text style={styles.title}>Verify You're Real</Text>
          <Text style={styles.subtitle}>Follow the prompts to complete liveness verification</Text>

          <View style={styles.successContainer}>
            <Ionicons name="checkmark-circle" size={64} color={colors.textPrimary} />
            <Text style={styles.successTitle}>Identity Verified!</Text>
            <Text style={styles.successSubtitle}>
              Your selfie has been submitted and is being reviewed.
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
          <Text style={styles.step}>Step 4 of 5</Text>
          <Text style={styles.title}>Verify You're Real</Text>
          <Text style={styles.subtitle}>Follow the prompts to complete liveness verification</Text>

          <View style={styles.cameraContainer}>
            {capturedUri && (
              <Image source={{ uri: capturedUri }} style={styles.capturedImage} />
            )}
            <View style={styles.uploadOverlay}>
              <ActivityIndicator size="large" color={colors.textInverse} />
              <Text style={styles.uploadingText}>Uploading...</Text>
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
          <Text style={styles.step}>Step 4 of 5</Text>
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
        <Text style={styles.step}>Step 4 of 5</Text>
        <Text style={styles.title}>Verify You're Real</Text>
        <Text style={styles.subtitle}>Take a clear selfie for liveness verification</Text>

        <View style={styles.cameraContainer}>
          <CameraView
            ref={cameraRef}
            style={styles.camera}
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
    width: CAMERA_SIZE,
    height: CAMERA_SIZE,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xxl,
  },
  placeholderText: { ...typography.body2, color: colors.textMuted, marginTop: spacing.md },

  // Camera
  cameraContainer: {
    width: CAMERA_SIZE,
    height: CAMERA_SIZE,
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

  // Face guide corners
  faceGuide: {
    position: 'absolute',
    top: '15%',
    left: '15%',
    right: '15%',
    bottom: '20%',
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

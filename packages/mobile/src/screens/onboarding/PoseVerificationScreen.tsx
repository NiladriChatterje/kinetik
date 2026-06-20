import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../components/common/Button';
import { useToast } from '../../hooks/useToast';
import { api } from '../../services/api';
import { colors, typography, spacing, radius } from '../../theme';

const POSES = ['Turn left', 'Smile', 'Blink', 'Turn right', 'Look up'];

export const PoseVerificationScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [currentPose, setCurrentPose] = useState(0);
  const [verified, setVerified] = useState(false);
  const toast = useToast();

  const handlePoseComplete = () => {
    if (currentPose < POSES.length - 1) {
      setCurrentPose((p) => p + 1);
    } else {
      setVerified(true);
      toast.showSuccess('Identity Verified!', 'Liveness check passed successfully.');
    }
  };

  const handleContinue = async () => {
    await api.updateOnboardingStep('pose');
    navigation.navigate('KYC');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.step}>Step 4 of 5</Text>
        <Text style={styles.title}>Verify You're Real</Text>
        <Text style={styles.subtitle}>Follow the prompts to complete liveness verification</Text>

        <View style={styles.cameraPlaceholder}>
          <Ionicons name="camera-outline" size={48} color={colors.textMuted} />
          <Text style={styles.poseText}>{POSES[currentPose]}</Text>

          {/* Pose progress dots */}
          <View style={styles.poseDots}>
            {POSES.map((_, i) => (
              <View key={i} style={[styles.dot, i <= currentPose && styles.dotActive]} />
            ))}
          </View>
        </View>

        {verified ? (
          <View style={styles.verifiedContainer}>
            <Ionicons name="checkmark-circle" size={48} color={colors.textPrimary} />
            <Text style={styles.verifiedText}>Identity Verified!</Text>
          </View>
        ) : (
          <Button title="I did that!" onPress={handlePoseComplete} fullWidth />
        )}
      </View>

      {verified && (
        <View style={styles.footer}>
          <Button title="Continue" onPress={handleContinue} fullWidth />
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, padding: spacing.xxl, alignItems: 'center' },
  step: { ...typography.label, color: colors.textPrimary, marginBottom: spacing.sm, alignSelf: 'flex-start' },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm, alignSelf: 'flex-start' },
  subtitle: { ...typography.body1, color: colors.textSecondary, marginBottom: spacing.xxl, alignSelf: 'flex-start' },
  cameraPlaceholder: { width: 280, height: 340, borderRadius: radius.xl, backgroundColor: colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xxl },
  poseText: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.lg },
  poseDots: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.surfaceLight },
  dotActive: { backgroundColor: colors.textPrimary },
  verifiedContainer: { alignItems: 'center', marginTop: spacing.lg },
  verifiedText: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.sm },
  footer: { padding: spacing.xxl, paddingBottom: spacing.huge },
});

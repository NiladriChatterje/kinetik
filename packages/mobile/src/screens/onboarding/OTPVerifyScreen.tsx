import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/authStore';
import { useToast } from '../../hooks/useToast';
import { Button } from '../../components/common/Button';
import { OtpTarget } from '../../services/api';
import { colors, typography, spacing, radius } from '../../theme';

const RESEND_COOLDOWN = 30;

export const OTPVerifyScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { pendingEmail, pendingPhone, verifyOtp, sendOtp, clearPendingOtp } = useAuthStore();
  const toast = useToast();

  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const inputRefs = useRef<(TextInput | null)[]>([]);

  // The code is delivered by email (Brevo) or, on the legacy path, by SMS.
  const target: OtpTarget | null = pendingEmail
    ? { email: pendingEmail }
    : pendingPhone
      ? { phone: pendingPhone }
      : null;
  const isEmail = !!pendingEmail;

  // The login route already emailed the code before navigating here, so the
  // screen only starts the resend cooldown — sending again on mount would be
  // rejected by the server's 30 s cooldown and waste a Brevo send.
  useEffect(() => {
    setCountdown(RESEND_COOLDOWN);
  }, []);

  // Countdown timer for resend
  useEffect(() => {
    if (countdown <= 0) return;
    const interval = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(interval);
  }, [countdown]);

  // Handle digit input
  const handleDigitChange = (text: string, index: number) => {
    // Only allow single digits
    const digit = text.replace(/[^0-9]/g, '').slice(-1);
    const newDigits = [...digits];
    newDigits[index] = digit;
    setDigits(newDigits);

    // Auto-advance to next field
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  // Handle backspace
  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleResend = async () => {
    if (countdown > 0 || !target) return;
    setCountdown(RESEND_COOLDOWN);
    const result = await sendOtp(target);
    if (result.success) {
      toast.showSuccess('Code sent', isEmail ? 'Check your inbox.' : 'Check your phone.');
    } else {
      toast.showError('Failed', result.error || 'Could not resend.');
      setCountdown(0);
    }
  };

  const handleVerify = async () => {
    const code = digits.join('');
    if (code.length !== 6 || !target) {
      toast.showGlass('Enter code', 'Enter the 6-digit code.');
      return;
    }

    setLoading(true);
    try {
      const result = await verifyOtp(target, code);
      if (result.success) {
        toast.showSuccess('Verified!', 'You\'re all set.');
        // Read the latest onboardingStep directly from store (avoid stale closure)
        const currentStep = useAuthStore.getState().onboardingStep;
        if (currentStep === 'complete') {
          // Profile is fully set up — go straight to Main
          navigation.getParent()?.reset({ index: 0, routes: [{ name: 'Main' }] });
        } else if (currentStep === 'identity') {
          // Identity data already exists — skip to About
          navigation.navigate('About');
        } else if (currentStep === 'about' || currentStep === 'location' || currentStep === 'photos' || currentStep === 'face' || currentStep === 'pose' || currentStep === 'kyc') {
          // User is further along — determine next screen based on step
          const screenMap: Record<string, string> = {
            about: 'Location',
            location: 'Photos',
            photos: 'FaceVerification',
            face: 'KYC',
            // Legacy value: rows written before migration 019 renamed the step.
            pose: 'KYC',
            kyc: 'KYC',
          };
          navigation.navigate(screenMap[currentStep] || 'Identity');
        } else {
          // No progress — start from Identity
          navigation.navigate('Identity');
        }
      } else {
        toast.showError('Verification failed', result.error || 'Invalid code.');
        setDigits(['', '', '', '', '', '']);
        inputRefs.current[0]?.focus();
      }
    } catch (e: any) {
      toast.showError('Network error', e?.message || 'Try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    clearPendingOtp();
    navigation.goBack();
  };

  const maskPhone = (phone: string) => {
    if (phone.length <= 6) return phone;
    return phone.slice(0, 4) + '•••••' + phone.slice(-2);
  };

  const maskEmail = (email: string) => {
    const at = email.indexOf('@');
    if (at <= 0) return email;
    return email.slice(0, Math.min(2, at)) + '•••' + email.slice(at);
  };

  const maskedTarget = pendingEmail
    ? maskEmail(pendingEmail)
    : pendingPhone
      ? maskPhone(pendingPhone)
      : '';

  // Guard: no pending verification
  if (!target) {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.textMuted} />
          <Text style={styles.errorText}>No verification in progress.</Text>
          <Button title="Back to Login" onPress={() => navigation.navigate('Splash')} fullWidth size="lg" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Verification</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Content */}
      <View style={styles.content}>
        {/* Icon */}
        <View style={styles.iconCircle}>
          <Ionicons name={isEmail ? 'mail-outline' : 'phone-portrait-outline'} size={28} color={colors.textPrimary} />
        </View>

        {/* Heading */}
        <Text style={styles.heading}>Enter verification code</Text>
        <Text style={styles.subtitle}>
          A code has been sent to{'\n'}
          <Text style={styles.phone}>{maskedTarget}</Text>
        </Text>

        {/* Digit boxes */}
        <View style={styles.digitRow}>
          {digits.map((digit, index) => (
            <TextInput
              key={index}
              ref={(ref) => { inputRefs.current[index] = ref; }}
              style={[styles.digitBox, digit ? styles.digitBoxFilled : null]}
              value={digit}
              onChangeText={(text) => handleDigitChange(text, index)}
              onKeyPress={(e) => handleKeyPress(e, index)}
              keyboardType="number-pad"
              maxLength={2}
              selectTextOnFocus
              autoFocus={index === 0}
              textContentType={Platform.OS === 'ios' ? 'oneTimeCode' : undefined}
            />
          ))}
        </View>

        {isEmail && (
          <Text style={styles.spamHint}>Not in your inbox? Check spam.</Text>
        )}

        {/* Resend section */}
        <View style={styles.resendSection}>
          {countdown > 0 ? (
            <Text style={styles.resendText}>
              Resend code in <Text style={styles.countdownText}>00:{countdown.toString().padStart(2, '0')}</Text>
            </Text>
          ) : (
            <TouchableOpacity onPress={handleResend} style={styles.resendButton}>
              <Ionicons name="refresh-outline" size={16} color={colors.textPrimary} />
              <Text style={styles.resendAction}>  Resend code</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Verify button */}
        <View style={styles.footer}>
          <Button
            title="Verify"
            onPress={handleVerify}
            loading={loading}
            fullWidth
            size="lg"
          />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  // ─── Header ─────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: 60,
    paddingBottom: spacing.md,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    ...typography.h4,
    color: colors.textPrimary,
  },
  headerSpacer: {
    width: 40,
  },
  // ─── Content ────────────────────────────────────────────
  content: {
    flex: 1,
    paddingHorizontal: spacing.xxl,
    alignItems: 'center',
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xxl,
    marginTop: spacing.xxl,
  },
  heading: {
    ...typography.h2,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body1,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xxxl,
    lineHeight: 22,
  },
  phone: {
    ...typography.body1,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  // ─── Digit Boxes ─────────────────────────────────────────
  digitRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xxl,
  },
  digitBox: {
    width: 46,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.inputBg,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  digitBoxFilled: {
    borderColor: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  spamHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: -spacing.md,
    marginBottom: spacing.xxl,
  },
  // ─── Resend ─────────────────────────────────────────────
  resendSection: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  resendText: {
    ...typography.body2,
    color: colors.textSecondary,
  },
  countdownText: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  resendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  resendAction: {
    ...typography.body2,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  // ─── Footer ─────────────────────────────────────────────
  footer: {
    width: '100%',
    marginTop: 'auto',
    paddingBottom: spacing.huge,
  },
  // ─── Error State ────────────────────────────────────────
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    gap: spacing.lg,
  },
  errorText: {
    ...typography.body1,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});

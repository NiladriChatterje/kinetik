import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/authStore';
import { useToast } from '../../hooks/useToast';
import { Button } from '../../components/common/Button';
import { enterOnboarding } from '../../navigation/onboardingFlow';
import { colors, typography, spacing, radius } from '../../theme';

const RESEND_COOLDOWN = 30;

const secondsUntil = (ms: number) => Math.max(0, Math.ceil((ms - Date.now()) / 1000));
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;

/**
 * Sign-up code entry. The account does not exist yet: a correct code creates
 * it and signs the user in. The code lasts 5 minutes and allows 3 guesses;
 * when either runs out the user goes back to the sign-up form, still filled
 * in (SplashScreen stays mounted underneath).
 */
export const OTPVerifyScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const pending = useAuthStore((s) => s.pendingSignup);
  const verifySignup = useAuthStore((s) => s.verifySignup);
  const resendSignupCode = useAuthStore((s) => s.resendSignupCode);
  const clearPendingSignup = useAuthStore((s) => s.clearPendingSignup);
  const toast = useToast();

  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  // Re-render once a second for the expiry and resend countdowns
  const [, setTick] = useState(0);

  const inputRefs = useRef<(TextInput | null)[]>([]);
  // Leaving is triggered by the timer and by replies; only once
  const leftRef = useRef(false);

  const expiresIn = pending ? secondsUntil(pending.expiresAt) : 0;
  const resendIn = pending ? secondsUntil(pending.sentAt + RESEND_COOLDOWN * 1000) : 0;

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  /** Back to the filled-in sign-up form. */
  const backToForm = () => {
    if (leftRef.current) return;
    leftRef.current = true;
    clearPendingSignup();
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Splash');
  };

  useEffect(() => {
    if (pending && expiresIn === 0 && !loading) {
      toast.showError('Code expired', 'Please create your account again.');
      backToForm();
    }
  }, [expiresIn, pending, loading]);

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

  const clearDigits = () => {
    setDigits(['', '', '', '', '', '']);
    inputRefs.current[0]?.focus();
  };

  const handleResend = async () => {
    if (!pending || resendIn > 0 || pending.sendsLeft <= 0 || resending) return;
    setResending(true);
    try {
      const result = await resendSignupCode();
      if (result.success) {
        toast.showSuccess('New code sent', 'Check your inbox.');
        clearDigits();
      } else if (result.errorCode === 'SIGNUP_EXPIRED') {
        toast.showError('Code expired', 'Please create your account again.');
        backToForm();
      } else if (result.errorCode === 'SIGNUP_LOCKED') {
        toast.showError('No codes left today', result.error || 'Try again in 24 hours.');
      } else {
        toast.showError('Could not resend', result.error || 'Please try again.');
      }
    } finally {
      setResending(false);
    }
  };

  const handleVerify = async () => {
    const code = digits.join('');
    if (code.length !== 6 || !pending) {
      toast.showGlass('Enter code', 'Enter the 6-digit code.');
      return;
    }

    setLoading(true);
    try {
      const result = await verifySignup(code);
      if (result.success) {
        leftRef.current = true;
        toast.showSuccess('Email verified', 'Your account is ready.');
        enterOnboarding(navigation, useAuthStore.getState().onboardingStep);
      } else if (result.errorCode === 'INVALID_OTP') {
        toast.showError('Wrong code', result.error || 'Please try again.');
        clearDigits();
      } else if (result.errorCode === 'SIGNUP_FAILED' || result.errorCode === 'SIGNUP_EXPIRED') {
        toast.showError(
          result.errorCode === 'SIGNUP_FAILED' ? 'Verification failed' : 'Code expired',
          result.error || 'Please create your account again.',
        );
        backToForm();
      } else if (result.errorCode === 'EMAIL_EXISTS') {
        toast.showGlass('Email already registered', 'Sign in with your password instead.');
        leftRef.current = true;
        clearPendingSignup();
        navigation.navigate('Splash', { mode: 'login' });
      } else {
        toast.showError('Verification failed', result.error || 'Please try again.');
      }
    } catch (e: any) {
      toast.showError('Network error', e?.message || 'Try again.');
    } finally {
      setLoading(false);
    }
  };

  const maskEmail = (email: string) => {
    const at = email.indexOf('@');
    if (at <= 0) return email;
    return email.slice(0, Math.min(2, at)) + '•••' + email.slice(at);
  };

  // Guard: no pending sign-up
  if (!pending) {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.textMuted} />
          <Text style={styles.errorText}>No verification in progress.</Text>
          <Button title="Back to Sign Up" onPress={() => navigation.navigate('Splash')} fullWidth size="lg" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={backToForm} style={styles.backButton} accessibilityLabel="Back to sign up">
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Verify Email</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Content */}
      <View style={styles.content}>
        {/* Icon */}
        <View style={styles.iconCircle}>
          <Ionicons name="mail-outline" size={28} color={colors.textPrimary} />
        </View>

        {/* Heading */}
        <Text style={styles.heading}>Enter verification code</Text>
        <Text style={styles.subtitle}>
          A code has been sent to{'\n'}
          <Text style={styles.phone}>{maskEmail(pending.email)}</Text>
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

        <Text style={styles.expiryText}>
          Code expires in <Text style={styles.countdownText}>{clock(expiresIn)}</Text>
          {'  ·  '}
          {pending.attemptsLeft} {pending.attemptsLeft === 1 ? 'attempt' : 'attempts'} left
        </Text>

        <Text style={styles.spamHint}>Not in your inbox? Check spam.</Text>

        {/* Resend section */}
        <View style={styles.resendSection}>
          {pending.sendsLeft <= 0 ? (
            <Text style={styles.resendText}>No more codes can be sent today</Text>
          ) : resendIn > 0 ? (
            <Text style={styles.resendText}>
              Resend code in <Text style={styles.countdownText}>{clock(resendIn)}</Text>
            </Text>
          ) : (
            <TouchableOpacity onPress={handleResend} style={styles.resendButton} disabled={resending}>
              <Ionicons name="refresh-outline" size={16} color={colors.textPrimary} />
              <Text style={styles.resendAction}>
                {'  '}Resend code ({pending.sendsLeft} left today)
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Verify button */}
        <View style={styles.footer}>
          <Button
            title="Verify"
            onPress={handleVerify}
            loading={loading}
            disabled={loading}
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
  expiryText: {
    ...typography.body2,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: -spacing.md,
    marginBottom: spacing.sm,
  },
  spamHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
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

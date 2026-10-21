import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useToast } from '../../hooks/useToast';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';
import { enterOnboarding } from '../../navigation/onboardingFlow';
import { colors, typography, spacing } from '../../theme';

/**
 * Forgot password: a code emailed under the sign-up code rules (5 minutes,
 * 3 tries, 3 a day), then a new password, then signed in with it. The server
 * signs every other device out.
 */
export const ForgotPasswordScreen: React.FC<{ navigation: any; route?: any }> = ({ navigation, route }) => {
  const [email, setEmail] = useState<string>(route?.params?.email ?? '');
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);
  const toast = useToast();

  const sendCode = async () => {
    const address = email.trim();
    if (!address) {
      toast.showError('Email required', 'Enter the email you signed up with.');
      return;
    }
    setLoading(true);
    try {
      const res = await api.requestPasswordReset(address);
      if (res.success) {
        setCodeSent(true);
        setCode('');
        toast.showSuccess('Code sent', 'Check your email, and spam too.');
      } else {
        toast.showError('Could not send a code', res.error?.message || 'Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async () => {
    if (!/^\d{6}$/.test(code)) {
      toast.showError('Enter the code', 'Enter the 6-digit code from the email.');
      return;
    }
    if (password.length < 8) {
      toast.showError('Password too short', 'Use at least 8 characters.');
      return;
    }
    const address = email.trim();
    setLoading(true);
    try {
      const res = await api.resetPassword(address, code, password);
      if (!res.success) {
        toast.showError('Could not reset the password', res.error?.message || 'Please try again.');
        // The code is used up or expired: back to asking for a new one
        if (res.error?.code === 'SIGNUP_EXPIRED' || res.error?.code === 'SIGNUP_FAILED') setCodeSent(false);
        return;
      }

      // Signed in with the new password, as the sign-in screen does
      const result = await login(address, password);
      if (!result.success) {
        toast.showSuccess('Password changed', 'Sign in with your new password.');
        navigation.goBack();
        return;
      }
      toast.showSuccess('Password changed', 'Signed in with your new password.');
      const step = useAuthStore.getState().onboardingStep;
      if (step === 'complete') {
        navigation.getParent()?.reset({ index: 0, routes: [{ name: 'Main' }] });
      } else {
        enterOnboarding(navigation, step);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Reset Password</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.iconCircle}>
            <Ionicons name="key-outline" size={28} color={colors.textPrimary} />
          </View>
          <Text style={styles.heading}>{codeSent ? 'Choose a new password' : 'Forgot your password?'}</Text>
          <Text style={styles.subtitle}>
            {codeSent
              ? `Enter the 6-digit code sent to ${email.trim()}, and your new password.`
              : 'Enter your email and we will send you a code to reset it.'}
          </Text>

          {codeSent ? (
            <>
              <Input
                label="Code"
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
                placeholder="6-digit code"
                keyboardType="numeric"
                maxLength={6}
                textContentType={Platform.OS === 'ios' ? 'oneTimeCode' : undefined}
                syncOnChange
                required
              />
              <Input
                label="New password"
                value={password}
                onChangeText={setPassword}
                placeholder="At least 8 characters"
                secureTextEntry
                required
              />
            </>
          ) : (
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              textContentType={Platform.OS === 'ios' ? 'emailAddress' : undefined}
              required
            />
          )}

          <Button
            title={codeSent ? 'Reset password' : 'Send code'}
            onPress={codeSent ? resetPassword : sendCode}
            loading={loading}
            disabled={loading}
            fullWidth
            size="lg"
            style={styles.button}
          />
          {codeSent && (
            <TouchableOpacity onPress={sendCode} disabled={loading} style={styles.link} accessibilityRole="button">
              <Text style={styles.linkText}>Send a new code</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  // Same header as the code screen (OTPVerifyScreen)
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
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
  headerTitle: { ...typography.h4, color: colors.textPrimary },
  headerSpacer: { width: 40 },
  content: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxl },
  iconCircle: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xxl,
    marginBottom: spacing.xxl,
  },
  heading: { ...typography.h2, color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.sm },
  subtitle: {
    ...typography.body1,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.xxl,
  },
  button: { marginTop: spacing.lg },
  link: { alignSelf: 'center', paddingVertical: spacing.md, marginTop: spacing.sm },
  linkText: { ...typography.body2, color: colors.textSecondary },
});

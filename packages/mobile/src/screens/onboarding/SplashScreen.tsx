import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useOtpVerify } from 'react-native-otp-verify';
import { useAuthStore } from '../../store/authStore';
import { useToast } from '../../hooks/useToast';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { colors, typography, spacing } from '../../theme';

export const SplashScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [mode, setMode] = useState<'login' | 'register' | 'otp'>('login');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, register, verifyOtp } = useAuthStore();
  const toast = useToast();
  const { otp: detectedOtp, hash } = useOtpVerify({ numberOfDigits: 6 });

  // Auto-fill OTP when detected from SMS (Android SMS Retriever API)
  useEffect(() => {
    if (detectedOtp && detectedOtp !== otp) {
      setOtp(detectedOtp);
      toast.showSuccess('OTP Detected', 'Code has been auto-filled.');
    }
  }, [detectedOtp]);

  // Log app hash for backend SMS template configuration
  useEffect(() => {
    if (hash) {
      console.log('[OTP] App Hash:', hash);
    }
  }, [hash]);

  const handleSubmit = async () => {
    // Client-side validation
    if (!phone || !password) {
      toast.showError('Validation Error', 'Please fill in all required fields.');
      return;
    }
    if (mode === 'register' && !firstName) {
      toast.showError('Validation Error', 'Please enter your first name.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        const result = await login(phone, password);
        if (result.success) {
          toast.showSuccess('Welcome back!', 'You have signed in successfully.');
          navigation.navigate('Identity');
        } else toast.showError('Login Failed', result.error || 'Please check your credentials and try again.');
      } else if (mode === 'register') {
        const payload: { phone: string; password: string; displayName?: string } = { phone, password };
        if (firstName) payload.displayName = firstName;
        const result = await register(payload);
        if (result.success) {
          toast.showSuccess('Account Created', 'Welcome to Kinetik!');
          navigation.navigate('Identity');
        } else toast.showError('Registration Failed', result.error || 'Could not create your account. Please try again.');
      } else if (mode === 'otp') {
        const result = await verifyOtp(phone, otp);
        if (result.success) {
          toast.showSuccess('Verified!', 'You have signed in successfully.');
          navigation.navigate('Identity');
        } else toast.showError('Verification Failed', result.error || 'Invalid verification code. Please try again.');
      }
    } catch (e: any) {
      toast.showError('Network Error', e?.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* Logo */}
        <View style={styles.logoContainer}>
          <View style={styles.logoIcon}>
            <Ionicons name="flash" size={36} color={colors.textPrimary} />
          </View>
          <Text style={styles.title}>Kinetik</Text>
          <Text style={styles.tagline}>Skip the chat. Meet already.</Text>
        </View>

        {/* Auth Form */}
        <View style={styles.form}>
          {mode !== 'otp' ? (
            <>
              <Input
                label="Phone Number"
                value={phone}
                onChangeText={setPhone}
                placeholder="+1 555-0123"
                keyboardType="phone-pad"
                required
              />

              <Input
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder="Enter your password"
                secureTextEntry
                required
              />

              {mode === 'register' && (
                <>
                  <Input
                    label="First Name"
                    value={firstName}
                    onChangeText={setFirstName}
                    placeholder="John"
                    autoCapitalize="words"
                    required
                  />
                  <Input
                    label="Last Name"
                    value={lastName}
                    onChangeText={setLastName}
                    placeholder="Doe"
                    autoCapitalize="words"
                    required
                  />
                  <Input
                    label="Middle Name (optional)"
                    value={middleName}
                    onChangeText={setMiddleName}
                    placeholder="Middle name"
                    autoCapitalize="words"
                  />
                </>
              )}
            </>
          ) : (
            <>
              <Input
                label="Phone Number"
                value={phone}
                onChangeText={setPhone}
                placeholder="+1 555-0123"
                keyboardType="phone-pad"
                editable={false}
                required
              />
              <Input
                label="Verification Code"
                value={otp}
                onChangeText={setOtp}
                placeholder="000000"
                keyboardType="numeric"
                maxLength={6}
                required
                textContentType={Platform.OS === 'ios' ? 'oneTimeCode' : undefined}
              />
            </>
          )}

          <Button
            title={mode === 'login' ? 'Sign In' : mode === 'register' ? 'Create Account' : 'Verify Code'}
            onPress={handleSubmit}
            loading={loading}
            disabled={loading}
            fullWidth
            size="lg"
          />

          {/* Mode switcher */}
          <View style={styles.switchContainer}>
            {mode === 'login' && (
              <TouchableOpacity onPress={() => setMode('otp')}>
                <Text style={styles.switchText}>Use OTP instead</Text>
              </TouchableOpacity>
            )}
            {mode !== 'register' && mode !== 'otp' && (
              <TouchableOpacity onPress={() => setMode('register')}>
                <Text style={styles.switchText}>No account? Sign up</Text>
              </TouchableOpacity>
            )}
            {mode === 'register' && (
              <TouchableOpacity onPress={() => setMode('login')}>
                <Text style={styles.switchText}>Already have an account? Sign in</Text>
              </TouchableOpacity>
            )}
            {mode === 'otp' && (
              <TouchableOpacity onPress={() => setMode('login')}>
                <Text style={styles.switchText}>Back to sign in</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.huge,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: spacing.xxxl,
  },
  logoIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm, textAlign: 'center' },
  tagline: { ...typography.body1, color: colors.textSecondary, textAlign: 'center' },
  form: { width: '100%' },
  switchContainer: { alignItems: 'center', marginTop: spacing.lg },
  switchText: { ...typography.body2, color: colors.textPrimary, marginTop: spacing.sm },
});

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/authStore';
import { useToast } from '../../hooks/useToast';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { colors, typography, spacing, radius } from '../../theme';

export const SplashScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const toast = useToast();

  const clearError = () => setErrorMsg('');

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
          if (result.requiresOtp) {
            // Credentials valid — navigate to OTP verification
            navigation.navigate('OTPVerify');
          } else {
            // OAuth login without OTP (handled by backend)
            toast.showSuccess('Welcome back!', 'You have signed in successfully.');
            // Read live onboarding status from store (avoid stale closure)
            if (useAuthStore.getState().onboardingStep === 'complete') {
              navigation.getParent()?.reset({ index: 0, routes: [{ name: 'Main' }] });
            } else {
              navigation.navigate('Identity');
            }
          }
        } else {
          console.log('[LOGIN] failed:', result.error || 'unknown');
          toast.showError('Login Failed', result.error || 'Invalid phone or password.');
          setErrorMsg(result.error || 'Wrong credential. Please try again.');
        }
      } else if (mode === 'register') {
        const payload: { phone: string; password: string; displayName?: string } = { phone, password };
        if (firstName) payload.displayName = firstName;
        const result = await register(payload);
        if (result.success) {
          toast.showSuccess('Account Created', 'Your account has been created. Please sign in.');
          setMode('login');
          setPassword('');
          setFirstName('');
          setLastName('');
          setMiddleName('');
        } else if (result.errorCode === 'PHONE_EXISTS') {
          // Graceful glassmorphic toast for duplicate phone
          toast.showGlass('Phone already exists!', 'Try signing in instead.');
        } else {
          toast.showError('Registration Failed', result.error || 'Could not create your account. Please try again.');
        }
      }
    } catch (e: any) {
      const errMsg = String(e?.message || e);
      console.log('[LOGIN] unexpected error:', errMsg);
      toast.showError('Connection Error', 'Unable to reach server. Please check your connection.');
      setErrorMsg('Connection error. Please check your network and try again.');
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
          {mode === 'register' && (
            <Text style={styles.registerSubtext}>Create your account to get started</Text>
          )}
        </View>

        {/* Auth Form */}
        <View style={styles.form}>
          <Input
            label="Phone Number"
            value={phone}
            onChangeText={(t) => { setPhone(t); clearError(); }}
            placeholder="+1 555-0123"
            keyboardType="phone-pad"
            required
          />

          <Input
            label="Password"
            value={password}
            onChangeText={(t) => { setPassword(t); clearError(); }}
            placeholder={mode === 'register' ? 'Create a password' : 'Enter your password'}
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

          <Button
            title={mode === 'login' ? 'Sign In' : 'Create Account'}
            onPress={handleSubmit}
            loading={loading}
            disabled={loading}
            fullWidth
            size="lg"
          />

          {/* Inline error message */}
          {errorMsg ? (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle-outline" size={16} color={colors.textPrimary} />
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          ) : null}

          {/* Mode switcher */}
          <View style={styles.switchContainer}>
            {mode === 'login' ? (
              <TouchableOpacity onPress={() => { setMode('register'); clearError(); }}>
                <Text style={styles.switchText}>No account? Sign up</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={() => { setMode('login'); clearError(); }}>
                <Text style={styles.switchText}>Already have an account? Sign in</Text>
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
  registerSubtext: { ...typography.body2, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm },
  form: { width: '100%' },
  switchContainer: { alignItems: 'center', marginTop: spacing.xl },
  switchText: { ...typography.body2, color: colors.textPrimary, marginTop: spacing.sm },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  errorText: {
    ...typography.body2,
    color: colors.textPrimary,
    flex: 1,
  },
});

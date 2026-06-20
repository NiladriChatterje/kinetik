import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/authStore';
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
  const { login, register, verifyOtp } = useAuthStore();

  const handleSubmit = async () => {
    if (mode === 'login') {
      const success = await login(phone, password);
      if (success) navigation.navigate('Identity');
    } else if (mode === 'register') {
      const payload: { phone: string; password: string; displayName?: string } = { phone, password };
      if (firstName) payload.displayName = firstName;
      const success = await register(payload);
      if (success) navigation.navigate('Identity');
    } else if (mode === 'otp') {
      const success = await verifyOtp(phone, otp);
      if (success) navigation.navigate('Identity');
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
              />

              <Input
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder="Enter your password"
                secureTextEntry
              />

              {mode === 'register' && (
                <>
                  <Input
                    label="First Name"
                    value={firstName}
                    onChangeText={setFirstName}
                    placeholder="John"
                    autoCapitalize="words"
                  />
                  <Input
                    label="Last Name"
                    value={lastName}
                    onChangeText={setLastName}
                    placeholder="Doe"
                    autoCapitalize="words"
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
              />
              <Input
                label="Verification Code"
                value={otp}
                onChangeText={setOtp}
                placeholder="000000"
                keyboardType="numeric"
                maxLength={6}
              />
            </>
          )}

          <Button
            title={mode === 'login' ? 'Sign In' : mode === 'register' ? 'Create Account' : 'Verify Code'}
            onPress={handleSubmit}
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

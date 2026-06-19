import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, Animated,
  KeyboardAvoidingView, Platform, TouchableOpacity,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/authStore';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { colors, typography, spacing, radius } from '../../theme';

export const SplashScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [mode, setMode] = useState<'login' | 'register' | 'otp'>('login');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [email, setEmail] = useState('');
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;
  const { login, register, verifyOtp } = useAuthStore();

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();
  }, [mode]);

  const handleSubmit = async () => {
    if (mode === 'login') {
      const success = await login(phone, password);
      if (success) navigation.navigate('Identity');
    } else if (mode === 'register') {
      const success = await register({ phone, email, password });
      if (success) navigation.navigate('Identity');
    } else if (mode === 'otp') {
      const success = await verifyOtp(phone, otp);
      if (success) navigation.navigate('Identity');
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#0A0A0F', '#141418']} style={StyleSheet.absoluteFill} />
      
      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Animated.View style={[{ flex: 1 }, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
          >
          {/* Logo */}
          <View style={styles.logoContainer}>
            <View style={styles.logoIcon}>
              <Ionicons name="flash" size={36} color={colors.primary} />
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
                {mode === 'register' && (
                  <Input
                    label="Email"
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                )}
                {mode === 'login' && (
                  <Input
                    label="Password"
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Enter your password"
                    secureTextEntry
                  />
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

            {/* Social auth */}
            <View style={styles.socialContainer}>
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or continue with</Text>
                <View style={styles.dividerLine} />
              </View>
              <View style={styles.socialButtons}>
                <TouchableOpacity style={styles.socialButton}>
                  <Ionicons name="logo-apple" size={24} color={colors.textPrimary} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.socialButton}>
                  <Ionicons name="logo-google" size={24} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.huge,
  },
  logoContainer: { alignItems: 'center', marginBottom: spacing.xxxl },
  logoIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm },
  tagline: { ...typography.body1, color: colors.textSecondary },
  form: { width: '100%' },
  switchContainer: { alignItems: 'center', marginTop: spacing.lg },
  switchText: { ...typography.body2, color: colors.primary, marginTop: spacing.sm },
  socialContainer: { marginTop: spacing.xxl },
  divider: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.cardBorder },
  dividerText: { ...typography.caption, color: colors.textMuted, marginHorizontal: spacing.lg },
  socialButtons: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg },
  socialButton: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center', justifyContent: 'center',
  },
});

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Animated, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/authStore';
import { useToast } from '../../hooks/useToast';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { colors, typography, spacing, radius } from '../../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SEGMENT_WIDTH = SCREEN_WIDTH - spacing.xxl * 2;
const SEGMENT_TAB_WIDTH = (SEGMENT_WIDTH - 4) / 2;

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

  // ─── Entrance animations ──────────────────────────────
  const logoScale = useRef(new Animated.Value(0.6)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const formOpacity = useRef(new Animated.Value(0)).current;
  const formTranslateY = useRef(new Animated.Value(30)).current;
  const segmentX = useRef(new Animated.Value(mode === 'login' ? 0 : 1)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.spring(logoScale, {
          toValue: 1,
          friction: 8,
          tension: 60,
          useNativeDriver: true,
        }),
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(formOpacity, {
          toValue: 1,
          duration: 350,
          useNativeDriver: true,
        }),
        Animated.spring(formTranslateY, {
          toValue: 0,
          friction: 9,
          tension: 70,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, []);

  useEffect(() => {
    Animated.spring(segmentX, {
      toValue: mode === 'login' ? 0 : 1,
      friction: 8,
      tension: 80,
      useNativeDriver: false,
    }).start();
  }, [mode]);

  const clearError = () => setErrorMsg('');

  const handleModeSwitch = (newMode: 'login' | 'register') => {
    if (newMode === mode) return;
    setMode(newMode);
    clearError();
    setPassword('');
    setFirstName('');
    setLastName('');
    setMiddleName('');
  };

  const handleSubmit = async () => {
    if (!phone || !password) {
      toast.showError('Missing fields', 'Fill in all required fields.');
      return;
    }
    if (mode === 'register' && !firstName) {
      toast.showError('Missing name', 'Enter your first name.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        const result = await login(phone, password);
        if (result.success) {
          if (result.requiresOtp) {
            navigation.navigate('OTPVerify');
          } else {
            toast.showSuccess('Welcome back!', 'Signed in successfully.');
            if (useAuthStore.getState().onboardingStep === 'complete') {
              navigation.getParent()?.reset({ index: 0, routes: [{ name: 'Main' }] });
            } else {
              navigation.navigate('Identity');
            }
          }
        } else {
          console.log('[LOGIN] failed:', result.error || 'unknown');
          toast.showError('Login failed', result.error || 'Invalid phone or password.');
          setErrorMsg(result.error || 'Wrong credential. Please try again.');
        }
      } else if (mode === 'register') {
        const payload: { phone: string; password: string; displayName?: string } = { phone, password };
        if (firstName) payload.displayName = firstName;
        const result = await register(payload);
        if (result.success) {
          toast.showSuccess('Account created', 'Please sign in.');
          setMode('login');
          setPassword('');
          setFirstName('');
          setLastName('');
          setMiddleName('');
        } else if (result.errorCode === 'PHONE_EXISTS') {
          toast.showGlass('Phone exists', 'Try signing in instead.');
        } else {
          toast.showError('Signup failed', result.error || 'Please try again.');
        }
      }
    } catch (e: any) {
      const errMsg = String(e?.message || e);
      console.log('[LOGIN] unexpected error:', errMsg);
      toast.showError('No connection', 'Check your network and retry.');
      setErrorMsg('Connection error. Please check your network and try again.');
    } finally {
      setLoading(false);
    }
  };

  const indicatorTranslateX = segmentX.interpolate({
    inputRange: [0, 1],
    outputRange: [0, SEGMENT_TAB_WIDTH + 4],
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* ─── Fixed Top: Logo + Segment ──────────────────── */}
      <Animated.View style={[styles.topSection, { opacity: logoOpacity, transform: [{ scale: logoScale }] }]}>
        <View style={styles.logoIcon}>
          <Ionicons name="flash" size={32} color={colors.textInverse} />
        </View>
        <Text style={styles.title}>Kinetik</Text>
        <Text style={styles.tagline}>Where real connections begin</Text>
      </Animated.View>

      {/* Segmented control sits just below the logo, still fixed */}
      <Animated.View style={[styles.segmentSection, { opacity: formOpacity, transform: [{ translateY: formTranslateY }] }]}>
        <View style={styles.segmentTrack}>
          <Animated.View
            style={[styles.segmentIndicator, { transform: [{ translateX: indicatorTranslateX }] }]}
          />
          <TouchableOpacity
            style={styles.segmentTab}
            onPress={() => handleModeSwitch('login')}
            activeOpacity={0.8}
          >
            <Text style={[styles.segmentText, mode === 'login' && styles.segmentTextActive]}>
              Sign In
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.segmentTab}
            onPress={() => handleModeSwitch('register')}
            activeOpacity={0.8}
          >
            <Text style={[styles.segmentText, mode === 'register' && styles.segmentTextActive]}>
              Sign Up
            </Text>
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* ─── Scrollable Middle: Form Fields ─────────────── */}
      <Animated.View style={[styles.formSection, { opacity: formOpacity, transform: [{ translateY: formTranslateY }] }]}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {mode === 'register' && (
            <Text style={styles.registerSubtext}>Create your account to get started</Text>
          )}

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

          {errorMsg ? (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle-outline" size={16} color={colors.textPrimary} />
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          ) : null}
        </ScrollView>
      </Animated.View>

      {/* ─── Fixed Bottom: Button ───────────────────────── */}
      <View style={styles.bottomSection}>
        <Button
          title={mode === 'login' ? 'Sign In' : 'Create Account'}
          onPress={handleSubmit}
          loading={loading}
          disabled={loading}
          fullWidth
          size="lg"
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // ─── Fixed Top: Logo ─────────────────────────────────
  topSection: {
    alignItems: 'center',
    paddingTop: spacing.huge - spacing.lg,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.xxl,
  },
  logoIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  title: {
    fontFamily: 'Cantarell-Bold',
    fontSize: 40,
    lineHeight: 46,
    fontWeight: '700',
    letterSpacing: -1.5,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  tagline: {
    fontFamily: 'Cantarell-Regular',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
    color: colors.textSecondary,
    letterSpacing: 0.2,
  },

  // ─── Fixed: Segmented Control ────────────────────────
  segmentSection: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.lg,
  },
  segmentTrack: {
    height: 44,
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    padding: 2,
    position: 'relative',
  },
  segmentIndicator: {
    position: 'absolute',
    top: 2,
    left: 2,
    width: SEGMENT_TAB_WIDTH,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.textPrimary,
  },
  segmentTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
  segmentTextActive: {
    color: colors.textInverse,
  },

  // ─── Scrollable Middle: Form Fields ──────────────────
  formSection: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.md,
  },
  registerSubtext: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },

  // ─── Fixed Bottom: Button ────────────────────────────
  bottomSection: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxl,
    paddingTop: spacing.md,
    backgroundColor: colors.background,
  },

  // ─── Error ───────────────────────────────────────────
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

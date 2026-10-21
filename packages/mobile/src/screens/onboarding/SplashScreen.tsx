import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ScrollView, Animated, Dimensions,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore, signupEmailKey } from '../../store/authStore';
import { useToast } from '../../hooks/useToast';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { LocationPicker, LocationSelection } from '../../components/common/LocationPicker';
import { enterOnboarding } from '../../navigation/onboardingFlow';
import { colors, typography, spacing, radius } from '../../theme';

const LOGO = require('../../assets/images/logo.png');

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SEGMENT_WIDTH = SCREEN_WIDTH - spacing.xxl * 2;
const SEGMENT_TAB_WIDTH = (SEGMENT_WIDTH - 4) / 2;

// Loose shape check only — the server validates properly and the one-time
// code proves the address is real.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "about 23 hours" / "about 40 minutes" for the sign-up lock message. */
function roughDuration(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  if (minutes < 60) return `about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.ceil(minutes / 60);
  return `about ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

export const SplashScreen: React.FC<{ navigation: any; route?: any }> = ({ navigation, route }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [middleName, setMiddleName] = useState('');
  // Where the user lives — seeds the feed origin until GPS is granted
  const [location, setLocation] = useState<LocationSelection | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const login = useAuthStore((s) => s.login);
  const startSignup = useAuthStore((s) => s.startSignup);
  const signupLocks = useAuthStore((s) => s.signupLocks);
  const toast = useToast();

  // Opened while signed in with onboarding unfinished (the app was closed
  // mid-onboarding): carry on from the saved step instead of asking to sign
  // in again. Read once, when the screen opens: during a sign-in or sign-up
  // it opened signed out, and those flows hand off to onboarding themselves.
  const [resumeStep] = useState(() => {
    const { isAuthenticated, onboardingStep } = useAuthStore.getState();
    return isAuthenticated && onboardingStep !== 'complete' ? onboardingStep : null;
  });
  useEffect(() => {
    if (resumeStep) enterOnboarding(navigation, resumeStep);
    // Once, when the screen opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // All sign-up codes for this email are used up for today: Create Account
  // stays disabled until the server's 24-hour window ends.
  const lockedUntil = signupLocks[signupEmailKey(email)] ?? 0;
  const [now, setNow] = useState(Date.now());
  const signupLocked = mode === 'register' && lockedUntil > now;
  useEffect(() => {
    if (!signupLocked) return;
    const interval = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(interval);
  }, [signupLocked]);
  useEffect(() => setNow(Date.now()), [lockedUntil]);

  // The code screen sends an already registered email back here to sign in
  useEffect(() => {
    if (route?.params?.mode === 'login') {
      handleModeSwitch('login');
      navigation.setParams({ mode: undefined });
    }
  }, [route?.params?.mode]);

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

  // Email is the login identity: the one-time code is emailed through Brevo.
  // The server lowercases and trims it, so casing here does not matter.
  const clearError = () => setErrorMsg('');

  // Email and password are shared by both tabs and deliberately kept. Input
  // does not push a cleared value into a field that still has focus, so
  // clearing them here left text on screen that the form no longer held and
  // submit failed with Missing fields.
  const handleModeSwitch = (newMode: 'login' | 'register') => {
    if (newMode === mode) return;
    setMode(newMode);
    clearError();
    setFirstName('');
    setLastName('');
    setMiddleName('');
    setLocation(null);
  };

  const handleSubmit = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      toast.showError('Missing fields', 'Fill in all required fields.');
      return;
    }
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      toast.showError('Invalid email', 'Enter a valid email address.');
      return;
    }
    if (mode === 'register' && !firstName) {
      toast.showError('Missing name', 'Enter your first name.');
      return;
    }
    if (mode === 'register' && !location) {
      toast.showError('Missing location', 'Select your country and city.');
      return;
    }
    if (mode === 'register' && password.length < 8) {
      toast.showError('Password too short', 'Use at least 8 characters.');
      return;
    }
    if (signupLocked) return;
    setLoading(true);
    try {
      if (mode === 'login') {
        const result = await login(trimmedEmail, password);
        if (result.success) {
          toast.showSuccess('Welcome back!', 'Signed in successfully.');
          const step = useAuthStore.getState().onboardingStep;
          if (step === 'complete') {
            navigation.getParent()?.reset({ index: 0, routes: [{ name: 'Main' }] });
          } else {
            enterOnboarding(navigation, step);
          }
        } else {
          console.log('[LOGIN] failed:', result.error || 'unknown');
          toast.showError('Login failed', result.error || 'Invalid email or password.');
          setErrorMsg(result.error || 'Wrong credential. Please try again.');
        }
      } else if (mode === 'register' && location) {
        const payload: { email: string; password: string; displayName?: string; countryCode: string; city: string; stateCode?: string } = {
          email: trimmedEmail,
          password,
          countryCode: location.countryCode,
          city: location.city,
          stateCode: location.stateCode,
        };
        if (firstName) payload.displayName = firstName;
        // Emails a code; the account is created once it is verified. The
        // form stays filled in underneath, so a failed or expired code
        // comes back to it unchanged.
        const result = await startSignup(payload);
        if (result.success) {
          toast.showSuccess('Code sent', 'Check your inbox.');
          navigation.navigate('OTPVerify');
        } else if (result.errorCode === 'SIGNUP_LOCKED') {
          toast.showError('Sign-up locked', result.error || 'Try again in 24 hours.');
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

  // Moving on to the saved step: no sign-in form flashing up first
  if (resumeStep) return <View style={styles.container} />;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
      {/* ─── Fixed Top: Logo + Segment ──────────────────── */}
      <Animated.View style={[styles.topSection, { opacity: logoOpacity, transform: [{ scale: logoScale }] }]}>
        <View style={styles.logoIcon}>
          <Image source={LOGO} style={styles.logoImage} resizeMode="contain" />
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
            label="Email"
            value={email}
            onChangeText={(t) => { setEmail(t); clearError(); }}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            textContentType={Platform.OS === 'ios' ? 'emailAddress' : undefined}
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
              <LocationPicker value={location} onChange={setLocation} required />
            </>
          )}

          {signupLocked ? (
            <View style={styles.errorBanner}>
              <Ionicons name="lock-closed-outline" size={16} color={colors.textPrimary} />
              <Text style={styles.errorText}>
                All 3 verification codes for this email were used today, so sign-up is locked
                for 24 hours. Try again in {roughDuration(lockedUntil - now)}.
              </Text>
            </View>
          ) : null}

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
          disabled={loading || signupLocked}
          fullWidth
          size="lg"
        />
      </View>
      </KeyboardAvoidingView>
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
  // The logo as it is: the black couple straight on the page, no tile
  logoIcon: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  // logo.png has wide transparent margins (the drawing is 57% of its
  // height), so the box overhangs this slot to draw the couple ~72 tall
  logoImage: {
    width: 127,
    height: 127,
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

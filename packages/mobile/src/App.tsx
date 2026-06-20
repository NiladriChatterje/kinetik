import React, { useEffect, useRef } from 'react';
import { LogBox, View, Text, StyleSheet, Animated, TouchableOpacity, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as NavigationBar from 'expo-navigation-bar';
import Toast, { BaseToastProps } from 'react-native-toast-message';
import { RootNavigator } from './navigation/RootNavigator';
import { useAuthStore } from './store/authStore';
import { colors, typography, spacing, radius, animation } from './theme';

// Suppress InteractionManager deprecation warnings from third-party libraries
// (react-navigation v6, react-native-screens, etc. use it internally)
// TODO: Remove when these libraries update to avoid deprecated API
LogBox.ignoreLogs([
  'InteractionManager has been deprecated',
  'InteractionManager.runAfterInteractions',
]);

// ─── Animated Toast Wrapper ───────────────────────────────

const AnimatedToastWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const slideAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      damping: 20,
      stiffness: 200,
      useNativeDriver: true,
    }).start();
  }, []);

  return (
    <Animated.View
      style={{
        transform: [
          {
            translateX: slideAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 350],
            }),
          },
        ],
        opacity: slideAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [1, 0],
        }),
      }}
    >
      {children}
    </Animated.View>
  );
};

// ─── Toast Card ───────────────────────────────────────────

const ICON_MAP = {
  error: 'close-circle-outline' as const,
  success: 'checkmark-circle-outline' as const,
};

const ACCENT_MAP = {
  error: '#FF6B6B' as const,
  success: '#4CAF50' as const,
};

const ToastCard: React.FC<BaseToastProps & { accentColor: string; iconName: keyof typeof ICON_MAP }> = ({ text1, text2, hide, accentColor, iconName }) => (
  <TouchableOpacity
    activeOpacity={0.85}
    onPress={hide}
    style={{
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#1c1c1e',
      borderRadius: 10,
      maxWidth: 320,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 10 } as const,
          shadowOpacity: 0.4,
          shadowRadius: 20,
        },
        android: { elevation: 16 },
      }),
    }}
  >
    {/* Accent bar on the left */}
    <View style={{ width: 4, backgroundColor: accentColor, alignSelf: 'stretch', borderTopLeftRadius: 10, borderBottomLeftRadius: 10 }} />

    {/* Icon */}
    <View style={{ paddingLeft: 14, paddingRight: 4 }}>
      <Ionicons name={ICON_MAP[iconName]} size={18} color={accentColor} />
    </View>

    {/* Text content */}
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingRight: 16, flex: 1 }}>
      <Text style={{ color: '#ffffff', fontWeight: '600', fontSize: 12, letterSpacing: 0.2 }}>{text1}</Text>
      {text2 ? (
        <>
          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#555', marginHorizontal: 6 }} />
          <Text style={{ color: '#b0b0b0', fontSize: 11, flexShrink: 1 }} numberOfLines={1}>
            {text2}
          </Text>
        </>
      ) : null}
    </View>
  </TouchableOpacity>
);

// ─── Custom Toast Config ──────────────────────────────────

const toastConfig = {
  error: (props: BaseToastProps) => (
    <AnimatedToastWrapper>
      <ToastCard {...props} accentColor={ACCENT_MAP.error} iconName="error" />
    </AnimatedToastWrapper>
  ),
  success: (props: BaseToastProps) => (
    <AnimatedToastWrapper>
      <ToastCard {...props} accentColor={ACCENT_MAP.success} iconName="success" />
    </AnimatedToastWrapper>
  ),
};

export default function App() {
  const initialize = useAuthStore((s) => s.initialize);
  const checkConnection = useAuthStore((s) => s.checkConnection);
  const connectionStatus = useAuthStore((s) => s.connectionStatus);
  const connectionError = useAuthStore((s) => s.connectionError);
  const bannerAnim = useRef(new Animated.Value(0)).current;
  const bannerVisible = useRef(false);
  const [isRetrying, setIsRetrying] = React.useState(false);

  // Initialize auth state (checks for stored token), but don't pre-call any API until credentials are provided
  useEffect(() => {
    initialize();

    // Hide Android system navigation bar for a more immersive experience
    if (Platform.OS === 'android') {
      NavigationBar.setVisibilityAsync('hidden');
      NavigationBar.setBehaviorAsync('overlay-swipe');
    }
  }, []);

  // Animate banner in/out
  useEffect(() => {
    const shouldShow = connectionStatus === 'disconnected';
    if (shouldShow && !bannerVisible.current) {
      bannerVisible.current = true;
      Animated.spring(bannerAnim, { toValue: 1, useNativeDriver: true, damping: 15, stiffness: 150 }).start();
    } else if (!shouldShow && bannerVisible.current) {
      bannerVisible.current = false;
      Animated.timing(bannerAnim, { toValue: 0, duration: animation.quick, useNativeDriver: true }).start();
    }
  }, [connectionStatus]);

  const bannerTranslateY = bannerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-80, 0],
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <RootNavigator />

        {/* Offline banner */}
        <Animated.View
          style={[styles.banner, { transform: [{ translateY: bannerTranslateY }], opacity: bannerAnim }]}
          pointerEvents={connectionStatus === 'disconnected' ? 'auto' : 'none'}
        >
          <View style={styles.bannerContent}>
            <Ionicons name="cloud-offline-outline" size={18} color={colors.textInverse} />
            <Text style={styles.bannerText}>{connectionError || 'Server unreachable'}</Text>
            <TouchableOpacity
              onPress={async () => {
                setIsRetrying(true);
                await checkConnection();
                setIsRetrying(false);
              }}
              disabled={isRetrying}
              style={[styles.bannerRetry, isRetrying && styles.bannerRetryDisabled]}
            >
              <Text style={styles.bannerRetryText}>{isRetrying ? 'Checking…' : 'Retry'}</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
        {/* Floating toast messages — pinned to top-right corner */}
        <Toast
          position="top"
          config={toastConfig}
          topOffset={0}
          visibilityTime={4000}
          contentContainerStyle={{ alignItems: 'flex-end', paddingRight: 16, paddingTop: 60 }}
        />
      </SafeAreaProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    backgroundColor: '#000000',
    paddingTop: 50, // above safe area
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  bannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerText: {
    ...typography.body2,
    color: colors.textInverse,
    flex: 1,
    marginLeft: spacing.sm,
  },
  bannerRetry: {
    marginLeft: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  bannerRetryText: {
    ...typography.buttonSmall,
    color: colors.textInverse,
  },
  bannerRetryDisabled: {
    opacity: 0.5,
  },
});

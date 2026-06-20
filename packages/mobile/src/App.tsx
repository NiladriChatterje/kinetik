import React, { useEffect, useRef } from 'react';
import { LogBox, View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
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

export default function App() {
  const initialize = useAuthStore((s) => s.initialize);
  const checkConnection = useAuthStore((s) => s.checkConnection);
  const connectionStatus = useAuthStore((s) => s.connectionStatus);
  const connectionError = useAuthStore((s) => s.connectionError);
  const bannerAnim = useRef(new Animated.Value(0)).current;
  const bannerVisible = useRef(false);
  const [isRetrying, setIsRetrying] = React.useState(false);

  // Initial health check
  useEffect(() => {
    initialize();
    checkConnection();
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

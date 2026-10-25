import React, { useEffect } from 'react';
import { AppState, LogBox, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFonts, Cantarell_400Regular, Cantarell_700Bold } from '@expo-google-fonts/cantarell';
import * as SplashScreen from 'expo-splash-screen';
import * as NavigationBar from 'expo-navigation-bar';
import Toast from 'react-native-toast-message';
import { IslandToast } from './components/common/IslandToast';
import { IslandStatus } from './components/common/IslandStatus';
import { SystemBarsFrame } from './components/common/SystemBars';
import { RootNavigator } from './navigation/RootNavigator';
import { useAuthStore } from './store/authStore';
import { useNotifications } from './hooks/useNotifications';
import { recoverPlayPurchases } from './services/purchaseRecovery';
import { colors } from './theme';

// Suppress InteractionManager deprecation warnings from third-party libraries
// (react-navigation v6, react-native-screens, etc. use it internally)
// TODO: Remove when these libraries update to avoid deprecated API
LogBox.ignoreLogs([
  'InteractionManager has been deprecated',
  'InteractionManager.runAfterInteractions',
  'Require cycles are allowed',
]);

// Hard-suppress InteractionManager deprecation warnings that slip past LogBox
// (e.g. from native modules or early-init code)
const _origWarn = console.warn;
console.warn = (...args: any[]) => {
  const msg = String(args[0] ?? '');
  if (
    msg.includes('InteractionManager has been deprecated') ||
    msg.includes('InteractionManager.runAfterInteractions') ||
    msg.includes('Require cycles are allowed')
  ) return;
  _origWarn.apply(console, args);
};

export default function App() {
  const initialize = useAuthStore((s) => s.initialize);
  const checkConnection = useAuthStore((s) => s.checkConnection);
  const connectionStatus = useAuthStore((s) => s.connectionStatus);
  const connectionError = useAuthStore((s) => s.connectionError);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [isRetrying, setIsRetrying] = React.useState(false);

  // A Play purchase the server never confirmed (app closed mid-purchase, or
  // the check failed) is sent again when a session starts and when the app
  // returns to the foreground, before Google refunds it (purchaseRecovery.ts)
  useEffect(() => {
    if (!isAuthenticated) return;
    recoverPlayPurchases();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') recoverPlayPurchases();
    });
    return () => sub.remove();
  }, [isAuthenticated]);

  const [fontsLoaded] = useFonts({
    'Cantarell-Regular': Cantarell_400Regular,
    'Cantarell-Bold': Cantarell_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  // Initialize push notifications
  useNotifications();

  // Initialize auth state (checks for stored token), but don't pre-call any API until credentials are provided
  useEffect(() => {
    initialize();

    // The Android navigation bar stays visible (SystemBarsFrame keeps the app
    // above it); its buttons are dark on the app's light background.
    // Gracefully handled in case the native module isn't available (Expo Go)
    if (Platform.OS === 'android') {
      try {
        NavigationBar.setStyle('dark');
      } catch {
        // Native module not available (Expo Go) — silent fallback
      }
    }
  }, []);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <SystemBarsFrame>
          <RootNavigator />
        </SystemBarsFrame>

        {/* Connection status — persistent Dynamic Island pill while offline */}
        <IslandStatus
          visible={connectionStatus === 'disconnected' || connectionStatus === 'slow'}
          tone={connectionStatus === 'slow' ? 'waiting' : 'error'}
          message={connectionError || 'Server unreachable'}
          retrying={isRetrying}
          onRetry={async () => {
            setIsRetrying(true);
            await checkConnection();
            setIsRetrying(false);
          }}
        />
        {/* Toast messages — Dynamic Island style: drops from the top to 15px
            as a dot, then expands sideways to reveal the message. Top-aligned
            so toasts stay visible while the keyboard is open. */}
        <Toast
          position="top"
          topOffset={50}
          visibilityTime={4000}
          config={{
            error: (props) => <IslandToast {...props} type="error" />,
            success: (props) => <IslandToast {...props} type="success" />,
            info: (props) => <IslandToast {...props} type="info" />,
            glass: (props) => <IslandToast {...props} type="glass" />,
          }}
        />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}


import React, { useEffect } from 'react';
import { LogBox, View, Platform } from 'react-native';
import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, Cantarell_400Regular, Cantarell_700Bold } from '@expo-google-fonts/cantarell';
import * as SplashScreen from 'expo-splash-screen';
import * as NavigationBar from 'expo-navigation-bar';
import Toast from 'react-native-toast-message';
import { IslandToast } from './components/common/IslandToast';
import { IslandStatus } from './components/common/IslandStatus';
import { RootNavigator } from './navigation/RootNavigator';
import { useAuthStore } from './store/authStore';
import { useNotifications } from './hooks/useNotifications';
import { colors } from './theme';

// Set up WebRTC globals (RTCPeerConnection, mediaDevices, etc.) required by
// LiveKit before any call screen is rendered.
//
// react-native-webrtc is a native module that only exists in development /
// production builds — it is NOT bundled in Expo Go. Importing
// @livekit/react-native there throws "WebRTC native module not found" at
// module load, which crashes the whole app before it can render. Guard the
// import so the app boots everywhere and only the voice/video call feature
// degrades (same pattern as services/notifications.ts).
try {
  if (Constants.executionEnvironment !== 'storeClient') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { registerGlobals } = require('@livekit/react-native');
    registerGlobals();
  }
  // Expo Go: silently skip — Voice/video calls are unavailable here
} catch {
  // Native module not available — silent fallback
}

// Suppress InteractionManager deprecation warnings from third-party libraries
// (react-navigation v6, react-native-screens, etc. use it internally)
// TODO: Remove when these libraries update to avoid deprecated API
LogBox.ignoreLogs([
  'InteractionManager has been deprecated',
  'InteractionManager.runAfterInteractions',
  'Text strings must be rendered within a <Text',
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
  const [isRetrying, setIsRetrying] = React.useState(false);

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

    // Attempt to hide Android system navigation bar for immersive experience
    // Gracefully handled in case the native module isn't available (Expo Go)
    if (Platform.OS === 'android') {
      try {
        NavigationBar.setVisibilityAsync('hidden');
      } catch {
        // Native module not available (Expo Go) — silent fallback
      }
    }
  }, []);

  if (!fontsLoaded) return null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <RootNavigator />

        {/* Connection status — persistent Dynamic Island pill while offline */}
        <IslandStatus
          visible={connectionStatus === 'disconnected'}
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
    </View>
  );
}


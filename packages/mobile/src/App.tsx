import React, { useEffect } from 'react';
import { LogBox } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './navigation/RootNavigator';
import { useAuthStore } from './store/authStore';
import { colors } from './theme';

// Suppress InteractionManager deprecation warnings from third-party libraries
// (react-navigation v6, react-native-screens, etc. use it internally)
// TODO: Remove when these libraries update to avoid deprecated API
LogBox.ignoreLogs([
  'InteractionManager has been deprecated',
  'InteractionManager.runAfterInteractions',
]);

export default function App() {
  const initialize = useAuthStore((state) => state.initialize);

  useEffect(() => {
    initialize();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <RootNavigator />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

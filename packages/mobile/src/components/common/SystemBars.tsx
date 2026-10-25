import React, { createContext, useContext, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../theme';

/**
 * The Android navigation bar (back, home, recents) stays on screen and the
 * app ends above it instead of drawing underneath it, so the buttons are
 * always there to press and never sit on top of a tab bar or a text field.
 *
 * The window is edge-to-edge, so this frame pads the bottom by the bar's
 * height and gives the screens a SafeAreaProvider of their own, measured
 * inside that padding: their bottom inset is then 0 and nothing is padded
 * twice. The screens keep the layout they had while the bar was hidden.
 *
 * The keyboard covers the bar, and the screens already move above the
 * keyboard the way they did before, so nothing changes while it is open.
 *
 * A <Modal> opens in a window of its own that still runs under the bar, so
 * a bottom sheet inside one pads itself with useNavigationBarInset().
 */
const NavigationBarInsetContext = createContext(0);

/** Height of the Android navigation bar under the current window, in dp. */
export const useNavigationBarInset = (): number => useContext(NavigationBarInsetContext);

export const SystemBarsFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  // The inner provider starts from the outer insets with the bottom already
  // taken by the frame, so the first paint does not jump once it measures.
  const [initialMetrics] = useState(() => ({ insets: { ...insets, bottom: 0 }, frame }));

  if (Platform.OS !== 'android') return <>{children}</>;

  return (
    <View style={[styles.frame, { paddingBottom: insets.bottom }]}>
      <NavigationBarInsetContext.Provider value={insets.bottom}>
        <SafeAreaProvider initialMetrics={initialMetrics}>{children}</SafeAreaProvider>
      </NavigationBarInsetContext.Provider>
    </View>
  );
};

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: colors.background },
});

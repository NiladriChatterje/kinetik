import React, { useContext, useEffect, useState } from 'react';
import { Image, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomTabBarHeightContext, type BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { CommonActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, typography } from '../theme';

/**
 * The main tabs as a compact pill floating over the bottom of the screen:
 * flat matte near-black slate with a fine grain, white icons and labels
 * (the open tab full white, the others dimmed), a hairline edge and a soft
 * shadow to lift it off the page.
 *
 * The screens run under it, so a tab's scrolling list pads its end by
 * useTabBarSpace() to let the last row scroll clear of the pill. It hides
 * while the keyboard is open.
 */

/** Height of the pill, in dp. */
const BAR_HEIGHT = 58;
/** Gap between the pill and the bottom edge, and above it to the content. */
const BAR_GAP = 12;
/** Width of one tab; fixed so the icons sit close together, not spread out. */
const ITEM_WIDTH = 68;
/** Softly rounded corners rather than full round ends. */
const BAR_RADIUS = 20;
/**
 * Tile of faint black and white specks (about 5% opacity on average). The
 * file is grain@2x.png, 128px drawn as 64 dp; Metro picks it from this name.
 */
const GRAIN = require('../assets/images/grain.png');

function useKeyboardVisible(enabled = true): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const show = Keyboard.addListener('keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [enabled]);
  return enabled && visible;
}

/**
 * Room to leave at the bottom of a tab's content so nothing ends hidden
 * under the floating pill; 0 outside the tabs. With dropWhileTyping, 0
 * while the keyboard is open too (the pill is hidden then), for a pane
 * whose text field would otherwise sit that far above the keyboard.
 */
export function useTabBarSpace({ dropWhileTyping = false } = {}): number {
  const inTabs = useContext(BottomTabBarHeightContext) !== undefined;
  const { bottom } = useSafeAreaInsets();
  const typing = useKeyboardVisible(inTabs && dropWhileTyping);
  if (!inTabs || typing) return 0;
  return BAR_HEIGHT + bottom + BAR_GAP * 2;
}

export const FloatingTabBar: React.FC<BottomTabBarProps> = ({ state, descriptors, navigation }) => {
  const { bottom } = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  if (keyboardVisible) return null;

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: bottom + BAR_GAP }]}>
      <View style={styles.pill} accessibilityRole="tablist">
        {/* Fine grain over the flat fill: the matte finish */}
        <View pointerEvents="none" style={styles.grainClip}>
          <Image source={GRAIN} resizeMode="repeat" style={StyleSheet.absoluteFill} />
        </View>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const focused = index === state.index;
          const color = focused ? colors.tabBarActive : colors.tabBarInactive;
          const label = typeof options.tabBarLabel === 'string' ? options.tabBarLabel : options.title ?? route.name;

          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) {
              navigation.dispatch({
                ...CommonActions.navigate({ name: route.name, merge: true }),
                target: state.key,
              });
            }
          };
          const onLongPress = () => navigation.emit({ type: 'tabLongPress', target: route.key });

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              onLongPress={onLongPress}
              style={styles.item}
              android_ripple={{ color: colors.tabBarRipple, borderless: true, radius: 30 }}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
            >
              {options.tabBarIcon?.({ focused, color, size: 22 })}
              <Text style={[styles.label, focused && styles.labelFocused, { color }]} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    height: BAR_HEIGHT,
    paddingHorizontal: 6,
    borderRadius: BAR_RADIUS,
    backgroundColor: colors.tabBarBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.tabBarBorder,
    boxShadow: colors.tabBarShadow,
  },
  // Its own clip, so the pill itself keeps no overflow clip that could cut
  // its shadow
  grainClip: {
    ...StyleSheet.absoluteFill,
    borderRadius: BAR_RADIUS,
    overflow: 'hidden',
  },
  item: {
    width: ITEM_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  label: {
    ...typography.caption,
    fontSize: 10,
    lineHeight: 13,
  },
  labelFocused: {
    fontFamily: typography.label.fontFamily,
  },
});

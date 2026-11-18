import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, BackHandler, Easing, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ExploreScreen } from './ExploreScreen';
import { LikeListScreen } from './LikeListScreen';
import { PaneWidthContext } from '../../hooks/usePaneWidth';
import { isSplitWidth, splitListWidth } from '../../navigation/splitLayout';
import { colors } from '../../theme';

/** How long Explore takes to slide away or back. */
const SLIDE_MS = 280;

/**
 * The Explore tab. On a phone it is the Explore grid, nothing else. On a
 * large screen (tablet, unfolded foldable) the grid stays on the left and
 * the Likes list sits beside it on the right, so the people nearby and the
 * people who liked you are in view together. The Match tab still opens
 * Likes on its own.
 *
 * Large screens only: the button at the top left of Likes slides the grid
 * off to the left while Likes widens over the whole screen, and slides it
 * back (Android back does that too). The grid stays mounted throughout,
 * with its width fixed and only its frame narrowing, so it does not reflow
 * on every frame and keeps its loaded pages and scroll position.
 *
 * The grid is always the first child, so it also stays mounted when the
 * screen grows or shrinks across the split (a foldable opened or closed).
 */
export const ExploreSplitScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { width } = useWindowDimensions();
  const split = isSplitWidth(width);
  const likesWidth = splitListWidth(width);
  const gridWidth = width - likesWidth;

  // Likes over the whole screen (large screens only)
  const [wide, setWide] = useState(false);
  // 0: side by side, 1: Likes over the whole screen
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Width, not a transform: the frames resize, so the native driver cannot run it
    Animated.timing(progress, {
      toValue: wide ? 1 : 0,
      duration: SLIDE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [wide, progress]);

  // Narrower than the split (a foldable folded): back to the plain grid, and
  // side by side again when it next opens
  useEffect(() => {
    if (split || !wide) return;
    progress.stopAnimation();
    progress.setValue(0);
    setWide(false);
  }, [split, wide, progress]);

  // Android back brings the grid back first, then works as usual
  useEffect(() => {
    if (!split || !wide) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!navigation.isFocused()) return false;
      setWide(false);
      return true;
    });
    return () => sub.remove();
  }, [split, wide, navigation]);

  const onToggle = useCallback(() => setWide((w) => !w), []);
  const paneToggle = useMemo(() => ({ wide, onToggle }), [wide, onToggle]);

  return (
    <View style={styles.row}>
      <Animated.View
        style={
          split
            ? [styles.gridFrame, { width: progress.interpolate({ inputRange: [0, 1], outputRange: [gridWidth, 0] }) }]
            : styles.fill
        }
        pointerEvents={split && wide ? 'none' : 'auto'}
        importantForAccessibility={split && wide ? 'no-hide-descendants' : 'auto'}
      >
        {/* Fixed width, held to the frame's right edge: as the frame narrows
            the grid slides out to the left instead of being squeezed */}
        <View style={split ? [styles.gridAtRight, { width: gridWidth }] : styles.fill}>
          <PaneWidthContext.Provider value={split ? gridWidth : null}>
            <ExploreScreen navigation={navigation} />
          </PaneWidthContext.Provider>
        </View>
      </Animated.View>
      {split ? (
        <>
          <Animated.View
            style={[styles.divider, { opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}
          />
          <View style={styles.fill}>
            <PaneWidthContext.Provider value={wide ? width : likesWidth}>
              <LikeListScreen navigation={navigation} paneToggle={paneToggle} />
            </PaneWidthContext.Provider>
          </View>
        </>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
  fill: { flex: 1 },
  gridFrame: { overflow: 'hidden' },
  gridAtRight: { position: 'absolute', top: 0, bottom: 0, right: 0 },
  divider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.surfaceHighlight },
});

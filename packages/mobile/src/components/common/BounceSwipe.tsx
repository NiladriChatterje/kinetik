import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, PanResponder, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme';
import { hapticLight } from '../../utils/haptics';

export type SwipeDirection = 'left' | 'right';

const SCREEN_WIDTH = Dimensions.get('window').width;

/** Finger travel that commits a swipe. */
const COMMIT_AT = SCREEN_WIDTH * 0.28;
/** Furthest the card moves, however far the finger goes: it never leaves the screen. */
const MAX_TRAVEL = SCREEN_WIDTH * 0.26;
const INDICATOR = 44;
/** Like is green, pass / reject is red (the reds match the Face unverified tag). */
const LIKE_GREEN = '#43A047';
const REJECT_RED = '#E53935';

/**
 * Finger travel → card travel with growing resistance, like Android's back
 * gesture: close to the finger at first, then easing off towards MAX_TRAVEL.
 * Sampled for Animated.interpolate, which is linear between points.
 */
function sampled(fn: (travel: number) => number) {
  const steps = 12;
  const inputRange = Array.from({ length: steps + 1 }, (_, i) => ((i / steps) * 2 - 1) * SCREEN_WIDTH);
  const outputRange = inputRange.map((x) => fn(MAX_TRAVEL * Math.tanh(x / MAX_TRAVEL)));
  return { inputRange, outputRange, extrapolate: 'clamp' as const };
}

/**
 * A card that slides straight sideways, right (like) or left (pass /
 * reject), then bounces back into place instead of flying off: the screen
 * moves on once the action is done. A small outlined icon appears at the
 * edge the card leaves and fills in when releasing would commit.
 */
export function BounceSwipe({
  children,
  onSwipe,
  enabled = true,
  busy = false,
  enterFrom,
  labels,
  style,
  cardStyle,
}: {
  children: React.ReactNode;
  onSwipe: (direction: SwipeDirection) => void;
  /** False while the last swipe is still being answered. */
  enabled?: boolean;
  /** Dims the card while its swipe is being answered. */
  busy?: boolean;
  /** Scale the card grows from when it appears (the deck's next card sits at 0.96). */
  enterFrom?: number;
  /** For screen readers, which get these as actions in place of the gesture. */
  labels: { right: string; left: string };
  style?: StyleProp<ViewStyle>;
  cardStyle?: StyleProp<ViewStyle>;
}) {
  const drag = useRef(new Animated.Value(0)).current;
  const enter = useRef(new Animated.Value(enterFrom ?? 1)).current;
  // Latest props for the responder, which is created once
  const onSwipeRef = useRef(onSwipe);
  onSwipeRef.current = onSwipe;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const zone = useRef(0);

  useEffect(() => {
    if (enterFrom !== undefined) {
      Animated.spring(enter, { toValue: 1, friction: 8, tension: 90, useNativeDriver: true }).start();
    }
    // Once, when the card appears
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      // Clearly sideways only, so vertical scrolling keeps working
      onMoveShouldSetPanResponder: (_, g) =>
        enabledRef.current && Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => {
        drag.setValue(g.dx);
        const now = g.dx > COMMIT_AT ? 1 : g.dx < -COMMIT_AT ? -1 : 0;
        if (now !== zone.current) {
          if (now !== 0) hapticLight();
          zone.current = now;
        }
      },
      onPanResponderRelease: (_, g) => {
        // Past the commit point, or a quick flick most of the way there
        const flick = Math.abs(g.vx) > 1 && Math.abs(g.dx) > COMMIT_AT * 0.4;
        const direction: SwipeDirection | null =
          g.dx > COMMIT_AT || (flick && g.dx > 0) ? 'right'
            : g.dx < -COMMIT_AT || (flick && g.dx < 0) ? 'left'
              : null;
        bounceBack(g.vx);
        if (direction && enabledRef.current) onSwipeRef.current(direction);
      },
      onPanResponderTerminate: () => bounceBack(0),
    }),
  ).current;

  function bounceBack(velocity: number) {
    zone.current = 0;
    Animated.spring(drag, { toValue: 0, velocity, friction: 7, tension: 120, useNativeDriver: true }).start();
  }

  const translateX = drag.interpolate(sampled((t) => t));
  const shrink = drag.interpolate(sampled((t) => 1 - 0.06 * Math.abs(t / MAX_TRAVEL)));

  return (
    <View style={style} pointerEvents="box-none">
      <Animated.View
        style={[
          cardStyle,
          busy && styles.busy,
          { transform: [{ translateX }, { scale: Animated.multiply(shrink, enter) }] },
        ]}
        accessibilityActions={[
          { name: 'swipeRight', label: labels.right },
          { name: 'swipeLeft', label: labels.left },
        ]}
        onAccessibilityAction={(e) => {
          if (enabledRef.current) onSwipeRef.current(e.nativeEvent.actionName === 'swipeRight' ? 'right' : 'left');
        }}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
      <EdgeIndicator drag={drag} side="right" icon="heart" />
      <EdgeIndicator drag={drag} side="left" icon="close" />
    </View>
  );
}

/** Outlined circle at the edge the card leaves; fills in once releasing would commit. */
function EdgeIndicator({
  drag,
  side,
  icon,
}: {
  drag: Animated.Value;
  side: SwipeDirection;
  icon: 'heart' | 'close';
}) {
  const sign = side === 'right' ? 1 : -1;
  const progress = drag.interpolate({
    inputRange: side === 'right' ? [0, COMMIT_AT] : [-COMMIT_AT, 0],
    outputRange: side === 'right' ? [0, 1] : [1, 0],
    extrapolate: 'clamp',
  });
  const committed = drag.interpolate({
    inputRange: side === 'right' ? [COMMIT_AT - 1, COMMIT_AT] : [-COMMIT_AT, -COMMIT_AT + 1],
    outputRange: side === 'right' ? [0, 1] : [1, 0],
    extrapolate: 'clamp',
  });
  const slide = progress.interpolate({ inputRange: [0, 1], outputRange: [-10 * sign, 0] });
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const outline = icon === 'heart' ? 'heart-outline' : 'close';
  const tint = icon === 'heart' ? LIKE_GREEN : REJECT_RED;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.indicator,
        // A right swipe uncovers the left edge, and the other way round
        side === 'right' ? styles.atLeft : styles.atRight,
        { borderColor: tint, opacity: progress, transform: [{ translateX: slide }, { scale }] },
      ]}
    >
      <Ionicons name={outline} size={20} color={tint} />
      <Animated.View style={[StyleSheet.absoluteFill, styles.filled, { backgroundColor: tint, opacity: committed }]}>
        <Ionicons name={icon} size={20} color={colors.textInverse} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  busy: { opacity: 0.5 },
  indicator: {
    position: 'absolute',
    top: '50%',
    marginTop: -INDICATOR / 2,
    width: INDICATOR,
    height: INDICATOR,
    borderRadius: INDICATOR / 2,
    borderWidth: 1.5,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  atLeft: { left: 6 },
  atRight: { right: 6 },
  filled: {
    borderRadius: INDICATOR / 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

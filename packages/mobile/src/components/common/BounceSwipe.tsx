import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, PanResponder, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
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
 * reject). On release past the commit point it either bounces back into
 * place (the Likes list: the row leaves once the answer is recorded) or,
 * with `flyOff`, keeps going off the screen (the Discover deck: the next
 * card takes its place at once and the answer is sent in the background).
 * A small outlined icon appears at the edge the card leaves and fills in
 * when releasing would commit.
 */
export function BounceSwipe({
  children,
  onSwipe,
  onExited,
  enabled = true,
  busy = false,
  shrink = true,
  flyOff = false,
  enterFrom,
  demo = false,
  labels,
  style,
  cardStyle,
}: {
  children: React.ReactNode;
  /** The swipe is committed; with `flyOff` the card is still on its way out. */
  onSwipe: (direction: SwipeDirection) => void;
  /** With `flyOff`: the card has left the screen. */
  onExited?: (direction: SwipeDirection) => void;
  /** False while the last swipe is still being answered. */
  enabled?: boolean;
  /** Dims the card while its swipe is being answered. */
  busy?: boolean;
  /** Shrinks a little as it is dragged; false keeps it flat (the Discover card). */
  shrink?: boolean;
  /** Leave the screen on commit instead of bouncing back. */
  flyOff?: boolean;
  /** Scale the card grows from when it appears (the deck's next card sits at 0.96). */
  enterFrom?: number;
  /**
   * Shows the like swipe once: the card slides right by itself until the
   * heart at the left edge fills green, holds, and settles back. The real
   * drag value is driven, so what plays is exactly what a swipe does. A
   * touch during the demo takes over at once.
   */
  demo?: boolean;
  /** For screen readers, which get these as actions in place of the gesture. */
  labels: { right: string; left: string };
  style?: StyleProp<ViewStyle>;
  cardStyle?: StyleProp<ViewStyle>;
}) {
  const drag = useRef(new Animated.Value(0)).current;
  // How far the card has gone off the screen after a committed fly-off swipe
  const exit = useRef(new Animated.Value(0)).current;
  const enter = useRef(new Animated.Value(enterFrom ?? 1)).current;
  // Latest props for the responder, which is created once
  const onSwipeRef = useRef(onSwipe);
  onSwipeRef.current = onSwipe;
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const flyOffRef = useRef(flyOff);
  flyOffRef.current = flyOff;
  // Set once a fly-off swipe is committed: the card takes no further gestures
  const goneRef = useRef(false);
  const zone = useRef(0);

  useEffect(() => {
    if (enterFrom !== undefined) {
      Animated.spring(enter, { toValue: 1, friction: 8, tension: 90, useNativeDriver: true }).start();
    }
    // Once, when the card appears
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The demo drives `drag` like a finger would (a real touch calls
  // drag.setValue, which stops this animation and takes over)
  useEffect(() => {
    if (!demo) return;
    const timer = setTimeout(() => {
      if (!enabledRef.current || goneRef.current) return;
      Animated.sequence([
        Animated.timing(drag, {
          toValue: COMMIT_AT * 1.15,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.delay(550),
        Animated.spring(drag, { toValue: 0, friction: 7, tension: 120, useNativeDriver: true }),
      ]).start();
    }, 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);

  function bounceBack(velocity: number) {
    zone.current = 0;
    Animated.spring(drag, { toValue: 0, velocity, friction: 7, tension: 120, useNativeDriver: true }).start();
  }

  /** A committed swipe: the card leaves or bounces back, and the parent is told. */
  function commit(direction: SwipeDirection, velocity: number) {
    if (flyOffRef.current) {
      goneRef.current = true;
      zone.current = 0;
      onSwipeRef.current(direction);
      Animated.timing(exit, {
        toValue: (direction === 'right' ? 1 : -1) * SCREEN_WIDTH * 1.2,
        duration: 240,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) onExitedRef.current?.(direction);
      });
      return;
    }
    bounceBack(velocity);
    onSwipeRef.current(direction);
  }

  const panResponder = useRef(
    PanResponder.create({
      // Clearly sideways only, so vertical scrolling keeps working
      onMoveShouldSetPanResponder: (_, g) =>
        enabledRef.current && !goneRef.current && Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
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
        if (direction && enabledRef.current && !goneRef.current) commit(direction, g.vx);
        else bounceBack(g.vx);
      },
      onPanResponderTerminate: () => bounceBack(0),
    }),
  ).current;

  const translateX = Animated.add(drag.interpolate(sampled((t) => t)), exit);
  // A slight tilt as the card flies out
  const rotate = exit.interpolate({
    inputRange: [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
    outputRange: ['-8deg', '0deg', '8deg'],
  });
  const scale = shrink
    ? Animated.multiply(drag.interpolate(sampled((t) => 1 - 0.06 * Math.abs(t / MAX_TRAVEL))), enter)
    : enter;

  return (
    <View style={style} pointerEvents="box-none">
      <Animated.View
        style={[
          cardStyle,
          busy && styles.busy,
          { transform: [{ translateX }, { rotate }, { scale }] },
        ]}
        accessibilityActions={[
          { name: 'swipeRight', label: labels.right },
          { name: 'swipeLeft', label: labels.left },
        ]}
        onAccessibilityAction={(e) => {
          if (enabledRef.current && !goneRef.current) {
            commit(e.nativeEvent.actionName === 'swipeRight' ? 'right' : 'left', 0);
          }
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

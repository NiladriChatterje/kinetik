import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Text,
  StyleSheet,
  Dimensions,
  LayoutAnimation,
  PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type ToastType = 'error' | 'success' | 'info' | 'glass';

interface IslandToastProps {
  type?: string;
  text1?: string;
  text2?: string;
  hide: () => void;
  onPress?: () => void;
}

/** Accent icon per toast type — the island itself stays black for all types. */
function getAccent(type: ToastType): { icon: keyof typeof Ionicons.glyphMap; color: string } {
  switch (type) {
    case 'error':
      return { icon: 'close-circle', color: '#F87171' };
    case 'success':
      return { icon: 'checkmark-circle', color: '#4ADE80' };
    case 'info':
      return { icon: 'information-circle', color: '#93C5FD' };
    case 'glass':
    default:
      return { icon: 'alert-circle', color: 'rgba(255,255,255,0.85)' };
  }
}

const DOT_SIZE = 14;
const MAX_WIDTH = Math.min(Dimensions.get('window').width - 48, 340);

// Swipe-to-dismiss. A release is a tap when the finger moved less than
// TAP_SLOP; it dismisses when dragged up past DISMISS_DISTANCE or flicked up
// faster than DISMISS_VELOCITY (px/ms); anything else springs back.
const TAP_SLOP = 6;
const DISMISS_DISTANCE = 20;
const DISMISS_VELOCITY = 0.3;
const FLY_OUT_DISTANCE = 140;

/**
 * Dynamic Island-style toast.
 *
 * The toast library's container slides the whole thing down from the top of
 * the screen (the "drop"); this component starts as a small black dot and
 * then springs open horizontally to reveal the message, with the content
 * fading in near the end of the expansion. Rendered at the TOP of the screen
 * so it stays visible when the keyboard is open.
 *
 * Tap opens the full message, a second tap closes the toast, and swiping up
 * drags it off the top of the screen. The island owns that gesture itself:
 * the toast library's container tries to take over any touch that moves,
 * but it is never the touch target, so the swipe is handled here and the
 * takeover is refused.
 */
export const IslandToast: React.FC<IslandToastProps> = React.memo(
  ({ type = 'glass', text1, text2, hide, onPress }) => {
    const expand = useRef(new Animated.Value(0)).current;
    const iconScale = useRef(new Animated.Value(0)).current;
    // How far the finger has dragged the island up (never below 0)
    const dragY = useRef(new Animated.Value(0)).current;
    const [expanded, setExpanded] = useState(false);

    const title = text1 || '';
    const message = text2 || '';
    const twoLines = Boolean(title && message);
    const targetHeight = twoLines ? 46 : 32;

    useEffect(() => {
      Animated.sequence([
        // Let the container's top-drop finish before the dot opens up
        Animated.delay(180),
        Animated.parallel([
          // Pill stretches out with a satisfying overshoot then settles
          Animated.spring(expand, {
            toValue: 1,
            friction: 7,
            tension: 80,
            useNativeDriver: false,
          }),
          // Icon pops in with a quick scale bounce
          Animated.sequence([
            Animated.spring(iconScale, {
              toValue: 1.3,
              friction: 4,
              tension: 120,
              useNativeDriver: true,
            }),
            Animated.spring(iconScale, {
              toValue: 1,
              friction: 6,
              tension: 80,
              useNativeDriver: true,
            }),
          ]),
        ]),
      ]).start();
    }, [expand, iconScale]);

    const width = expand.interpolate({ inputRange: [0, 1], outputRange: [DOT_SIZE, MAX_WIDTH] });
    const height = expand.interpolate({ inputRange: [0, 1], outputRange: [DOT_SIZE, targetHeight] });
    const borderRadius = expand.interpolate({
      inputRange: [0, 1],
      outputRange: [DOT_SIZE / 2, targetHeight / 2],
    });
    // Content appears only near the end of the expansion so text is never
    // visible half-clipped mid-animation
    const contentOpacity = expand.interpolate({
      inputRange: [0, 0.6, 1],
      outputRange: [0, 0, 1],
    });

    const accent = getAccent(type as ToastType);

    const handlePress = () => {
      if (onPress) onPress();
      if (!expanded && message) {
        // First tap: open the pill vertically to reveal the full message
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpanded(true);
        return;
      }
      hide();
    };

    // The responder is created once, so it reads the latest handlers
    // through refs instead of closing over the first render's props/state.
    const handlePressRef = useRef(handlePress);
    handlePressRef.current = handlePress;
    const hideRef = useRef(hide);
    hideRef.current = hide;

    const panResponder = useMemo(
      () =>
        PanResponder.create({
          onStartShouldSetPanResponder: () => true,
          onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,
          // Keep the gesture when the toast library's container asks for it
          // mid-swipe; otherwise the drag stops following the finger.
          onPanResponderTerminationRequest: () => false,
          onPanResponderMove: (_e, g) => {
            dragY.setValue(Math.min(0, g.dy));
          },
          onPanResponderRelease: (_e, g) => {
            const moved = Math.abs(g.dx) > TAP_SLOP || Math.abs(g.dy) > TAP_SLOP;
            if (!moved) {
              dragY.setValue(0);
              handlePressRef.current();
              return;
            }
            if (g.dy < -DISMISS_DISTANCE || g.vy < -DISMISS_VELOCITY) {
              Animated.timing(dragY, {
                toValue: -FLY_OUT_DISTANCE,
                duration: 160,
                useNativeDriver: true,
              }).start(() => hideRef.current());
              return;
            }
            Animated.spring(dragY, { toValue: 0, friction: 6, useNativeDriver: true }).start();
          },
          onPanResponderTerminate: () => {
            Animated.spring(dragY, { toValue: 0, friction: 6, useNativeDriver: true }).start();
          },
        }),
      [dragY],
    );

    // Fade out as the island leaves the top of the screen
    const dragOpacity = dragY.interpolate({
      inputRange: [-FLY_OUT_DISTANCE, -DISMISS_DISTANCE, 0],
      outputRange: [0, 0.85, 1],
      extrapolate: 'clamp',
    });

    return (
      <Animated.View
        {...panResponder.panHandlers}
        accessibilityRole="button"
        accessibilityHint="Tap to expand, swipe up to dismiss"
        style={{ transform: [{ translateY: dragY }], opacity: dragOpacity }}
      >
        <Animated.View
          style={[
            styles.island,
            expanded
              ? { width: MAX_WIDTH, borderRadius: 18, minHeight: targetHeight }
              : { width, height, borderRadius },
          ]}
        >
          {/* Inner row is laid out at full target size and revealed by the
              expanding (overflow-hidden) island — no text reflow mid-spring */}
          <Animated.View
            style={[
              styles.inner,
              { width: MAX_WIDTH, opacity: contentOpacity },
              expanded && styles.innerExpanded,
            ]}
          >
            <Animated.View style={{ transform: [{ scale: iconScale }] }}>
              <Ionicons name={accent.icon} size={14} color={accent.color} />
            </Animated.View>
            <Text style={styles.textContent} numberOfLines={1}>
              {title ? <Text style={styles.title}>{title}</Text> : null}
              {title && message ? '  ' : null}
              {message ? <Text style={styles.message}>{message}</Text> : null}
            </Text>
          </Animated.View>
        </Animated.View>
      </Animated.View>
    );
  },
);

IslandToast.displayName = 'IslandToast';

const styles = StyleSheet.create({
  island: {
    alignSelf: 'center',
    backgroundColor: 'rgba(8, 8, 10, 0.96)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    // Soft drop shadow so the black pill reads on dark screens too
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 12,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 14,
    gap: 6,
  },
  innerExpanded: {
    paddingVertical: 10,
  },
  textContent: {
    flexShrink: 1,
    fontSize: 12,
    color: '#FFFFFF',
  },
  title: {
    fontFamily: 'Cantarell-Bold',
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  message: {
    fontFamily: 'Cantarell-Regular',
    color: 'rgba(255, 255, 255, 0.65)',
  },
});

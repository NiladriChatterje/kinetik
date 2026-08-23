import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CENTER_X = SCREEN_WIDTH / 2;
const CENTER_Y = SCREEN_HEIGHT / 2;

// Lightning bolt path — matches Ionicons "flash" icon shape
// Drawn relative to a 100×100 viewBox, centered on the screen
const BOLT_PATH = 'M 55 5 L 25 48 L 45 48 L 35 95 L 75 42 L 55 42 Z';
const BOLT_LENGTH = 320; // approximate path length (over-estimate is fine for dashoffset)

interface AnimatedSplashProps {
  onFinish: () => void;
}

/**
 * Splash animation:
 * 1. A thin line enters from the left edge
 * 2. It travels to the center and draws the ⚡ lightning bolt via stroke-dashoffset
 * 3. Brief hold
 * 4. The bolt un-draws and the line exits off the right edge
 * 5. Fade to white → login screen
 */
export const AnimatedSplash: React.FC<AnimatedSplashProps> = ({ onFinish }) => {
  // Stroke draw progress: 0 → 1 (draw on) → 0 (draw off)
  const drawProgress = useRef(new Animated.Value(0)).current;

  // Horizontal line that enters from left, stays during draw, exits right
  const lineX = useRef(new Animated.Value(-SCREEN_WIDTH * 0.3)).current;

  // Subtle glow pulse while bolt is visible
  const glowOpacity = useRef(new Animated.Value(0)).current;

  // Final fade
  const fadeOut = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      // 1) Line enters from left to center area (400ms)
      Animated.timing(lineX, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }),

      // 2) Line morphs into bolt — stroke draws on (800ms)
      Animated.parallel([
        Animated.timing(drawProgress, {
          toValue: 1,
          duration: 800,
          useNativeDriver: false, // SVG strokeDashoffset is not native-driven
        }),
        Animated.timing(glowOpacity, {
          toValue: 0.6,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),

      // 3) Hold the bolt visible (500ms)
      Animated.delay(500),

      // 4) Bolt un-draws + line exits right (600ms)
      Animated.parallel([
        Animated.timing(drawProgress, {
          toValue: 0,
          duration: 600,
          useNativeDriver: false,
        }),
        Animated.timing(lineX, {
          toValue: SCREEN_WIDTH * 0.3,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(glowOpacity, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
      ]),

      // 5) Fade out (300ms)
      Animated.timing(fadeOut, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => onFinish());
  }, []);

  // strokeDashoffset: full BOLT_LENGTH = invisible, 0 = fully drawn
  const strokeDashoffset = drawProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [BOLT_LENGTH, 0],
  });

  const strokeDasharray = BOLT_LENGTH;

  // Horizontal line width: shrinks as the bolt draws, expands as it undraws
  const lineWidth = drawProgress.interpolate({
    inputRange: [0, 0.15, 0.85, 1],
    outputRange: [SCREEN_WIDTH * 0.5, 120, 120, SCREEN_WIDTH * 0.5],
  });

  return (
    <Animated.View style={[styles.container, { opacity: fadeOut }]} pointerEvents="none">
      {/* Horizontal line */}
      <Animated.View
        style={[
          styles.line,
          {
            transform: [{ translateX: lineX }],
          },
          {
            width: lineWidth,
            alignSelf: 'center',
          },
        ]}
      />

      {/* Lightning bolt — centered */}
      <View style={styles.boltWrapper}>
        <Svg width={140} height={140} viewBox="0 0 100 100">
          {/* Glow layer */}
          <AnimatedPath
            d={BOLT_PATH}
            stroke="#000"
            strokeWidth={10}
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="none"
            strokeDasharray={strokeDasharray}
            strokeDashoffset={strokeDashoffset}
            opacity={glowOpacity}
          />
          {/* Crisp stroke */}
          <AnimatedPath
            d={BOLT_PATH}
            stroke="#000"
            strokeWidth={4}
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="none"
            strokeDasharray={strokeDasharray}
            strokeDashoffset={strokeDashoffset}
          />
        </Svg>
      </View>
    </Animated.View>
  );
};

// Wrapper to allow Animated.Value on SVG Path props
const AnimatedPath = Animated.createAnimatedComponent(Path);

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#FFFFFF',
    zIndex: 9999,
    elevation: 9999,
    justifyContent: 'center',
    alignItems: 'center',
  },
  line: {
    position: 'absolute',
    height: 4,
    backgroundColor: '#000000',
    borderRadius: 2,
  },
  boltWrapper: {
    position: 'absolute',
    left: CENTER_X - 70,
    top: CENTER_Y - 70,
  },
});

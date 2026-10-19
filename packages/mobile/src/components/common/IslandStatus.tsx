import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  View,
} from 'react-native';

interface IslandStatusProps {
  visible: boolean;
  message: string;
  onRetry: () => void;
  retrying?: boolean;
  /**
   * error (default): red dot and a Retry action, the server cannot be reached.
   * waiting: amber dot and no action, the server is slow but answering.
   */
  tone?: 'error' | 'waiting';
}

const DOT_SIZE = 14;
const PILL_HEIGHT = 32;
const MAX_WIDTH = Math.min(Dimensions.get('window').width - 48, 340);

/**
 * Persistent Dynamic Island status pill — the connection-state sibling of
 * IslandToast. While the server is unreachable it stays parked below the top
 * of the screen: drops in as a dot, expands sideways into a pill with a red
 * status dot, the message, and a Retry action; collapses and slides away when
 * the connection returns.
 */
export const IslandStatus: React.FC<IslandStatusProps> = ({
  visible,
  message,
  onRetry,
  retrying = false,
  tone = 'error',
}) => {
  const slide = useRef(new Animated.Value(0)).current; // 0 hidden above, 1 parked
  const expand = useRef(new Animated.Value(0)).current; // 0 dot, 1 pill
  const [rendered, setRendered] = useState(visible);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      Animated.sequence([
        Animated.spring(slide, { toValue: 1, useNativeDriver: false, friction: 9, tension: 80 }),
        Animated.spring(expand, { toValue: 1, useNativeDriver: false, friction: 9, tension: 70 }),
      ]).start();
    } else {
      Animated.sequence([
        Animated.timing(expand, { toValue: 0, duration: 160, useNativeDriver: false }),
        Animated.timing(slide, { toValue: 0, duration: 180, useNativeDriver: false }),
      ]).start(({ finished }) => {
        if (finished) setRendered(false);
      });
    }
  }, [visible, slide, expand]);

  if (!rendered) return null;

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [-48, 0] });
  const width = expand.interpolate({ inputRange: [0, 1], outputRange: [DOT_SIZE, MAX_WIDTH] });
  const height = expand.interpolate({ inputRange: [0, 1], outputRange: [DOT_SIZE, PILL_HEIGHT] });
  const borderRadius = expand.interpolate({
    inputRange: [0, 1],
    outputRange: [DOT_SIZE / 2, PILL_HEIGHT / 2],
  });
  const contentOpacity = expand.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0, 0, 1] });

  return (
    <Animated.View
      style={[styles.wrapper, { transform: [{ translateY }], opacity: slide }]}
      pointerEvents={visible ? 'box-none' : 'none'}
    >
      <Animated.View style={[styles.island, { width, height, borderRadius }]}>
        <Animated.View style={[styles.inner, { width: MAX_WIDTH, opacity: contentOpacity }]}>
          <View style={[styles.statusDot, tone === 'waiting' && styles.statusDotWaiting]} />
          <Text style={styles.message} numberOfLines={1}>
            {message}
          </Text>
          {tone === 'error' && (
            <TouchableOpacity
              onPress={onRetry}
              disabled={retrying}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            >
              <Text style={[styles.retry, retrying && styles.retryDisabled]}>
                {retrying ? 'Checking…' : 'Retry'}
              </Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    top: 15,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9998,
  },
  island: {
    backgroundColor: 'rgba(8, 8, 10, 0.96)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 12,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    gap: 8,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#F87171',
  },
  statusDotWaiting: {
    backgroundColor: '#FBBF24',
  },
  message: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
    flexShrink: 1,
  },
  retry: {
    fontSize: 12,
    fontWeight: '700',
    color: '#93C5FD',
  },
  retryDisabled: {
    opacity: 0.5,
  },
});

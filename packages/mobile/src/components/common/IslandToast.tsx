import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  View,
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

/**
 * Dynamic Island-style toast.
 *
 * The toast library's container slides the whole thing down from the top of
 * the screen (the "drop"); this component starts as a small black dot and
 * then springs open horizontally to reveal the message, with the content
 * fading in near the end of the expansion. Rendered at the TOP of the screen
 * so it stays visible when the keyboard is open.
 */
export const IslandToast: React.FC<IslandToastProps> = React.memo(
  ({ type = 'glass', text1, text2, hide, onPress }) => {
    const expand = useRef(new Animated.Value(0)).current;

    const title = text1 || '';
    const message = text2 || '';
    const twoLines = Boolean(title && message);
    const targetHeight = twoLines ? 46 : 32;

    useEffect(() => {
      Animated.sequence([
        // Let the container's top-drop finish before the dot opens up
        Animated.delay(220),
        Animated.spring(expand, {
          toValue: 1,
          friction: 9,
          tension: 70,
          // Width/height are layout props — native driver unavailable
          useNativeDriver: false,
        }),
      ]).start();
    }, [expand]);

    const width = expand.interpolate({ inputRange: [0, 1], outputRange: [DOT_SIZE, MAX_WIDTH] });
    const height = expand.interpolate({ inputRange: [0, 1], outputRange: [DOT_SIZE, targetHeight] });
    const borderRadius = expand.interpolate({
      inputRange: [0, 1],
      outputRange: [DOT_SIZE / 2, targetHeight / 2],
    });
    // Content appears only near the end of the expansion so text is never
    // visible half-clipped mid-animation
    const contentOpacity = expand.interpolate({
      inputRange: [0, 0.7, 1],
      outputRange: [0, 0, 1],
    });

    const accent = getAccent(type as ToastType);

    const handlePress = () => {
      if (onPress) onPress();
      hide();
    };

    return (
      <TouchableOpacity activeOpacity={0.9} onPress={handlePress}>
        <Animated.View style={[styles.island, { width, height, borderRadius }]}>
          {/* Inner row is laid out at full target size and revealed by the
              expanding (overflow-hidden) island — no text reflow mid-spring */}
          <Animated.View style={[styles.inner, { width: MAX_WIDTH, opacity: contentOpacity }]}>
            <Ionicons name={accent.icon} size={14} color={accent.color} />
            <View style={styles.textCol}>
              {title ? (
                <Text style={styles.title} numberOfLines={1}>
                  {title}
                </Text>
              ) : null}
              {message ? (
                <Text style={styles.message} numberOfLines={1}>
                  {message}
                </Text>
              ) : null}
            </View>
          </Animated.View>
        </Animated.View>
      </TouchableOpacity>
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
    justifyContent: 'center',
    paddingHorizontal: 14,
    gap: 6,
  },
  textCol: {
    flexShrink: 1,
    alignItems: 'center',
  },
  title: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.1,
  },
  message: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.65)',
    marginTop: 1,
  },
});

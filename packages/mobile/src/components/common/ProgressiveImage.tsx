import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  StyleSheet,
  View,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { colors } from '../../theme';

interface ProgressiveImageProps {
  /** Full-resolution image URI */
  uri?: string;
  /** Low-res thumbnail shown immediately while the full image loads */
  thumbnailUri?: string;
  style?: StyleProp<ViewStyle>;
  resizeMode?: 'cover' | 'contain';
}

/**
 * Progressive image: a pulsing skeleton until any pixels arrive, the (cached,
 * tiny) thumbnail as soon as it loads, and the full-resolution image faded in
 * on top when ready. On a photo-first feed over mobile data this is the
 * difference between "blank card" and "instant card".
 */
export const ProgressiveImage: React.FC<ProgressiveImageProps> = React.memo(
  ({ uri, thumbnailUri, style, resizeMode = 'cover' }) => {
    const [thumbLoaded, setThumbLoaded] = useState(false);
    const [fullLoaded, setFullLoaded] = useState(false);
    const fullOpacity = useRef(new Animated.Value(0)).current;
    const pulse = useRef(new Animated.Value(0.45)).current;

    // Skeleton pulse — runs only until something is visible
    const showSkeleton = !thumbLoaded && !fullLoaded;
    useEffect(() => {
      if (!showSkeleton) return;
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0.45, duration: 700, useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }, [showSkeleton, pulse]);

    const handleFullLoad = () => {
      setFullLoaded(true);
      Animated.timing(fullOpacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
    };

    return (
      <View style={[styles.container, style]}>
        {showSkeleton && <Animated.View style={[styles.skeleton, { opacity: pulse }]} />}

        {thumbnailUri ? (
          <Image
            source={{ uri: thumbnailUri }}
            style={styles.layer}
            resizeMode={resizeMode}
            onLoad={() => setThumbLoaded(true)}
          />
        ) : null}

        {uri ? (
          <Animated.Image
            source={{ uri }}
            style={[styles.layer, { opacity: fullOpacity }]}
            resizeMode={resizeMode}
            onLoad={handleFullLoad}
          />
        ) : null}
      </View>
    );
  },
);

ProgressiveImage.displayName = 'ProgressiveImage';

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: colors.surfaceHighlight,
  },
  skeleton: {
    ...StyleSheet.absoluteFill,
    // Lighter tint pulsing over the surface base so the shimmer is visible
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
  },
  layer: {
    ...StyleSheet.absoluteFill,
    width: undefined,
    height: undefined,
  },
});

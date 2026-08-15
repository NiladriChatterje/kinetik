import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, Image,
  Animated, Modal, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../../theme';
import { resolveUrl } from '../../config';
import { Button } from './Button';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface MatchPopupProps {
  visible: boolean;
  partnerName: string;
  partnerPhotoUrl?: string;
  onKeepSwiping: () => void;
  onSayHello: () => void;
}

export const MatchPopup: React.FC<MatchPopupProps> = ({
  visible,
  partnerName,
  partnerPhotoUrl,
  onKeepSwiping,
  onSayHello,
}) => {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const heartScale1 = useRef(new Animated.Value(0)).current;
  const heartScale2 = useRef(new Animated.Value(0)).current;
  const heartRotate = useRef(new Animated.Value(0)).current;
  const buttonAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      // Reset
      scaleAnim.setValue(0);
      fadeAnim.setValue(0);
      heartScale1.setValue(0);
      heartScale2.setValue(0);
      heartRotate.setValue(0);
      buttonAnim.setValue(0);

      // Entrance animation sequence
      Animated.sequence([
        // Fade in background
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        // Scale up the card
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 6,
          tension: 100,
          useNativeDriver: true,
        }),
        // Pop hearts
        Animated.parallel([
          Animated.spring(heartScale1, {
            toValue: 1,
            friction: 4,
            tension: 80,
            useNativeDriver: true,
          }),
          Animated.spring(heartScale2, {
            toValue: 1,
            friction: 4,
            tension: 80,
            useNativeDriver: true,
          }),
          Animated.spring(heartRotate, {
            toValue: 1,
            friction: 8,
            tension: 60,
            useNativeDriver: true,
          }),
        ]),
      ]).start();

      // Show buttons after a delay
      Animated.timing(buttonAnim, {
        toValue: 1,
        delay: 600,
        duration: 300,
        useNativeDriver: true,
      }).start();

      // Continuous heart pulse
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(heartScale1, {
            toValue: 1.15,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(heartScale1, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ]),
      );
      pulse.start();

      return () => pulse.stop();
    }
  }, [visible]);

  const heartRotation = heartRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['-15deg', '5deg'],
  });

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="none" statusBarTranslucent>
      <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
        {/* Background particles - decorative circles */}
        <View style={styles.particleContainer}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <View
              key={i}
              style={[
                styles.particle,
                {
                  left: Math.random() * SCREEN_WIDTH,
                  top: Math.random() * SCREEN_HEIGHT,
                  width: 4 + Math.random() * 8,
                  height: 4 + Math.random() * 8,
                  opacity: 0.3 + Math.random() * 0.7,
                },
              ]}
            />
          ))}
        </View>

        {/* Main card */}
        <Animated.View style={[styles.card, { transform: [{ scale: scaleAnim }] }]}>
          {/* Floating hearts */}
          <Animated.View style={[styles.heartLeft, { transform: [{ scale: heartScale2 }, { rotate: heartRotation }] }]}>
            <Ionicons name="heart" size={28} color={colors.primary} />
          </Animated.View>
          <Animated.View style={[styles.heartRight, { transform: [{ scale: heartScale1 }] }]}>
            <Ionicons name="heart" size={24} color={colors.primary} />
          </Animated.View>

          {/* It's a Match! title */}
          <Animated.View style={[styles.matchTitleContainer, { transform: [{ scale: heartScale1 }] }]}>
            <Ionicons name="heart" size={22} color={colors.primary} style={{ marginRight: 6 }} />
            <Text style={styles.matchTitle}>It's a Match!</Text>
            <Ionicons name="heart" size={22} color={colors.primary} style={{ marginLeft: 6 }} />
          </Animated.View>

          <Text style={styles.subtitle}>You and {partnerName} liked each other</Text>

          {/* Partner photo */}
          <View style={styles.photoContainer}>
            {partnerPhotoUrl ? (
              <Image source={{ uri: resolveUrl(partnerPhotoUrl) }} style={styles.partnerPhoto} />
            ) : (
              <View style={[styles.partnerPhoto, styles.noPhoto]}>
                <Ionicons name="person-outline" size={40} color={colors.textMuted} />
              </View>
            )}
            {/* Glow effect */}
            <View style={styles.photoGlow} />
          </View>

          <Text style={styles.partnerName}>{partnerName}</Text>

          {/* Action buttons */}
          <Animated.View style={[styles.buttonContainer, { opacity: buttonAnim }]}>
            <Button
              title="Say Hello"
              icon={<Ionicons name="chatbubble-ellipses" size={18} color={colors.textInverse} />}
              onPress={onSayHello}
              fullWidth
            />
            <Button
              title="Keep Swiping"
              variant="outline"
              onPress={onKeepSwiping}
              fullWidth
            />
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  particleContainer: {
    ...StyleSheet.absoluteFill,
  },
  particle: {
    position: 'absolute',
    backgroundColor: colors.primary,
    borderRadius: 999,
  },
  card: {
    width: SCREEN_WIDTH * 0.82,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingVertical: spacing.huge,
    paddingHorizontal: spacing.xxl,
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
  },
  heartLeft: {
    position: 'absolute',
    top: spacing.xl,
    left: spacing.lg,
  },
  heartRight: {
    position: 'absolute',
    top: spacing.xl + 8,
    right: spacing.lg,
  },
  matchTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  matchTitle: {
    ...typography.h1,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.body2,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  photoContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  partnerPhoto: {
    width: 120,
    height: 120,
    borderRadius: 60,
    resizeMode: 'cover',
    borderWidth: 3,
    borderColor: colors.primary,
  },
  noPhoto: {
    backgroundColor: colors.surfaceHighlight,
    justifyContent: 'center',
    alignItems: 'center',
    borderColor: colors.surfaceHighlight,
  },
  photoGlow: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 2,
    borderColor: 'rgba(0, 0, 0, 0.2)',
  },
  partnerName: {
    ...typography.h2,
    color: colors.textPrimary,
    marginBottom: spacing.xxl,
  },
  buttonContainer: {
    width: '100%',
    gap: spacing.md,
  },
});

export default MatchPopup;

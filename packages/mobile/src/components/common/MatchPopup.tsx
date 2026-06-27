import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, Image, TouchableOpacity,
  Animated, Modal, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../../theme';
import { resolveUrl } from '../../config';

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
            <Ionicons name="heart" size={28} color="#FF6B6B" />
          </Animated.View>
          <Animated.View style={[styles.heartRight, { transform: [{ scale: heartScale1 }] }]}>
            <Ionicons name="heart" size={24} color="#FF6B6B" />
          </Animated.View>

          {/* It's a Match! title */}
          <Animated.View style={[styles.matchTitleContainer, { transform: [{ scale: heartScale1 }] }]}>
            <Ionicons name="heart" size={22} color="#FF6B6B" style={{ marginRight: 6 }} />
            <Text style={styles.matchTitle}>It's a Match!</Text>
            <Ionicons name="heart" size={22} color="#FF6B6B" style={{ marginLeft: 6 }} />
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
            <TouchableOpacity
              style={styles.chatButton}
              onPress={onSayHello}
              activeOpacity={0.8}
            >
              <Ionicons name="chatbubble-ellipses" size={18} color={colors.textInverse} style={{ marginRight: 6 }} />
              <Text style={styles.chatButtonText}>Say Hello</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.keepSwipingButton}
              onPress={onKeepSwiping}
              activeOpacity={0.8}
            >
              <Text style={styles.keepSwipingText}>Keep Swiping</Text>
            </TouchableOpacity>
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
    backgroundColor: '#FF6B6B',
    borderRadius: 999,
  },
  card: {
    width: SCREEN_WIDTH * 0.82,
    backgroundColor: '#fff',
    borderRadius: radius.xl,
    paddingVertical: spacing.huge,
    paddingHorizontal: spacing.xxl,
    alignItems: 'center',
    elevation: 20,
    shadowColor: '#FF6B6B',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
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
    fontSize: 28,
    fontWeight: '800',
    color: '#FF6B6B',
    letterSpacing: -0.5,
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
    borderColor: '#FF6B6B',
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
    borderColor: 'rgba(255, 107, 107, 0.3)',
  },
  partnerName: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.xxl,
  },
  buttonContainer: {
    width: '100%',
    gap: spacing.md,
  },
  chatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FF6B6B',
    paddingVertical: spacing.md,
    borderRadius: radius.full,
    elevation: 4,
    shadowColor: '#FF6B6B',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
  },
  chatButtonText: {
    ...typography.button,
    color: '#fff',
  },
  keepSwipingButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.surfaceHighlight,
  },
  keepSwipingText: {
    ...typography.button,
    color: colors.textSecondary,
  },
});

export default MatchPopup;

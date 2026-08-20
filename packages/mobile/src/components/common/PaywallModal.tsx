import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, Modal, Animated, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../../theme';
import { Button } from './Button';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export type PaywallReason = 'swipe_limit' | 'chat_limit';

interface PaywallModalProps {
  visible: boolean;
  reason: PaywallReason;
  /** Current usage count (e.g. 30 swipes used) */
  used: number;
  /** Max limit (e.g. 30 for swipes, 3 for chats) */
  limit: number;
  onDismiss: () => void;
  onUpgrade: () => void;
}

const REASON_CONFIG: Record<
  PaywallReason,
  { icon: 'infinite-outline' | 'chatbubbles-outline'; title: string; description: string; feature: string }
> = {
  swipe_limit: {
    icon: 'infinite-outline',
    title: 'Swipe limit reached',
    description: "You've used all your free swipes for today.",
    feature: 'Unlimited daily swipes',
  },
  chat_limit: {
    icon: 'chatbubbles-outline',
    title: 'Chat limit reached',
    description: "You've reached the maximum number of active chats on the free plan.",
    feature: 'Unlimited active chats',
  },
};

export const PaywallModal: React.FC<PaywallModalProps> = ({
  visible,
  reason,
  used,
  limit,
  onDismiss,
  onUpgrade,
}) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;

  const config = REASON_CONFIG[reason];

  useEffect(() => {
    if (visible) {
      fadeAnim.setValue(0);
      scaleAnim.setValue(0.9);

      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 6,
          tension: 100,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="none" statusBarTranslucent>
      <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
        <Animated.View style={[styles.card, { transform: [{ scale: scaleAnim }] }]}>
          {/* Icon */}
          <View style={styles.iconContainer}>
            <Ionicons name={config.icon} size={36} color={colors.textInverse} />
          </View>

          {/* Title */}
          <Text style={styles.title}>{config.title}</Text>

          {/* Usage indicator */}
          <View style={styles.usageRow}>
            <View style={styles.usageBar}>
              <View style={[styles.usageFill, { width: '100%' }]} />
            </View>
            <Text style={styles.usageText}>
              {used}/{limit}
            </Text>
          </View>

          <Text style={styles.description}>{config.description}</Text>

          {/* Premium features */}
          <View style={styles.featuresContainer}>
            <View style={styles.featureRow}>
              <Ionicons name="checkmark-circle" size={18} color={colors.textPrimary} />
              <Text style={styles.featureText}>{config.feature}</Text>
            </View>
            <View style={styles.featureRow}>
              <Ionicons name="checkmark-circle" size={18} color={colors.textPrimary} />
              <Text style={styles.featureText}>25 Super Likes every day</Text>
            </View>
            <View style={styles.featureRow}>
              <Ionicons name="checkmark-circle" size={18} color={colors.textPrimary} />
              <Text style={styles.featureText}>See who liked you</Text>
            </View>
          </View>

          {/* Actions */}
          <View style={styles.buttonContainer}>
            <Button
              title="Upgrade to Premium"
              onPress={onUpgrade}
              fullWidth
            />
            <Button
              title="Not now"
              variant="outline"
              onPress={onDismiss}
              fullWidth
            />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    width: SCREEN_WIDTH * 0.85,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xxl,
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.textPrimary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.h2,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  usageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    width: '100%',
    marginBottom: spacing.md,
  },
  usageBar: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surfaceHighlight,
    overflow: 'hidden',
  },
  usageFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: colors.textPrimary,
  },
  usageText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
    minWidth: 50,
    textAlign: 'right',
  },
  description: {
    ...typography.body2,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  featuresContainer: {
    width: '100%',
    gap: spacing.md,
    marginBottom: spacing.xxl,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  featureText: {
    ...typography.body2,
    color: colors.textPrimary,
    flex: 1,
  },
  buttonContainer: {
    width: '100%',
    gap: spacing.md,
  },
});

export default PaywallModal;

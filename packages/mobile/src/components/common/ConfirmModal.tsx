import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Modal, Animated, Pressable } from 'react-native';
import { colors, typography, spacing, radius } from '../../theme';
import { Button } from './Button';

interface ConfirmModalProps {
  visible: boolean;
  title: string;
  message: string;
  /** The safe way out, shown as the filled button */
  keepLabel: string;
  /** The action being confirmed, shown as the outlined button */
  confirmLabel: string;
  onDismiss: () => void;
  onConfirm: () => void;
}

/**
 * A yes/no question in the app's own style instead of the system alert: the
 * dimmed overlay and centred card of PaywallModal, flat, with the safe choice
 * as the filled button. Tapping outside or pressing back keeps things as
 * they are.
 */
export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  visible,
  title,
  message,
  keepLabel,
  confirmLabel,
  onDismiss,
  onConfirm,
}) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;

  useEffect(() => {
    if (visible) {
      fadeAnim.setValue(0);
      scaleAnim.setValue(0.95);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 160, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, friction: 7, tension: 120, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={onDismiss}>
      <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} accessibilityLabel={keepLabel} />
        <Animated.View style={[styles.card, { transform: [{ scale: scaleAnim }] }]}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.buttons}>
            <Button title={keepLabel} onPress={onDismiss} fullWidth />
            <Button title={confirmLabel} onPress={onConfirm} variant="outline" fullWidth />
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
    padding: spacing.xxl,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.xxl,
  },
  title: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.sm },
  message: { ...typography.body2, color: colors.textSecondary, lineHeight: 20, marginBottom: spacing.xl },
  buttons: { gap: spacing.sm },
});

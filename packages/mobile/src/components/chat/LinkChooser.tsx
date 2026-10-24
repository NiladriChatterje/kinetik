import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Modal, Animated, Pressable, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../common/Button';
import { colors, typography, spacing, radius } from '../../theme';

interface LinkChooserProps {
  visible: boolean;
  links: string[];
  onPick: (url: string) => void;
  onClose: () => void;
}

/**
 * A message with several links asks which one to open: the dimmed overlay
 * and centred card of ConfirmModal, one row per link, flat. Tapping
 * outside or pressing back opens nothing.
 */
export const LinkChooser: React.FC<LinkChooserProps> = ({ visible, links, onPick, onClose }) => {
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
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Cancel" />
        <Animated.View style={[styles.card, { transform: [{ scale: scaleAnim }] }]}>
          <Text style={styles.title}>Open link</Text>
          <Text style={styles.message}>This message has {links.length} links.</Text>
          <View style={styles.list}>
            {links.map((url, i) => (
              <React.Fragment key={url}>
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => onPick(url)}
                  activeOpacity={0.7}
                  accessibilityRole="link"
                >
                  <Ionicons name="open-outline" size={16} color={colors.textSecondary} />
                  <Text style={styles.rowText} numberOfLines={2}>{url}</Text>
                </TouchableOpacity>
                {i < links.length - 1 && <View style={styles.divider} />}
              </React.Fragment>
            ))}
          </View>
          <Button title="Cancel" onPress={onClose} variant="outline" fullWidth />
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
  message: { ...typography.body2, color: colors.textSecondary, lineHeight: 20, marginBottom: spacing.md },
  list: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.md,
    marginBottom: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  rowText: { ...typography.body2, color: colors.textPrimary, textDecorationLine: 'underline', flex: 1 },
  divider: { height: 1, backgroundColor: colors.cardBorder, marginHorizontal: spacing.md },
});

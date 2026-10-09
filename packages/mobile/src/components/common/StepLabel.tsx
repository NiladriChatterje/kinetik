import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing } from '../../theme';

interface StepLabelProps {
  /** e.g. "Step 3 of 6" */
  label: string;
  /** Shows a small back arrow before the label, centered on its text. */
  onBack?: () => void;
  /** Keeps the arrow in place but inactive, e.g. while a check is running. */
  backDisabled?: boolean;
  style?: ViewStyle;
}

/**
 * Onboarding step label with its back arrow inline, so the arrow takes no
 * height of its own from the screen below.
 */
export const StepLabel: React.FC<StepLabelProps> = ({ label, onBack, backDisabled, style }) => (
  <View style={[styles.row, style]}>
    {onBack && (
      <TouchableOpacity
        onPress={onBack}
        disabled={backDisabled}
        style={[styles.back, backDisabled && styles.backDisabled]}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="chevron-back" size={16} color={colors.textPrimary} />
      </TouchableOpacity>
    )}
    <Text style={styles.label}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  back: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backDisabled: { opacity: 0.4 },
  label: { ...typography.label, color: colors.textPrimary },
});

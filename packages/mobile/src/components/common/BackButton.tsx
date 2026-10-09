import React from 'react';
import { TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../../theme';

interface BackButtonProps {
  onPress: () => void;
  style?: ViewStyle;
}

/** Round top-left back arrow, matching the settings and chat screen headers. */
export const BackButton: React.FC<BackButtonProps> = ({ onPress, style }) => (
  <TouchableOpacity
    onPress={onPress}
    style={[styles.button, style]}
    hitSlop={8}
    accessibilityRole="button"
    accessibilityLabel="Go back"
  >
    <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
});

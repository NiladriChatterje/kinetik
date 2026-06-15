import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { colors, radius, spacing, shadows } from '../../theme';

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  glow?: boolean;
  padded?: boolean;
}

export const Card: React.FC<CardProps> = ({ children, style, glow = false, padded = true }) => {
  return (
    <View style={[styles.card, glow && styles.glow, padded && styles.padded, style]}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  glow: {
    ...shadows.glow,
  },
  padded: {
    padding: spacing.lg,
  },
});

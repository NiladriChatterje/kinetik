import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
} from 'react-native';

import { colors, radius, spacing } from '../../theme';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
  textStyle?: TextStyle;
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = React.memo(({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  style,
  textStyle,
  fullWidth = false,
}) => {
  const isFilled = variant === 'primary' || variant === 'secondary' || variant === 'danger';

  // While loading the label stays put so the button never reads as empty.
  // The fill and text drop to grey and a small spinner sits beside the text.
  const loadingContainerStyle = loading
    ? isFilled
      ? styles.loadingFilled
      : variant === 'outline'
        ? styles.loadingOutline
        : null
    : null;

  const buttonContent = (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        styles.base,
        styles[`size_${size}`],
        styles[`variant_${variant}`],
        fullWidth && styles.fullWidth,
        disabled && styles.disabled,
        style,
        loadingContainerStyle,
      ]}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator
          color={colors.textMuted}
          size="small"
          style={styles.loadingSpinner}
        />
      ) : (
        icon
      )}
      <Text
        style={[
          styles.text,
          styles[`text_${size}`],
          styles[`text_${variant}`],
          icon || loading ? { marginLeft: spacing.sm } : {},
          textStyle,
          loading && styles.textLoading,
        ]}
      >
        {title}
      </Text>
    </TouchableOpacity>
  );

  return buttonContent;
});
Button.displayName = 'Button';

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  fullWidth: {
    width: '100%',
  },
  disabled: {
    opacity: 0.5,
  },
  loadingFilled: {
    backgroundColor: colors.surfaceHighlight,
  },
  loadingOutline: {
    borderColor: colors.textMuted,
  },
  loadingSpinner: {
    // Match the spinner's box to the text line so the row height is stable.
    height: 20,
  },
  textLoading: {
    color: colors.textMuted,
  },

  // Sizes
  size_sm: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  size_md: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
  },
  size_lg: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xxxl,
  },

  // Variants
  variant_primary: {
    backgroundColor: colors.textPrimary,
  },
  variant_secondary: {
    backgroundColor: colors.textSecondary,
  },
  variant_outline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  variant_ghost: {
    backgroundColor: 'transparent',
  },
  variant_danger: {
    backgroundColor: colors.textPrimary,
  },

  // Text styles
  text: {
    fontWeight: '600',
  },
  text_sm: {
    fontSize: 14,
  },
  text_md: {
    fontSize: 16,
  },
  text_lg: {
    fontSize: 18,
  },
  text_primary: {
    color: colors.textInverse,
  },
  text_secondary: {
    color: colors.textInverse,
  },
  text_outline: {
    color: colors.primary,
  },
  text_ghost: {
    color: colors.textSecondary,
  },
  text_danger: {
    color: colors.textInverse,
  },
});

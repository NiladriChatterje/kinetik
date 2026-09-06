import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../../theme';

export type DatingCategory = 'casual' | 'serious' | 'intimacy';

// Labels mirror the choices on the identity step so what a person picked is
// exactly what everyone else reads on their profile.
const CATEGORY_META: Record<DatingCategory, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  casual: { label: 'Casual', icon: 'sunny-outline' },
  serious: { label: 'Serious', icon: 'heart-outline' },
  intimacy: { label: 'Intimacy', icon: 'flame-outline' },
};

interface Props {
  category?: DatingCategory | string | null;
  /** White-on-translucent for photo scrims; default is a light surface pill. */
  onDark?: boolean;
  /** Smaller text and padding for dense grid cards and list rows. */
  compact?: boolean;
  style?: ViewStyle;
}

export const isDatingCategory = (v: unknown): v is DatingCategory =>
  v === 'casual' || v === 'serious' || v === 'intimacy';

export const DatingCategoryBadge: React.FC<Props> = ({ category, onDark = false, compact = false, style }) => {
  if (!isDatingCategory(category)) return null;
  const { label, icon } = CATEGORY_META[category];
  const fg = onDark ? '#fff' : colors.textSecondary;

  return (
    <View
      style={[styles.pill, onDark ? styles.pillDark : styles.pillLight, compact && styles.pillCompact, style]}
      accessibilityLabel={`Looking for: ${label}`}
    >
      <Ionicons name={icon} size={compact ? 10 : 12} color={fg} />
      <Text style={[styles.text, compact && styles.textCompact, { color: fg }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  pillLight: {
    backgroundColor: colors.surfaceHighlight,
  },
  pillDark: {
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  pillCompact: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  text: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '600',
  },
  textCompact: {
    fontSize: 9,
  },
});

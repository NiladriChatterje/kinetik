import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, spacing, typography } from '../../theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * The right-hand pane on a large screen before anything is picked on the
 * left: an icon in a soft circle, a title, a line of help and, optionally,
 * shortcuts underneath (PaneShortcut).
 */
export const PaneEmptyState: React.FC<{
  icon: IconName;
  title: string;
  text: string;
  children?: React.ReactNode;
}> = ({ icon, title, text, children }) => (
  <View style={styles.wrap}>
    <View style={styles.halo}>
      <View style={styles.circle}>
        <Ionicons name={icon} size={36} color={colors.textSecondary} />
      </View>
    </View>
    <Text style={styles.title}>{title}</Text>
    <Text style={styles.text}>{text}</Text>
    {children ? <View style={styles.shortcuts}>{children}</View> : null}
  </View>
);

/** A shortcut under the empty state: a pill with an icon and a label. */
export const PaneShortcut: React.FC<{
  icon: IconName;
  label: string;
  onPress: () => void;
}> = ({ icon, label, onPress }) => (
  <TouchableOpacity style={styles.shortcut} onPress={onPress} activeOpacity={0.7} accessibilityRole="button">
    <Ionicons name={icon} size={16} color={colors.textPrimary} />
    <Text style={styles.shortcutText}>{label}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
    backgroundColor: colors.background,
  },
  halo: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  circle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: { ...typography.h3, color: colors.textPrimary, textAlign: 'center' },
  text: {
    ...typography.body1,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: 320,
  },
  shortcuts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
    maxWidth: 440,
  },
  shortcut: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.background,
  },
  shortcutText: { ...typography.body2, color: colors.textPrimary, fontWeight: '600' },
});

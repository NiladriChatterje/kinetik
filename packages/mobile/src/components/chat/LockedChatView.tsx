import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../common/Button';
import { colors, typography, spacing } from '../../theme';

interface LockedChatViewProps {
  partnerName: string;
  onBack: () => void;
  onUpgrade: () => void;
}

/**
 * Shown in place of a chat the server reports as locked: free accounts can
 * chat with one match, and every other chat needs Premium. The server refuses
 * the messages themselves, so this screen is the upsell, not the guard.
 */
export const LockedChatView: React.FC<LockedChatViewProps> = ({ partnerName, onBack, onUpgrade }) => (
  <SafeAreaView style={styles.container}>
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} hitSlop={8} accessibilityLabel="Go back">
        <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
      </TouchableOpacity>
      <Text style={styles.headerTitle} numberOfLines={1}>{partnerName}</Text>
      <View style={{ width: 24 }} />
    </View>

    <View style={styles.body}>
      <View style={styles.lockCircle}>
        <Ionicons name="lock-closed" size={30} color={colors.textPrimary} />
      </View>
      <Text style={styles.title}>This chat is locked</Text>
      <Text style={styles.subtitle}>
        Free accounts can chat with one match. Upgrade to Premium to unlock your chat
        with {partnerName} and every other match.
      </Text>
    </View>

    <View style={styles.footer}>
      <Button title="Upgrade to Premium" onPress={onUpgrade} fullWidth size="lg" />
    </View>
  </SafeAreaView>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerTitle: { ...typography.h3, color: colors.textPrimary, flex: 1, textAlign: 'center' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xxl, gap: spacing.md },
  lockCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: { ...typography.h2, color: colors.textPrimary, textAlign: 'center' },
  subtitle: { ...typography.body1, color: colors.textSecondary, textAlign: 'center' },
  footer: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.xl },
});

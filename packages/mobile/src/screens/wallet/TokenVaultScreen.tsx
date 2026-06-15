import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { colors, typography, spacing, radius } from '../../theme';

const TOKENS = [
  { emoji: '⚡', name: 'Fast Passes', count: 3, desc: 'Skip visual blur in Vibe Checks' },
  { emoji: '☔', name: 'Rain Checks', count: 1, desc: 'Save a profile for 24 hours' },
  { emoji: '❤️', name: 'Super Likes', count: 5, desc: 'Stand out from the queue' },
];

export const TokenVaultScreen: React.FC = () => {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Token Vault</Text>
        <Text style={styles.subtitle}>Your premium utilities and perks</Text>

        <Card style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Current Plan</Text>
          <Text style={styles.balanceAmount}>Premium</Text>
          <Text style={styles.balanceDate}>Renews Jul 15, 2026</Text>
        </Card>

        {TOKENS.map((t) => (
          <Card key={t.name} style={styles.tokenCard}>
            <View style={styles.tokenRow}>
              <Text style={styles.tokenEmoji}>{t.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.tokenName}>{t.name}</Text>
                <Text style={styles.tokenDesc}>{t.desc}</Text>
              </View>
              <Text style={styles.tokenCount}>{t.count}</Text>
            </View>
          </Card>
        ))}

        <TouchableOpacity style={styles.upgradeBtn}>
          <Text style={styles.upgradeText}>Upgrade to Infinite →</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xxl },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm },
  subtitle: { ...typography.body1, color: colors.textSecondary, marginBottom: spacing.xxl },
  balanceCard: { alignItems: 'center', marginBottom: spacing.xl, padding: spacing.xxl },
  balanceLabel: { ...typography.label, color: colors.textMuted, marginBottom: spacing.sm },
  balanceAmount: { ...typography.h1, color: colors.primary, marginBottom: spacing.xs },
  balanceDate: { ...typography.caption, color: colors.textMuted },
  tokenCard: { marginBottom: spacing.md, padding: spacing.lg },
  tokenRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  tokenEmoji: { fontSize: 28 },
  tokenName: { ...typography.body1, color: colors.textPrimary },
  tokenDesc: { ...typography.caption, color: colors.textMuted },
  tokenCount: { ...typography.h3, color: colors.primary },
  upgradeBtn: { alignItems: 'center', marginTop: spacing.lg },
  upgradeText: { ...typography.body1, color: colors.secondary },
});

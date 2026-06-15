import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card } from '../../components/common/Card';
import { Avatar } from '../../components/common/Avatar';
import { Button } from '../../components/common/Button';
import { useAuthStore } from '../../store/authStore';
import { colors, typography, spacing, radius } from '../../theme';

const METRICS = [
  { label: 'Vibe Checks', value: '23', emoji: '🎙️' },
  { label: 'Matches', value: '8', emoji: '💖' },
  { label: 'Lock Rate', value: '35%', emoji: '🔒' },
  { label: 'Dates', value: '3', emoji: '📅' },
];

export const ProfileLedgerScreen: React.FC = () => {
  const { user, logout } = useAuthStore();

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.profileHeader}>
          <Avatar size={80} isOnline />
          <Text style={styles.name}>{user?.displayName || 'Alex Johnson'}</Text>
          <View style={styles.verifiedBadge}>
            <Text style={styles.verifiedText}>✅ Identity Verified</Text>
          </View>
        </View>

        <View style={styles.metricsRow}>
          {METRICS.map((m) => (
            <Card key={m.label} style={styles.metricCard}>
              <Text style={styles.metricEmoji}>{m.emoji}</Text>
              <Text style={styles.metricValue}>{m.value}</Text>
              <Text style={styles.metricLabel}>{m.label}</Text>
            </Card>
          ))}
        </View>

        <Card style={styles.settingsCard}>
          <TouchableOpacity style={styles.settingRow}><Text style={styles.settingEmoji}>🔔</Text><Text style={styles.settingText}>Notifications</Text></TouchableOpacity>
          <View style={styles.settingDivider} />
          <TouchableOpacity style={styles.settingRow}><Text style={styles.settingEmoji}>🔒</Text><Text style={styles.settingText}>Privacy</Text></TouchableOpacity>
          <View style={styles.settingDivider} />
          <TouchableOpacity style={styles.settingRow}><Text style={styles.settingEmoji}>💳</Text><Text style={styles.settingText}>Subscription</Text></TouchableOpacity>
          <View style={styles.settingDivider} />
          <TouchableOpacity style={styles.settingRow}><Text style={styles.settingEmoji}>📞</Text><Text style={styles.settingText}>Support</Text></TouchableOpacity>
        </Card>

        <Button title="Sign Out" onPress={logout} variant="outline" fullWidth />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xxl, paddingBottom: 100 },
  profileHeader: { alignItems: 'center', marginBottom: spacing.xxl },
  name: { ...typography.h2, color: colors.textPrimary, marginTop: spacing.md, marginBottom: spacing.xs },
  verifiedBadge: { backgroundColor: 'rgba(6, 214, 160, 0.1)', paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, borderRadius: radius.full },
  verifiedText: { ...typography.caption, color: colors.success },
  metricsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.xxl },
  metricCard: { width: '47%', alignItems: 'center', padding: spacing.md },
  metricEmoji: { fontSize: 24, marginBottom: spacing.xs },
  metricValue: { ...typography.h3, color: colors.textPrimary },
  metricLabel: { ...typography.caption, color: colors.textMuted },
  settingsCard: { padding: 0, marginBottom: spacing.xxl },
  settingRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  settingEmoji: { fontSize: 20 },
  settingText: { ...typography.body1, color: colors.textPrimary },
  settingDivider: { height: 1, backgroundColor: colors.cardBorder, marginHorizontal: spacing.lg },
});

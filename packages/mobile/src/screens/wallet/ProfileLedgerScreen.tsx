import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../../components/common/Card';
import { Avatar } from '../../components/common/Avatar';
import { Button } from '../../components/common/Button';
import { useAuthStore } from '../../store/authStore';
import { colors, typography, spacing, radius } from '../../theme';

const METRICS = [
  { label: 'Vibe Checks', value: '23', icon: 'mic-outline' as const },
  { label: 'Matches', value: '8', icon: 'heart-outline' as const },
  { label: 'Lock Rate', value: '35%', icon: 'lock-closed-outline' as const },
  { label: 'Dates', value: '3', icon: 'calendar-outline' as const },
];

const SETTINGS = [
  { icon: 'notifications-outline' as const, label: 'Notifications' },
  { icon: 'lock-closed-outline' as const, label: 'Privacy' },
  { icon: 'card-outline' as const, label: 'Subscription' },
  { icon: 'call-outline' as const, label: 'Support' },
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
            <Ionicons name="checkmark-circle" size={14} color={colors.success} style={{ marginRight: 4 }} />
            <Text style={styles.verifiedText}>Identity Verified</Text>
          </View>
        </View>

        <View style={styles.metricsRow}>
          {METRICS.map((m) => (
            <Card key={m.label} style={styles.metricCard}>
              <Ionicons name={m.icon} size={24} color={colors.primary} />
              <Text style={styles.metricValue}>{m.value}</Text>
              <Text style={styles.metricLabel}>{m.label}</Text>
            </Card>
          ))}
        </View>

        <Card style={styles.settingsCard}>
          {SETTINGS.map((s, i) => (
            <React.Fragment key={s.label}>
              <TouchableOpacity style={styles.settingRow}>
                <Ionicons name={s.icon} size={20} color={colors.textSecondary} />
                <Text style={styles.settingText}>{s.label}</Text>
              </TouchableOpacity>
              {i < SETTINGS.length - 1 && <View style={styles.settingDivider} />}
            </React.Fragment>
          ))}
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
  name: { ...typography.h2, color: colors.textPrimary, marginTop: spacing.md, marginBottom: spacing.sm },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(6, 214, 160, 0.1)', paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, borderRadius: radius.full },
  verifiedText: { ...typography.caption, color: colors.success },
  metricsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.xxl },
  metricCard: { width: '47%', alignItems: 'center', padding: spacing.md },
  metricValue: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.sm },
  metricLabel: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  settingsCard: { padding: 0, marginBottom: spacing.xxl },
  settingRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  settingText: { ...typography.body1, color: colors.textPrimary },
  settingDivider: { height: 1, backgroundColor: colors.cardBorder, marginHorizontal: spacing.lg },
});

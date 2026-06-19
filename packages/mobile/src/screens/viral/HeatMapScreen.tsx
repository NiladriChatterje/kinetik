import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../../components/common/Card';
import { colors, typography, spacing, radius } from '../../theme';

const HEAT_ZONES = [
  { name: 'Mission District', count: 234, color: '#FF3B7F' },
  { name: 'SOMA', count: 189, color: '#FF6B9D' },
  { name: 'Marina', count: 156, color: '#7C3AED' },
  { name: 'Castro', count: 98, color: '#A78BFA' },
  { name: 'Hayes Valley', count: 67, color: '#06D6A0' },
];

export const HeatMapScreen: React.FC = () => {
  const maxCount = Math.max(...HEAT_ZONES.map((z) => z.count));

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Local Heat Map</Text>
      <Text style={styles.subtitle}>See where the action is right now</Text>
      <View style={styles.mapPlaceholder}>
        <Ionicons name="map-outline" size={48} color={colors.textMuted} />
        <Text style={styles.mapLabel}>Live density map</Text>
      </View>
      <View style={styles.zonesList}>
        {HEAT_ZONES.map((z) => (
          <View key={z.name} style={styles.zoneRow}>
            <Text style={styles.zoneName}>{z.name}</Text>
            <View style={styles.zoneBarBg}>
              <View style={[styles.zoneBarFill, { width: `${(z.count / maxCount) * 100}%`, backgroundColor: z.color }]} />
            </View>
            <Text style={styles.zoneCount}>{z.count}</Text>
          </View>
        ))}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.xxl },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm },
  subtitle: { ...typography.body1, color: colors.textSecondary, marginBottom: spacing.xxl },
  mapPlaceholder: { height: 200, backgroundColor: colors.surfaceHighlight, borderRadius: radius.xl, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xxl },
  mapLabel: { ...typography.body1, color: colors.textMuted, marginTop: spacing.sm },
  zonesList: { gap: spacing.md },
  zoneRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  zoneName: { ...typography.body2, color: colors.textPrimary, width: 110 },
  zoneBarBg: { flex: 1, height: 8, backgroundColor: colors.surfaceHighlight, borderRadius: 4 },
  zoneBarFill: { height: 8, borderRadius: 4 },
  zoneCount: { ...typography.caption, color: colors.textSecondary, width: 40, textAlign: 'right' },
});

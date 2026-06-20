import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { api } from '../../services/api';
import { colors, typography, spacing, radius } from '../../theme';

const WEIGHTS = [
  { key: 'weightValues', label: 'Values', icon: 'heart-outline' as const, desc: 'Shared values and life priorities' },
  { key: 'weightAge', label: 'Age', icon: 'calendar-outline' as const, desc: 'Age range compatibility' },
  { key: 'weightDistance', label: 'Distance', icon: 'location-outline' as const, desc: 'Physical proximity importance' },
  { key: 'weightInterests', label: 'Interests', icon: 'bulb-outline' as const, desc: 'Shared hobbies and interests' },
];

export const PriorityWeightingScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [weights, setWeights] = useState<Record<string, number>>({
    weightValues: 1.0, weightAge: 0.5, weightDistance: 0.5, weightInterests: 0.7,
  });

  const handleSave = async () => {
    await api.updatePreferences(weights);
    navigation.navigate('CommCadence');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.step}>Step 3 of 4</Text>
        <Text style={styles.title}>What's Important?</Text>
        <Text style={styles.subtitle}>Drag to prioritize what matters most for matching</Text>

        {WEIGHTS.map((w) => (
          <Card key={w.key} style={styles.weightCard}>
            <View style={styles.weightHeader}>
              <Ionicons name={w.icon} size={28} color={weights[w.key] > 0.7 ? colors.textPrimary : colors.textSecondary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.weightLabel}>{w.label}</Text>
                <Text style={styles.weightDesc}>{w.desc}</Text>
              </View>
              <Text style={[styles.weightScore, weights[w.key] > 0.7 && styles.weightScoreHigh]}>
                {Math.round(weights[w.key] * 100)}%
              </Text>
            </View>
            <Slider style={{ width: '100%', height: 40 }} minimumValue={0} maximumValue={1} value={weights[w.key]} onValueChange={(v) => setWeights((p) => ({ ...p, [w.key]: v }))} minimumTrackTintColor={colors.textSecondary} maximumTrackTintColor={colors.surfaceHighlight} thumbTintColor={colors.textSecondary} />
          </Card>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <Button title="Continue" onPress={handleSave} fullWidth />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xxl, paddingBottom: 100 },
  step: { ...typography.label, color: colors.textPrimary, marginBottom: spacing.sm },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm },
  subtitle: { ...typography.body1, color: colors.textSecondary, marginBottom: spacing.xxl },
  weightCard: { marginBottom: spacing.md },
  weightHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.md },
  weightLabel: { ...typography.body1, color: colors.textPrimary },
  weightDesc: { ...typography.caption, color: colors.textMuted },
  weightScore: { ...typography.h3, color: colors.textSecondary },
  weightScoreHigh: { color: colors.textPrimary },
  footer: { position: 'absolute', bottom: 40, left: spacing.xxl, right: spacing.xxl },
});

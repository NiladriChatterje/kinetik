import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { api } from '../../services/api';
import { colors, typography, spacing, radius } from '../../theme';

const VALUE_OPTIONS = [
  { key: 'valuesAmbition', label: 'Ambition', icon: 'rocket-outline' as const, desc: 'Driven, career-focused, goal-oriented' },
  { key: 'valuesSocial', label: 'Social', icon: 'people-outline' as const, desc: 'Outgoing, loves parties and group activities' },
  { key: 'valuesAdventure', label: 'Adventure', icon: 'compass-outline' as const, desc: 'Spontaneous, loves travel and new experiences' },
  { key: 'valuesTradition', label: 'Tradition', icon: 'home-outline' as const, desc: 'Values family, stability, and routine' },
  { key: 'valuesIntellect', label: 'Intellect', icon: 'bulb-outline' as const, desc: 'Deep conversations, learning, curiosity' },
  { key: 'valuesEmotional', label: 'Emotional', icon: 'heart-half-outline' as const, desc: 'Empathetic, emotionally available, caring' },
];

export const ValueMatrixScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [values, setValues] = useState<Record<string, number>>({
    valuesAmbition: 0.5, valuesSocial: 0.5, valuesAdventure: 0.5,
    valuesTradition: 0.5, valuesIntellect: 0.5, valuesEmotional: 0.5,
  });

  const handleSave = async () => {
    await api.updatePreferences(values);
    navigation.navigate('PriorityWeights');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.step}>Step 2 of 4</Text>
        <Text style={styles.title}>What Matters to You</Text>
        <Text style={styles.subtitle}>Rate each value to build your compatibility profile</Text>

        {VALUE_OPTIONS.map((v) => (
          <Card key={v.key} style={styles.valueCard}>
            <View style={styles.valueHeader}>
              <Ionicons name={v.icon} size={28} color={values[v.key] > 0.6 ? colors.primary : colors.textSecondary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.valueLabel}>{v.label}</Text>
                <Text style={styles.valueDesc}>{v.desc}</Text>
              </View>
              <Text style={styles.valueScore}>{Math.round(values[v.key] * 100)}%</Text>
            </View>
            <Slider
              style={{ width: '100%', height: 40 }}
              minimumValue={0} maximumValue={1}
              value={values[v.key]}
              onValueChange={(val) => setValues((p) => ({ ...p, [v.key]: val }))}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor={colors.surfaceHighlight}
              thumbTintColor={colors.primary}
            />
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
  step: { ...typography.label, color: colors.primary, marginBottom: spacing.sm },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm },
  subtitle: { ...typography.body1, color: colors.textSecondary, marginBottom: spacing.xxl },
  valueCard: { marginBottom: spacing.md },
  valueHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.md },
  valueLabel: { ...typography.body1, color: colors.textPrimary },
  valueDesc: { ...typography.caption, color: colors.textMuted },
  valueScore: { ...typography.h3, color: colors.primary },
  footer: { position: 'absolute', bottom: 40, left: spacing.xxl, right: spacing.xxl },
});

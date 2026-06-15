import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { api } from '../../services/api';
import { colors, typography, spacing, radius } from '../../theme';

export const FilterConstraintsScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(60);
  const [maxDistance, setMaxDistance] = useState(50);

  const handleSave = async () => {
    await api.updatePreferences({ ageMin, ageMax, maxDistanceKm: maxDistance });
    navigation.navigate('ValueMatrix');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.step}>Step 1 of 4</Text>
        <Text style={styles.title}>Your Preferences</Text>
        <Text style={styles.subtitle}>Set your non-negotiable filters</Text>

        <Card style={styles.sliderCard}>
          <Text style={styles.sliderLabel}>Age Range</Text>
          <Text style={styles.sliderValue}>{ageMin} - {ageMax} years</Text>
          <View style={styles.sliderRow}>
            <Text style={styles.sliderMin}>18</Text>
            <Slider style={styles.slider} minimumValue={18} maximumValue={80} value={ageMin} onValueChange={setAgeMin} minimumTrackTintColor={colors.primary} maximumTrackTintColor={colors.surfaceHighlight} thumbTintColor={colors.primary} />
            <Slider style={styles.slider} minimumValue={18} maximumValue={80} value={ageMax} onValueChange={setAgeMax} minimumTrackTintColor={colors.primary} maximumTrackTintColor={colors.surfaceHighlight} thumbTintColor={colors.primary} />
            <Text style={styles.sliderMax}>80</Text>
          </View>
        </Card>

        <Card style={styles.sliderCard}>
          <Text style={styles.sliderLabel}>Maximum Distance</Text>
          <Text style={styles.sliderValue}>{maxDistance} km</Text>
          <Slider style={styles.slider} minimumValue={1} maximumValue={300} value={maxDistance} onValueChange={setMaxDistance} minimumTrackTintColor={colors.secondary} maximumTrackTintColor={colors.surfaceHighlight} thumbTintColor={colors.secondary} />
          <View style={styles.distanceLabels}>
            <Text style={styles.distanceLabel}>1 km</Text>
            <Text style={styles.distanceLabel}>300 km</Text>
          </View>
        </Card>
      </ScrollView>

      <View style={styles.footer}>
        <Button title="Continue" onPress={handleSave} fullWidth />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xxl },
  step: { ...typography.label, color: colors.primary, marginBottom: spacing.sm },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm },
  subtitle: { ...typography.body1, color: colors.textSecondary, marginBottom: spacing.xxl },
  sliderCard: { marginBottom: spacing.lg },
  sliderLabel: { ...typography.body1, color: colors.textPrimary, marginBottom: spacing.xs },
  sliderValue: { ...typography.h3, color: colors.primary, marginBottom: spacing.lg },
  slider: { width: '100%', height: 40, marginVertical: spacing.xs },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sliderMin: { ...typography.caption, color: colors.textMuted },
  sliderMax: { ...typography.caption, color: colors.textMuted },
  distanceLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  distanceLabel: { ...typography.caption, color: colors.textMuted },
  footer: { padding: spacing.xxl, paddingBottom: spacing.huge },
});

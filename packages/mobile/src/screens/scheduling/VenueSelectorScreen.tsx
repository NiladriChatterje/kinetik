import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { colors, typography, spacing, radius } from '../../theme';

const VENUES = [
  { id: '1', name: 'Blend Craft Coffee', type: 'Cafe', price: '$$', emoji: '☕', distance: '0.3mi' },
  { id: '2', name: 'The Velvet Lounge', type: 'Bar', price: '$$$', emoji: '🍸', distance: '0.5mi' },
  { id: '3', name: 'Sakura Sushi Bar', type: 'Restaurant', price: '$$', emoji: '🍣', distance: '0.7mi' },
  { id: '4', name: 'Rooftop Tapas', type: 'Lounge', price: '$$$', emoji: '🌮', distance: '1.1mi' },
];

export const VenueSelectorScreen: React.FC<{ navigation: any }> = ({ navigation, route }) => {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Pick a Spot</Text>
        <Text style={styles.subtitle}>Midpoint venues between you two</Text>
        {VENUES.map((v) => (
          <TouchableOpacity key={v.id} onPress={() => setSelected(v.id)}>
            <Card style={[styles.venueCard, selected === v.id && styles.venueCardActive]}>
              <View style={styles.venueRow}>
                <Text style={styles.venueEmoji}>{v.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.venueName}>{v.name}</Text>
                  <Text style={styles.venueMeta}>{v.type} · {v.price} · {v.distance}</Text>
                </View>
                {selected === v.id && <Text style={styles.checkMark}>✓</Text>}
              </View>
            </Card>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <View style={styles.footer}>
        <Button title="Reserve Spot" onPress={() => navigation.navigate('ReservationLocker', { matchId: route.params?.matchId, venueId: selected })} disabled={!selected} fullWidth />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xxl, paddingBottom: 100 },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm },
  subtitle: { ...typography.body1, color: colors.textSecondary, marginBottom: spacing.xxl },
  venueCard: { marginBottom: spacing.md, padding: spacing.lg },
  venueCardActive: { borderColor: colors.primary, borderWidth: 1.5 },
  venueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  venueEmoji: { fontSize: 32 },
  venueName: { ...typography.body1, color: colors.textPrimary },
  venueMeta: { ...typography.caption, color: colors.textMuted },
  checkMark: { ...typography.h3, color: colors.primary },
  footer: { position: 'absolute', bottom: 40, left: spacing.xxl, right: spacing.xxl },
});

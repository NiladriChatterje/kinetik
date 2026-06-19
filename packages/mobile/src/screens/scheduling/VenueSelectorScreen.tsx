import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { colors, typography, spacing, radius } from '../../theme';

const VENUES = [
  { id: '1', name: 'Blend Craft Coffee', type: 'Cafe', price: '$$', distance: '0.3mi' },
  { id: '2', name: 'The Velvet Lounge', type: 'Bar', price: '$$$', distance: '0.5mi' },
  { id: '3', name: 'Sakura Sushi Bar', type: 'Restaurant', price: '$$', distance: '0.7mi' },
  { id: '4', name: 'Rooftop Tapas', type: 'Lounge', price: '$$$', distance: '1.1mi' },
];

export const VenueSelectorScreen: React.FC<{ navigation: any; route: any }> = ({ navigation, route }) => {
  const [selected, setSelected] = useState<string | null>(null);

  const renderVenueIcon = (venueId: string, color: string) => {
    switch (venueId) {
      case '1': return <MaterialCommunityIcons name={'cafe-outline' as any} size={32} color={color} />;
      case '2': return <Ionicons name="wine-outline" size={32} color={color} />;
      case '3': return <Ionicons name="restaurant-outline" size={32} color={color} />;
      case '4': return <Ionicons name="pizza-outline" size={32} color={color} />;
      default: return null;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Pick a Spot</Text>
        <Text style={styles.subtitle}>Midpoint venues between you two</Text>
        {VENUES.map((v) => (
          <TouchableOpacity key={v.id} onPress={() => setSelected(v.id)}>
            <Card style={[styles.venueCard, selected === v.id ? styles.venueCardActive : undefined] as any}>
              <View style={styles.venueRow}>
                {renderVenueIcon(v.id, selected === v.id ? colors.primary : colors.textSecondary)}
                <View style={{ flex: 1 }}>
                  <Text style={styles.venueName}>{v.name}</Text>
                  <Text style={styles.venueMeta}>{v.type} - {v.price} - {v.distance}</Text>
                </View>
                {selected === v.id && <Ionicons name="checkmark-circle" size={22} color={colors.primary} />}
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
  venueName: { ...typography.body1, color: colors.textPrimary },
  venueMeta: { ...typography.caption, color: colors.textMuted },
  footer: { position: 'absolute', bottom: 40, left: spacing.xxl, right: spacing.xxl },
});

import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { colors, typography, spacing, radius } from '../../theme';

const SLOTS = ['6:00 PM', '6:30 PM', '7:00 PM', '7:30 PM', '8:00 PM', '8:30 PM', '9:00 PM'];

export const CalendarSyncScreen: React.FC<{ navigation: any; route: any }> = ({ navigation, route }) => {
  const [selectedDate, setSelectedDate] = useState('Tomorrow');
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Pick a Time</Text>
        <Text style={styles.subtitle}>Find a slot that works for both of you</Text>
        <Card style={styles.calendarCard}>
          <Text style={styles.sectionTitle}>Available Dates</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.datesRow}>
            {['Today', 'Tomorrow', 'Fri', 'Sat', 'Sun', 'Mon'].map((d) => (
              <TouchableOpacity key={d} style={[styles.dateChip, selectedDate === d && styles.dateChipActive]} onPress={() => setSelectedDate(d)}>
                <Text style={[styles.dateText, selectedDate === d && styles.dateTextActive]}>{d}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </Card>
        <Card style={styles.timeCard}>
          <Text style={styles.sectionTitle}>Evening Slots</Text>
          <View style={styles.timeGrid}>
            {SLOTS.map((t) => (
              <TouchableOpacity key={t} style={[styles.timeSlot, selectedTime === t && styles.timeSlotActive]} onPress={() => setSelectedTime(t)}>
                <Text style={[styles.timeText, selectedTime === t && styles.timeTextActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Card>
      </ScrollView>
      <View style={styles.footer}>
        <Button title="Confirm Time" onPress={() => navigation.navigate('VenueSelector', { matchId: route.params?.matchId })} disabled={!selectedTime} fullWidth size="lg" />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xxl, paddingBottom: 100 },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm },
  subtitle: { ...typography.body1, color: colors.textSecondary, marginBottom: spacing.xxl },
  calendarCard: { marginBottom: spacing.lg },
  sectionTitle: { ...typography.h4, color: colors.textPrimary, marginBottom: spacing.lg },
  datesRow: { flexDirection: 'row', gap: spacing.sm },
  dateChip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.surfaceHighlight, borderRadius: radius.full },
  dateChipActive: { backgroundColor: colors.primary },
  dateText: { ...typography.body2, color: colors.textSecondary },
  dateTextActive: { color: colors.textPrimary },
  timeCard: { marginBottom: spacing.lg },
  timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  timeSlot: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.surfaceHighlight, borderRadius: radius.md },
  timeSlotActive: { backgroundColor: colors.secondary },
  timeText: { ...typography.body2, color: colors.textSecondary },
  timeTextActive: { color: colors.textPrimary },
  footer: { position: 'absolute', bottom: 40, left: spacing.xxl, right: spacing.xxl },
});

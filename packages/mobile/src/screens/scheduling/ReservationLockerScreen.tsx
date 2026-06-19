import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { colors, typography, spacing, radius } from '../../theme';

export const ReservationLockerScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [booked, setBooked] = useState(false);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Ionicons name={booked ? 'checkmark-circle-outline' : 'lock-closed-outline'} size={64} color={booked ? colors.success : colors.primary} />
        <Text style={styles.title}>{booked ? 'Reserved!' : 'Confirm Reservation'}</Text>
        <Text style={styles.subtitle}>
          {booked ? 'Your date is set. Both of you will receive a reminder.' : 'Secure your spot with a small deposit'}
        </Text>
        <Card style={styles.detailCard}>
          <View style={styles.detailRow}><Text style={styles.detailLabel}>Venue</Text><Text style={styles.detailValue}>Blend Craft Coffee</Text></View>
          <View style={styles.detailRow}><Text style={styles.detailLabel}>Date</Text><Text style={styles.detailValue}>Tomorrow - 7:00 PM</Text></View>
          <View style={styles.detailRow}><Text style={styles.detailLabel}>Deposit</Text><Text style={styles.detailValue}>$5.00 (refundable)</Text></View>
        </Card>
      </View>
      <View style={styles.footer}>
        {!booked ? (
          <Button title="Pay Deposit & Confirm" onPress={() => setBooked(true)} fullWidth size="lg" />
        ) : (
          <Button title="Back to Kinetik" onPress={() => navigation.navigate('Main')} fullWidth />
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm, marginTop: spacing.lg },
  subtitle: { ...typography.body1, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xxl },
  detailCard: { padding: spacing.xl, width: '100%' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md },
  detailLabel: { ...typography.body2, color: colors.textMuted },
  detailValue: { ...typography.body1, color: colors.textPrimary },
  footer: { padding: spacing.xxl, paddingBottom: spacing.huge },
});

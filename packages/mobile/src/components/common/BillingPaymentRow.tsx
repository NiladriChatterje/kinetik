import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { BillingPayment } from '../../services/api';
import { colors, typography, spacing } from '../../theme';

export function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** One line of billing history: status, description, date and amount. */
export const BillingPaymentRow = React.memo(({ payment: p }: { payment: BillingPayment }) => (
  <View style={styles.row}>
    <Ionicons
      name={p.status === 'completed' ? 'checkmark-circle-outline' : 'time-outline'}
      size={18}
      color={p.status === 'completed' ? colors.success : colors.warning}
    />
    <View style={styles.info}>
      <Text style={styles.desc} numberOfLines={1}>{p.description}</Text>
      <Text style={styles.date}>{formatDate(p.paidAt)}</Text>
    </View>
    <Text style={styles.amount}>{p.amount !== null ? `₹${p.amount}` : '—'}</Text>
  </View>
));

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.cardBorder,
  },
  info: { flex: 1 },
  desc: { ...typography.body2, color: colors.textPrimary },
  date: { ...typography.caption, color: colors.textMuted },
  amount: { ...typography.body2, color: colors.textPrimary, fontWeight: '600' },
});

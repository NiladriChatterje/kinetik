import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../components/common/Button';
import { BillingPaymentRow } from '../../components/common/BillingPaymentRow';
import { api, BillingPayment } from '../../services/api';
import { colors, typography, spacing } from '../../theme';

// Rows per request. The list is virtualised, so only the rows on screen are
// rendered however many pages have been loaded.
const PAGE_SIZE = 20;

/**
 * Every payment, newest first, loaded a page at a time by cursor as the user
 * scrolls. The checkout screen shows only the newest page and links here.
 */
export const BillingHistoryScreen: React.FC = () => {
  const navigation = useNavigation();
  const [payments, setPayments] = useState<BillingPayment[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  // One request at a time: onEndReached fires repeatedly while the list settles
  const inFlightRef = useRef(false);

  const loadPage = useCallback(async (cursor: string | null) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (cursor) setLoadingMore(true);
    try {
      const res = await api.getSubscriptionHistory({ limit: PAGE_SIZE, cursor: cursor ?? undefined });
      if (!res.success || !res.data) throw new Error(res.error?.message);
      const page = res.data;
      setPayments((prev) => (cursor ? [...prev, ...page.payments] : page.payments));
      setNextCursor(page.nextCursor);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    loadPage(null);
  }, [loadPage]);

  // After a failure the list stops asking on its own; the footer offers a retry
  const loadMore = useCallback(() => {
    if (nextCursor && !failed) loadPage(nextCursor);
  }, [nextCursor, failed, loadPage]);

  const retry = useCallback(() => {
    if (!payments.length) setLoading(true);
    loadPage(payments.length ? nextCursor : null);
  }, [payments.length, nextCursor, loadPage]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Billing history</Text>
          <Text style={styles.headerSubtitle}>Every Kinetik Premium payment</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
      ) : failed && !payments.length ? (
        <View style={styles.notice}>
          <Ionicons name="cloud-offline-outline" size={28} color={colors.textSecondary} />
          <Text style={styles.noticeText}>Couldn't load your billing history.</Text>
          <Button title="Try again" onPress={retry} variant="outline" size="sm" />
        </View>
      ) : (
        <FlatList
          data={payments}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => <BillingPaymentRow payment={item} />}
          contentContainerStyle={styles.list}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={<Text style={styles.noticeText}>No payments yet.</Text>}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={colors.primary} style={styles.footer} />
            ) : failed ? (
              <View style={styles.footer}>
                <Text style={styles.noticeText}>Couldn't load more.</Text>
                <Button title="Try again" onPress={retry} variant="outline" size="sm" />
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1 },
  headerTitle: { ...typography.h2, color: colors.textPrimary },
  headerSubtitle: { ...typography.body2, color: colors.textSecondary, marginTop: 2 },
  loader: { marginTop: spacing.xxl * 2 },
  list: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxl },
  notice: { alignItems: 'center', gap: spacing.md, padding: spacing.xxl },
  noticeText: { ...typography.body2, color: colors.textSecondary, textAlign: 'center' },
  footer: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg },
});

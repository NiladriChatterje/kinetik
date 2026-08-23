import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import RazorpayCheckout from 'react-native-razorpay';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { useToast } from '../../hooks/useToast';
import { useAuthStore } from '../../store/authStore';
import { api } from '../../services/api';
import { colors, typography, spacing, radius } from '../../theme';

interface PricingInfo {
  currency: string;
  symbol: string;
  amount: number;
  amountMinor: number;
  label: string;
}

interface SubscriptionStatus {
  tier: string;
  autoRenew: boolean;
  expiresAt: string | null;
  subscriptionId: string | null;
}

interface SubscriptionPayment {
  paymentId: string | null;
  amount: number | null;
  currency: string;
  status: string;
  description: string;
  paidAt: string;
}

const FEATURES = [
  { icon: 'infinite-outline' as const, label: 'Unlimited daily swipes' },
  { icon: 'heart-outline' as const, label: '25 Super Likes every day' },
  { icon: 'eye-off-outline' as const, label: 'See who liked you — no blur' },
];

const PAYMENT_METHODS = ['Credit / Debit Card', 'UPI Autopay (recurring mandate)'];

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const SubscriptionCheckoutScreen: React.FC = () => {
  const authUser = useAuthStore((s) => s.user);
  const toast = useToast();

  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [pricing, setPricing] = useState<PricingInfo | null>(null);
  const [history, setHistory] = useState<{ payments: SubscriptionPayment[]; monthsPaid: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const [res, hist, priceRes] = await Promise.all([
        api.getSubscriptionStatus(),
        api.getSubscriptionHistory(),
        api.getPricing(),
      ]);
      if (res.success && res.data) {
        setStatus(res.data as SubscriptionStatus);
      }
      if (hist.success && hist.data) {
        setHistory(hist.data);
      }
      if (priceRes.success && priceRes.data) {
        setPricing(priceRes.data as PricingInfo);
      }
    } catch {
      // Leave status null — the screen falls back to the "not subscribed" state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const isPremium = status?.tier === 'premium';
  const isAutoRenew = Boolean(status?.autoRenew);

  const handleCancel = useCallback(() => {
    if (cancelling) return;
    const until = formatDate(status?.expiresAt ?? null);
    Alert.alert(
      'Cancel subscription?',
      `You will keep Premium${until ? ` until ${until}` : ''}, but it will not renew afterwards.`,
      [
        { text: 'Keep subscription', style: 'cancel' },
        {
          text: 'Cancel subscription',
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            try {
              const res = await api.cancelRazorpaySubscription();
              if (!res.success) {
                throw new Error(res.error?.message || 'Could not cancel subscription');
              }
              toast.showSuccess('Cancelled', 'Premium active until cycle ends.');
              await fetchStatus();
            } catch (error: any) {
              toast.showError('Failed', error?.message || 'Try again.');
            } finally {
              setCancelling(false);
            }
          },
        },
      ],
    );
  }, [cancelling, status, toast, fetchStatus]);

  const handleSubscribe = useCallback(async () => {
    if (subscribing) return;
    setSubscribing(true);
    try {
      // 1. Create the recurring subscription on the server
      const createRes = await api.createRazorpaySubscription();
      if (!createRes.success || !createRes.data) {
        throw new Error(createRes.error?.message || 'Could not start checkout');
      }
      const { subscriptionId, razorpayKeyId } = createRes.data;

      // 2. Open the Razorpay Checkout — cards + UPI Autopay mandate
      const contact = (authUser?.phone || '').replace(/\D/g, '').slice(-10);
      const options = {
        key: razorpayKeyId,
        subscription_id: subscriptionId,
        name: 'Kinetik',
        description: `Kinetik Premium — ${pricing?.label ?? '₹250/month'}`,
        currency: pricing?.currency ?? 'INR',
        prefill: {
          name: authUser?.displayName || '',
          email: authUser?.email || '',
          contact,
        },
        theme: { color: colors.primary },
      };

      const data = await RazorpayCheckout.open(options) as {
        razorpay_payment_id?: string;
        razorpay_subscription_id?: string;
        razorpay_signature?: string;
      };

      // 3. Server-side verification + activation (HMAC over payment + subscription)
      if (!data?.razorpay_payment_id || !data?.razorpay_subscription_id || !data?.razorpay_signature) {
        throw new Error('Checkout returned an incomplete response');
      }

      const verifyRes = await api.verifyRazorpaySubscription({
        razorpayPaymentId: data.razorpay_payment_id,
        razorpaySubscriptionId: data.razorpay_subscription_id,
        razorpaySignature: data.razorpay_signature,
      });

      if (!verifyRes.success) {
        throw new Error(verifyRes.error?.message || 'Payment could not be verified');
      }

      if (verifyRes.data?.activated) {
        toast.showSuccess('Premium active!', 'Subscription is live.');
      } else {
        toast.showSuccess('Approved', 'Activating shortly.');
      }
      await fetchStatus();
    } catch (error: any) {
      const code = error?.code;
      const message = error?.description || error?.message;
      // Payment cancelled by the user is expected — show a neutral message
      if (code === 'BAD_REQUEST_ERROR' || code === 'PAYMENT_CANCELLED' || /cancelled|cancel/i.test(message || '')) {
        toast.showError('Cancelled', 'Try again any time.');
      } else {
        toast.showError('Failed', message || 'Try again.');
      }
    } finally {
      setSubscribing(false);
    }
  }, [subscribing, authUser, toast, fetchStatus]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Subscription</Text>
        <Text style={styles.subtitle}>Go Premium on Kinetik</Text>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <>
            {/* Plan card */}
            <Card style={styles.planCard}>
              <View style={styles.planBadge}>
                <Ionicons name="diamond" size={16} color={colors.textPrimary} />
                <Text style={styles.planBadgeText}>PREMIUM</Text>
              </View>
              <View style={styles.priceRow}>
                <Text style={styles.price}>{pricing?.label ?? '₹250/month'}</Text>
              </View>
              <Text style={styles.planNote}>Recurring — cancel any time from Razorpay</Text>

              {isPremium && (
                <View style={styles.activeBox}>
                  <Ionicons
                    name={isAutoRenew ? 'checkmark-circle' : 'stop-circle-outline'}
                    size={18}
                    color={isAutoRenew ? colors.success : colors.warning}
                  />
                  <Text style={styles.activeText}>
                    {isAutoRenew
                      ? `Active · auto-renews on ${formatDate(status?.expiresAt ?? null)}`
                      : `Cancelled · active until ${formatDate(status?.expiresAt ?? null)}`}
                  </Text>
                </View>
              )}
            </Card>

            {/* Features */}
            <Text style={styles.sectionTitle}>What you get</Text>
            {FEATURES.map((f) => (
              <View key={f.label} style={styles.featureRow}>
                <Ionicons name={f.icon} size={20} color={colors.secondary} />
                <Text style={styles.featureText}>{f.label}</Text>
              </View>
            ))}

            {/* Payment methods */}
            <Text style={styles.sectionTitle}>Payment methods</Text>
            {PAYMENT_METHODS.map((m) => (
              <View key={m} style={styles.featureRow}>
                <Ionicons name="card-outline" size={20} color={colors.secondary} />
                <Text style={styles.featureText}>{m}</Text>
              </View>
            ))}
            <Text style={styles.disclaimer}>
              Subscriptions are billed by Razorpay in {pricing?.currency ?? 'INR'}. Cards are charged {pricing?.label ?? '₹250'} each month; UPI users
              approve a recurring mandate. Razorpay sends payment reminders before every charge.
            </Text>

            <Button
              title={isPremium && !isAutoRenew ? 'Renew subscription' : `Subscribe for ${pricing?.label ?? '₹250/month'}`}
              onPress={handleSubscribe}
              loading={subscribing}
              disabled={isPremium && isAutoRenew}
              fullWidth
              style={styles.subscribeBtn}
            />

            {isPremium && isAutoRenew && (
              <Button
                title="Cancel subscription"
                onPress={handleCancel}
                loading={cancelling}
                variant="outline"
                fullWidth
                style={styles.cancelBtn}
              />
            )}

            {/* Reassurance: deleting the account never leaves a running mandate */}
            <View style={styles.assuranceBox}>
              <Ionicons name="shield-checkmark" size={20} color={colors.success} />
              <Text style={styles.assuranceText}>
                If you ever delete your Kinetik account, your subscription and payment mandate
                are cancelled automatically — you will never be charged after leaving.
              </Text>
            </View>

            {/* Billing history */}
            {history && history.payments.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Billing history</Text>
                <Text style={styles.historySummary}>
                  {history.monthsPaid} month{history.monthsPaid === 1 ? '' : 's'} of Premium paid
                </Text>
                {history.payments.map((p, i) => (
                  <View key={p.paymentId || `${p.paidAt}-${i}`} style={styles.historyRow}>
                    <Ionicons
                      name={p.status === 'completed' ? 'checkmark-circle-outline' : 'time-outline'}
                      size={18}
                      color={p.status === 'completed' ? colors.success : colors.warning}
                    />
                    <View style={styles.historyInfo}>
                      <Text style={styles.historyDesc} numberOfLines={1}>{p.description}</Text>
                      <Text style={styles.historyDate}>{formatDate(p.paidAt)}</Text>
                    </View>
                    <Text style={styles.historyAmount}>
                      {p.amount !== null ? `₹${p.amount}` : '—'}
                    </Text>
                  </View>
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xxl, paddingBottom: spacing.xxl * 2 },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm },
  subtitle: { ...typography.body1, color: colors.textSecondary, marginBottom: spacing.xxl },
  loadingBox: { alignItems: 'center', paddingVertical: spacing.xxl * 2 },
  planCard: { alignItems: 'center', padding: spacing.xl, marginBottom: spacing.xl },
  planBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surfaceLight,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginBottom: spacing.lg,
  },
  planBadgeText: { ...typography.label, color: colors.textSecondary },
  priceRow: { flexDirection: 'row', alignItems: 'baseline' },
  price: { ...typography.h1, color: colors.textPrimary },
  pricePeriod: { ...typography.body1, color: colors.textMuted, marginLeft: spacing.xs },
  planNote: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
  activeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  activeText: { ...typography.body2, color: colors.textSecondary, flex: 1 },
  sectionTitle: { ...typography.h4, color: colors.textPrimary, marginBottom: spacing.md, marginTop: spacing.lg },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  featureText: { ...typography.body1, color: colors.textSecondary, flex: 1 },
  disclaimer: { ...typography.caption, color: colors.textMuted, marginTop: spacing.md, lineHeight: 18 },
  subscribeBtn: { marginTop: spacing.xxl },
  cancelBtn: { marginTop: spacing.md },
  assuranceBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHighlight,
    borderWidth: 1,
    borderColor: colors.success,
  },
  assuranceText: { ...typography.caption, color: colors.textSecondary, flex: 1, lineHeight: 18 },
  historySummary: { ...typography.body2, color: colors.textSecondary, marginBottom: spacing.md },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.cardBorder,
  },
  historyInfo: { flex: 1 },
  historyDesc: { ...typography.body2, color: colors.textPrimary },
  historyDate: { ...typography.caption, color: colors.textMuted },
  historyAmount: { ...typography.body2, color: colors.textPrimary, fontWeight: '600' },
});

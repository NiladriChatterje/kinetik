import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import {
  initConnection,
  endConnection,
  fetchProducts,
  requestPurchase,
  finishTransaction,
  getAvailablePurchases,
  purchaseUpdatedListener,
  purchaseErrorListener,
} from 'expo-iap';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { BillingPaymentRow, formatDate } from '../../components/common/BillingPaymentRow';
import { useToast } from '../../hooks/useToast';
import { api, BillingPayment } from '../../services/api';
import { useAuthStore, announcePremiumActive } from '../../store/authStore';
import { onPremiumChanged } from '../../services/appEvents';
import { colors, typography, spacing, radius } from '../../theme';

interface PricingInfo {
  currency: string;
  symbol: string;
  amount: number;
  amountMinor: number;
  label: string;
  productId: string;
  period: string;
}

interface SubscriptionStatus {
  tier: string;
  autoRenew: boolean;
  expiresAt: string | null;
  hasPurchase: boolean;
  /** Google could not charge the renewal (grace period or account hold) */
  paymentIssue?: boolean;
  manageUrl: string;
}

/** The payment problem notice, the same orange as Profile's pending badge */
const PAYMENT_ISSUE_ORANGE = '#FFA500';

const FEATURES = [
  { icon: 'chatbubbles-outline' as const, label: 'Chat with your matches' },
  { icon: 'infinite-outline' as const, label: 'Unlimited likes' },
  { icon: 'eye-off-outline' as const, label: 'See everyone who liked you' },
];

const PAYMENT_METHODS = [
  'UPI Autopay, cards, and anything else saved in Google Play',
  'Managed entirely by Google Play — cancel any time',
];

// expo-iap error codes, grouped by what the user can do about them
const STORE_UNREACHABLE_CODES = new Set([
  'network-error',
  'service-disconnected',
  'service-timeout',
  'service-error',
  'connection-closed',
  'billing-unavailable',
  'iap-not-available',
  'init-connection',
  'remote-error',
]);
const PLAN_UNAVAILABLE_CODES = new Set([
  'item-unavailable',
  'sku-not-found',
  'sku-offer-mismatch',
  'query-product',
  'empty-sku-list',
  'developer-error',
  'feature-not-supported',
]);

type PurchaseErrorOutcome =
  | { kind: 'cancelled' }
  | { kind: 'owned' }
  | { kind: 'message'; title: string; message: string };

/**
 * What to tell the user about a failed Play purchase. Play's own text is
 * technical, so it only goes to the log.
 */
function describePurchaseError(error: any): PurchaseErrorOutcome {
  const code = String(error?.code || '');
  const raw = String(error?.message || '');
  if (/cancel/i.test(code) || /cancel/i.test(raw)) return { kind: 'cancelled' };
  console.warn('[subscription] Purchase failed:', code || '(no code)', raw);
  if (code === 'already-owned') return { kind: 'owned' };
  if (STORE_UNREACHABLE_CODES.has(code)) {
    return {
      kind: 'message',
      title: 'Google Play unavailable',
      message: 'Check your connection and try again.',
    };
  }
  if (PLAN_UNAVAILABLE_CODES.has(code)) {
    return {
      kind: 'message',
      title: 'Plan unavailable',
      message: 'This plan is not available right now. Try again later.',
    };
  }
  return {
    kind: 'message',
    title: 'Purchase failed',
    message: 'Google Play could not complete the purchase. Try again.',
  };
}

export const SubscriptionCheckoutScreen: React.FC = () => {
  const toast = useToast();
  const navigation = useNavigation<any>();
  // Opened from a chat, likes or swipe paywall (see RootNavigator)
  const fromPaywall = Boolean((useRoute<any>().params as { fromPaywall?: boolean } | undefined)?.fromPaywall);

  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [pricing, setPricing] = useState<PricingInfo | null>(null);
  // The newest page only; BillingHistoryScreen pages through the rest
  const [history, setHistory] = useState<{
    payments: BillingPayment[];
    nextCursor: string | null;
    monthsPaid?: number;
  } | null>(null);
  const [product, setProduct] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  // The server did not answer the status request (offline, outage)
  const [statusFailed, setStatusFailed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // The purchase listener fires outside React's lifecycle (including for
  // purchases completed while the app was closed), so it reads these through a
  // ref rather than closing over stale state.
  const pricingRef = useRef<PricingInfo | null>(null);
  pricingRef.current = pricing;

  // The Play connection is opened once per visit (see the store effect) and
  // closed when the screen goes. Refs, not state, so no re-render can end it.
  const mountedRef = useRef(true);
  const connectedRef = useRef(false);
  const storeLoadRef = useRef<Promise<any | null> | null>(null);
  // True while this screen reports its own purchase to the store
  const reportingOwnPurchaseRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    try {
      const [res, hist, priceRes] = await Promise.all([
        api.getSubscriptionStatus(),
        api.getSubscriptionHistory(),
        api.getPricing(),
      ]);
      setStatusFailed(!(res.success && res.data));
      if (res.success && res.data) {
        setStatus(res.data as SubscriptionStatus);
        // Same tiers the server's chat and likes gates treat as Premium
        const tier = (res.data as SubscriptionStatus).tier;
        useAuthStore.getState().setPremium(tier === 'premium' || tier === 'infinite');
        useAuthStore.getState().setPaymentIssue(Boolean((res.data as SubscriptionStatus).paymentIssue));
      }
      if (hist.success && hist.data) {
        setHistory(hist.data);
      }
      if (priceRes.success && priceRes.data) {
        // Also into the ref now, so loadStore can use it before the re-render
        pricingRef.current = priceRes.data as PricingInfo;
        setPricing(priceRes.data as PricingInfo);
      }
      return priceRes.success ? (priceRes.data as PricingInfo) : null;
    } catch {
      setStatusFailed(true);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Sends a purchase token to the server for verification and, once the server
   * has durably granted the entitlement, finishes the transaction with Play.
   *
   * finishTransaction must not run before the server confirms: it is what tells
   * Play the purchase was handled, and doing it early on a request that failed
   * would leave the user charged with no Premium.
   */
  const redeemPurchase = useCallback(
    async (purchase: any, { silent }: { silent?: boolean } = {}) => {
      const price = pricingRef.current;
      const res = await api.verifyPlayPurchase({
        purchaseToken: purchase.purchaseToken,
        productId: purchase.productId,
        priceAmount: price?.amount,
        priceCurrency: price?.currency,
      });

      if (!res.success) {
        throw new Error(res.error?.message || 'Could not verify the purchase');
      }

      // A pending UPI Autopay mandate is not an error — Play will notify the
      // server when it resolves. Leave the transaction unfinished so Play
      // re-delivers it once the state changes.
      if (res.data?.pending) {
        if (!silent) {
          toast.showSuccess('Almost there', 'Waiting for your bank to confirm the mandate.');
        }
        return;
      }

      // The server has granted the entitlement and acknowledged the purchase
      // (with the hourly sweep as its backup), so a failure here must not be
      // reported as a failed purchase: Play re-delivers an unfinished one.
      try {
        await finishTransaction({ purchase, isConsumable: false });
      } catch (error: any) {
        console.warn('[subscription] finishTransaction failed:', error?.code || error?.message || error);
      }

      if (res.data?.activated) {
        // Every screen that locked something reloads (appEvents). The event
        // is delivered synchronously; this screen's own listener skips it,
        // because the lines below refresh or leave the screen anyway.
        reportingOwnPurchaseRef.current = true;
        try {
          useAuthStore.getState().setPremium(true, { isChange: true });
        } finally {
          reportingOwnPurchaseRef.current = false;
        }
        if (!silent) {
          announcePremiumActive();
          // Bought from a paywall: go straight back to the chat, likes or
          // card that asked for Premium, which has already reloaded unlocked
          if (fromPaywall && navigation.canGoBack()) {
            navigation.goBack();
            return;
          }
        }
      }
      await fetchStatus();
    },
    [toast, fetchStatus, fromPaywall, navigation],
  );

  /**
   * Connect to Play (once per visit) and look up the subscription product.
   * Concurrent calls share one attempt. A failed or empty attempt can be
   * retried, and the subscribe button does: the first one may have run while
   * the server's database was waking up, with no product id to look up.
   */
  const loadStore = useCallback((): Promise<any | null> => {
    if (!storeLoadRef.current) {
      storeLoadRef.current = (async () => {
        const productId = pricingRef.current?.productId ?? (await fetchStatus())?.productId;
        if (!productId) return null;
        if (!connectedRef.current) {
          await initConnection();
          connectedRef.current = true;
        }
        const products = await fetchProducts({ skus: [productId], type: 'subs' });
        const found = products?.[0] ?? null;
        if (found && mountedRef.current) setProduct(found);
        return found;
      })().finally(() => {
        storeLoadRef.current = null;
      });
    }
    return storeLoadRef.current;
  }, [fetchStatus]);

  // The listeners below are registered once, so they call the latest version
  const redeemRef = useRef(redeemPurchase);
  redeemRef.current = redeemPurchase;

  /**
   * Re-send subscriptions Play already holds for this Google account
   * (reinstall, new device, or Play saying "already owned") rather than
   * making the user pay again. Silent on the visit-time run; when the user
   * asked, a failure is reported.
   */
  const restoreOwned = useCallback(async ({ silent }: { silent: boolean }) => {
    const productId = pricingRef.current?.productId;
    const owned = (await getAvailablePurchases() ?? []).filter(
      (purchase: any) => !productId || purchase?.productId === productId,
    );
    if (!owned.length && !silent) {
      toast.showError('Nothing to restore', 'Google Play found no subscription on this account.');
    }
    for (const purchase of owned) {
      try {
        await redeemRef.current(purchase, { silent });
      } catch (error: any) {
        // Another account may own it, or the network is down — the
        // subscribe button still works.
        if (!silent) {
          toast.showError('Could not restore', error?.message || 'Reopen this screen to try again.');
        }
      }
    }
  }, [toast]);

  // ─── Store connection, product lookup, and restore ────
  // Runs once per visit. It must not depend on anything that can change
  // between renders: re-running it ends the Play connection (cleanup) and
  // starts a new one, and in a re-render loop Play never stays connected long
  // enough to return the product (seen in versionCode 10: "Google Play is not
  // ready" on every tap).
  useEffect(() => {
    mountedRef.current = true;

    const purchaseSub = purchaseUpdatedListener(async (purchase: any) => {
      // Android reports 'pending' for a purchase awaiting a UPI mandate. It is
      // still sent to the server: nothing is granted for it, but the server
      // records which account it belongs to, so the Play notification that
      // arrives when the bank confirms can activate Premium even if this
      // screen is never opened again. redeemPurchase leaves a pending
      // transaction unfinished.
      if (!purchase?.purchaseToken) return;
      try {
        await redeemRef.current(purchase);
      } catch (error: any) {
        toast.showError('Purchase not confirmed', error?.message || 'Please reopen this screen.');
      } finally {
        if (mountedRef.current) setSubscribing(false);
      }
    });

    const errorSub = purchaseErrorListener((error: any) => {
      if (mountedRef.current) setSubscribing(false);
      const outcome = describePurchaseError(error);
      if (outcome.kind === 'cancelled') {
        toast.showError('Cancelled', 'Try again any time.');
      } else if (outcome.kind === 'owned') {
        toast.showSuccess('Already subscribed', 'Restoring your subscription.');
        restoreOwned({ silent: false }).catch(() => {});
      } else {
        toast.showError(outcome.title, outcome.message);
      }
    });

    // Premium changed elsewhere while this screen is open (a UPI mandate
    // confirmed, an expiry): show the new state. Never navigates, so it
    // cannot add to the paywall return in redeemPurchase.
    const offPremiumChanged = onPremiumChanged(() => {
      if (!reportingOwnPurchaseRef.current && mountedRef.current) fetchStatus();
    });

    (async () => {
      await fetchStatus();

      try {
        await loadStore();
        if (!mountedRef.current || !connectedRef.current) return;
        // Silent because this runs on every visit to the screen
        await restoreOwned({ silent: true });
      } catch (error: any) {
        if (mountedRef.current) {
          console.warn('[subscription] Store unavailable:', error?.message || error);
        }
      }
    })();

    return () => {
      mountedRef.current = false;
      purchaseSub?.remove?.();
      errorSub?.remove?.();
      offPremiumChanged();
      connectedRef.current = false;
      storeLoadRef.current = null;
      endConnection().catch(() => {});
    };
    // Deliberately once per visit; see the comment above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isPremium = status?.tier === 'premium';
  // Never loaded on this visit: unknown, not "not subscribed". A paying user
  // must not be offered Subscribe (or lose Cancel) because of an outage. A
  // status loaded earlier stays shown if a later refresh fails.
  const statusUnknown = statusFailed && !status;
  const retryStatus = async () => {
    setLoading(true);
    await fetchStatus();
  };
  // From the status read and the server's push (authStore)
  const paymentIssue = useAuthStore((s) => s.paymentIssue);
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
              const res = await api.cancelSubscription();
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

  /** Play's subscription centre, for restoring renewal or changing payment method. */
  const handleOpenPlay = useCallback(() => {
    const url = status?.manageUrl;
    if (!url) return;
    Linking.openURL(url).catch(() => {});
  }, [status]);

  const handleSubscribe = useCallback(async () => {
    if (subscribing) return;

    setSubscribing(true);
    try {
      // The product may not have loaded when the screen opened; try again now
      const current =
        product ??
        (await loadStore().catch((err: any) => {
          console.warn('[subscription] Store unavailable:', err?.message || err);
          return null;
        }));
      const productId = pricingRef.current?.productId ?? current?.id;
      if (!current || !productId) {
        setSubscribing(false);
        toast.showError('Store unavailable', 'Google Play is not ready. Try again in a moment.');
        return;
      }

      // Play requires the offer token for the base plan being purchased; a
      // subscription with no offers cannot be bought.
      const offers = (current.subscriptionOffers ?? [])
        .filter((o: any) => o?.offerTokenAndroid)
        .map((o: any) => ({ sku: current.id ?? productId, offerToken: o.offerTokenAndroid }));

      if (!offers.length) {
        setSubscribing(false);
        toast.showError('Plan unavailable', 'This plan is not available on your account yet.');
        return;
      }

      // Resolution arrives on purchaseUpdatedListener, which clears `subscribing`.
      // The account id is kept by Play on the purchase, so purchase recovery
      // (services/purchaseRecovery.ts) only ever sends it for this account.
      await requestPurchase({
        request: {
          google: {
            skus: [productId],
            subscriptionOffers: offers,
            obfuscatedAccountId: useAuthStore.getState().user?.id ?? null,
          },
        },
        type: 'subs',
      });
    } catch (error: any) {
      setSubscribing(false);
      const outcome = describePurchaseError(error);
      if (outcome.kind === 'cancelled') {
        toast.showError('Cancelled', 'Try again any time.');
      } else if (outcome.kind === 'owned') {
        toast.showSuccess('Already subscribed', 'Restoring your subscription.');
        restoreOwned({ silent: false }).catch(() => {});
      } else {
        toast.showError(outcome.title, outcome.message);
      }
    }
  }, [subscribing, product, loadStore, restoreOwned, toast]);

  // Play sets the real price per region; the server figure is only a fallback
  // for the moment before the store connection is up.
  const displayPrice: string =
    product?.displayPrice ?? product?.localizedPrice ?? pricing?.label ?? '₹99/week';

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
            {statusUnknown && (
              <View style={styles.statusErrorBox}>
                <Ionicons name="cloud-offline-outline" size={22} color={colors.textSecondary} />
                <View style={styles.issueBody}>
                  <Text style={styles.issueTitle}>Couldn't load your subscription</Text>
                  <Text style={styles.issueText}>Check your connection and try again.</Text>
                  <Button
                    title="Try again"
                    onPress={retryStatus}
                    variant="outline"
                    size="sm"
                    style={styles.issueButton}
                  />
                </View>
              </View>
            )}

            {/* Google could not charge the renewal: in a grace period the user
                is still Premium for a few days, on hold they have lost it.
                The fix is always the payment method in Google Play. */}
            {paymentIssue && (
              <View style={styles.issueBox}>
                <Ionicons name="alert-circle" size={22} color={PAYMENT_ISSUE_ORANGE} />
                <View style={styles.issueBody}>
                  <Text style={styles.issueTitle}>Payment problem</Text>
                  <Text style={styles.issueText}>
                    Google Play could not charge your renewal. Update your payment method to keep Premium.
                  </Text>
                  {status?.manageUrl ? (
                    <Button
                      title="Fix in Google Play"
                      onPress={handleOpenPlay}
                      variant="outline"
                      size="sm"
                      style={styles.issueButton}
                    />
                  ) : null}
                </View>
              </View>
            )}

            {/* Plan card */}
            <Card style={styles.planCard}>
              <View style={styles.planBadge}>
                <Ionicons name="diamond" size={16} color={colors.textPrimary} />
                <Text style={styles.planBadgeText}>PREMIUM</Text>
              </View>
              <View style={styles.priceRow}>
                <Text style={styles.price}>{displayPrice}</Text>
              </View>
              <Text style={styles.planNote}>Recurring — cancel any time in Google Play</Text>

              {isPremium && (
                <View style={styles.activeBox}>
                  <Ionicons
                    name={isAutoRenew ? 'checkmark-circle' : 'stop-circle-outline'}
                    size={18}
                    color={isAutoRenew ? colors.success : colors.warning}
                  />
                  <Text style={styles.activeText}>
                    {isAutoRenew
                      ? `Active · renews on ${formatDate(status?.expiresAt ?? null)}`
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
            <Text style={styles.sectionTitle}>Payment</Text>
            {PAYMENT_METHODS.map((m) => (
              <View key={m} style={styles.featureRow}>
                <Ionicons name="card-outline" size={20} color={colors.secondary} />
                <Text style={styles.featureText}>{m}</Text>
              </View>
            ))}
            <Text style={styles.disclaimer}>
              Billed by Google Play. Your subscription renews automatically each week using the
              payment method on your Google account, and Google notifies you before every charge.
              Manage or cancel it any time in Google Play → Payments &amp; subscriptions.
            </Text>

            {!statusUnknown && (
              <Button
                title={isPremium && !isAutoRenew ? 'Resubscribe' : `Subscribe — ${displayPrice}`}
                onPress={handleSubscribe}
                loading={subscribing}
                disabled={isPremium && isAutoRenew}
                fullWidth
                style={styles.subscribeBtn}
              />
            )}

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

            {isPremium && !isAutoRenew && (
              <Button
                title="Manage in Google Play"
                onPress={handleOpenPlay}
                variant="outline"
                fullWidth
                style={styles.cancelBtn}
              />
            )}

            {/* Deleting the account cancels the subscription at Play first, and
                aborts if that call fails — so this promise is actually kept. */}
            <View style={styles.assuranceBox}>
              <Ionicons name="shield-checkmark" size={20} color={colors.success} />
              <Text style={styles.assuranceText}>
                If you ever delete your Kinetik account, your subscription is cancelled
                automatically — you will never be charged after leaving.
              </Text>
            </View>

            {/* Billing history */}
            {history && history.payments.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Billing history</Text>
                {/* The server counts completed payments (monthsPaid predates
                    weekly billing), so the label counts payments, not months */}
                <Text style={styles.historySummary}>
                  {history.monthsPaid ?? history.payments.length} payment
                  {(history.monthsPaid ?? history.payments.length) === 1 ? '' : 's'} made
                </Text>
                {history.payments.map((p) => (
                  <BillingPaymentRow key={p.id} payment={p} />
                ))}
                {history.nextCursor && (
                  <Button
                    title="Show more"
                    onPress={() => navigation.navigate('BillingHistory')}
                    variant="outline"
                    size="sm"
                    style={styles.showMoreBtn}
                  />
                )}
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
  issueBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.xl,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: PAYMENT_ISSUE_ORANGE,
    backgroundColor: 'rgba(255, 165, 0, 0.08)',
  },
  // The same box as the payment problem, in neutral grey
  statusErrorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.xl,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.surface,
  },
  issueBody: { flex: 1 },
  issueTitle: { ...typography.body1, color: colors.textPrimary, fontWeight: '600', marginBottom: spacing.xs },
  issueText: { ...typography.body2, color: colors.textSecondary, lineHeight: 20 },
  issueButton: { marginTop: spacing.md, alignSelf: 'flex-start' },
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
  showMoreBtn: { alignSelf: 'flex-start', marginTop: spacing.md },
});

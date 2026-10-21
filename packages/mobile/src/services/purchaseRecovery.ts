import { Platform } from 'react-native';
import { initConnection, getAvailablePurchases, finishTransaction } from 'expo-iap';
import { api } from './api';
import { useAuthStore, announcePremiumActive } from '../store/authStore';

/**
 * Sends Google Play purchases the server never confirmed back to it.
 *
 * The Subscription screen confirms a purchase while it is open. If the app
 * was closed mid-purchase, or that check failed, Play keeps the purchase
 * unacknowledged and Google refunds it after three days, with no Premium
 * ever given. This runs when a session starts and when the app comes back
 * to the foreground, and sends each such purchase to the same verify
 * endpoint, which grants Premium and acknowledges it, then finishes it as
 * the screen does.
 *
 * Only purchases tagged with the signed-in account count (the screen passes
 * the account id to Play as obfuscatedAccountId), so on a shared phone one
 * account never receives another's purchase. Untagged ones, made before the
 * tag existed, are left to the screen's own restore.
 *
 * The Play connection is left open: the Subscription screen opens and ends
 * its own, and ending it here could cut off a purchase in progress there.
 */

const MIN_INTERVAL_MS = 10 * 60 * 1000;

let running = false;
let lastRun = { userId: '', at: 0 };

export async function recoverPlayPurchases(): Promise<void> {
  const userId = useAuthStore.getState().user?.id;
  if (Platform.OS !== 'android' || !userId || running) return;
  if (lastRun.userId === userId && Date.now() - lastRun.at < MIN_INTERVAL_MS) return;
  running = true;
  lastRun = { userId, at: Date.now() };
  try {
    await initConnection();
    const purchases: any[] = (await getAvailablePurchases()) ?? [];
    for (const purchase of purchases) {
      // Signed out or switched account meanwhile: the verify call would
      // carry someone else's session
      if (useAuthStore.getState().user?.id !== userId) return;
      if (!purchase?.purchaseToken || purchase.isAcknowledgedAndroid !== false) continue;
      if (purchase.obfuscatedAccountIdAndroid !== userId) continue;

      const res = await api.verifyPlayPurchase({
        purchaseToken: purchase.purchaseToken,
        productId: purchase.productId,
      });
      // A pending UPI mandate stays unfinished, as on the Subscription screen
      if (!res.success || res.data?.pending) continue;
      try {
        await finishTransaction({ purchase, isConsumable: false });
      } catch {
        // Already acknowledged by the server; Play re-delivers an unfinished one
      }
      // The verify call credited this account; show it only if it is still
      // the one signed in
      const { user, isPremium } = useAuthStore.getState();
      if (res.data?.activated && user?.id === userId && isPremium !== true) {
        useAuthStore.getState().setPremium(true, { isChange: true });
        announcePremiumActive();
      }
    }
  } catch {
    // No Play on this device or the store is unreachable: try again next time
    lastRun = { userId: '', at: 0 };
  } finally {
    running = false;
  }
}

import * as SecureStore from 'expo-secure-store';

/**
 * The one-time Welcome page after onboarding.
 *
 * Marked pending when a user finishes onboarding, and cleared only by its
 * Start Exploring button, so closing the app on that page brings it back on
 * the next launch. Kept per user on this device: existing users never see
 * it, and a reinstall simply skips it.
 */

const key = (userId: string) => `welcome_pending_${userId}`;

export async function markWelcomePending(userId: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key(userId), '1');
  } catch {
    // Not critical: the page is still shown right now, just not on relaunch
  }
}

export async function isWelcomePending(userId: string): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(key(userId))) === '1';
  } catch {
    return false;
  }
}

export async function clearWelcomePending(userId: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key(userId));
  } catch {
    // Worst case the page shows once more on the next launch
  }
}

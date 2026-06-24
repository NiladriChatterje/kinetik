/**
 * Lazy loader for expo-notifications.
 *
 * Expo Go (SDK 53+) permanently removed Android push notification support.
 * The expo-notifications JS module CAN be required in Expo Go — but calling
 * ANY function on it throws because the native module backing is missing.
 *
 * Strategy:
 *  1. Check Constants.executionEnvironment FIRST.
 *     - If Expo Go => return null immediately (never touch expo-notifications).
 *  2. Only then require() the module. Cached after first load.
 *
 * This avoids BOTH the logged "removed from Expo Go" error AND the
 * "undefined is not a function" crashes from calling notification APIs.
 */

import Constants from 'expo-constants';

type NotificationsModule = typeof import('expo-notifications');

let _module: NotificationsModule | null | undefined = undefined;
let _loadAttempted = false;

export async function getNotificationsModule(): Promise<NotificationsModule | null> {
  if (_loadAttempted) return _module ?? null;
  _loadAttempted = true;

  // ── Expo Go guard ─────────────────────────────────────────────
  // expo-constants works in all environments (including Expo Go).
  if (Constants.executionEnvironment === 'storeClient') {
    console.log(
      '[notifications] Expo Go detected — expo-notifications native module ' +
        'is unavailable. Skipping all notification setup.'
    );
    _module = null;
    return null;
  }

  // ── Load the module (only outside Expo Go) ────────────────────
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('expo-notifications');
    _module = mod as unknown as NotificationsModule;
    return _module;
  } catch (error) {
    console.warn('[notifications] Failed to load expo-notifications:', error);
    _module = null;
    return null;
  }
}

/**
 * Guarded haptic feedback for the app's emotional beats (match, super like,
 * verification success). expo-haptics is a native module — dev clients built
 * before it was added would crash on a plain import, so it's loaded lazily
 * and every call degrades to a silent no-op (same pattern as the guarded
 * import in services/notifications.ts).
 */

let Haptics: typeof import('expo-haptics') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Haptics = require('expo-haptics');
} catch {
  Haptics = null;
}

/** Strong "something great happened" buzz — matches, verification success. */
export function hapticSuccess(): void {
  Haptics?.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/** Medium tap — super like sent. */
export function hapticImpact(): void {
  Haptics?.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/** Light tap — chip selection, subtle UI interactions. */
export function hapticLight(): void {
  Haptics?.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

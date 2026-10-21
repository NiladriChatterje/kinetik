import { DeviceEventEmitter } from 'react-native';

/**
 * In-app events between screens that have no other link.
 *
 * The swipe deck announces a like here; the Explore grid listens and drops
 * that person's card at once, instead of showing them until its next load
 * (the server leaves pending likes out of Explore).
 */
const PROFILE_LIKED = 'kinetik:profile:liked';

export function emitProfileLiked(userId: string): void {
  DeviceEventEmitter.emit(PROFILE_LIKED, { userId });
}

/**
 * A block removes the person everywhere at once. The Explore grid drops the
 * card exactly as it does for a like, so this shares that event.
 */
export function emitProfileBlocked(userId: string): void {
  DeviceEventEmitter.emit(PROFILE_LIKED, { userId });
}

/**
 * A pass keeps the person out of the viewer's Explore for a while (server
 * side, REJECT_COOLDOWN_DAYS), so the grid drops the card as for a like.
 */
export function emitProfilePassed(userId: string): void {
  DeviceEventEmitter.emit(PROFILE_LIKED, { userId });
}

/** Subscribe; the returned function unsubscribes. */
export function onProfileLiked(handler: (userId: string) => void): () => void {
  const subscription = DeviceEventEmitter.addListener(PROFILE_LIKED, (event: { userId?: string }) => {
    if (event?.userId) handler(event.userId);
  });
  return () => subscription.remove();
}

const LIKE_ANSWERED = 'kinetik:like:answered';

/**
 * A like was answered (liked back or rejected) from Discover, where a liker
 * opened from the Likes list is shown in full. The Likes list drops them.
 */
export function emitLikeAnswered(userId: string): void {
  DeviceEventEmitter.emit(LIKE_ANSWERED, { userId });
}

/** Subscribe; the returned function unsubscribes. */
export function onLikeAnswered(handler: (userId: string) => void): () => void {
  const subscription = DeviceEventEmitter.addListener(LIKE_ANSWERED, (event: { userId?: string }) => {
    if (event?.userId) handler(event.userId);
  });
  return () => subscription.remove();
}

const PREMIUM_CHANGED = 'kinetik:premium:changed';

/**
 * Premium was gained or lost: a purchase, a UPI mandate confirmed later, an
 * expiry, a refund. Screens whose content depends on it (chats, likes, the
 * deck and the grid) reload once. Raised only by the auth store's
 * setPremium, and only when its known value really changes, so a renewal or
 * a repeat answer costs nothing.
 */
export function emitPremiumChanged(isPremium: boolean): void {
  DeviceEventEmitter.emit(PREMIUM_CHANGED, { isPremium });
}

/** Subscribe; the returned function unsubscribes. */
export function onPremiumChanged(handler: (isPremium: boolean) => void): () => void {
  const subscription = DeviceEventEmitter.addListener(PREMIUM_CHANGED, (event: { isPremium?: boolean }) => {
    handler(Boolean(event?.isPremium));
  });
  return () => subscription.remove();
}

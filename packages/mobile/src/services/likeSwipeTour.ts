import * as SecureStore from 'expo-secure-store';

/**
 * The swipe tour on the Likes page: the top card slides right by itself
 * until its heart fills green, then settles back, showing that a swipe to
 * the right likes the person back. It plays until the account has answered
 * three likes here, counted per user on this device like the welcome page
 * (welcomeNotice.ts): a reinstall shows it again, a second account on the
 * same phone gets its own three.
 */

export const LIKE_SWIPE_TOUR_SWIPES = 3;

const key = (userId: string) => `like_swipes_${userId}`;

/** Likes answered by swiping so far, capped at the tour's limit. */
export async function getLikeSwipeCount(userId: string): Promise<number> {
  try {
    const raw = await SecureStore.getItemAsync(key(userId));
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    // Unknown: treat as done, so a storage hiccup never replays the tour forever
    return LIKE_SWIPE_TOUR_SWIPES;
  }
}

/** One more like answered; returns the new count. */
export async function countLikeSwipe(userId: string): Promise<number> {
  const next = Math.min(LIKE_SWIPE_TOUR_SWIPES, (await getLikeSwipeCount(userId)) + 1);
  try {
    await SecureStore.setItemAsync(key(userId), String(next));
  } catch {
    // Not critical: the tour plays once more on the next visit
  }
  return next;
}

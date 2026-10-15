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

/** Subscribe; the returned function unsubscribes. */
export function onProfileLiked(handler: (userId: string) => void): () => void {
  const subscription = DeviceEventEmitter.addListener(PROFILE_LIKED, (event: { userId?: string }) => {
    if (event?.userId) handler(event.userId);
  });
  return () => subscription.remove();
}

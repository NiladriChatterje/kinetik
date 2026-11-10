import * as SecureStore from 'expo-secure-store';

/**
 * How this player last left a chat's game, kept on this phone only (the
 * server never sees it): Dots and Boxes folded or unfolded, Reversi and
 * Chinese Checkers full screen or down to their bar. Coming back to the chat
 * shows the game the same way. One value per account and chat, tied to the
 * game's id, so a new game in that chat starts from the usual default.
 */

export type GameView = 'open' | 'folded';

export interface SavedGameView {
  gameId: string;
  view: GameView;
}

const key = (userId: string, matchId: string) => `chat_game_view_${userId}_${matchId}`;

export async function getChatGameView(userId: string, matchId: string): Promise<SavedGameView | null> {
  try {
    const raw = await SecureStore.getItemAsync(key(userId, matchId));
    if (!raw) return null;
    const sep = raw.lastIndexOf(':');
    const gameId = raw.slice(0, sep);
    const view = raw.slice(sep + 1);
    if (sep <= 0 || (view !== 'open' && view !== 'folded')) return null;
    return { gameId, view };
  } catch {
    // Unknown: the game shows the usual way
    return null;
  }
}

export async function setChatGameView(userId: string, matchId: string, saved: SavedGameView): Promise<void> {
  try {
    await SecureStore.setItemAsync(key(userId, matchId), `${saved.gameId}:${saved.view}`);
  } catch {
    // Not critical: the game shows the usual way next time
  }
}

/** The chat is over (unmatch or block): forget its game view. */
export async function clearChatGameView(userId: string, matchId: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key(userId, matchId));
  } catch {
    // Harmless leftover
  }
}

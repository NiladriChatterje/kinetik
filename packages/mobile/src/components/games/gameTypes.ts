/**
 * A game played inside a chat, as the server sends it (api-core
 * routes/matchGames.ts). The server owns the rules; the app draws the state
 * and sends the line that was tapped.
 */

export type EdgeKind = 'h' | 'v';

export interface DotsEdge {
  kind: EdgeKind;
  r: number;
  c: number;
}

/**
 * Dots and Boxes board, `rows` x `cols` boxes.
 *   h[r * cols + c]        line from dot (r, c) to (r, c + 1)
 *   v[r * (cols + 1) + c]  line from dot (r, c) to (r + 1, c)
 *   boxes[r * cols + c]    0 or 1 (index into players) once taken
 */
export interface DotsState {
  rows: number;
  cols: number;
  h: number[];
  v: number[];
  boxes: (0 | 1 | null)[];
  players: [string, string];
  turn: 0 | 1;
  scores: [number, number];
  last: DotsEdge | null;
  moves: number;
}

/**
 * Reversi board, size x size (8). board[r * size + c] is 0 or 1 (index into
 * players) or null. Player 0 started, plays black and moves first. `legal`
 * holds the squares the player to move may take (empty once it is over);
 * `passed` means the other player had no move, so the mover goes again.
 */
export interface ReversiState {
  size: number;
  board: (0 | 1 | null)[];
  players: [string, string];
  turn: 0 | 1;
  scores: [number, number];
  last: ReversiCell | null;
  flipped: number[];
  legal: number[];
  passed: boolean;
  moves: number;
}

export interface ReversiCell {
  r: number;
  c: number;
}

interface ChatGameBase {
  id: string;
  matchId: string;
  status: 'active' | 'finished' | 'ended';
  startedBy: string;
  endedBy: string | null;
  winnerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DotsGame extends ChatGameBase {
  type: 'dots_boxes';
  state: DotsState;
}

export interface ReversiGame extends ChatGameBase {
  type: 'reversi';
  state: ReversiState;
}

export type ChatGame = DotsGame | ReversiGame;

/**
 * Whether this app can draw the game. A newer app may start a game an older
 * one does not know; the older one then shows nothing rather than a broken
 * board.
 */
export function isKnownGame(game: { type?: unknown } | null | undefined): game is ChatGame {
  return !!game && (game.type === 'dots_boxes' || game.type === 'reversi');
}

/**
 * Dots and Boxes boards offered when starting, in boxes: columns and rows
 * each from 6 to 8, not necessarily square. 8 is the most that still leaves
 * lines easy to tap on a 360-wide phone with the board above the chat (the
 * server accepts 2 to 8).
 */
export const DOTS_MIN_SIDE = 6;
export const DOTS_MAX_SIDE = 8;
export const DOTS_SIDES: number[] = Array.from(
  { length: DOTS_MAX_SIDE - DOTS_MIN_SIDE + 1 },
  (_, i) => DOTS_MIN_SIDE + i,
);

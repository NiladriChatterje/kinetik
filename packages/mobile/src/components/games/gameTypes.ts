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

export interface ChatGame {
  id: string;
  matchId: string;
  type: 'dots_boxes';
  status: 'active' | 'finished' | 'ended';
  startedBy: string;
  endedBy: string | null;
  winnerId: string | null;
  state: DotsState;
  createdAt: string;
  updatedAt: string;
}

/** Board sizes offered when starting, in boxes per side */
export const DOTS_SIZES: Array<{ size: number; label: string }> = [
  { size: 3, label: 'Quick' },
  { size: 4, label: 'Classic' },
  { size: 5, label: 'Longer' },
  { size: 6, label: 'Long' },
];

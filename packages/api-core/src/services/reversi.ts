/**
 * Reversi (8 x 8), played inside a chat (routes/matchGames.ts). Also known
 * by a trademarked name, which the app does not use.
 *
 * Players place a disc so that it closes a straight line (across, down or
 * diagonal) of the other player's discs between it and one of their own;
 * every disc so closed in is flipped. A move must flip at least one disc.
 * A player with no such move passes; when neither player can move (or the
 * board is full) the game is over and the most discs wins.
 *
 * The server owns the rules: the app draws the state and sends the square
 * that was tapped. The state also carries the squares the player to move
 * may take (`legal`), so the app can mark them without a copy of the rules.
 *
 * board[r * 8 + c] is 0 or 1 (index into players) or null. Player 0 is the
 * one who started; they play black and move first.
 */

export const REVERSI_SIZE = 8;

export interface ReversiCell {
  r: number;
  c: number;
}

export interface ReversiState {
  size: number;
  board: (0 | 1 | null)[];
  players: [string, string];
  /** Index into players of whose move it is */
  turn: 0 | 1;
  /** Discs on the board, per player */
  scores: [number, number];
  /** The square played last, and the discs it flipped (board indices) */
  last: ReversiCell | null;
  flipped: number[];
  /** Board indices the player to move may take; empty once the game is over */
  legal: number[];
  /** The other player had no move, so the player who just moved goes again */
  passed: boolean;
  moves: number;
}

export type ReversiMoveError = 'not_a_player' | 'not_your_turn' | 'bad_square' | 'square_taken' | 'flips_nothing';

export type ReversiMoveResult =
  | { ok: true; state: ReversiState; finished: boolean }
  | { ok: false; error: ReversiMoveError };

const DIRECTIONS: ReadonlyArray<[number, number]> = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

/** The discs a disc of `player` at (r, c) would flip; empty when the move is not allowed */
function flipsFor(board: ReversiState['board'], size: number, player: 0 | 1, r: number, c: number): number[] {
  if (board[r * size + c] !== null) return [];
  const other = player === 0 ? 1 : 0;
  const out: number[] = [];
  for (const [dr, dc] of DIRECTIONS) {
    const run: number[] = [];
    let rr = r + dr;
    let cc = c + dc;
    while (rr >= 0 && rr < size && cc >= 0 && cc < size && board[rr * size + cc] === other) {
      run.push(rr * size + cc);
      rr += dr;
      cc += dc;
    }
    // A run counts only when one of the player's own discs closes it
    if (run.length > 0 && rr >= 0 && rr < size && cc >= 0 && cc < size && board[rr * size + cc] === player) {
      out.push(...run);
    }
  }
  return out;
}

export function reversiLegalMoves(board: ReversiState['board'], size: number, player: 0 | 1): number[] {
  const out: number[] = [];
  for (let i = 0; i < size * size; i++) {
    if (board[i] === null && flipsFor(board, size, player, Math.floor(i / size), i % size).length > 0) out.push(i);
  }
  return out;
}

function count(board: ReversiState['board']): [number, number] {
  let a = 0;
  let b = 0;
  for (const cell of board) {
    if (cell === 0) a++;
    else if (cell === 1) b++;
  }
  return [a, b];
}

export function newReversiGame(starterId: string, otherId: string): ReversiState {
  const size = REVERSI_SIZE;
  const board: ReversiState['board'] = new Array(size * size).fill(null);
  // The usual opening square in the middle: each colour on one diagonal
  const mid = size / 2;
  board[(mid - 1) * size + (mid - 1)] = 1;
  board[(mid - 1) * size + mid] = 0;
  board[mid * size + (mid - 1)] = 0;
  board[mid * size + mid] = 1;
  return {
    size,
    board,
    players: [starterId, otherId],
    turn: 0,
    scores: count(board),
    last: null,
    flipped: [],
    legal: reversiLegalMoves(board, size, 0),
    passed: false,
    moves: 0,
  };
}

/** The square in a move request, or null when it is not a well-formed one */
export function parseReversiCell(body: unknown): ReversiCell | null {
  if (!body || typeof body !== 'object') return null;
  const { r, c } = body as Record<string, unknown>;
  if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
  return { r: r as number, c: c as number };
}

/** Over when the player to move has nothing left to play (passes are already settled) */
export function isReversiFinished(state: ReversiState): boolean {
  return state.legal.length === 0;
}

/** The winner's id once the game is over; null for a draw or a game still on */
export function reversiWinner(state: ReversiState): string | null {
  if (!isReversiFinished(state)) return null;
  const [a, b] = state.scores;
  if (a === b) return null;
  return a > b ? state.players[0] : state.players[1];
}

export function applyReversiMove(state: ReversiState, playerId: string, cell: ReversiCell): ReversiMoveResult {
  const me = state.players.indexOf(playerId);
  if (me === -1) return { ok: false, error: 'not_a_player' };
  if (isReversiFinished(state) || me !== state.turn) return { ok: false, error: 'not_your_turn' };

  const { size } = state;
  const { r, c } = cell;
  if (r < 0 || r >= size || c < 0 || c >= size) return { ok: false, error: 'bad_square' };
  const index = r * size + c;
  if (state.board[index] !== null) return { ok: false, error: 'square_taken' };

  const player = me as 0 | 1;
  const flipped = flipsFor(state.board, size, player, r, c);
  if (flipped.length === 0) return { ok: false, error: 'flips_nothing' };

  const board = [...state.board];
  board[index] = player;
  for (const i of flipped) board[i] = player;

  // The other player moves next if they can; if not, this player goes
  // again; if neither can, the game is over (legal stays empty)
  const other = (1 - player) as 0 | 1;
  const otherMoves = reversiLegalMoves(board, size, other);
  let turn: 0 | 1 = other;
  let legal = otherMoves;
  let passed = false;
  if (otherMoves.length === 0) {
    const againMoves = reversiLegalMoves(board, size, player);
    turn = player;
    legal = againMoves;
    passed = againMoves.length > 0;
  }

  const next: ReversiState = {
    ...state,
    board,
    turn,
    scores: count(board),
    last: { r, c },
    flipped,
    legal,
    passed,
    moves: state.moves + 1,
  };
  return { ok: true, state: next, finished: isReversiFinished(next) };
}

/**
 * Dots and Boxes, played inside a chat (routes/matchGames.ts).
 *
 * The board is `rows` x `cols` boxes, so (rows + 1) x (cols + 1) dots. A
 * move draws one line between two neighbouring dots. A player who closes a
 * box (or two at once) takes it and moves again; otherwise the turn passes.
 * When every box is taken the game is over and the most boxes wins.
 *
 * The server owns the rules: the app only draws the state and sends the
 * line that was tapped, so a move is checked here once, for both players.
 *
 * Lines are kept as flat 0/1 arrays:
 *   h[r * cols + c]        the horizontal line from dot (r, c) to (r, c + 1),
 *                          r in 0..rows, c in 0..cols-1
 *   v[r * (cols + 1) + c]  the vertical line from dot (r, c) to (r + 1, c),
 *                          r in 0..rows-1, c in 0..cols
 * boxes[r * cols + c] is the index (0 or 1) of the player who took the box,
 * or null.
 */

/** Smallest and largest board, in boxes per side */
export const DOTS_MIN_SIZE = 2;
export const DOTS_MAX_SIZE = 8;

export type EdgeKind = 'h' | 'v';

export interface DotsEdge {
  kind: EdgeKind;
  r: number;
  c: number;
}

export interface DotsState {
  rows: number;
  cols: number;
  h: number[];
  v: number[];
  boxes: (0 | 1 | null)[];
  /** [the player who started, the other]; the starter moves first */
  players: [string, string];
  /** Index into players of whose move it is */
  turn: 0 | 1;
  scores: [number, number];
  /** The line drawn last, so both boards can mark it */
  last: DotsEdge | null;
  moves: number;
}

export type DotsMoveError = 'not_a_player' | 'not_your_turn' | 'bad_line' | 'line_taken';

export type DotsMoveResult =
  | { ok: true; state: DotsState; boxesTaken: number; finished: boolean }
  | { ok: false; error: DotsMoveError };

export function isValidDotsSize(rows: unknown, cols: unknown): rows is number {
  return (
    Number.isInteger(rows) && Number.isInteger(cols) &&
    (rows as number) >= DOTS_MIN_SIZE && (rows as number) <= DOTS_MAX_SIZE &&
    (cols as number) >= DOTS_MIN_SIZE && (cols as number) <= DOTS_MAX_SIZE
  );
}

export function newDotsGame(rows: number, cols: number, starterId: string, otherId: string): DotsState {
  return {
    rows,
    cols,
    h: new Array((rows + 1) * cols).fill(0),
    v: new Array(rows * (cols + 1)).fill(0),
    boxes: new Array(rows * cols).fill(null),
    players: [starterId, otherId],
    turn: 0,
    scores: [0, 0],
    last: null,
    moves: 0,
  };
}

/** The line in a move request, or null when it is not a well-formed one */
export function parseDotsEdge(body: unknown): DotsEdge | null {
  if (!body || typeof body !== 'object') return null;
  const { kind, r, c } = body as Record<string, unknown>;
  if (kind !== 'h' && kind !== 'v') return null;
  if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
  return { kind, r: r as number, c: c as number };
}

function edgeIndex(state: DotsState, edge: DotsEdge): number | null {
  const { rows, cols } = state;
  const { kind, r, c } = edge;
  if (kind === 'h') {
    if (r < 0 || r > rows || c < 0 || c >= cols) return null;
    return r * cols + c;
  }
  if (r < 0 || r >= rows || c < 0 || c > cols) return null;
  return r * (cols + 1) + c;
}

function boxClosed(h: number[], v: number[], cols: number, r: number, c: number): boolean {
  return (
    h[r * cols + c] === 1 &&
    h[(r + 1) * cols + c] === 1 &&
    v[r * (cols + 1) + c] === 1 &&
    v[r * (cols + 1) + c + 1] === 1
  );
}

/** The boxes on either side of a line that exist on the board */
function boxesBeside(state: DotsState, edge: DotsEdge): Array<[number, number]> {
  const { rows, cols } = state;
  const { kind, r, c } = edge;
  const out: Array<[number, number]> = [];
  if (kind === 'h') {
    if (r - 1 >= 0) out.push([r - 1, c]);
    if (r < rows) out.push([r, c]);
  } else {
    if (c - 1 >= 0) out.push([r, c - 1]);
    if (c < cols) out.push([r, c]);
  }
  return out;
}

export function isDotsFinished(state: DotsState): boolean {
  return state.boxes.every((b) => b !== null);
}

/** The winner's id once the game is over; null for a draw or a game still on */
export function dotsWinner(state: DotsState): string | null {
  if (!isDotsFinished(state)) return null;
  const [a, b] = state.scores;
  if (a === b) return null;
  return a > b ? state.players[0] : state.players[1];
}

export function applyDotsMove(state: DotsState, playerId: string, edge: DotsEdge): DotsMoveResult {
  const me = state.players.indexOf(playerId);
  if (me === -1) return { ok: false, error: 'not_a_player' };
  if (me !== state.turn) return { ok: false, error: 'not_your_turn' };

  const index = edgeIndex(state, edge);
  if (index === null) return { ok: false, error: 'bad_line' };
  const lines = edge.kind === 'h' ? state.h : state.v;
  if (lines[index] === 1) return { ok: false, error: 'line_taken' };

  const h = [...state.h];
  const v = [...state.v];
  (edge.kind === 'h' ? h : v)[index] = 1;

  const boxes = [...state.boxes];
  const scores: [number, number] = [...state.scores];
  let boxesTaken = 0;
  for (const [br, bc] of boxesBeside(state, edge)) {
    const bi = br * state.cols + bc;
    if (boxes[bi] === null && boxClosed(h, v, state.cols, br, bc)) {
      boxes[bi] = me as 0 | 1;
      scores[me]++;
      boxesTaken++;
    }
  }

  const next: DotsState = {
    ...state,
    h,
    v,
    boxes,
    scores,
    // Closing a box earns another move
    turn: boxesTaken > 0 ? state.turn : ((1 - state.turn) as 0 | 1),
    last: { kind: edge.kind, r: edge.r, c: edge.c },
    moves: state.moves + 1,
  };
  return { ok: true, state: next, boxesTaken, finished: isDotsFinished(next) };
}

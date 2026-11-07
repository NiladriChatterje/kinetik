/**
 * Chinese Checkers for two, played inside a chat (routes/matchGames.ts).
 *
 * The board is the six-pointed star of 121 holes. Each player starts with
 * 10 pegs filling one point of the star and races them into the point
 * opposite. A move takes one peg either one step into an empty hole next to
 * it, or through one or more jumps: over a single next-door peg (anyone's)
 * into the empty hole straight beyond, as many jumps in a row as the board
 * allows. A step and jumps never mix in one move. Pegs may stop anywhere on
 * the board, the four side points included.
 *
 * A player wins when the point they are heading for is full and at least
 * one of its pegs is theirs. So a peg left at home to block the other
 * player does not stop them: once every other hole there is filled, they
 * win. A player with no move passes; when neither can move it is a draw.
 *
 * The server owns the rules: the app draws the state and sends the peg and
 * the hole it should go to. The state also carries, for the player to move,
 * every peg that can move and the holes it can reach (`legal`), so the app
 * can mark them without a copy of the rules, and the route the last move
 * took (`last`), so both boards can show it.
 *
 * Holes are numbered row by row from the top point (row 0) to the bottom
 * one (row 16), left to right. Within a row, a hole's `x` is its position
 * in half-hole steps from the centre line, so neighbours across are 2
 * apart and neighbours on the rows above and below are 1 across. Turning
 * the board half a turn maps hole i to hole 120 - i.
 *
 * Player 0 (who started) begins in the bottom point and heads for the top;
 * player 1 the other way.
 */

export const CHECKERS_ROWS = 17;
export const CHECKERS_HOLES = 121;
export const CHECKERS_PEGS = 10;

export interface CheckersHole {
  r: number;
  x: number;
}

export interface CheckersOption {
  from: number;
  to: number[];
}

export interface CheckersMove {
  from: number;
  to: number;
}

export interface CheckersState {
  /** board[i] is 0 or 1 (index into players) or null, for hole i */
  board: (0 | 1 | null)[];
  players: [string, string];
  /** Index into players of whose move it is */
  turn: 0 | 1;
  /** Pegs each player has in the point they are heading for */
  scores: [number, number];
  /** The holes the last move went through, from where the peg was to where it stopped */
  last: number[] | null;
  /** For the player to move: each peg that can move and the holes it can reach; empty once it is over */
  legal: CheckersOption[];
  /** The other player had no move, so the player who just moved goes again */
  passed: boolean;
  moves: number;
}

export type CheckersMoveError = 'not_a_player' | 'not_your_turn' | 'bad_hole' | 'not_your_peg' | 'cannot_reach';

export type CheckersMoveResult =
  | { ok: true; state: CheckersState; finished: boolean; winner: 0 | 1 | null }
  | { ok: false; error: CheckersMoveError };

// ─── The board ──────────────────────────────────────────────

/** Every hole, in number order */
export const CHECKERS_BOARD: readonly CheckersHole[] = (() => {
  const holes: CheckersHole[] = [];
  for (let r = 0; r < CHECKERS_ROWS; r++) {
    // The star is two big triangles: one with its point at the top (rows 0
    // to 12), one with its point at the bottom (rows 4 to 16)
    const halfWidth = Math.max(r <= 12 ? r : -1, r >= 4 ? 16 - r : -1);
    for (let x = 0 - halfWidth; x <= halfWidth; x += 2) holes.push({ r, x });
  }
  return holes;
})();

const INDEX = new Map<string, number>(CHECKERS_BOARD.map((h, i) => [`${h.r},${h.x}`, i]));

function holeAt(r: number, x: number): number | undefined {
  return INDEX.get(`${r},${x}`);
}

/** The six directions, in (row, x) steps */
const DIRECTIONS: ReadonlyArray<[number, number]> = [
  [0, -2], [0, 2], [-1, -1], [-1, 1], [1, -1], [1, 1],
];

/** For each hole and direction: the hole next door, and the one beyond it */
const NEXT: ReadonlyArray<ReadonlyArray<[number | undefined, number | undefined]>> = CHECKERS_BOARD.map(({ r, x }) =>
  DIRECTIONS.map(([dr, dx]) => [holeAt(r + dr, x + dx), holeAt(r + 2 * dr, x + 2 * dx)] as [number | undefined, number | undefined]),
);

/** The top point (rows 0 to 3) and the bottom one (rows 13 to 16) */
const TOP = CHECKERS_BOARD.map((h, i) => (h.r <= 3 ? i : -1)).filter((i) => i >= 0);
const BOTTOM = CHECKERS_BOARD.map((h, i) => (h.r >= 13 ? i : -1)).filter((i) => i >= 0);

/** Where each player starts */
export const CHECKERS_HOME: readonly [readonly number[], readonly number[]] = [BOTTOM, TOP];
/** Where each player is heading */
export const CHECKERS_TARGET: readonly [readonly number[], readonly number[]] = [TOP, BOTTOM];

// ─── Moves ──────────────────────────────────────────────────

/**
 * Every hole the peg at `from` can reach, with the hole it came from on the
 * way (for the route). A step reaches the holes next door; jumps can go on
 * and on. The peg's own hole counts as empty once it sets off.
 */
function reachFrom(board: CheckersState['board'], from: number): Map<number, number> {
  const cameFrom = new Map<number, number>();
  for (const [next] of NEXT[from]) {
    if (next !== undefined && board[next] === null) cameFrom.set(next, from);
  }
  // Jumps, breadth first, so each route found is a shortest one
  const seen = new Set<number>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const at = queue.shift()!;
    for (const [over, beyond] of NEXT[at]) {
      if (over === undefined || beyond === undefined) continue;
      if (over === from || board[over] === null) continue; // nothing to jump over
      if (beyond !== from && board[beyond] !== null) continue; // nowhere to land
      if (seen.has(beyond)) continue;
      seen.add(beyond);
      queue.push(beyond);
      // A hole next door is reached by a step already; keep that route
      if (!cameFrom.has(beyond)) cameFrom.set(beyond, at);
    }
  }
  return cameFrom;
}

/** The holes a move goes through, start to end */
function routeTo(cameFrom: Map<number, number>, from: number, to: number): number[] {
  const route = [to];
  let at = to;
  while (at !== from) {
    at = cameFrom.get(at)!;
    route.unshift(at);
  }
  return route;
}

export function checkersLegalMoves(board: CheckersState['board'], player: 0 | 1): CheckersOption[] {
  const out: CheckersOption[] = [];
  for (let i = 0; i < CHECKERS_HOLES; i++) {
    if (board[i] !== player) continue;
    const to = [...reachFrom(board, i).keys()].sort((a, b) => a - b);
    if (to.length > 0) out.push({ from: i, to });
  }
  return out;
}

function pegsHome(board: CheckersState['board'], player: 0 | 1): number {
  return CHECKERS_TARGET[player].filter((i) => board[i] === player).length;
}

/** Whether `player` has won: the point they head for is full, with at least one of their pegs */
export function hasCheckersWon(board: CheckersState['board'], player: 0 | 1): boolean {
  const target = CHECKERS_TARGET[player];
  return target.every((i) => board[i] !== null) && target.some((i) => board[i] === player);
}

export function newCheckersGame(starterId: string, otherId: string): CheckersState {
  const board: CheckersState['board'] = new Array(CHECKERS_HOLES).fill(null);
  for (const i of CHECKERS_HOME[0]) board[i] = 0;
  for (const i of CHECKERS_HOME[1]) board[i] = 1;
  return {
    board,
    players: [starterId, otherId],
    turn: 0,
    scores: [0, 0],
    last: null,
    legal: checkersLegalMoves(board, 0),
    passed: false,
    moves: 0,
  };
}

/** The peg and hole in a move request, or null when it is not a well-formed one */
export function parseCheckersMove(body: unknown): CheckersMove | null {
  if (!body || typeof body !== 'object') return null;
  const { from, to } = body as Record<string, unknown>;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
  return { from: from as number, to: to as number };
}

/** Over when the player to move has nothing left to play (passes are already settled) */
export function isCheckersFinished(state: CheckersState): boolean {
  return state.legal.length === 0;
}

export function applyCheckersMove(state: CheckersState, playerId: string, move: CheckersMove): CheckersMoveResult {
  const me = state.players.indexOf(playerId);
  if (me === -1) return { ok: false, error: 'not_a_player' };
  if (isCheckersFinished(state) || me !== state.turn) return { ok: false, error: 'not_your_turn' };

  const { from, to } = move;
  const onBoard = (i: number) => i >= 0 && i < CHECKERS_HOLES;
  if (!onBoard(from) || !onBoard(to)) return { ok: false, error: 'bad_hole' };
  const player = me as 0 | 1;
  if (state.board[from] !== player) return { ok: false, error: 'not_your_peg' };

  const cameFrom = reachFrom(state.board, from);
  if (!cameFrom.has(to)) return { ok: false, error: 'cannot_reach' };

  const board = [...state.board];
  board[from] = null;
  board[to] = player;
  const scores: [number, number] = [pegsHome(board, 0), pegsHome(board, 1)];

  // A win ends it at once. A peg moving back into its own point can fill
  // the other player's target, so both are checked, the mover first.
  const other = (1 - player) as 0 | 1;
  const winner: 0 | 1 | null = hasCheckersWon(board, player) ? player : hasCheckersWon(board, other) ? other : null;

  // Otherwise the other player moves next if they can; if not, this player
  // goes again; if neither can, it is a draw (legal stays empty)
  let turn: 0 | 1 = other;
  let legal: CheckersOption[] = [];
  let passed = false;
  if (winner === null) {
    legal = checkersLegalMoves(board, other);
    if (legal.length === 0) {
      turn = player;
      legal = checkersLegalMoves(board, player);
      passed = legal.length > 0;
    }
  }

  const next: CheckersState = {
    ...state,
    board,
    turn,
    scores,
    last: routeTo(cameFrom, from, to),
    legal,
    passed,
    moves: state.moves + 1,
  };
  return { ok: true, state: next, finished: winner !== null || legal.length === 0, winner };
}

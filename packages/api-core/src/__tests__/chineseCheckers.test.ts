import { describe, it, expect } from 'vitest';
import {
  applyCheckersMove, checkersLegalMoves, hasCheckersWon, newCheckersGame, parseCheckersMove,
  CHECKERS_BOARD, CHECKERS_HOLES, CHECKERS_HOME, CHECKERS_TARGET, CheckersState,
} from '../services/chineseCheckers';

const A = 'player-a'; // started: bottom point, heading up, index 0
const B = 'player-b';

/** The number of the hole at row r, half-step x */
function h(r: number, x: number): number {
  const i = CHECKERS_BOARD.findIndex((hole) => hole.r === r && hole.x === x);
  if (i === -1) throw new Error(`no hole at ${r},${x}`);
  return i;
}

/** A position: the listed holes hold player 0 or 1, the rest are empty */
function position(pegs0: number[], pegs1: number[], turn: 0 | 1 = 0): CheckersState {
  const board: CheckersState['board'] = new Array(CHECKERS_HOLES).fill(null);
  for (const i of pegs0) board[i] = 0;
  for (const i of pegs1) board[i] = 1;
  return { ...newCheckersGame(A, B), board, turn, legal: checkersLegalMoves(board, turn) };
}

const reach = (state: CheckersState, from: number) => state.legal.find((o) => o.from === from)?.to ?? [];

describe('the board', () => {
  it('is the 121-hole star, row by row', () => {
    expect(CHECKERS_BOARD).toHaveLength(121);
    const perRow = Array.from({ length: 17 }, (_, r) => CHECKERS_BOARD.filter((hole) => hole.r === r).length);
    expect(perRow).toEqual([1, 2, 3, 4, 13, 12, 11, 10, 9, 10, 11, 12, 13, 4, 3, 2, 1]);
  });

  it('turned half a turn, hole i is hole 120 - i', () => {
    CHECKERS_BOARD.forEach((hole, i) => {
      expect(CHECKERS_BOARD[120 - i]).toEqual({ r: 16 - hole.r, x: hole.x === 0 ? 0 : -hole.x });
    });
  });

  it('each player starts in one point and heads for the other', () => {
    expect(CHECKERS_HOME[0]).toEqual(CHECKERS_TARGET[1]);
    expect(CHECKERS_HOME[1]).toEqual(CHECKERS_TARGET[0]);
    expect(CHECKERS_HOME[0].every((i) => CHECKERS_BOARD[i].r >= 13)).toBe(true);
    expect(CHECKERS_HOME[1].every((i) => CHECKERS_BOARD[i].r <= 3)).toBe(true);
  });
});

describe('a new game', () => {
  it('ten pegs each, the starter to move, with the pegs that can move and where to', () => {
    const s = newCheckersGame(A, B);
    expect(s.board.filter((x) => x === 0)).toHaveLength(10);
    expect(s.board.filter((x) => x === 1)).toHaveLength(10);
    expect(s.players).toEqual([A, B]);
    expect(s.turn).toBe(0);
    expect(s.scores).toEqual([0, 0]);
    expect(s.last).toBeNull();
    // The front row (4) steps out; the row behind it (3) jumps over it
    expect(s.legal.map((o) => CHECKERS_BOARD[o.from].r).sort()).toEqual([13, 13, 13, 13, 14, 14, 14]);
    expect(reach(s, h(13, -3))).toEqual([h(12, -4), h(12, -2)]);
    expect(reach(s, h(14, -2))).toEqual([h(12, -4), h(12, 0)]);
  });
});

describe('moves', () => {
  it('a step goes to an empty hole next door, and the turn passes', () => {
    const s = newCheckersGame(A, B);
    const r = applyCheckersMove(s, A, { from: h(13, -3), to: h(12, -2) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.board[h(13, -3)]).toBeNull();
    expect(r.state.board[h(12, -2)]).toBe(0);
    expect(r.state.last).toEqual([h(13, -3), h(12, -2)]);
    expect(r.state.turn).toBe(1);
    expect(r.state.moves).toBe(1);
    expect(r.finished).toBe(false);
    // Player 1's options, from their own point
    expect(r.state.legal.every((o) => r.state.board[o.from] === 1)).toBe(true);
  });

  it('jumps chain over any peg into the hole beyond, and the route is kept', () => {
    // 0 at (10,0) jumps over 1 at (9,1) to (8,2), then over 0 at (7,3) to (6,4)
    const s = position([h(10, 0), h(7, 3)], [h(9, 1)]);
    const r = applyCheckersMove(s, A, { from: h(10, 0), to: h(6, 4) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.last).toEqual([h(10, 0), h(8, 2), h(6, 4)]);
    expect(r.state.board[h(9, 1)]).toBe(1); // jumped pegs stay
  });

  it('a step and a jump never mix, and only single pegs are jumped', () => {
    // From (10,0): a step to (9,1) could be followed by a jump over (8,2), but not in one move
    const s = position([h(10, 0)], [h(8, 2), h(9, -1), h(8, -2)]);
    const to = reach(s, h(10, 0));
    expect(to).toContain(h(9, 1));
    expect(to).not.toContain(h(7, 3));
    // Two pegs in a line cannot be jumped
    expect(to).not.toContain(h(7, -3));
    expect(to).not.toContain(h(8, -2));
  });

  it('refuses moves that break the rules', () => {
    const s = newCheckersGame(A, B);
    const err = (playerId: string, from: number, to: number) => {
      const r = applyCheckersMove(s, playerId, { from, to });
      return r.ok ? null : r.error;
    };
    expect(err('stranger', h(13, -3), h(12, -2))).toBe('not_a_player');
    expect(err(B, h(3, -3), h(4, -4))).toBe('not_your_turn');
    expect(err(A, -1, h(12, -2))).toBe('bad_hole');
    expect(err(A, h(13, -3), 121)).toBe('bad_hole');
    expect(err(A, h(3, -3), h(4, -4))).toBe('not_your_peg');
    expect(err(A, h(12, 0), h(11, 1))).toBe('not_your_peg'); // an empty hole
    expect(err(A, h(13, -3), h(10, 0))).toBe('cannot_reach');
    expect(err(A, h(13, -3), h(13, -1))).toBe('cannot_reach'); // taken
  });

  it('reads a move request', () => {
    expect(parseCheckersMove({ from: 3, to: 9 })).toEqual({ from: 3, to: 9 });
    expect(parseCheckersMove({ from: '3', to: 9 })).toBeNull();
    expect(parseCheckersMove({ r: 1, c: 2 })).toBeNull();
    expect(parseCheckersMove(null)).toBeNull();
  });
});

describe('winning', () => {
  const top = [...CHECKERS_TARGET[0]];
  const bottom = [...CHECKERS_TARGET[1]];

  it('filling the far point wins at once', () => {
    // Nine pegs home, the tenth one step away
    const last = top.find((i) => CHECKERS_BOARD[i].r === 3 && CHECKERS_BOARD[i].x === -3)!;
    const s = position([...top.filter((i) => i !== last), h(4, -4)], [h(8, 0), h(8, 2)]);
    const r = applyCheckersMove(s, A, { from: h(4, -4), to: last });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.winner).toBe(0);
    expect(r.finished).toBe(true);
    expect(r.state.scores[0]).toBe(10);
    expect(r.state.legal).toEqual([]);
  });

  it('a peg left at home to block does not stop the other player', () => {
    // Player 1 keeps one peg on the top point; player 0 fills the other nine
    const blocker = h(0, 0);
    const open = h(3, -3);
    const mine = top.filter((i) => i !== blocker && i !== open);
    const s = position([...mine, h(4, -4)], [blocker, ...bottom.slice(0, 9)]);
    expect(hasCheckersWon(s.board, 0)).toBe(false);
    const r = applyCheckersMove(s, A, { from: h(4, -4), to: open });
    expect(r.ok && r.winner).toBe(0);
  });

  it('a player with no move passes, and the other goes again', () => {
    // Player 1's only peg sits on the top point, boxed in: both holes next
    // to it are taken, and so are the holes beyond them
    const s = position([h(1, -1), h(1, 1), h(2, -2), h(2, 2), h(10, 0)], [h(0, 0)]);
    const r = applyCheckersMove(s, A, { from: h(10, 0), to: h(9, 1) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.passed).toBe(true);
    expect(r.state.turn).toBe(0);
    expect(r.finished).toBe(false);
  });
});

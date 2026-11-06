import { describe, it, expect } from 'vitest';
import {
  applyDotsMove, dotsWinner, isDotsFinished, isValidDotsSize, newDotsGame, parseDotsEdge, DotsEdge, DotsState,
} from '../services/dotsAndBoxes';

const A = 'player-a';
const B = 'player-b';

/** Plays a list of moves, failing the test on any refused one */
function play(state: DotsState, moves: Array<[string, DotsEdge]>): DotsState {
  let s = state;
  for (const [player, edge] of moves) {
    const r = applyDotsMove(s, player, edge);
    if (!r.ok) throw new Error(`${player} ${edge.kind}${edge.r},${edge.c}: ${r.error}`);
    s = r.state;
  }
  return s;
}

const h = (r: number, c: number): DotsEdge => ({ kind: 'h', r, c });
const v = (r: number, c: number): DotsEdge => ({ kind: 'v', r, c });

describe('a new board', () => {
  it('has every line undrawn, no box taken, and the starter to move', () => {
    const s = newDotsGame(3, 4, A, B);
    expect(s.h).toHaveLength(4 * 4); // (rows + 1) x cols
    expect(s.v).toHaveLength(3 * 5); // rows x (cols + 1)
    expect(s.boxes).toHaveLength(12);
    expect(s.h.every((x) => x === 0) && s.v.every((x) => x === 0)).toBe(true);
    expect(s.boxes.every((b) => b === null)).toBe(true);
    expect(s.players).toEqual([A, B]);
    expect(s.turn).toBe(0);
    expect(s.scores).toEqual([0, 0]);
  });

  it('accepts boards from 2 x 2 to 8 x 8 boxes only', () => {
    expect(isValidDotsSize(2, 2)).toBe(true);
    expect(isValidDotsSize(5, 5)).toBe(true);
    expect(isValidDotsSize(8, 8)).toBe(true);
    expect(isValidDotsSize(1, 3)).toBe(false);
    expect(isValidDotsSize(9, 3)).toBe(false);
    expect(isValidDotsSize(3.5, 3)).toBe(false);
    expect(isValidDotsSize('4', 4)).toBe(false);
    expect(isValidDotsSize(undefined, 4)).toBe(false);
  });
});

describe('moves', () => {
  it('a line that closes nothing passes the turn', () => {
    const r = applyDotsMove(newDotsGame(3, 3, A, B), A, h(0, 0));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.turn).toBe(1);
    expect(r.boxesTaken).toBe(0);
    expect(r.state.last).toEqual(h(0, 0));
    expect(r.state.moves).toBe(1);
  });

  it('closing a box takes it and earns another move', () => {
    // Box (0,0): top h(0,0), bottom h(1,0), left v(0,0), right v(0,1)
    let s = play(newDotsGame(3, 3, A, B), [[A, h(0, 0)], [B, h(1, 0)], [A, v(0, 0)]]);
    expect(s.turn).toBe(1);
    const r = applyDotsMove(s, B, v(0, 1));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(r.boxesTaken).toBe(1);
    expect(s.boxes[0]).toBe(1);
    expect(s.scores).toEqual([0, 1]);
    expect(s.turn).toBe(1); // B again
  });

  it('one line can close two boxes at once', () => {
    // Boxes (0,0) and (0,1) share v(0,1); draw everything else around both
    const s = play(newDotsGame(2, 2, A, B), [
      [A, h(0, 0)], [B, h(0, 1)], [A, h(1, 0)], [B, h(1, 1)], [A, v(0, 0)], [B, v(0, 2)],
    ]);
    expect(s.turn).toBe(0);
    const r = applyDotsMove(s, A, v(0, 1));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.boxesTaken).toBe(2);
    expect(r.state.scores).toEqual([2, 0]);
    expect(r.state.turn).toBe(0);
  });

  it('refuses a move out of turn, by an outsider, off the board, or on a drawn line', () => {
    const s = newDotsGame(3, 3, A, B);
    expect(applyDotsMove(s, B, h(0, 0))).toEqual({ ok: false, error: 'not_your_turn' });
    expect(applyDotsMove(s, 'someone-else', h(0, 0))).toEqual({ ok: false, error: 'not_a_player' });
    expect(applyDotsMove(s, A, h(4, 0))).toEqual({ ok: false, error: 'bad_line' }); // rows + 1 = 4 rows of h
    expect(applyDotsMove(s, A, h(0, 3))).toEqual({ ok: false, error: 'bad_line' });
    expect(applyDotsMove(s, A, v(3, 0))).toEqual({ ok: false, error: 'bad_line' });
    expect(applyDotsMove(s, A, v(0, 4))).toEqual({ ok: false, error: 'bad_line' });
    expect(applyDotsMove(s, A, h(-1, 0))).toEqual({ ok: false, error: 'bad_line' });
    const after = play(s, [[A, h(0, 0)]]);
    expect(applyDotsMove(after, B, h(0, 0))).toEqual({ ok: false, error: 'line_taken' });
  });

  it('never changes the state it was given', () => {
    const s = newDotsGame(2, 2, A, B);
    const before = JSON.stringify(s);
    applyDotsMove(s, A, h(0, 0));
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('the end of a game', () => {
  it('is over once every box is taken; the most boxes wins', () => {
    // 2 x 2 has 12 lines. The first nine close nothing; then B closes one
    // box, then one more, then the last two with the middle-bottom line.
    const s = play(newDotsGame(2, 2, A, B), [
      [A, h(0, 0)], [B, h(0, 1)], [A, h(2, 0)], [B, h(2, 1)],
      [A, v(0, 0)], [B, v(1, 0)], [A, v(0, 2)], [B, v(1, 2)],
      [A, h(1, 0)],
      [B, v(0, 1)], // closes (0,0); B moves again
      [B, h(1, 1)], // closes (0,1); B moves again
      [B, v(1, 1)], // closes (1,0) and (1,1)
    ]);
    expect(isDotsFinished(s)).toBe(true);
    expect(s.scores).toEqual([0, 4]);
    expect(s.moves).toBe(12);
    expect(dotsWinner(s)).toBe(B);
  });

  it('a 2 x 2 board split two-two is a draw', () => {
    const s0 = newDotsGame(2, 2, A, B);
    const s: DotsState = { ...s0, boxes: [0, 0, 1, 1], scores: [2, 2] };
    expect(isDotsFinished(s)).toBe(true);
    expect(dotsWinner(s)).toBeNull();
  });

  it('a game still going has no winner', () => {
    expect(dotsWinner(newDotsGame(3, 3, A, B))).toBeNull();
  });
});

describe('parseDotsEdge', () => {
  it('reads a well-formed line and nothing else', () => {
    expect(parseDotsEdge({ kind: 'h', r: 1, c: 2 })).toEqual(h(1, 2));
    expect(parseDotsEdge({ kind: 'v', r: 0, c: 0, extra: true })).toEqual(v(0, 0));
    expect(parseDotsEdge({ kind: 'd', r: 1, c: 2 })).toBeNull();
    expect(parseDotsEdge({ kind: 'h', r: '1', c: 2 })).toBeNull();
    expect(parseDotsEdge({ kind: 'h', r: 1.5, c: 2 })).toBeNull();
    expect(parseDotsEdge(null)).toBeNull();
    expect(parseDotsEdge('h,1,2')).toBeNull();
  });
});

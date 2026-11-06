import { describe, it, expect } from 'vitest';
import {
  applyReversiMove, isReversiFinished, newReversiGame, parseReversiCell, reversiLegalMoves, reversiWinner,
  ReversiState,
} from '../services/reversi';

const A = 'player-a'; // starts: black, index 0
const B = 'player-b';
const at = (r: number, c: number) => r * 8 + c;

/** A board from 8 strings: 'x' = player 0, 'o' = player 1, '.' = empty */
function board(rows: string[]): ReversiState['board'] {
  return rows.join('').split('').map((ch) => (ch === 'x' ? 0 : ch === 'o' ? 1 : null));
}

function stateWith(rows: string[], turn: 0 | 1): ReversiState {
  const b = board(rows);
  const s = newReversiGame(A, B);
  const scores: [number, number] = [b.filter((x) => x === 0).length, b.filter((x) => x === 1).length];
  return { ...s, board: b, turn, scores, legal: reversiLegalMoves(b, 8, turn) };
}

describe('a new game', () => {
  it('opens with two discs each across the middle, starter to move with four choices', () => {
    const s = newReversiGame(A, B);
    expect(s.size).toBe(8);
    expect(s.board.filter((x) => x !== null)).toHaveLength(4);
    expect(s.board[at(3, 3)]).toBe(1);
    expect(s.board[at(3, 4)]).toBe(0);
    expect(s.board[at(4, 3)]).toBe(0);
    expect(s.board[at(4, 4)]).toBe(1);
    expect(s.players).toEqual([A, B]);
    expect(s.turn).toBe(0);
    expect(s.scores).toEqual([2, 2]);
    expect([...s.legal].sort((a, b) => a - b)).toEqual([at(2, 3), at(3, 2), at(4, 5), at(5, 4)]);
    expect(s.passed).toBe(false);
    expect(isReversiFinished(s)).toBe(false);
  });
});

describe('moves', () => {
  it('a move flips the discs it closes in and passes the turn', () => {
    const r = applyReversiMove(newReversiGame(A, B), A, { r: 2, c: 3 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.board[at(2, 3)]).toBe(0);
    expect(r.state.board[at(3, 3)]).toBe(0); // flipped
    expect(r.state.flipped).toEqual([at(3, 3)]);
    expect(r.state.scores).toEqual([4, 1]);
    expect(r.state.turn).toBe(1);
    expect(r.state.last).toEqual({ r: 2, c: 3 });
    expect(r.state.moves).toBe(1);
    expect(r.state.legal.length).toBeGreaterThan(0);
    expect(r.finished).toBe(false);
  });

  it('flips in every direction the move closes at once', () => {
    // x at the corners of a ring of o around the empty centre (3,3)
    const s = stateWith([
      '........',
      '.x.x.x..',
      '..ooo...',
      '.xo.ox..',
      '..ooo...',
      '.x.x.x..',
      '........',
      '........',
    ], 0);
    const r = applyReversiMove(s, A, { r: 3, c: 3 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.flipped).toHaveLength(8);
    expect(r.state.board.filter((x) => x === 1)).toHaveLength(0);
  });

  it('does not flip a run that no disc of the mover closes', () => {
    const s = stateWith([
      'oo......',
      '........',
      '........',
      '...ox...',
      '...xo...',
      '........',
      '........',
      '........',
    ], 0);
    // (0,2): the run to the left (0,1),(0,0) reaches the edge, not an x
    expect(applyReversiMove(s, A, { r: 0, c: 2 })).toEqual({ ok: false, error: 'flips_nothing' });
  });

  it('refuses a move out of turn, by an outsider, off the board, on a disc, or flipping nothing', () => {
    const s = newReversiGame(A, B);
    expect(applyReversiMove(s, B, { r: 2, c: 4 })).toEqual({ ok: false, error: 'not_your_turn' });
    expect(applyReversiMove(s, 'someone-else', { r: 2, c: 3 })).toEqual({ ok: false, error: 'not_a_player' });
    expect(applyReversiMove(s, A, { r: 8, c: 0 })).toEqual({ ok: false, error: 'bad_square' });
    expect(applyReversiMove(s, A, { r: 0, c: -1 })).toEqual({ ok: false, error: 'bad_square' });
    expect(applyReversiMove(s, A, { r: 3, c: 3 })).toEqual({ ok: false, error: 'square_taken' });
    expect(applyReversiMove(s, A, { r: 0, c: 0 })).toEqual({ ok: false, error: 'flips_nothing' });
  });

  it('never changes the state it was given', () => {
    const s = newReversiGame(A, B);
    const before = JSON.stringify(s);
    applyReversiMove(s, A, { r: 2, c: 3 });
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('passing and the end', () => {
  it('when the other player has no move, the mover goes again', () => {
    // x takes (2,2), flipping (2,1). Then o's two discs on the top row have
    // no x between them and any empty square, so o cannot move, while x can
    // still close the top row from (0,3).
    const s = stateWith([
      'xoo.....',
      '........',
      'xo......',
      '........',
      '........',
      '........',
      '........',
      '........',
    ], 0);
    const r = applyReversiMove(s, A, { r: 2, c: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.flipped).toEqual([at(2, 1)]);
    expect(reversiLegalMoves(r.state.board, 8, 1)).toEqual([]);
    expect(r.state.turn).toBe(0);
    expect(r.state.passed).toBe(true);
    expect(r.state.legal).toContain(at(0, 3));
    expect(r.finished).toBe(false);
  });

  it('is over when neither player can move; the most discs wins', () => {
    // x takes the last o: the board has no o left, so nobody can move
    const s = stateWith([
      'xo......',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
    ], 0);
    const r = applyReversiMove(s, A, { r: 0, c: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.finished).toBe(true);
    expect(r.state.legal).toEqual([]);
    expect(r.state.scores).toEqual([3, 0]);
    expect(reversiWinner(r.state)).toBe(A);
    // Nothing more can be played
    expect(applyReversiMove(r.state, A, { r: 5, c: 5 })).toEqual({ ok: false, error: 'not_your_turn' });
  });

  it('a level count at the end is a draw; a game still going has no winner', () => {
    const over: ReversiState = { ...newReversiGame(A, B), legal: [], scores: [32, 32] };
    expect(reversiWinner(over)).toBeNull();
    expect(reversiWinner(newReversiGame(A, B))).toBeNull();
  });

  it('200 random games always follow the rules to the end', () => {
    // A small seeded random source, so a failure can be replayed
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let g = 0; g < 200; g++) {
      let s = newReversiGame(A, B);
      let guard = 0;
      while (!isReversiFinished(s)) {
        expect(guard++).toBeLessThan(61); // 60 empty squares at the start
        expect([...s.legal].sort()).toEqual([...reversiLegalMoves(s.board, 8, s.turn)].sort());
        const pick = s.legal[Math.floor(rand() * s.legal.length)];
        const mover = s.players[s.turn];
        const r = applyReversiMove(s, mover, { r: Math.floor(pick / 8), c: pick % 8 });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const discs = r.state.board.filter((x) => x !== null).length;
        expect(discs).toBe(s.board.filter((x) => x !== null).length + 1);
        expect(r.state.scores[0] + r.state.scores[1]).toBe(discs);
        expect(r.state.flipped.length).toBeGreaterThan(0);
        // A pass only when the other player really had nothing
        if (r.state.passed) expect(reversiLegalMoves(r.state.board, 8, (1 - r.state.turn) as 0 | 1)).toEqual([]);
        s = r.state;
      }
      expect(reversiLegalMoves(s.board, 8, 0)).toEqual([]);
      expect(reversiLegalMoves(s.board, 8, 1)).toEqual([]);
      const w = reversiWinner(s);
      if (s.scores[0] === s.scores[1]) expect(w).toBeNull();
      else expect(w).toBe(s.scores[0] > s.scores[1] ? A : B);
    }
  });
});

describe('parseReversiCell', () => {
  it('reads a square and nothing else', () => {
    expect(parseReversiCell({ r: 2, c: 3 })).toEqual({ r: 2, c: 3 });
    expect(parseReversiCell({ r: '2', c: 3 })).toBeNull();
    expect(parseReversiCell({ r: 2.5, c: 3 })).toBeNull();
    expect(parseReversiCell({ r: 2 })).toBeNull();
    expect(parseReversiCell(null)).toBeNull();
  });
});

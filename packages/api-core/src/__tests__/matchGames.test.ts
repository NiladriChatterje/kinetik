import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';

// ─── Dots and Boxes inside a chat: the routes ─────────────────────
// Against an in-memory stand-in for matches and match_games. Covers login,
// the chat lock, who may start and play, one active game per chat, turns,
// a finished board, ending early, and closing a game that is over.

const ME = '11111111-1111-4111-8111-111111111111';
const HER = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';
const MATCH = '44444444-4444-4444-8444-444444444444';
const OTHER_MATCH = '55555555-5555-4555-8555-555555555555';

interface Row {
  id: string; match_id: string; game_type: string; state: any; status: string;
  started_by: string; ended_by: string | null; winner_id: string | null; hidden_for: string[];
  created_at: string; updated_at: string;
}

let matches: Array<{ id: string; user_a_id: string; user_b_id: string; is_active: boolean }>;
let games: Row[];
let seq = 0;
let lockedFor: Set<string>;

const out = (rows: any[]) => ({ rows, rowCount: rows.length });

function runQuery(text: string, params: any[] = []) {
  const sql = text.replace(/\s+/g, ' ');
  if (sql.startsWith('SELECT user_a_id, user_b_id FROM matches')) {
    const [id, uid] = params;
    return out(matches.filter((m) => m.id === id && m.is_active && (m.user_a_id === uid || m.user_b_id === uid)));
  }
  if (sql.startsWith('SELECT * FROM match_games WHERE match_id = $1 ORDER BY')) {
    const rows = games.filter((g) => g.match_id === params[0]).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return out(rows.slice(0, 1).map((r) => ({ ...r, state: JSON.parse(JSON.stringify(r.state)) })));
  }
  if (sql.startsWith('INSERT INTO match_games')) {
    const [matchId, type, state, startedBy] = params;
    if (games.some((g) => g.match_id === matchId && g.status === 'active')) {
      throw Object.assign(new Error('duplicate key'), { code: '23505' });
    }
    seq++;
    const row: Row = {
      id: `66666666-6666-4666-8666-${String(seq).padStart(12, '0')}`,
      match_id: matchId, game_type: type, state: JSON.parse(state), status: 'active',
      started_by: startedBy, ended_by: null, winner_id: null, hidden_for: [],
      created_at: new Date(Date.UTC(2026, 10, 6, 10, 0, seq)).toISOString(),
      updated_at: new Date().toISOString(),
    };
    games.push(row);
    return out([row]);
  }
  if (sql.startsWith('SELECT * FROM match_games WHERE id = $1 AND match_id = $2 FOR UPDATE')) {
    return out(games.filter((g) => g.id === params[0] && g.match_id === params[1])
      .map((r) => ({ ...r, state: JSON.parse(JSON.stringify(r.state)) })));
  }
  if (sql.startsWith('UPDATE match_games SET state = $2')) {
    const g = games.find((x) => x.id === params[0])!;
    Object.assign(g, { state: JSON.parse(params[1]), status: params[2], winner_id: params[3] });
    return out([g]);
  }
  if (sql.startsWith("UPDATE match_games SET status = 'ended'")) {
    const g = games.find((x) => x.id === params[0] && x.match_id === params[1] && x.status === 'active');
    if (!g) return out([]);
    Object.assign(g, { status: 'ended', ended_by: params[2] });
    return out([g]);
  }
  if (sql.startsWith('UPDATE match_games SET hidden_for = array_append')) {
    const g = games.find((x) => x.id === params[0] && x.match_id === params[1] && x.status !== 'active');
    if (g && !g.hidden_for.includes(params[2])) g.hidden_for.push(params[2]);
    return out(g ? [g] : []);
  }
  throw new Error(`Unexpected query: ${sql}`);
}

const mockQuery = vi.fn(async (text: string, params?: any[]) => runQuery(text, params));
const mockPublish = vi.fn();

vi.mock('@kinetik/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kinetik/shared')>();
  return { ...actual, transaction: async (cb: any) => cb(mockQuery) };
});

vi.mock('../services/database', () => ({
  query: mockQuery,
  TABLES: { MATCHES: 'matches', MATCH_GAMES: 'match_games' },
}));

vi.mock('../services/premiumAccess', () => ({
  CHAT_LOCKED: 'CHAT_LOCKED',
  isChatLocked: vi.fn(async (userId: string) => lockedFor.has(userId)),
}));

vi.mock('../services/redis', () => ({ publishChatMessage: mockPublish }));

let app: FastifyInstance;

beforeAll(async () => {
  const { matchGameRoutes } = await import('../routes/matchGames');
  app = Fastify();
  await app.register(jwt, { secret: 'test-secret' });
  await app.register(matchGameRoutes, { prefix: '/api/v1/matches' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  matches = [
    { id: MATCH, user_a_id: ME, user_b_id: HER, is_active: true },
    { id: OTHER_MATCH, user_a_id: HER, user_b_id: STRANGER, is_active: true },
  ];
  games = [];
  lockedFor = new Set();
});

const auth = (userId: string) => ({ authorization: `Bearer ${app.jwt.sign({ sub: userId })}` });
const post = (url: string, payload: unknown, userId = ME) =>
  app.inject({ method: 'POST', url: `/api/v1/matches/${url}`, payload: payload as any, headers: auth(userId) });
const get = (url: string, userId = ME) =>
  app.inject({ method: 'GET', url: `/api/v1/matches/${url}`, headers: auth(userId) });

const start = (rows = 2, cols = 2, userId = ME) => post(`${MATCH}/game`, { type: 'dots_boxes', rows, cols }, userId);
const move = (gameId: string, kind: 'h' | 'v', r: number, c: number, userId: string) =>
  post(`${MATCH}/game/${gameId}/move`, { kind, r, c }, userId);

describe('access', () => {
  it('needs a login', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/matches/${MATCH}/game` });
    expect(res.statusCode).toBe(401);
  });

  it('a locked chat locks its game', async () => {
    lockedFor.add(ME);
    expect((await get(`${MATCH}/game`)).statusCode).toBe(402);
    expect((await start()).statusCode).toBe(402);
    expect(games).toHaveLength(0);
  });

  it('only the two people in the chat can see or start its game', async () => {
    expect((await get(`${MATCH}/game`, STRANGER)).statusCode).toBe(404);
    expect((await start(3, 3, STRANGER)).statusCode).toBe(404);
    expect((await get('not-a-uuid/game')).statusCode).toBe(404);
  });
});

describe('starting a game', () => {
  it('the starter picks the size and moves first; both chats hear of it', async () => {
    const res = await start(4, 4);
    expect(res.statusCode).toBe(201);
    const { game } = res.json().data;
    expect(game).toMatchObject({ matchId: MATCH, type: 'dots_boxes', status: 'active', startedBy: ME });
    expect(game.state.rows).toBe(4);
    expect(game.state.cols).toBe(4);
    expect(game.state.players).toEqual([ME, HER]);
    expect(game.state.turn).toBe(0);
    expect(mockPublish).toHaveBeenCalledWith(expect.any(String), { type: 'game:update', matchId: MATCH, game });

    const seen = (await get(`${MATCH}/game`, HER)).json().data.game;
    expect(seen.id).toBe(game.id);
  });

  it('refuses an unknown game or a board outside 2 to 8 boxes', async () => {
    expect((await post(`${MATCH}/game`, { type: 'chess', rows: 4, cols: 4 })).statusCode).toBe(400);
    expect((await start(1, 4)).statusCode).toBe(400);
    expect((await start(9, 9)).statusCode).toBe(400);
    expect((await post(`${MATCH}/game`, { type: 'dots_boxes', rows: '4', cols: 4 })).statusCode).toBe(400);
    expect(games).toHaveLength(0);
  });

  it('one game at a time per chat', async () => {
    expect((await start()).statusCode).toBe(201);
    const second = await start(3, 3, HER);
    expect(second.statusCode).toBe(409);
    expect(games).toHaveLength(1);
  });
});

describe('playing', () => {
  it('moves alternate, are checked by the server, and reach both chats', async () => {
    const id = (await start(3, 3)).json().data.game.id;

    const outOfTurn = await move(id, 'h', 0, 0, HER);
    expect(outOfTurn.statusCode).toBe(409);
    expect(outOfTurn.json().error.message).toMatch(/not your turn/);

    const first = await move(id, 'h', 0, 0, ME);
    expect(first.statusCode).toBe(200);
    expect(first.json().data.game.state.turn).toBe(1);
    expect(mockPublish).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ type: 'game:update' }));

    expect((await move(id, 'h', 0, 0, HER)).json().error.message).toMatch(/already drawn/);
    expect((await move(id, 'h', 9, 0, HER)).json().error.message).toMatch(/not on the board/);
    expect((await post(`${MATCH}/game/${id}/move`, { kind: 'x', r: 0, c: 0 }, HER)).statusCode).toBe(400);
    expect((await move(id, 'v', 0, 0, STRANGER)).statusCode).toBe(404);
  });

  it('a full board finishes the game with a winner, and no move is taken after', async () => {
    const id = (await start(2, 2)).json().data.game.id;
    const seq: Array<['h' | 'v', number, number, string]> = [
      ['h', 0, 0, ME], ['h', 0, 1, HER], ['h', 2, 0, ME], ['h', 2, 1, HER],
      ['v', 0, 0, ME], ['v', 1, 0, HER], ['v', 0, 2, ME], ['v', 1, 2, HER],
      ['h', 1, 0, ME], ['v', 0, 1, HER], ['h', 1, 1, HER], ['v', 1, 1, HER],
    ];
    let last: any;
    for (const [kind, r, c, who] of seq) {
      last = await move(id, kind, r, c, who);
      expect(last.statusCode).toBe(200);
    }
    const game = last.json().data.game;
    expect(game.status).toBe('finished');
    expect(game.winnerId).toBe(HER);
    expect(game.state.scores).toEqual([0, 4]);

    const after = await move(id, 'h', 0, 0, ME);
    expect(after.statusCode).toBe(409);
    expect(after.json().error.message).toMatch(/over/);

    // A new game can start once the last is over
    expect((await start(3, 3, HER)).statusCode).toBe(201);
  });
});

describe('ending and closing', () => {
  it('either player can end the game, for both', async () => {
    const id = (await start()).json().data.game.id;
    const res = await post(`${MATCH}/game/${id}/end`, {}, HER);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.game).toMatchObject({ status: 'ended', endedBy: HER });
    expect(mockPublish).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ type: 'game:update' }));
    expect((await post(`${MATCH}/game/${id}/end`, {}, ME)).statusCode).toBe(404);
    expect((await move(id, 'h', 0, 0, ME)).statusCode).toBe(409);
  });

  it('closing a game that is over hides it for that player only', async () => {
    const id = (await start()).json().data.game.id;
    await post(`${MATCH}/game/${id}/end`, {}, ME);

    expect((await post(`${MATCH}/game/${id}/hide`, {}, ME)).statusCode).toBe(200);
    expect((await get(`${MATCH}/game`, ME)).json().data.game).toBeNull();
    expect((await get(`${MATCH}/game`, HER)).json().data.game.id).toBe(id);
    expect(mockPublish).toHaveBeenCalledTimes(2); // start and end; closing is private
  });

  it('a game still going cannot be closed away', async () => {
    const id = (await start()).json().data.game.id;
    await post(`${MATCH}/game/${id}/hide`, {}, ME);
    expect((await get(`${MATCH}/game`, ME)).json().data.game.id).toBe(id);
  });
});

describe('Reversi', () => {
  const startReversi = (userId = ME) => post(`${MATCH}/game`, { type: 'reversi' }, userId);
  const place = (gameId: string, r: number, c: number, userId: string) =>
    post(`${MATCH}/game/${gameId}/move`, { r, c }, userId);

  it('starts on the usual 8 x 8 opening, starter first, with the squares they may take', async () => {
    const res = await startReversi();
    expect(res.statusCode).toBe(201);
    const { game } = res.json().data;
    expect(game).toMatchObject({ type: 'reversi', status: 'active', startedBy: ME });
    expect(game.state.size).toBe(8);
    expect(game.state.players).toEqual([ME, HER]);
    expect(game.state.scores).toEqual([2, 2]);
    expect(game.state.legal).toHaveLength(4);
    expect(mockPublish).toHaveBeenCalledWith(expect.any(String), { type: 'game:update', matchId: MATCH, game });
  });

  it('one game at a time, whatever the game', async () => {
    expect((await start(3, 3)).statusCode).toBe(201);
    expect((await startReversi(HER)).statusCode).toBe(409);
  });

  it('plays squares in turn, flipping discs, and refuses moves that break the rules', async () => {
    const id = (await startReversi()).json().data.game.id;
    expect((await place(id, 2, 3, HER)).json().error.message).toMatch(/not your turn/);
    expect((await place(id, 0, 0, ME)).json().error.message).toMatch(/does not flip/);
    expect((await place(id, 3, 3, ME)).json().error.message).toMatch(/already taken/);
    expect((await place(id, 8, 8, ME)).json().error.message).toMatch(/not on the board/);

    const moved = await place(id, 2, 3, ME);
    expect(moved.statusCode).toBe(200);
    const g = moved.json().data.game;
    expect(g.state.scores).toEqual([4, 1]);
    expect(g.state.turn).toBe(1);
    expect(g.state.last).toEqual({ r: 2, c: 3 });

    // Her reply, from the squares the server says she may take
    const pick = g.state.legal[0];
    const reply = await place(id, Math.floor(pick / 8), pick % 8, HER);
    expect(reply.statusCode).toBe(200);
    expect(reply.json().data.game.state.turn).toBe(0);
  });

  it('a move meant for the other game is refused, both ways', async () => {
    const id = (await startReversi()).json().data.game.id;
    const dotsShaped = await post(`${MATCH}/game/${id}/move`, { kind: 'h', r: 2, c: 3 }, ME);
    expect(dotsShaped.statusCode).toBe(400);
    await post(`${MATCH}/game/${id}/end`, {}, ME);

    const dotsId = (await start(3, 3)).json().data.game.id;
    const square = await post(`${MATCH}/game/${dotsId}/move`, { r: 0, c: 0 }, ME);
    expect(square.statusCode).toBe(400);
    expect(games.find((x) => x.id === dotsId)!.state.moves).toBe(0);
  });

  it('ends and closes like any game', async () => {
    const id = (await startReversi()).json().data.game.id;
    expect((await post(`${MATCH}/game/${id}/end`, {}, HER)).json().data.game).toMatchObject({ status: 'ended', endedBy: HER });
    await post(`${MATCH}/game/${id}/hide`, {}, ME);
    expect((await get(`${MATCH}/game`, ME)).json().data.game).toBeNull();
  });
});

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ERROR_CODES, REDIS_KEYS } from '@kinetik/shared';
import { transaction } from '@kinetik/shared';
import { query, TABLES } from '../services/database';
import { isChatLocked, CHAT_LOCKED } from '../services/premiumAccess';
import { publishChatMessage } from '../services/redis';
import {
  applyDotsMove, dotsWinner, isValidDotsSize, newDotsGame, parseDotsEdge, DotsMoveError, DotsState,
} from '../services/dotsAndBoxes';
import {
  applyReversiMove, newReversiGame, parseReversiCell, reversiWinner, ReversiMoveError, ReversiState,
} from '../services/reversi';

// ─── Games inside a chat ────────────────────────────────────
// Dots and Boxes and Reversi. The player who starts a game moves first
// (and for Dots and Boxes picks the board size). A chat has at most one
// active game; either player can end it. Every change reaches both open
// chats through the chat room as `game:update`. A game is part of the
// conversation, so a locked chat locks it too.
//
//   GET  /:id/game                       the chat's current game, or null
//   POST /:id/game                       start one: { type: 'dots_boxes', rows, cols }
//                                        or { type: 'reversi' }
//   POST /:id/game/:gameId/move          Dots and Boxes: draw a line { kind, r, c }
//                                        Reversi: place a disc { r, c }
//   POST /:id/game/:gameId/end           stop the active game
//   POST /:id/game/:gameId/hide          close a game that is over, for me

export const GAME_TYPES = ['dots_boxes', 'reversi'] as const;
type GameType = (typeof GAME_TYPES)[number];

interface GameRow {
  id: string;
  match_id: string;
  game_type: GameType;
  state: DotsState | ReversiState;
  status: 'active' | 'finished' | 'ended';
  started_by: string;
  ended_by: string | null;
  winner_id: string | null;
  hidden_for: string[];
  created_at: string;
  updated_at: string;
}

export interface GameView {
  id: string;
  matchId: string;
  type: GameType;
  status: GameRow['status'];
  startedBy: string;
  endedBy: string | null;
  winnerId: string | null;
  state: DotsState | ReversiState;
  createdAt: string;
  updatedAt: string;
}

export function toGameView(row: GameRow): GameView {
  return {
    id: row.id,
    matchId: row.match_id,
    type: row.game_type,
    status: row.status,
    startedBy: row.started_by,
    endedBy: row.ended_by,
    winnerId: row.winner_id,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const MOVE_ERRORS: Record<DotsMoveError | ReversiMoveError, string> = {
  not_a_player: 'You are not playing this game.',
  not_your_turn: 'It is not your turn yet.',
  bad_line: 'That line is not on the board.',
  line_taken: 'That line is already drawn.',
  bad_square: 'That square is not on the board.',
  square_taken: 'That square is already taken.',
  flips_nothing: 'That move does not flip any disc.',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sendChatLocked(reply: FastifyReply) {
  return reply.status(402).send({
    success: false,
    error: {
      code: CHAT_LOCKED,
      message: 'Free accounts can chat with one match. Upgrade to Premium to unlock every chat.',
    },
  });
}

function notFound(reply: FastifyReply, message: string) {
  return reply.status(404).send({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message } });
}

function badRequest(reply: FastifyReply, message: string) {
  return reply.status(400).send({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message } });
}

/** The partner's id when the user is in this active match, else null */
async function partnerIn(matchId: string, userId: string): Promise<string | null> {
  if (!UUID_RE.test(matchId)) return null;
  const result = await query<{ user_a_id: string; user_b_id: string }>(
    `SELECT user_a_id, user_b_id FROM ${TABLES.MATCHES}
     WHERE id = $1 AND (user_a_id = $2 OR user_b_id = $2) AND is_active = TRUE`,
    [matchId, userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return row.user_a_id === userId ? row.user_b_id : row.user_a_id;
}

/** Both open chats redraw the game */
function publishGame(game: GameView): void {
  publishChatMessage(REDIS_KEYS.CHAT_MESSAGES_CHANNEL, {
    type: 'game:update',
    matchId: game.matchId,
    game,
  });
}

export async function matchGameRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.status(401).send({
        success: false,
        error: { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' },
      });
    }
  });

  // ─── The chat's current game ──────────────────────────────
  // The latest game, unless it is over and this player closed it
  app.get('/:id/game', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;
    const { id: matchId } = request.params;
    if (await isChatLocked(userId, matchId)) return sendChatLocked(reply);
    if (!(await partnerIn(matchId, userId))) return notFound(reply, 'Match not found or inactive');

    const result = await query<GameRow>(
      `SELECT * FROM ${TABLES.MATCH_GAMES}
       WHERE match_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [matchId],
    );
    const row = result.rows[0];
    const game = row && !(row.status !== 'active' && row.hidden_for.includes(userId)) ? toGameView(row) : null;
    return reply.send({ success: true, data: { game } });
  });

  // ─── Start a game ─────────────────────────────────────────
  app.post('/:id/game', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;
    const { id: matchId } = request.params;
    const { type, rows, cols } = (request.body ?? {}) as { type?: string; rows?: unknown; cols?: unknown };
    if (await isChatLocked(userId, matchId)) return sendChatLocked(reply);

    if (type !== 'dots_boxes' && type !== 'reversi') return badRequest(reply, 'Unknown game.');
    if (type === 'dots_boxes' && !isValidDotsSize(rows, cols)) {
      return badRequest(reply, 'Pick a board between 2 x 2 and 8 x 8 boxes.');
    }

    const partnerId = await partnerIn(matchId, userId);
    if (!partnerId) return notFound(reply, 'Match not found or inactive');

    const state =
      type === 'reversi'
        ? newReversiGame(userId, partnerId)
        : newDotsGame(rows as number, cols as number, userId, partnerId);
    let row: GameRow | undefined;
    try {
      const result = await query<GameRow>(
        `INSERT INTO ${TABLES.MATCH_GAMES} (match_id, game_type, state, started_by)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [matchId, type, JSON.stringify(state), userId],
      );
      row = result.rows[0];
    } catch (error: any) {
      // uniq_match_games_active: the other player started one a moment ago
      if (error?.code === '23505') {
        return reply.status(409).send({
          success: false,
          error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'A game is already going in this chat.' },
        });
      }
      throw error;
    }

    const game = toGameView(row!);
    publishGame(game);
    return reply.status(201).send({ success: true, data: { game } });
  });

  // ─── Draw a line ──────────────────────────────────────────
  app.post(
    '/:id/game/:gameId/move',
    async (request: FastifyRequest<{ Params: { id: string; gameId: string } }>, reply: FastifyReply) => {
      const { sub: userId } = request.user as any;
      const { id: matchId, gameId } = request.params;
      if (await isChatLocked(userId, matchId)) return sendChatLocked(reply);

      // Which shape a move takes depends on the game, known once its row is read
      const edge = parseDotsEdge(request.body);
      const cell = parseReversiCell(request.body);
      if (!edge && !cell) return badRequest(reply, 'A move needs a line (kind, r, c) or a square (r, c).');
      if (!UUID_RE.test(gameId)) return notFound(reply, 'Game not found');
      if (!(await partnerIn(matchId, userId))) return notFound(reply, 'Match not found or inactive');

      // The row is locked for the move, so two quick taps (or both players
      // at once) are applied one after the other, never over each other
      const outcome = await transaction(async (tx) => {
        const current = (await tx<GameRow>(
          `SELECT * FROM ${TABLES.MATCH_GAMES} WHERE id = $1 AND match_id = $2 FOR UPDATE`,
          [gameId, matchId],
        )).rows[0];
        if (!current) return { kind: 'missing' as const };
        if (current.status !== 'active') return { kind: 'over' as const };

        let moved:
          | { ok: true; state: DotsState | ReversiState; finished: boolean; winnerId: string | null }
          | { ok: false; error: DotsMoveError | ReversiMoveError };
        if (current.game_type === 'reversi') {
          // A Dots and Boxes line ({ kind, r, c }) also reads as a square, so
          // the kind field marks a move meant for the other game
          if (!cell || edge) return { kind: 'malformed' as const };
          const r = applyReversiMove(current.state as ReversiState, userId, cell);
          moved = r.ok ? { ...r, winnerId: r.finished ? reversiWinner(r.state) : null } : r;
        } else {
          if (!edge) return { kind: 'malformed' as const };
          const r = applyDotsMove(current.state as DotsState, userId, edge);
          moved = r.ok ? { ok: true, state: r.state, finished: r.finished, winnerId: r.finished ? dotsWinner(r.state) : null } : r;
        }
        if (!moved.ok) return { kind: 'refused' as const, error: moved.error };

        const winnerId = moved.winnerId;
        const updated = (await tx<GameRow>(
          `UPDATE ${TABLES.MATCH_GAMES}
              SET state = $2, status = $3, winner_id = $4, updated_at = NOW()
            WHERE id = $1
            RETURNING *`,
          [gameId, JSON.stringify(moved.state), moved.finished ? 'finished' : 'active', winnerId],
        )).rows[0];
        return { kind: 'moved' as const, row: updated };
      });

      if (outcome.kind === 'missing') return notFound(reply, 'Game not found');
      if (outcome.kind === 'malformed') return badRequest(reply, 'That move does not fit this game.');
      if (outcome.kind === 'over') {
        return reply.status(409).send({
          success: false,
          error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'This game is over.' },
        });
      }
      if (outcome.kind === 'refused') {
        return reply.status(409).send({
          success: false,
          error: { code: ERROR_CODES.VALIDATION_ERROR, message: MOVE_ERRORS[outcome.error] },
        });
      }

      const game = toGameView(outcome.row);
      publishGame(game);
      return reply.send({ success: true, data: { game } });
    },
  );

  // ─── Stop the active game ─────────────────────────────────
  app.post(
    '/:id/game/:gameId/end',
    async (request: FastifyRequest<{ Params: { id: string; gameId: string } }>, reply: FastifyReply) => {
      const { sub: userId } = request.user as any;
      const { id: matchId, gameId } = request.params;
      if (await isChatLocked(userId, matchId)) return sendChatLocked(reply);
      if (!UUID_RE.test(gameId)) return notFound(reply, 'Game not found');
      if (!(await partnerIn(matchId, userId))) return notFound(reply, 'Match not found or inactive');

      const result = await query<GameRow>(
        `UPDATE ${TABLES.MATCH_GAMES}
            SET status = 'ended', ended_by = $3, updated_at = NOW()
          WHERE id = $1 AND match_id = $2 AND status = 'active'
          RETURNING *`,
        [gameId, matchId, userId],
      );
      const row = result.rows[0];
      if (!row) return notFound(reply, 'No game going on');

      const game = toGameView(row);
      publishGame(game);
      return reply.send({ success: true, data: { game } });
    },
  );

  // ─── Close a game that is over (for this player only) ─────
  app.post(
    '/:id/game/:gameId/hide',
    async (request: FastifyRequest<{ Params: { id: string; gameId: string } }>, reply: FastifyReply) => {
      const { sub: userId } = request.user as any;
      const { id: matchId, gameId } = request.params;
      if (await isChatLocked(userId, matchId)) return sendChatLocked(reply);
      if (!UUID_RE.test(gameId)) return notFound(reply, 'Game not found');
      if (!(await partnerIn(matchId, userId))) return notFound(reply, 'Match not found or inactive');

      await query(
        `UPDATE ${TABLES.MATCH_GAMES}
            SET hidden_for = array_append(hidden_for, $3::uuid)
          WHERE id = $1 AND match_id = $2 AND status <> 'active'
            AND NOT ($3::uuid = ANY(hidden_for))`,
        [gameId, matchId, userId],
      );
      return reply.send({ success: true, data: { hidden: true } });
    },
  );
}

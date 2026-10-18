import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ERROR_CODES, REDIS_KEYS, transaction } from '@kinetik/shared';
import { query, TABLES } from '../services/database';
import { publishChatMessage } from '../services/redis';
import { invalidateFreeChatCache } from '../services/premiumAccess';
import { sendSafetyReportEmail } from '../services/email';

// ─── In-app reporting and blocking ─────────────────────────
// Google Play requires apps with user profiles and chat to let members report
// and block each other, and its Child Safety Standards policy requires an
// in-app way to report child sexual abuse. Reports are stored and emailed to
// the support inbox; blocks take effect at once.

/** What a member can report. The app shows a label for each (ReportBlockSheet). */
export const REPORT_REASONS: Record<string, string> = {
  child_safety: 'Child sexual abuse or exploitation',
  underage: 'May be under 18',
  sexual_content: 'Nudity or sexual content',
  harassment: 'Harassment, threats or hate',
  scam: 'Scam, spam or asking for money',
  fake_profile: 'Fake profile or impersonation',
  other: 'Something else',
};

/** Reasons that put a child at risk: emailed as urgent. */
const URGENT_REASONS = new Set(['child_safety', 'underage']);

const MAX_DETAILS_LENGTH = 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badRequest(reply: FastifyReply, message: string) {
  return reply.status(400).send({
    success: false,
    error: { code: ERROR_CODES.VALIDATION_ERROR, message },
  });
}

function notFound(reply: FastifyReply) {
  return reply.status(404).send({
    success: false,
    error: { code: ERROR_CODES.NOT_FOUND, message: 'User not found' },
  });
}

export async function safetyRoutes(app: FastifyInstance) {
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

  // ─── Report a member ────────────────────────────────────
  // Body: { reportedUserId, reason, details?, matchId? }
  // One report per reporter → reported pair: reporting again updates it, and
  // only a new report or a changed reason emails the support inbox again.
  app.post(
    '/report',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sub: userId } = request.user as any;
      const body = (request.body ?? {}) as Record<string, unknown>;

      const reportedUserId = typeof body.reportedUserId === 'string' ? body.reportedUserId : '';
      const reason = typeof body.reason === 'string' ? body.reason : '';
      const details = typeof body.details === 'string' ? body.details.trim().slice(0, MAX_DETAILS_LENGTH) : '';
      const matchId = typeof body.matchId === 'string' && UUID_RE.test(body.matchId) ? body.matchId : null;

      if (!UUID_RE.test(reportedUserId)) return badRequest(reply, 'reportedUserId is required');
      if (!(reason in REPORT_REASONS)) return badRequest(reply, 'Unknown report reason');
      if (reportedUserId === userId) return badRequest(reply, 'You cannot report yourself');

      const target = await query(
        `SELECT id, display_name FROM ${TABLES.USERS} WHERE id = $1`,
        [reportedUserId],
      );
      if (!target.rows[0]) return notFound(reply);

      // Keep the match only when it is one between these two people
      let linkedMatchId: string | null = null;
      if (matchId) {
        const match = await query(
          `SELECT id FROM ${TABLES.MATCHES}
           WHERE id = $1
             AND ((user_a_id = $2 AND user_b_id = $3) OR (user_a_id = $3 AND user_b_id = $2))`,
          [matchId, userId, reportedUserId],
        );
        linkedMatchId = match.rows[0]?.id ?? null;
      }

      // prior: the reason before this call (null for a first report). The CTE
      // reads the table as it was before the upsert.
      const result = await query(
        `WITH prior AS (
           SELECT reason FROM ${TABLES.USER_REPORTS} WHERE reporter_id = $1 AND reported_id = $2
         )
         INSERT INTO ${TABLES.USER_REPORTS} (reporter_id, reported_id, match_id, reason, details)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (reporter_id, reported_id) DO UPDATE SET
           reason = EXCLUDED.reason,
           details = EXCLUDED.details,
           match_id = COALESCE(EXCLUDED.match_id, ${TABLES.USER_REPORTS}.match_id),
           status = 'open',
           resolved_at = NULL,
           updated_at = NOW()
         RETURNING id, (SELECT reason FROM prior) AS prior_reason`,
        [userId, reportedUserId, linkedMatchId, reason, details || null],
      );
      const row = result.rows[0];
      const reportId: string = row.id;

      // Details are user text: never logged, only stored and emailed
      console.log(`[safety] Report ${reportId}: reason=${reason}${row.prior_reason ? ` (was ${row.prior_reason})` : ''}`);

      if (row.prior_reason !== reason) {
        // Not awaited: the reporter should not wait on email delivery, and a
        // failed send leaves the stored report for review (never throws).
        void sendSafetyReportEmail({
          reportId,
          reason,
          reasonLabel: REPORT_REASONS[reason],
          reporterId: userId,
          reportedId: reportedUserId,
          reportedName: target.rows[0].display_name || 'Unknown',
          matchId: linkedMatchId,
          details,
          urgent: URGENT_REASONS.has(reason),
        });
      }

      return reply.status(201).send({ success: true, data: { reportId } });
    },
  );

  // ─── Block a member ─────────────────────────────────────
  // Body: { userId }
  // Hides both people from each other and ends their chat at once. Messages
  // are kept (not deleted, unlike an unmatch) so a report can still be
  // reviewed; neither person can open the chat again.
  app.post(
    '/block',
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sub: userId } = request.user as any;
      const body = (request.body ?? {}) as Record<string, unknown>;
      const blockedUserId = typeof body.userId === 'string' ? body.userId : '';

      if (!UUID_RE.test(blockedUserId)) return badRequest(reply, 'userId is required');
      if (blockedUserId === userId) return badRequest(reply, 'You cannot block yourself');

      const target = await query(`SELECT id FROM ${TABLES.USERS} WHERE id = $1`, [blockedUserId]);
      if (!target.rows[0]) return notFound(reply);

      const endedMatchIds = await transaction(async (q) => {
        await q(
          `INSERT INTO ${TABLES.USER_BLOCKS} (blocker_id, blocked_id) VALUES ($1, $2)
           ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
          [userId, blockedUserId],
        );
        // End their chat. Every chat route and the realtime room join require
        // an active match, so this closes it for both people at once.
        const ended = await q<{ id: string }>(
          `UPDATE ${TABLES.MATCHES} SET is_active = FALSE
           WHERE is_active = TRUE
             AND ((user_a_id = $1 AND user_b_id = $2) OR (user_a_id = $2 AND user_b_id = $1))
           RETURNING id`,
          [userId, blockedUserId],
        );
        // Close pending likes either way, as a rejection does, so neither
        // shows up in the other's Likes list
        await q(
          `UPDATE ${TABLES.USER_INTERACTIONS} SET responded_at = NOW()
           WHERE ((actor_id = $1 AND target_id = $2) OR (actor_id = $2 AND target_id = $1))
             AND is_mutual = FALSE AND responded_at IS NULL`,
          [userId, blockedUserId],
        );
        const ids = ended.rows.map((r) => r.id);
        if (ids.length > 0) {
          // Same bookkeeping as an unmatch (routes/matches.ts)
          await q(
            `UPDATE ${TABLES.USERS} SET free_chat_spent = TRUE
             WHERE id IN ($1, $2) AND free_chat_match_id = ANY($3::uuid[])`,
            [userId, blockedUserId, ids],
          );
        }
        return ids;
      });

      if (endedMatchIds.length > 0) {
        await Promise.all([invalidateFreeChatCache(userId), invalidateFreeChatCache(blockedUserId)]);
        // The same event an unmatch sends: both apps drop the conversation and
        // close the chat if it is open. The other person is not told why.
        // Not awaited, as in the unmatch route: it retries briefly on a Redis
        // blip and never throws.
        for (const matchId of endedMatchIds) {
          void publishChatMessage(REDIS_KEYS.CHAT_MESSAGES_CHANNEL, {
            type: 'match:unmatched',
            matchId,
            unmatchedByUserId: userId,
          });
        }
      }

      console.log(`[safety] Block recorded (${endedMatchIds.length} chat(s) ended)`);
      return reply.send({ success: true, data: { blocked: true } });
    },
  );
}

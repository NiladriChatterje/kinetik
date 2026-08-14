import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AccessToken } from 'livekit-server-sdk';
import { ERROR_CODES } from '@kinetik/shared';
import { query, TABLES } from '../services/database';

// ─── LiveKit Configuration ──────────────────────────────────
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'kinetik_livekit_key';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'kinetik_livekit_secret_2024_dev_xyz';
// Client-facing URL — LiveKit exposes the WebSocket/WebRTC endpoints here.
// In docker, the internal host is `livekit:7880`; clients reach it via the
// machine's LAN IP on port 7880. Override with LIVEKIT_PUBLIC_URL.
const LIVEKIT_PUBLIC_URL = process.env.LIVEKIT_PUBLIC_URL;

// LiveKit's WebSocket port as exposed by docker-compose (host side).
const LIVEKIT_PUBLIC_PORT = process.env.LIVEKIT_PUBLIC_PORT || '7880';

export async function callRoutes(app: FastifyInstance) {
  // All call routes require authentication
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

  // ─── Get LiveKit Token for a 1:1 Match Call ───────────────
  // Issues a room-scoped token so ONLY the two matched users can join the
  // private call. The room name is derived from the match id, and we verify
  // the requester is one of the two participants of an active match.
  app.post(
    '/:matchId/call/token',
    async (
      request: FastifyRequest<{ Params: { matchId: string } }>,
      reply: FastifyReply,
    ) => {
      const { matchId } = request.params;
      const { sub: userId } = request.user as any;

      if (!matchId) {
        return reply.status(400).send({
          success: false,
          error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'matchId is required' },
        });
      }

      // Verify the match exists, is active, and the user is one of the two participants
      const matchResult = await query(
        `SELECT id, user_a_id, user_b_id, is_active FROM ${TABLES.MATCHES}
         WHERE id = $1 AND is_active = TRUE`,
        [matchId],
      );
      const match = matchResult.rows[0];

      if (!match) {
        return reply.status(404).send({
          success: false,
          error: { code: ERROR_CODES.NOT_FOUND, message: 'Match not found or inactive' },
        });
      }

      if (match.user_a_id !== userId && match.user_b_id !== userId) {
        return reply.status(403).send({
          success: false,
          error: { code: ERROR_CODES.FORBIDDEN, message: 'You are not a participant of this match' },
        });
      }

      // Room is namespaced by match id — only the two participants ever get a token for it
      const room = `match:${matchId}`;

      const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity: userId,
        // 4h TTL is plenty for a date call; tokens are short-lived by design
        ttl: '4h',
      });

      at.addGrant({
        roomJoin: true,
        room,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });

      const token = at.toJwt();

      // Clients can't reach `localhost` on a physical device/emulator — derive
      // the public URL from the request host (the same LAN IP the API is on),
      // swapping the API port for the LiveKit port. Explicit env var wins
      // (set LIVEKIT_PUBLIC_URL to e.g. `wss://<project>.livekit.cloud`).
      //
      // Scheme mirrors the inbound connection: `wss://` when the API was
      // reached over TLS (LiveKit Cloud / TLS-terminating proxy), `ws://` for
      // plain HTTP (LAN dev). X-Forwarded-Proto is read directly because
      // Fastify's trustProxy is not enabled (this runs behind nginx).
      const reqHost = request.hostname;
      const xfp = request.headers['x-forwarded-proto'];
      const forwardedSecure = typeof xfp === 'string'
        ? xfp.split(',')[0].trim() === 'https'
        : Array.isArray(xfp) && xfp[0] === 'https';
      const scheme = request.protocol === 'https' || forwardedSecure ? 'wss' : 'ws';
      const publicUrl =
        LIVEKIT_PUBLIC_URL ||
        (reqHost
          ? `${scheme}://${reqHost}:${LIVEKIT_PUBLIC_PORT}`
          : `${scheme}://localhost:${LIVEKIT_PUBLIC_PORT}`);

      return reply.send({
        success: true,
        data: {
          url: publicUrl,
          token,
          room,
          expiresIn: 4 * 60 * 60,
        },
      });
    },
  );
}

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ERROR_CODES, PREMIUM_SWIPE_LIMIT_DAILY } from '@kinetik/shared';
import { query, TABLES, getSubscription } from '../services/database';

export async function fanRoutes(app: FastifyInstance) {
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

  // ─── Get Fans (Who Liked You) ────────────────────────
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;

    // Check subscription tier
    const sub = await getSubscription(userId);
    const isPremium = sub?.tier !== 'free';

    // Get users who liked this user
    const result = await query(
      `SELECT ui.created_at as liked_at,
              u.id as user_id,
              u.display_name,
              u.bio,
              u.is_verified,
              pp.url as photo_url,
              pp.thumbnail_url as thumbnail_url
       FROM ${TABLES.USER_INTERACTIONS} ui
       JOIN ${TABLES.USERS} u ON u.id = ui.actor_id
       LEFT JOIN ${TABLES.PROFILE_PHOTOS} pp ON pp.user_id = u.id AND pp.is_primary = TRUE
       WHERE ui.target_id = $1 AND ui.action = 'like'
       ORDER BY ui.created_at DESC
       LIMIT 50`,
      [userId],
    );

    // If free tier, blur the profile data
    if (!isPremium) {
      const blurredFans = result.rows.map((fan: any) => ({
        likedAt: fan.liked_at,
        blurred: true,
        userId: fan.user_id?.slice(0, 8) + '...',
        isVerified: false,
        // Don't reveal name, bio, or photo - just show a blurred placeholder
        paywall: true,
      }));

      return reply.send({
        success: true,
        data: {
          fans: blurredFans,
          totalCount: result.rows.length,
          premiumRequired: true,
        },
      });
    }

    // Premium - return full data
    return reply.send({
      success: true,
      data: {
        fans: result.rows.map((fan: any) => ({
          likedAt: fan.liked_at,
          userId: fan.user_id,
          displayName: fan.display_name,
          bio: fan.bio,
          isVerified: fan.is_verified,
          photoUrl: fan.photo_url,
          thumbnailUrl: fan.thumbnail_url,
          blurred: false,
        })),
        totalCount: result.rows.length,
        premiumRequired: false,
      },
    });
  });

  // ─── Unlock Fans (Premium Purchase) ──────────────────
  app.post('/unlock', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;

    // In production, process payment via Razorpay
    // Update subscription tier
    await query(
      `UPDATE ${TABLES.SUBSCRIPTION_LEDGER} 
       SET tier = 'premium', swipe_allowance = $1, updated_at = NOW()
       WHERE user_id = $2`,
      [PREMIUM_SWIPE_LIMIT_DAILY, userId],
    );

    return reply.send({
      success: true,
      data: { unlocked: true, tier: 'premium' },
    });
  });
}

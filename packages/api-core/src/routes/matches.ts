import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ERROR_CODES, REDIS_KEYS, SUPER_LIKE_LIMIT_DAILY_FREE, SUPER_LIKE_LIMIT_DAILY_PREMIUM, KAFKA_TOPICS } from '@kinetik/shared';
import { query, TABLES } from '../services/database';
import { notificationEvents } from '../services/notificationService';
import { kafkaProducer } from '../services/kafka';
import { getRedis } from '../services/redis';
const redis = getRedis();

export async function matchRoutes(app: FastifyInstance) {
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

  // ─── Get Swipe Profiles ──────────────────────────────
  // Returns profiles the user hasn't interacted with, filtered by preferences.
  app.get('/profiles', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;

    // Get user's preferences for filtering
    const prefsResult = await query(
      `SELECT age_min, age_max, max_distance_km, preferred_genders
       FROM ${TABLES.USER_PREFERENCES} WHERE user_id = $1`,
      [userId],
    );
    const prefs = prefsResult.rows[0] || {};
    const ageMin = prefs.age_min ?? 18;
    const ageMax = prefs.age_max ?? 60;
    const maxDistance = prefs.max_distance_km ?? 50;
    const genders = prefs.preferred_genders ?? [];

    // Get the user's own H3 for distance filtering
    const userResult = await query(
      `SELECT h3_index, date_of_birth FROM ${TABLES.USERS} WHERE id = $1`,
      [userId],
    );
    const userRow = userResult.rows[0];
    if (!userRow) {
      return reply.send({ success: true, data: { profiles: [] } });
    }

    // Calculate min birth date from age
    const now = new Date();
    const minBirthDate = new Date(now.getFullYear() - ageMax, now.getMonth(), now.getDate()).toISOString().split('T')[0];
    const maxBirthDate = new Date(now.getFullYear() - ageMin, now.getMonth(), now.getDate()).toISOString().split('T')[0];

    // Build gender filter
    let genderFilter = '';
    const genderParams: any[] = [userId, minBirthDate, maxBirthDate];
    if (genders.length > 0) {
      genderFilter = `AND u.gender = ANY($${genderParams.length + 1})`;
      genderParams.push(genders);
    }

    // Get profiles excluding already-interacted users and self
    const sql = `
      SELECT
        u.id,
        u.display_name,
        u.date_of_birth,
        u.bio,
        u.occupation,
        u.education,
        u.is_verified,
        u.h3_index,
        u.latitude,
        u.longitude
      FROM ${TABLES.USERS} u
      WHERE u.id != $1
        AND u.is_active = TRUE
        AND u.onboarding_complete = TRUE
        AND u.date_of_birth >= $2
        AND u.date_of_birth <= $3
        ${genderFilter}
        AND u.id NOT IN (
          SELECT target_id FROM ${TABLES.USER_INTERACTIONS} WHERE actor_id = $1
          UNION
          SELECT actor_id FROM ${TABLES.USER_INTERACTIONS} WHERE target_id = $1
        )
      ORDER BY RANDOM()
      LIMIT 20
    `;
    const profilesResult = await query(sql, genderParams);

    // Fetch photos and interests for each profile
    const profiles = await Promise.all(
      profilesResult.rows.map(async (row: any) => {
        const photosResult = await query(
          `SELECT id, url, thumbnail_url, is_primary FROM ${TABLES.PROFILE_PHOTOS}
           WHERE user_id = $1 ORDER BY is_primary DESC, order_index ASC`,
          [row.id],
        );

        const interestsResult = await query(
          `SELECT i.id, i.name, i.emoji, i.category
           FROM ${TABLES.USER_INTERESTS} ui
           JOIN ${TABLES.INTERESTS} i ON i.id = ui.interest_id
           WHERE ui.user_id = $1`,
          [row.id],
        );

        const age = row.date_of_birth
          ? Math.floor((now.getTime() - new Date(row.date_of_birth).getTime()) / 31557600000)
          : 0;

        return {
          userId: row.id,
          displayName: row.display_name,
          age,
          bio: row.bio || '',
          occupation: row.occupation || undefined,
          education: row.education || undefined,
          photos: photosResult.rows.map((p: any) => ({
            id: p.id,
            url: p.url,
            thumbnailUrl: p.thumbnail_url || undefined,
            isPrimary: p.is_primary,
          })),
          interests: interestsResult.rows.map((i: any) => ({
            id: i.id,
            name: i.name,
            emoji: i.emoji,
            category: i.category,
          })),
          isVerified: row.is_verified,
        };
      }),
    );

    return reply.send({ success: true, data: { profiles } });
  });

  // ─── Swipe (Like / Pass / Super Like) ────────────────
  app.post('/swipe', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;
    const { targetUserId, action } = request.body as { targetUserId: string; action: 'like' | 'pass' | 'super_like' };

    if (!targetUserId || !action || !['like', 'pass', 'super_like'].includes(action)) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'targetUserId and action (like|pass|super_like) required' },
      });
    }

    if (targetUserId === userId) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'Cannot interact with yourself' },
      });
    }

    // Check for existing interaction
    const existing = await query(
      `SELECT id, action FROM ${TABLES.USER_INTERACTIONS}
       WHERE actor_id = $1 AND target_id = $2`,
      [userId, targetUserId],
    );
    if (existing.rows.length > 0) {
      return reply.status(409).send({
        success: false,
        error: { code: ERROR_CODES.ALREADY_MATCHED, message: 'Already interacted with this user' },
      });
    }

    // Check daily super like limit
    let superLikeRemaining = 0;
    if (action === 'super_like') {
      const subResult = await query(
        `SELECT tier FROM ${TABLES.SUBSCRIPTION_LEDGER} WHERE user_id = $1`,
        [userId],
      );
      const tier = subResult.rows[0]?.tier || 'free';
      const dailyLimit = tier === 'free' ? SUPER_LIKE_LIMIT_DAILY_FREE : SUPER_LIKE_LIMIT_DAILY_PREMIUM;

      const used = await redis.get(REDIS_KEYS.USER_SUPERLIKE_COUNT(userId));
      const usedCount = used ? parseInt(used, 10) : 0;
      superLikeRemaining = Math.max(0, dailyLimit - usedCount);

      if (usedCount >= dailyLimit) {
        return reply.status(429).send({
          success: false,
          error: { code: ERROR_CODES.SUPER_LIKE_LIMIT_REACHED, message: 'Daily super like limit reached' },
        });
      }

      // Increment daily usage with 24h expiry
      const multi = redis.multi();
      multi.incr(REDIS_KEYS.USER_SUPERLIKE_COUNT(userId));
      multi.expire(REDIS_KEYS.USER_SUPERLIKE_COUNT(userId), 86400);
      await multi.exec();
    }

    // Record interaction
    const interactionResult = await query(
      `INSERT INTO ${TABLES.USER_INTERACTIONS} (actor_id, target_id, action)
       VALUES ($1, $2, $3) RETURNING *`,
      [userId, targetUserId, action],
    );
    const interaction = interactionResult.rows[0];

    // If it's a like or super_like, check for mutual like
    const isSuperLike = action === 'super_like';
    if (action === 'like' || action === 'super_like') {
      // Get swiper's name for notifications
      const swiperNameResult = await query(
        `SELECT display_name FROM ${TABLES.USERS} WHERE id = $1`,
        [userId],
      );
      const swiperName = swiperNameResult.rows[0]?.display_name || 'Someone';

      // Check if the target has also liked this user (regular or super like)
      const mutualCheck = await query(
        `SELECT id, action FROM ${TABLES.USER_INTERACTIONS}
         WHERE actor_id = $1 AND target_id = $2 AND action IN ('like', 'super_like')`,
        [targetUserId, userId],
      );

      if (mutualCheck.rows.length > 0) {
        // Mutual like! Create a match
        const matchResult = await query(
          `INSERT INTO ${TABLES.MATCHES} (user_a_id, user_b_id, is_active, vibe_check_id)
           VALUES ($1, $2, TRUE, NULL) RETURNING *`,
          [userId, targetUserId],
        );
        const match = matchResult.rows[0];

        // Mark both interactions as mutual
        await query(
          `UPDATE ${TABLES.USER_INTERACTIONS} SET is_mutual = TRUE, responded_at = NOW()
           WHERE (actor_id = $1 AND target_id = $2) OR (actor_id = $2 AND target_id = $1)`,
          [userId, targetUserId],
        );

        // Get partner details for notification
        const partnerResult = await query(
          `SELECT u.display_name, pp.url as photo_url
           FROM ${TABLES.USERS} u
           LEFT JOIN ${TABLES.PROFILE_PHOTOS} pp ON pp.user_id = u.id AND pp.is_primary = TRUE
           WHERE u.id = $1`,
          [targetUserId],
        );
        const partnerName = partnerResult.rows[0]?.display_name || 'Someone';
        const partnerPhotoUrl = partnerResult.rows[0]?.photo_url || '';

        // Also get swiper's photo URL for the match event
        const swiperPhotoResult = await query(
          `SELECT pp.url as photo_url
           FROM ${TABLES.PROFILE_PHOTOS} pp
           WHERE pp.user_id = $1 AND pp.is_primary = TRUE`,
          [userId],
        );
        const swiperPhotoUrl = swiperPhotoResult.rows[0]?.photo_url || '';

        // Publish `match.created` event to Kafka for real-time delivery
        await kafkaProducer.sendEvent(KAFKA_TOPICS.MATCH_EVENTS, {
          type: 'match.created',
          payload: {
            userAId: userId,
            userBId: targetUserId,
            matchId: match.id,
            userAName: swiperName,
            userAPhotoUrl: swiperPhotoUrl,
            userBName: partnerName,
            userBPhotoUrl: partnerPhotoUrl,
            timestamp: new Date().toISOString(),
          },
        }).catch((err) => {
          console.error('[Kafka] Failed to publish match.created:', err);
        });

        // Send push notifications to both users with correct names
        await notificationEvents.matchFound(userId, partnerName);
        await notificationEvents.matchFound(targetUserId, swiperName);

        return reply.status(201).send({
          success: true,
          data: {
            matched: true,
            isSuperLike,
            matchId: match.id,
            partnerName,
            partnerId: targetUserId,
          },
        });
      }

      // Publish `like.created` event to Kafka for real-time delivery
      await kafkaProducer.sendEvent(KAFKA_TOPICS.MATCH_EVENTS, {
        type: 'like.created',
        payload: {
          actorId: userId,
          targetId: targetUserId,
          action,
          actorName: swiperName,
          timestamp: new Date().toISOString(),
        },
      }).catch((err) => {
        console.error('[Kafka] Failed to publish like.created:', err);
      });

      // Send push notification
      await notificationEvents.newLike(targetUserId, swiperName);

      return reply.send({
        success: true,
        data: {
          matched: false,
          isSuperLike,
          superLikesRemaining: action === 'super_like' ? superLikeRemaining - 1 : undefined,
        },
      });
    }

    // Pass — just acknowledge
    return reply.send({
      success: true,
      data: { matched: false },
    });
  });

  // ─── Get Incoming Likes ──────────────────────────────
  app.get('/likes', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;

    const result = await query(
      `SELECT ui.created_at as liked_at,
              ui.is_mutual,
              ui.responded_at,
              ui.action,
              u.id as user_id,
              u.display_name,
              u.bio,
              u.date_of_birth,
              u.is_verified,
              pp.url as photo_url,
              pp.thumbnail_url as thumbnail_url
       FROM ${TABLES.USER_INTERACTIONS} ui
       JOIN ${TABLES.USERS} u ON u.id = ui.actor_id
       LEFT JOIN ${TABLES.PROFILE_PHOTOS} pp ON pp.user_id = u.id AND pp.is_primary = TRUE
       WHERE ui.target_id = $1 AND ui.action IN ('like', 'super_like')
       ORDER BY ui.created_at DESC
       LIMIT 50`,
      [userId],
    );

    const now = new Date();
    const likes = result.rows.map((row: any) => ({
      likedAt: row.liked_at,
      userId: row.user_id,
      displayName: row.display_name,
      bio: row.bio || '',
      age: row.date_of_birth
        ? Math.floor((now.getTime() - new Date(row.date_of_birth).getTime()) / 31557600000)
        : 0,
      photoUrl: row.photo_url || undefined,
      thumbnailUrl: row.thumbnail_url || undefined,
      isVerified: row.is_verified,
      isMutual: row.is_mutual,
      respondedAt: row.responded_at || undefined,
      isSuperLike: row.action === 'super_like',
    }));

    return reply.send({
      success: true,
      data: { likes, totalCount: likes.length },
    });
  });

  // ─── Respond to Incoming Like ────────────────────────
  app.post('/respond', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;
    const { targetUserId, action } = request.body as { targetUserId: string; action: 'like' | 'discard' };

    if (!targetUserId || !action || !['like', 'discard'].includes(action)) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'targetUserId and action (like|discard) required' },
      });
    }

    // Verify there's an incoming like from targetUserId (regular or super)
    const incomingLike = await query(
      `SELECT id FROM ${TABLES.USER_INTERACTIONS}
       WHERE actor_id = $1 AND target_id = $2 AND action IN ('like', 'super_like') AND is_mutual = FALSE`,
      [targetUserId, userId],
    );
    if (incomingLike.rows.length === 0) {
      return reply.status(404).send({
        success: false,
        error: { code: ERROR_CODES.NOT_FOUND, message: 'No incoming like from this user' },
      });
    }

    if (action === 'discard') {
      // Mark as responded (discarded)
      await query(
        `UPDATE ${TABLES.USER_INTERACTIONS} SET responded_at = NOW()
         WHERE actor_id = $1 AND target_id = $2`,
        [targetUserId, userId],
      );
      return reply.send({ success: true, data: { matched: false } });
    }

    // Like back — create match
    const matchResult = await query(
      `INSERT INTO ${TABLES.MATCHES} (user_a_id, user_b_id, is_active, vibe_check_id)
       VALUES ($1, $2, TRUE, NULL) RETURNING *`,
      [targetUserId, userId],
    );
    const match = matchResult.rows[0];

    // Mark both interactions as mutual
    await query(
      `UPDATE ${TABLES.USER_INTERACTIONS} SET is_mutual = TRUE, responded_at = NOW()
       WHERE (actor_id = $1 AND target_id = $2) OR (actor_id = $2 AND target_id = $1)`,
      [targetUserId, userId],
    );

    // Get partner details
    const partnerResult = await query(
      `SELECT u.display_name, pp.url as photo_url
       FROM ${TABLES.USERS} u
       LEFT JOIN ${TABLES.PROFILE_PHOTOS} pp ON pp.user_id = u.id AND pp.is_primary = TRUE
       WHERE u.id = $1`,
      [targetUserId],
    );
    const partnerName = partnerResult.rows[0]?.display_name || 'Someone';
    const partnerPhotoUrl = partnerResult.rows[0]?.photo_url || '';

    // Publish `match.created` event to Kafka for real-time delivery
    // Note: userAId is the one who sent the original like (targetUserId),
    // userBId is the responder (current userId)
    await kafkaProducer.sendEvent(KAFKA_TOPICS.MATCH_EVENTS, {
      type: 'match.created',
      payload: {
        userAId: targetUserId,
        userBId: userId,
        matchId: match.id,
        userAName: partnerName,
        userAPhotoUrl: partnerPhotoUrl,
        userBName: partnerName, // responder — will be filled with current user's name
        userBPhotoUrl: '',
        timestamp: new Date().toISOString(),
      },
    }).catch((err) => {
      console.error('[Kafka] Failed to publish match.created:', err);
    });

    // Notify both
    await notificationEvents.matchFound(userId, partnerName);

    return reply.status(201).send({
      success: true,
      data: {
        matched: true,
        matchId: match.id,
        partnerName,
        partnerId: targetUserId,
      },
    });
  });

  // ─── List Conversations ──────────────────────────────
  app.get('/conversations', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;

    const result = await query(
      `SELECT
         m.id as match_id,
         CASE WHEN m.user_a_id = $1 THEN m.user_b_id ELSE m.user_a_id END as partner_id,
         u.display_name as partner_name,
         pp.url as partner_photo_url,
         pp.thumbnail_url as partner_thumbnail_url,
         m.is_active,
         msg.content as last_message_content,
         msg.created_at as last_message_at,
         msg.sender_id as last_message_sender_id,
         (SELECT COUNT(*)::int FROM ${TABLES.MESSAGES} msg2
          WHERE msg2.match_id = m.id AND msg2.sender_id != $1 AND msg2.read_at IS NULL
         ) as unread_count
       FROM ${TABLES.MATCHES} m
       JOIN ${TABLES.USERS} u ON u.id = CASE WHEN m.user_a_id = $1 THEN m.user_b_id ELSE m.user_a_id END
       LEFT JOIN ${TABLES.PROFILE_PHOTOS} pp ON pp.user_id = u.id AND pp.is_primary = TRUE
       LEFT JOIN LATERAL (
         SELECT content, created_at, sender_id
         FROM ${TABLES.MESSAGES}
         WHERE match_id = m.id
         ORDER BY created_at DESC
         LIMIT 1
       ) msg ON TRUE
       WHERE (m.user_a_id = $1 OR m.user_b_id = $1) AND m.is_active = TRUE
       ORDER BY msg.created_at DESC NULLS LAST, m.matched_at DESC
       LIMIT 50`,
      [userId],
    );

    const conversations = result.rows.map((row: any) => ({
      matchId: row.match_id,
      partnerId: row.partner_id,
      partnerName: row.partner_name,
      partnerPhotoUrl: row.partner_photo_url || undefined,
      partnerThumbnailUrl: row.partner_thumbnail_url || undefined,
      lastMessage: row.last_message_content || undefined,
      lastMessageAt: row.last_message_at || undefined,
      lastMessageSenderId: row.last_message_sender_id || undefined,
      unreadCount: row.unread_count || 0,
      isActive: row.is_active,
    }));

    return reply.send({ success: true, data: { conversations } });
  });

  // ─── Get Messages for a Conversation ─────────────────
  app.get('/conversations/:id/messages', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id: matchId } = request.params;
    const { sub: userId } = request.user as any;

    // Verify user is part of this match
    const matchCheck = await query(
      `SELECT id FROM ${TABLES.MATCHES}
       WHERE id = $1 AND (user_a_id = $2 OR user_b_id = $2) AND is_active = TRUE`,
      [matchId, userId],
    );
    if (!matchCheck.rows[0]) {
      return reply.status(404).send({
        success: false,
        error: { code: ERROR_CODES.NOT_FOUND, message: 'Match not found or inactive' },
      });
    }

    const messages = await query(
      `SELECT id, match_id, sender_id, content, created_at, read_at
       FROM ${TABLES.MESSAGES}
       WHERE match_id = $1
       ORDER BY created_at ASC
       LIMIT 200`,
      [matchId],
    );

    // Mark unread messages as read
    await query(
      `UPDATE ${TABLES.MESSAGES} SET read_at = NOW()
       WHERE match_id = $1 AND sender_id != $2 AND read_at IS NULL`,
      [matchId, userId],
    );

    return reply.send({
      success: true,
      data: {
        messages: messages.rows.map((m: any) => ({
          id: m.id,
          matchId: m.match_id,
          senderId: m.sender_id,
          content: m.content,
          createdAt: m.created_at,
          readAt: m.read_at,
        })),
      },
    });
  });

  // ─── Send a Message ─────────────────────────────────
  app.post('/conversations/:id/messages', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id: matchId } = request.params;
    const { sub: userId } = request.user as any;
    const { content } = request.body as { content: string };

    if (!content || content.trim().length === 0) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'Message content is required' },
      });
    }

    if (content.length > 2000) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'Message too long (max 2000 characters)' },
      });
    }

    // Verify user is part of this match
    const matchCheck = await query(
      `SELECT id, user_a_id, user_b_id FROM ${TABLES.MATCHES}
       WHERE id = $1 AND (user_a_id = $2 OR user_b_id = $2) AND is_active = TRUE`,
      [matchId, userId],
    );
    if (!matchCheck.rows[0]) {
      return reply.status(404).send({
        success: false,
        error: { code: ERROR_CODES.NOT_FOUND, message: 'Match not found or inactive' },
      });
    }

    const result = await query(
      `INSERT INTO ${TABLES.MESSAGES} (match_id, sender_id, content)
       VALUES ($1, $2, $3) RETURNING *`,
      [matchId, userId, content.trim()],
    );
    const message = result.rows[0];

    // Notify the partner via push
    const matchRow = matchCheck.rows[0];
    const partnerId = matchRow.user_a_id === userId ? matchRow.user_b_id : matchRow.user_a_id;
    const senderResult = await query(`SELECT display_name FROM ${TABLES.USERS} WHERE id = $1`, [userId]);
    const senderName = senderResult.rows[0]?.display_name || 'Someone';
    const preview = content.trim().length > 80 ? content.trim().slice(0, 80) + '…' : content.trim();

    await notificationEvents.newMessage(partnerId, senderName, preview);

    return reply.status(201).send({
      success: true,
      data: {
        id: message.id,
        matchId: message.match_id,
        senderId: message.sender_id,
        content: message.content,
        createdAt: message.created_at,
        readAt: message.read_at,
      },
    });
  });

  // ─── Existing: List Matches ──────────────────────────
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;

    const result = await query(
      `SELECT m.*,
              u.display_name as partner_name,
              pp.url as partner_photo_url,
              pp.thumbnail_url as partner_thumbnail_url,
              vc.started_at as vibe_started_at,
              vc.call_duration_seconds
       FROM ${TABLES.MATCHES} m
       LEFT JOIN ${TABLES.VIBE_CHECKS} vc ON m.vibe_check_id = vc.id
       JOIN ${TABLES.USERS} u ON u.id = CASE WHEN m.user_a_id = $1 THEN m.user_b_id ELSE m.user_a_id END
       LEFT JOIN ${TABLES.PROFILE_PHOTOS} pp ON pp.user_id = u.id AND pp.is_primary = TRUE
       WHERE (m.user_a_id = $1 OR m.user_b_id = $1) AND m.is_active = TRUE
       ORDER BY m.matched_at DESC
       LIMIT 50`,
      [userId],
    );

    return reply.send({ success: true, data: result.rows });
  });

  // ─── Existing: Get Match Detail ──────────────────────
  app.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const { sub: userId } = request.user as any;

    const result = await query(
      `SELECT m.*,
              u.display_name as partner_name,
              u.bio as partner_bio,
              u.date_of_birth as partner_dob,
              u.occupation as partner_occupation,
              pp.url as partner_photo_url,
              vc.created_at as vibe_created_at,
              vc.started_at as vibe_started_at,
              vc.call_duration_seconds,
              v.name as venue_name,
              v.address as venue_address,
              v.category as venue_category,
              v.image_url as venue_image_url
       FROM ${TABLES.MATCHES} m
       LEFT JOIN ${TABLES.VIBE_CHECKS} vc ON m.vibe_check_id = vc.id
       LEFT JOIN ${TABLES.RESERVATIONS} r ON r.match_id = m.id
       LEFT JOIN ${TABLES.VENUES} v ON r.venue_id = v.id
       JOIN ${TABLES.USERS} u ON u.id = CASE WHEN m.user_a_id = $1 THEN m.user_b_id ELSE m.user_a_id END
       LEFT JOIN ${TABLES.PROFILE_PHOTOS} pp ON pp.user_id = u.id AND pp.is_primary = TRUE
       WHERE m.id = $1 AND (m.user_a_id = $2 OR m.user_b_id = $2)`,
      [id, userId],
    );

    if (!result.rows[0]) {
      return reply.status(404).send({
        success: false,
        error: { code: ERROR_CODES.NOT_FOUND, message: 'Match not found' },
      });
    }

    return reply.send({ success: true, data: result.rows[0] });
  });
}

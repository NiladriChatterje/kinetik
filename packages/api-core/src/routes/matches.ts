import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  ERROR_CODES, REDIS_KEYS, SUPER_LIKE_LIMIT_DAILY_FREE,
  SUPER_LIKE_LIMIT_DAILY_PREMIUM, EVENT_BUS_CHANNELS,
  encryptMessage, decryptMessage, getOpeningLine, ChatMediaType,
} from '@kinetik/shared';
import { v4 as uuidv4 } from 'uuid';
import { query, TABLES } from '../services/database';
import { notificationEvents } from '../services/notificationService';
import { eventBus } from '../services/eventBus';
import { getRedis } from '../services/redis';
import { savePhoto, saveChatFile, saveEncryptedChatFile, getEncryptedChatFileBuffer, deleteChatFile } from '../services/photoStorage';

const MESSAGE_ENCRYPTION_KEY = process.env.MESSAGE_ENCRYPTION_KEY || '';
const redis = getRedis();

export async function matchRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip JWT auth ONLY for the GET media proxy endpoint — native audio/video
    // players cannot set custom HTTP headers, so they pass the JWT as a query
    // parameter (?token=...). The proxy verifies it manually and has its own
    // access control via the key structure and match-membership DB check.
    //
    // POST /media/:mediaId/view (markMediaViewed) must NOT skip auth — it
    // relies on request.user being populated by jwtVerify().
    if (request.method === 'GET' && request.url.startsWith('/api/v1/matches/media/')) return;
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
        u.pronouns,
        u.is_verified,
        u.about_answers,
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
          pronouns: row.pronouns || undefined,
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
          aboutAnswers: row.about_answers || undefined,
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

    // Load the user's entitlement. swipe_allowance is 50 for free accounts and
    // PREMIUM_SWIPE_LIMIT_DAILY (effectively unlimited) once a paid subscription
    // is active — the payments/webhook flows set it on activation.
    const subResult = await query(
      `SELECT tier, swipe_allowance FROM ${TABLES.SUBSCRIPTION_LEDGER} WHERE user_id = $1`,
      [userId],
    );
    const sub = subResult.rows[0];
    const tier = sub?.tier || 'free';
    const swipeAllowance = sub?.swipe_allowance ?? 50;

    // Daily swipe limit — only right swipes (like / super_like) count; passing
    // left is always free. Atomic INCR-then-compare avoids double-spend races.
    if (action === 'like' || action === 'super_like') {
      const usedCount = await redis.incr(REDIS_KEYS.USER_SWIPE_COUNT(userId));
      if (usedCount === 1) {
        // Fresh 24h window
        await redis.expire(REDIS_KEYS.USER_SWIPE_COUNT(userId), 86400);
      }
      if (usedCount > swipeAllowance) {
        // Revert the increment — the swipe did not land
        await redis.decr(REDIS_KEYS.USER_SWIPE_COUNT(userId));
        return reply.status(429).send({
          success: false,
          error: {
            code: ERROR_CODES.SWIPE_LIMIT_REACHED,
            message: "You've reached today's swipe limit. Upgrade to Premium for unlimited swipes.",
          },
        });
      }
    }

    // Check daily super like limit
    let superLikeRemaining = 0;
    if (action === 'super_like') {
      const dailyLimit = tier === 'free' ? SUPER_LIKE_LIMIT_DAILY_FREE : SUPER_LIKE_LIMIT_DAILY_PREMIUM;

      const used = await redis.get(REDIS_KEYS.USER_SUPERLIKE_COUNT(userId));
      const usedCount = used ? parseInt(used, 10) : 0;
      superLikeRemaining = Math.max(0, dailyLimit - usedCount);

      if (usedCount >= dailyLimit) {
        // Undo the swipe-count increment above — this super like never landed
        await redis.decr(REDIS_KEYS.USER_SWIPE_COUNT(userId));
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

        // Publish `match.created` event via Redis event bus
        await eventBus.publish(EVENT_BUS_CHANNELS.MATCH_EVENTS, {
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
          console.error('[EventBus] Failed to publish match.created:', err);
        });

        // Auto-send an opening line as the first message
        await sendOpeningLineAsMessage(match.id, userId, targetUserId);

        // Send new message notification instead of match notification
        await notificationEvents.newMessage(targetUserId, swiperName, 'You have a new match! Say hi');

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

      // Publish `like.created` event via Redis event bus
      await eventBus.publish(EVENT_BUS_CHANNELS.MATCH_EVENTS, {
        type: 'like.created',
        payload: {
          actorId: userId,
          targetId: targetUserId,
          action,
          actorName: swiperName,
          timestamp: new Date().toISOString(),
        },
      }).catch((err) => {
        console.error('[EventBus] Failed to publish like.created:', err);
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
       WHERE ui.target_id = $1
        AND ui.action IN ('like', 'super_like')
        AND ui.is_mutual = FALSE
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

    // Get partner details (the original liker)
    const partnerResult = await query(
      `SELECT u.display_name, pp.url as photo_url
       FROM ${TABLES.USERS} u
       LEFT JOIN ${TABLES.PROFILE_PHOTOS} pp ON pp.user_id = u.id AND pp.is_primary = TRUE
       WHERE u.id = $1`,
      [targetUserId],
    );
    const partnerName = partnerResult.rows[0]?.display_name || 'Someone';
    const partnerPhotoUrl = partnerResult.rows[0]?.photo_url || '';

    // Get the responder's (current user's) name and photo for the match event
    const responderResult = await query(
      `SELECT u.display_name, pp.url as photo_url
       FROM ${TABLES.USERS} u
       LEFT JOIN ${TABLES.PROFILE_PHOTOS} pp ON pp.user_id = u.id AND pp.is_primary = TRUE
       WHERE u.id = $1`,
      [userId],
    );
    const responderName = responderResult.rows[0]?.display_name || 'Someone';
    const responderPhotoUrl = responderResult.rows[0]?.photo_url || '';

    // Publish `match.created` event via Redis event bus
    // The realtime service uses:
    //   - userAId (original liker) → sees userBName as their partner's name
    //   - userBId (responder)       → sees userAName as their partner's name
    await eventBus.publish(EVENT_BUS_CHANNELS.MATCH_EVENTS, {
      type: 'match.created',
      payload: {
        userAId: targetUserId,
        userBId: userId,
        matchId: match.id,
        userAName: partnerName,          // original liker's name — shown to responder
        userAPhotoUrl: partnerPhotoUrl,  // original liker's photo — shown to responder
        userBName: responderName,        // responder's name — shown to original liker
        userBPhotoUrl: responderPhotoUrl,// responder's photo — shown to original liker
        timestamp: new Date().toISOString(),
      },
    }).catch((err) => {
      console.error('[EventBus] Failed to publish match.created:', err);
    });

    // Auto-send an opening line as the first message
    await sendOpeningLineAsMessage(match.id, userId, targetUserId);

    // Notify both users via new message notification
    await notificationEvents.newMessage(userId, partnerName, 'You have a new match! Say hi');
    await notificationEvents.newMessage(targetUserId, responderName, 'You have a new match! Say hi');

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
      lastMessage: row.last_message_content
        ? decryptMessage(row.last_message_content, MESSAGE_ENCRYPTION_KEY)
        : undefined,
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
      `SELECT
         m.id, m.match_id, m.sender_id, m.content, m.created_at, m.read_at,
         cm.id as media_id,
         cm.media_type,
         cm.url as media_url,
         cm.thumbnail_url as media_thumbnail_url,
         cm.mime_type as media_mime_type,
         cm.file_size as media_file_size,
         cm.duration_secs as media_duration_secs,
         cm.width as media_width,
         cm.height as media_height,
         cm.is_view_once as media_is_view_once,
         cm.viewed_at as media_viewed_at
       FROM ${TABLES.MESSAGES} m
       LEFT JOIN ${TABLES.CHAT_MEDIA} cm ON cm.message_id = m.id
       WHERE m.match_id = $1
       ORDER BY m.created_at ASC
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
        messages: messages.rows.map((m: any) => {
          // Build media object if this message has a media attachment
          let media: any = undefined;
          if (m.media_id) {
            media = {
              id: m.media_id,
              messageId: m.id,
              senderId: m.sender_id,
              mediaType: m.media_type,
              url: m.media_url,
              thumbnailUrl: m.media_thumbnail_url || undefined,
              mimeType: m.media_mime_type,
              fileSize: m.media_file_size,
              width: m.media_width || undefined,
              height: m.media_height || undefined,
              durationSecs: m.media_duration_secs != null ? m.media_duration_secs : undefined,
              isViewOnce: m.media_is_view_once || false,
              viewedAt: m.media_viewed_at || undefined,
            };
          }

          return {
            id: m.id,
            matchId: m.match_id,
            senderId: m.sender_id,
            content: decryptMessage(m.content, MESSAGE_ENCRYPTION_KEY),
            createdAt: m.created_at,
            readAt: m.read_at,
            media,
          };
        }),
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

    const plainContent = content.trim();
    const encryptedContent = encryptMessage(plainContent, MESSAGE_ENCRYPTION_KEY);

    const result = await query(
      `INSERT INTO ${TABLES.MESSAGES} (match_id, sender_id, content)
       VALUES ($1, $2, $3) RETURNING *`,
      [matchId, userId, encryptedContent],
    );
    const message = result.rows[0];

    // Publish to Redis pub/sub with PLAINTEXT (clients render plaintext)
    const messagePayload = {
      id: message.id,
      matchId: message.match_id,
      senderId: message.sender_id,
      content: plainContent,
      createdAt: message.created_at,
    };
    redis.publish(REDIS_KEYS.CHAT_MESSAGES_CHANNEL, JSON.stringify(messagePayload)).catch((err: Error) => {
      console.error('[Redis] Failed to publish chat message:', err.message);
    });

    // Notify the partner via push
    const matchRow = matchCheck.rows[0];
    const partnerId = matchRow.user_a_id === userId ? matchRow.user_b_id : matchRow.user_a_id;
    const senderResult = await query(`SELECT display_name FROM ${TABLES.USERS} WHERE id = $1`, [userId]);
    const senderName = senderResult.rows[0]?.display_name || 'Someone';
    const preview = plainContent.length > 80 ? plainContent.slice(0, 80) + '…' : plainContent;

    await notificationEvents.newMessage(partnerId, senderName, preview);

    return reply.status(201).send({
      success: true,
      data: {
        id: message.id,
        matchId: message.match_id,
        senderId: message.sender_id,
        content: plainContent,
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

  // ─── Send Media Message ────────────────────────────────
  // Upload a media file (image/video/audio/file) and attach it to a chat message.
  // Query params: ?media_type=image|video|audio|file&caption=optional
  app.post('/conversations/:id/media', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id: matchId } = request.params;
    const { sub: userId } = request.user as any;

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

    const mediaType = (request.query as any).media_type || 'image';
    const caption = (request.query as any).caption || '';
    const durationSecs = parseInt((request.query as any).duration_secs, 10) || null;
    const viewOnce = (request.query as any).view_once === 'true';

    if (!['image', 'video', 'audio', 'file'].includes(mediaType)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_MEDIA_TYPE', message: 'media_type must be image, video, audio, or file' },
      });
    }

    // Parse multipart file
    const file = await request.file();
    if (!file) {
      return reply.status(400).send({
        success: false,
        error: { code: 'NO_FILE', message: 'No media file provided.' },
      });
    }

    const mimeType = file.mimetype;

    // Read the file buffer
    const chunks: Buffer[] = [];
    for await (const chunk of file.file) {
      chunks.push(chunk);
    }
    const fileBuffer = Buffer.concat(chunks);

    if (fileBuffer.length === 0) {
      return reply.status(400).send({
        success: false,
        error: { code: 'EMPTY_FILE', message: 'Media data is empty.' },
      });
    }

    if (fileBuffer.length > 50 * 1024 * 1024) {
      return reply.status(400).send({
        success: false,
        error: { code: 'FILE_TOO_LARGE', message: 'File too large. Max 50MB.' },
      });
    }

    const fileId = uuidv4();

    // Save to storage
    let url: string;
    let thumbnailUrl: string | null = null;

    if (mediaType === 'image') {
      const saved = await savePhoto(userId, fileBuffer, mimeType);
      url = saved.url;
      thumbnailUrl = saved.thumbnailUrl;
    } else {
      // All non-image media (audio, video, file) use encrypted-at-rest storage
      const saved = await saveEncryptedChatFile(userId, fileBuffer, mimeType, fileId);
      url = saved.url;
    }

    // Create the message
    const content = caption || `Sent a ${mediaType}`;
    const encryptedContent = encryptMessage(content, MESSAGE_ENCRYPTION_KEY);

    const messageResult = await query(
      `INSERT INTO ${TABLES.MESSAGES} (match_id, sender_id, content)
       VALUES ($1, $2, $3) RETURNING *`,
      [matchId, userId, encryptedContent],
    );
    const message = messageResult.rows[0];

    // Insert chat_media record
    const mediaResult = await query(
      `INSERT INTO ${TABLES.CHAT_MEDIA} (message_id, sender_id, media_type, url, thumbnail_url, mime_type, file_size, duration_secs, is_view_once)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [message.id, userId, mediaType, url, thumbnailUrl, mimeType, fileBuffer.length, durationSecs, viewOnce],
    );
    const media = mediaResult.rows[0];

    // Prepare plaintext payload for realtime delivery
    const mediaPayload = {
      id: media.id,
      messageId: media.message_id,
      senderId: media.sender_id,
      mediaType: media.media_type,
      url: media.url,
      thumbnailUrl: media.thumbnail_url || undefined,
      mimeType: media.mime_type,
      fileSize: media.file_size,
      width: media.width || undefined,
      height: media.height || undefined,
      durationSecs: media.duration_secs != null ? media.duration_secs : undefined,
      isViewOnce: viewOnce || false,
      viewedAt: undefined,
    };

    const messagePayload = {
      id: message.id,
      matchId: message.match_id,
      senderId: message.sender_id,
      content,
      media: mediaPayload,
      createdAt: message.created_at,
    };

    // Publish via Redis pub/sub
    redis.publish(REDIS_KEYS.CHAT_MESSAGES_CHANNEL, JSON.stringify(messagePayload)).catch((err: Error) => {
      console.error('[Redis] Failed to publish media message:', err.message);
    });

    // Notify the partner
    const matchRow = matchCheck.rows[0];
    const partnerId = matchRow.user_a_id === userId ? matchRow.user_b_id : matchRow.user_a_id;
    const senderResult = await query(`SELECT display_name FROM ${TABLES.USERS} WHERE id = $1`, [userId]);
    const senderName = senderResult.rows[0]?.display_name || 'Someone';
    const preview = mediaType === 'image' ? 'Sent a photo' : `Sent ${mediaType}`;

    await notificationEvents.newMessage(partnerId, senderName, preview);

    return reply.status(201).send({
      success: true,
      data: {
        id: message.id,
        matchId: message.match_id,
        senderId: message.sender_id,
        content,
        media: mediaPayload,
        createdAt: message.created_at,
        readAt: null,
      },
    });
  });

  // ─── Serve Decrypted Media File ─────────────────────────
  // Proxy endpoint that reads an encrypted file from MinIO, decrypts it
  // on-the-fly, and streams the plaintext.
  //
  // URL format: /api/v1/matches/media/chat/{userId}/{fileId}.enc?ext=m4a
  //
  // Auth: this endpoint is excluded from the JWT preHandler because native
  // media players (AVPlayer, ExoPlayer, MediaPlayer) cannot send custom HTTP
  // headers. Instead, the client passes the JWT token as a query parameter:
  //   ?ext=m4a&token=<jwt_token>
  //
  // Security: the token is verified manually; the key contains a random UUID
  // making it cryptographically unguessable; the file is encrypted at rest.
  app.get('/media/*', async (request: FastifyRequest, reply: FastifyReply) => {
    // Resolve user identity: try JWT from query param first, then fall back
    // to request.user (set by the preHandler for any requests that DO have
    // the Authorization header, e.g. fetch() calls from JS).
    let userId: string | undefined;

    const urlObj = new URL(request.url, 'http://localhost');
    const tokenFromQuery = urlObj.searchParams.get('token');

    if (tokenFromQuery) {
      try {
        // request.jwtVerify() only reads from Authorization header — it does NOT
        // accept a raw token string. Use request.server.jwt.verify() instead.
        const decoded = request.server.jwt.verify(tokenFromQuery);
        userId = (decoded as any).sub;
      } catch {
        return reply.status(401).send({
          success: false,
          error: { code: ERROR_CODES.UNAUTHORIZED, message: 'Invalid or expired token.' },
        });
      }
    } else {
      // Fallback: request.user is set by the preHandler JWT hook
      const user = request.user as any;
      userId = user?.sub;
    }

    if (!userId) {
      return reply.status(401).send({
        success: false,
        error: { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required.' },
      });
    }

    // Extract the MinIO key from the wildcard path (everything after /media/)
    // e.g., /api/v1/matches/media/chat/user123/abc.enc?ext=m4a
    //   → key = "chat/user123/abc.enc"
    const fullPath = request.url;
    const mediaPath = fullPath.split('/media/')[1];
    if (!mediaPath) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_PATH', message: 'Invalid media path.' },
      });
    }

    // Extract the extension query param for Content-Type
    const ext = urlObj.searchParams.get('ext') || 'bin';

    // The key is the path up to ?ext=...
    const key = mediaPath.split('?')[0];

    // Verify the user is part of the match by checking the chat/media ownership
    // The key format is: chat/{ownerUserId}/{fileId}.enc
    // We check if the requesting userId matches the owner userId in the key
    // or if they're matched with the owner
    const ownerMatch = key.match(/^chat\/([^/]+)\//);
    if (!ownerMatch) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_KEY', message: 'Invalid media key format.' },
      });
    }

    const ownerId = ownerMatch[1];

    // Verify the requesting user is either the owner or matched with the owner
    if (ownerId !== userId) {
      const matchCheck = await query(
        `SELECT id FROM ${TABLES.MATCHES}
         WHERE is_active = TRUE
           AND ((user_a_id = $1 AND user_b_id = $2) OR (user_a_id = $2 AND user_b_id = $1))`,
        [userId, ownerId],
      );
      if (!matchCheck.rows[0]) {
        return reply.status(403).send({
          success: false,
          error: { code: ERROR_CODES.FORBIDDEN, message: 'Not authorized to access this media.' },
        });
      }
    }

    try {
      const { buffer } = await getEncryptedChatFileBuffer(key);

      // Map extension to MIME type
      const mimeMap: Record<string, string> = {
        m4a: 'audio/mp4',
        mp4: 'video/mp4',
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        ogg: 'audio/ogg',
        webm: 'video/webm',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
        gif: 'image/gif',
        pdf: 'application/pdf',
        bin: 'application/octet-stream',
      };
      const contentType = mimeMap[ext] || 'application/octet-stream';

      return reply
        .header('Content-Type', contentType)
        .header('Content-Length', buffer.length.toString())
        .header('Cache-Control', 'private, max-age=3600')
        .send(buffer);
    } catch (err: any) {
      console.error('[MediaProxy] Failed to serve encrypted file:', err.message);
      return reply.status(404).send({
        success: false,
        error: { code: 'MEDIA_NOT_FOUND', message: 'Media file not found.' },
      });
    }
  });

  // ─── Mark One-Time View Media as Viewed ─────────────────
  // Marks a one-time view media as viewed and deletes the actual file from storage.
  // After this call, the media URL becomes invalid.
  app.post('/media/:mediaId/view', async (request: FastifyRequest<{ Params: { mediaId: string } }>, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;
    const { mediaId } = request.params;

    // Atomically mark as viewed — only succeeds if it hasn't been viewed yet.
    // Using a single UPDATE ... WHERE viewed_at IS NULL RETURNING * avoids a
    // race condition where two concurrent requests could both view the same media.
    const mediaResult = await query(
      `UPDATE ${TABLES.CHAT_MEDIA} SET viewed_at = NOW()
       WHERE id = $1 AND is_view_once = TRUE AND viewed_at IS NULL
       RETURNING id, sender_id, url, message_id`,
      [mediaId],
    );

    const mediaRow = mediaResult.rows[0];
    if (!mediaRow) {
      return reply.status(404).send({
        success: false,
        error: { code: 'MEDIA_NOT_FOUND', message: 'View-once media not found or already viewed.' },
      });
    }

    // Verify the requesting user is the recipient (not the sender)
    if (mediaRow.sender_id === userId) {
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Cannot mark your own sent media as viewed.' },
      });
    }

    // Delete the file from storage (best-effort, non-critical if it fails)
    const url = mediaRow.url;
    let keyToDelete: string | null = null;

    if (url.startsWith('/api/v1/matches/media/')) {
      // Encrypted file URL — extract the MinIO key from the proxy path
      // Format: /api/v1/matches/media/chat/{userId}/{fileId}.enc?ext=...
      const pathPart = url.split('/api/v1/matches/media/')[1];
      if (pathPart) {
        keyToDelete = pathPart.split('?')[0];
      }
    } else if (url.startsWith('/uploads/')) {
      // Direct upload URL — extract the key from /uploads/{key}
      const uploadKey = url.replace('/uploads/', '');
      if (uploadKey) {
        await deleteChatFile(uploadKey).catch(() => {});
        // Also delete thumbnail if it exists
        const thumbKey = uploadKey.replace('.webp', '_thumb.webp');
        if (thumbKey !== uploadKey) {
          await deleteChatFile(thumbKey).catch(() => {});
        }
      }
    }

    if (keyToDelete) {
      await deleteChatFile(keyToDelete).catch((err: Error) => {
        console.error(`[MediaView] Failed to delete file ${keyToDelete}:`, err.message);
      });
    }

    // Look up the matchId for this message so we can route the view event to the right room
    const msgResult = await query(
      `SELECT match_id FROM ${TABLES.MESSAGES} WHERE id = $1`,
      [mediaRow.message_id],
    );
    const matchIdForEvent = msgResult.rows[0]?.match_id;

    if (matchIdForEvent) {
      // Publish a view event so the realtime service can notify the sender
      redis.publish(REDIS_KEYS.CHAT_MESSAGES_CHANNEL, JSON.stringify({
        type: 'media:viewed',
        matchId: matchIdForEvent,
        mediaId,
        viewedAt: new Date().toISOString(),
      })).catch((err: Error) => {
        console.error('[Redis] Failed to publish media:viewed:', err.message);
      });
    }

    return reply.send({
      success: true,
      data: { viewedAt: new Date().toISOString() },
    });
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

// ─── Helper: Auto-send opening line on match ─────────────
// Picks a curated line based on the dating category of either user,
// encrypts it at rest, inserts as a message, and publishes via Redis pub/sub.
async function sendOpeningLineAsMessage(
  matchId: string,
  userAId: string,
  userBId: string,
): Promise<void> {
  try {
    // Get dating category from both users — prefer userB (target), fallback to userA (actor)
    const catResult = await query(
      `SELECT id, dating_category FROM ${TABLES.USERS}
       WHERE id IN ($1, $2)`,
      [userAId, userBId],
    );

    const userACat = catResult.rows.find((r: any) => r.id === userAId)?.dating_category;
    const userBCat = catResult.rows.find((r: any) => r.id === userBId)?.dating_category;

    // Prefer userB's category for the line, then userA's, then default to 'casual'
    const category: string = userBCat || userACat || 'casual';
    const openingLine = getOpeningLine(category as any, matchId);

    const encryptedContent = encryptMessage(openingLine, MESSAGE_ENCRYPTION_KEY);

    // Insert the message (sender = userA, the one who initiated the match)
    const result = await query(
      `INSERT INTO ${TABLES.MESSAGES} (match_id, sender_id, content)
       VALUES ($1, $2, $3) RETURNING *`,
      [matchId, userAId, encryptedContent],
    );
    const message = result.rows[0];

    // Publish via Redis pub/sub so realtime service delivers it
    const messagePayload = {
      id: message.id,
      matchId: message.match_id,
      senderId: message.sender_id,
      content: openingLine,
      createdAt: message.created_at,
    };
    redis.publish(REDIS_KEYS.CHAT_MESSAGES_CHANNEL, JSON.stringify(messagePayload)).catch((err: Error) => {
      console.error('[Redis] Failed to publish opening line:', err.message);
    });

    console.log(`[OpeningLine] Sent to match ${matchId} (category: ${category}): "${openingLine.slice(0, 50)}..."`);
  } catch (err) {
    // Non-critical — match already created, opening line is best-effort
    console.error('[OpeningLine] Failed to send opening line:', err);
  }
}

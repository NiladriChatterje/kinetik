import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  ERROR_CODES, REDIS_KEYS, FREE_SWIPE_LIMIT, FREE_CHAT_LIMIT,
  PREMIUM_CHAT_LIMIT, SUPER_LIKE_LIMIT_DAILY_FREE, SUPER_LIKE_LIMIT_DAILY_PREMIUM,
  EVENT_BUS_CHANNELS, encryptMessage, decryptMessage, getOpeningLine,
  h3ToGeo,
} from '@kinetik/shared';
import { v4 as uuidv4 } from 'uuid';
import { query, TABLES } from '../services/database';
import { transaction } from '@kinetik/shared';
import { notificationEvents } from '../services/notificationService';
import { hasActivePremium, getChatAccess, isChatLocked, CHAT_LOCKED } from '../services/premiumAccess';
import { eventBus } from '../services/eventBus';
import { getRedis, publishChatMessage } from '../services/redis';
import { savePhoto, saveEncryptedChatFile, getEncryptedChatFileBuffer, deleteChatFile } from '../services/photoStorage';

const MESSAGE_ENCRYPTION_KEY = process.env.MESSAGE_ENCRYPTION_KEY || '';
const redis = getRedis();

/** Extract a MinIO storage key from a chat media URL. */
function chatMediaKeyFromUrl(url: string): string | null {
  if (url.startsWith('/api/v1/matches/media/')) {
    const path = url.split('/api/v1/matches/media/')[1];
    return path ? path.split('?')[0] : null;
  }
  if (url.startsWith('/uploads/')) {
    const key = url.replace('/uploads/', '');
    return key || null;
  }
  return null;
}

// Every chat endpoint answers a locked conversation the same way, so the app
// can show its Premium upsell (see services/premiumAccess.ts).
function sendChatLocked(reply: FastifyReply) {
  return reply.status(402).send({
    success: false,
    error: {
      code: CHAT_LOCKED,
      message: 'Free accounts can chat with one match. Upgrade to Premium to unlock every chat.',
    },
  });
}

/** Push text for a message in a chat the recipient cannot open. */
const LOCKED_MESSAGE_PREVIEW = 'New message. Upgrade to Premium to read it.';

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
  // Two modes, same response shape:
  //  - default (swipe deck): 20 random profiles the user hasn't interacted with
  //  - ?scope=explore&offset=N&limit=M: paginated browse over EVERYONE eligible
  //    (only active matches are excluded), deterministic newest-first ordering —
  //    a cheap indexed OFFSET/LIMIT query, no ORDER BY RANDOM(). Adds hasMore.
  app.get('/profiles', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;
    const q = request.query as { scope?: string; offset?: string; limit?: string };
    const isExplore = q.scope === 'explore';
    // "Liked you" tags reveal who liked the user, a Premium feature
    const canSeeLikes = await hasActivePremium(userId);
    const exploreOffset = Math.max(0, parseInt(q.offset || '0', 10) || 0);
    const exploreLimit = Math.min(50, Math.max(1, parseInt(q.limit || '24', 10) || 24));

    // Get user's preferences for filtering
    const prefsResult = await query(
      `SELECT age_min, age_max, max_distance_km
       FROM ${TABLES.USER_PREFERENCES} WHERE user_id = $1`,
      [userId],
    );
    const prefs = prefsResult.rows[0] || {};
    const ageMin = prefs.age_min ?? 18;
    const ageMax = prefs.age_max ?? 60;


    // The viewer's own row: gender for the filter, and the feed origin.
    const userResult = await query(
      `SELECT h3_index, date_of_birth, gender, latitude, longitude, preferred_latitude, preferred_longitude
       FROM ${TABLES.USERS} WHERE id = $1`,
      [userId],
    );
    const userRow = userResult.rows[0];
    if (!userRow) {
      return reply.send({ success: true, data: { profiles: [] } });
    }

    // Feed origin: the "preferred location" city if one is set, else the
    // user's own location (GPS, or the signup city). No origin → no geo.
    const originLat: number | null = userRow.preferred_latitude ?? userRow.latitude ?? null;
    const originLng: number | null = userRow.preferred_longitude ?? userRow.longitude ?? null;
    const hasOrigin = originLat != null && originLng != null;
    const maxDistanceKm: number = prefs.max_distance_km ?? 50;

    // Calculate min birth date from age
    const now = new Date();
    const minBirthDate = new Date(now.getFullYear() - ageMax, now.getMonth(), now.getDate()).toISOString().split('T')[0];
    const maxBirthDate = new Date(now.getFullYear() - ageMin, now.getMonth(), now.getDate()).toISOString().split('T')[0];

    // Build gender filter — the viewer's own gender decides who they see:
    // male → female profiles only, female → male profiles only,
    // any other gender (non_binary / other / prefer_not_to_say) → everyone.
    let genderFilter = '';
    const genderParams: any[] = [userId, minBirthDate, maxBirthDate];
    if (userRow.gender === 'male' || userRow.gender === 'female') {
      genderFilter = `AND u.gender = ANY($${genderParams.length + 1})`;
      genderParams.push([userRow.gender === 'male' ? 'female' : 'male']);
    }

    // Great-circle km from the origin to each row (haversine on lat/lng, no
    // extension needed). NULL when the viewer has no origin, so the column is
    // always present and the ORDER BY below can name it.
    let distanceExpr = 'NULL::double precision';
    if (hasOrigin) {
      const latP = `$${genderParams.length + 1}`;
      const lngP = `$${genderParams.length + 2}`;
      genderParams.push(originLat, originLng);
      distanceExpr = `(6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians(${latP})) * cos(radians(u.latitude)) * cos(radians(u.longitude) - radians(${lngP}))
          + sin(radians(${latP})) * sin(radians(u.latitude))))))`;
    }

    // Swipe deck: only people within the max-distance preference, nearest
    // first. Without an origin it stays a random draw over everyone.
    const swipeParams = hasOrigin ? [...genderParams, maxDistanceKm] : genderParams;
    const swipeDistanceWhere = hasOrigin
      ? `AND u.latitude IS NOT NULL AND u.longitude IS NOT NULL AND ${distanceExpr} <= $${swipeParams.length}`
      : '';
    const swipeOrderBy = hasOrigin ? 'ORDER BY distance_km ASC, RANDOM()' : 'ORDER BY RANDOM()';

    // Get profiles excluding already-interacted users and self
    const selectAndWhere = `
      SELECT
        u.id,
        u.display_name,
        u.date_of_birth,
        u.bio,
        u.occupation,
        u.education,
        u.pronouns,
        u.is_verified,
        u.dating_category,
        u.about_answers,
        u.h3_index,
        u.latitude,
        u.longitude,
        ${distanceExpr} AS distance_km
      FROM %SOURCE% u
      WHERE u.id != $1
        AND u.is_active = TRUE
        AND u.onboarding_complete = TRUE
        AND u.date_of_birth >= $2
        AND u.date_of_birth <= $3
        ${genderFilter}
        ${swipeDistanceWhere}
        AND u.id NOT IN (
          SELECT target_id FROM ${TABLES.USER_INTERACTIONS} WHERE actor_id = $1
          UNION
          SELECT actor_id FROM ${TABLES.USER_INTERACTIONS} WHERE target_id = $1
          UNION
          -- Active matches are the source of truth for "already matched" —
          -- covers matches however they were created
          SELECT user_b_id FROM ${TABLES.MATCHES} WHERE user_a_id = $1 AND is_active = TRUE
          UNION
          SELECT user_a_id FROM ${TABLES.MATCHES} WHERE user_b_id = $1 AND is_active = TRUE
        )
      ${swipeOrderBy}
      LIMIT 20
    `;

    // Explore mode: paginated browse over everyone eligible. Only active
    // matches are excluded (people you're already chatting with) — passed and
    // liked users stay visible so the whole platform is browsable.
    let profilesResult;
    let hasMore = false;
    if (isExplore) {
      const exploreSql = `
        SELECT
          u.id, u.display_name, u.date_of_birth, u.bio, u.occupation,
          u.education, u.pronouns, u.is_verified, u.dating_category, u.about_answers,
          u.h3_index, u.latitude, u.longitude,
          ${distanceExpr} AS distance_km,
          -- Pending incoming like from this profile — the Explore grid shows
          -- their card with a "Liked you" tag
          EXISTS (
            SELECT 1 FROM ${TABLES.USER_INTERACTIONS} ui
            WHERE ui.actor_id = u.id AND ui.target_id = $1
              AND ui.action IN ('like', 'super_like')
              AND ui.is_mutual = FALSE AND ui.responded_at IS NULL
          ) AS liked_you
        FROM ${TABLES.USERS} u
        WHERE u.id != $1
          AND u.is_active = TRUE
          AND u.onboarding_complete = TRUE
          AND u.date_of_birth >= $2
          AND u.date_of_birth <= $3
          ${genderFilter}
          AND u.id NOT IN (
            SELECT user_b_id FROM ${TABLES.MATCHES} WHERE user_a_id = $1 AND is_active = TRUE
            UNION
            SELECT user_a_id FROM ${TABLES.MATCHES} WHERE user_b_id = $1 AND is_active = TRUE
          )
        -- Explore browses everyone (no distance cut-off) but nearest first
        -- when the viewer has an origin; profiles without a location go last.
        ORDER BY ${hasOrigin ? 'distance_km ASC NULLS LAST, ' : ''}u.created_at DESC, u.id
        OFFSET $${genderParams.length + 1} LIMIT $${genderParams.length + 2}
      `;
      // Fetch one extra row to know whether another page exists
      profilesResult = await query(exploreSql, [...genderParams, exploreOffset, exploreLimit + 1]);
      hasMore = (profilesResult.rowCount ?? 0) > exploreLimit;
      profilesResult.rows = profilesResult.rows.slice(0, exploreLimit);
    } else if (hasOrigin) {
      // Nearest-first must see the whole pool, so no block sample here: the
      // distance cut-off already keeps the candidate set small.
      profilesResult = await query(selectAndWhere.replace('%SOURCE%', TABLES.USERS), swipeParams);
    } else {
      // Try a 10% block sample first — ORDER BY RANDOM() over the sample instead
      // of the whole table. If the sample can't fill 20 (small table, small
      // remaining pool), fall back to the original full-table query, so the
      // result is always exactly what the unsampled query would return.
      profilesResult = await query(
        selectAndWhere.replace('%SOURCE%', `(SELECT * FROM ${TABLES.USERS} TABLESAMPLE SYSTEM (10))`),
        genderParams,
      );
      if ((profilesResult.rowCount ?? 0) < 20) {
        profilesResult = await query(
          selectAndWhere.replace('%SOURCE%', TABLES.USERS),
          genderParams,
        );
      }
    }

    // Fetch photos and interests for all profiles in two batched queries
    // (was one pair of queries per profile — 41 queries per feed request)
    const profileIds = profilesResult.rows.map((row: any) => row.id);
    const photosByUser = new Map<string, any[]>();
    const interestsByUser = new Map<string, any[]>();

    if (profileIds.length > 0) {
      const photosResult = await query(
        `SELECT user_id, id, url, thumbnail_url, is_primary FROM ${TABLES.PROFILE_PHOTOS}
         WHERE user_id = ANY($1) ORDER BY is_primary DESC, order_index ASC`,
        [profileIds],
      );
      for (const p of photosResult.rows) {
        if (!photosByUser.has(p.user_id)) photosByUser.set(p.user_id, []);
        photosByUser.get(p.user_id)!.push(p);
      }

      const interestsResult = await query(
        `SELECT ui.user_id, i.id, i.name, i.emoji, i.category
         FROM ${TABLES.USER_INTERESTS} ui
         JOIN ${TABLES.INTERESTS} i ON i.id = ui.interest_id
         WHERE ui.user_id = ANY($1)`,
        [profileIds],
      );
      for (const i of interestsResult.rows) {
        if (!interestsByUser.has(i.user_id)) interestsByUser.set(i.user_id, []);
        interestsByUser.get(i.user_id)!.push(i);
      }
    }

    const profiles = profilesResult.rows.map((row: any) => {
      const age = row.date_of_birth
        ? Math.floor((now.getTime() - new Date(row.date_of_birth).getTime()) / 31557600000)
        : 0;

      // Coarse location = center of the user's res-7 H3 cell (~5 km² hexagon).
      // The client sorts the deck nearest-first from this; exact coordinates
      // never leave the server.
      let approxLocation: { latitude: number; longitude: number } | undefined;
      if (row.h3_index) {
        try {
          approxLocation = h3ToGeo(row.h3_index);
        } catch {
          // Malformed cell — profile simply has no distance
        }
      }

      return {
        approxLocation,
        // Km from the feed origin (own or preferred location); undefined when
        // the viewer has no origin. The app keeps this order when present.
        distanceKm: row.distance_km != null ? Math.max(1, Math.round(Number(row.distance_km))) : undefined,
        userId: row.id,
        displayName: row.display_name,
        age,
        bio: row.bio || '',
        occupation: row.occupation || undefined,
        education: row.education || undefined,
        pronouns: row.pronouns || undefined,
        // What they said they are here for; shown as a badge on their card.
        datingCategory: row.dating_category || undefined,
        photos: (photosByUser.get(row.id) || []).map((p: any) => ({
          id: p.id,
          url: p.url,
          thumbnailUrl: p.thumbnail_url || undefined,
          isPrimary: p.is_primary,
        })),
        interests: (interestsByUser.get(row.id) || []).map((i: any) => ({
          id: i.id,
          name: i.name,
          emoji: i.emoji,
          category: i.category,
        })),
        aboutAnswers: row.about_answers || undefined,
        isVerified: row.is_verified,
        // Only set by the explore query; undefined (→ false) for the deck.
        // Never sent to free users, who may only see how many liked them.
        likedYou: canSeeLikes && Boolean(row.liked_you),
      };
    });

    return reply.send({
      success: true,
      data: isExplore ? { profiles, hasMore, offset: exploreOffset } : { profiles },
    });
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

    // Load the user's entitlement. swipe_allowance is FREE_SWIPE_LIMIT (30)
    // for free accounts and PREMIUM_SWIPE_LIMIT (effectively unlimited) once a
    // paid subscription is active — the payments/webhook flows set it on activation.
    const subResult = await query(
      `SELECT tier, swipe_allowance FROM ${TABLES.SUBSCRIPTION_LEDGER} WHERE user_id = $1`,
      [userId],
    );
    const sub = subResult.rows[0];
    const tier = sub?.tier || 'free';
    const swipeAllowance = sub?.swipe_allowance ?? FREE_SWIPE_LIMIT;

    // Swipe limit — PER ACCOUNT (lifetime), not daily. Only right swipes
    // (like / super_like) count; passing left is always free. Counted from the
    // durable user_interactions table so a Redis restart can't reset it.
    let swipesRemaining: number | undefined;
    if (action === 'like' || action === 'super_like') {
      const usedResult = await query(
        `SELECT COUNT(*)::int AS cnt FROM ${TABLES.USER_INTERACTIONS}
         WHERE actor_id = $1 AND action IN ('like', 'super_like')`,
        [userId],
      );
      const usedCount = usedResult.rows[0]?.cnt ?? 0;
      if (usedCount >= swipeAllowance) {
        return reply.status(429).send({
          success: false,
          error: {
            code: ERROR_CODES.SWIPE_LIMIT_REACHED,
            message: "You've used all your free swipes. Upgrade to Premium for unlimited swipes.",
            details: { used: usedCount, limit: swipeAllowance },
          },
        });
      }
      // Remaining AFTER this swipe lands (recorded below)
      swipesRemaining = Math.max(0, swipeAllowance - usedCount - 1);
    }

    // Check daily super like limit
    let superLikeRemaining = 0;
    if (action === 'super_like') {
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
    await query(
      `INSERT INTO ${TABLES.USER_INTERACTIONS} (actor_id, target_id, action)
       VALUES ($1, $2, $3) RETURNING *`,
      [userId, targetUserId, action],
    );


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
        // Mutual like! Check chat limit before creating a match.
        const chatCheck = await checkChatLimit(userId, tier);
        if (!chatCheck.allowed) {
          // Still record the interaction as mutual (so the like shows up in likes list)
          // but don't create a new match — the user must upgrade to unlock more chats.
          await query(
            `UPDATE ${TABLES.USER_INTERACTIONS} SET is_mutual = TRUE, responded_at = NOW()
             WHERE actor_id = $1 AND target_id = $2`,
            [targetUserId, userId],
          );
          return reply.status(429).send({
            success: false,
            error: {
              code: ERROR_CODES.CHAT_LIMIT_REACHED,
              message: `You've reached the ${chatCheck.limit} chat limit. Upgrade to Premium for unlimited matches.`,
              details: { activeChats: chatCheck.activeCount, limit: chatCheck.limit },
            },
          });
        }

        // Create a match (or reuse the active one if a racing
        // request / the Likes-screen respond flow already created it)
        const { match, created } = await getOrCreateActiveMatch(userId, targetUserId);

        if (match) {
          // Mark both interactions as mutual
          await query(
            `UPDATE ${TABLES.USER_INTERACTIONS} SET is_mutual = TRUE, responded_at = NOW()
             WHERE (actor_id = $1 AND target_id = $2) OR (actor_id = $2 AND target_id = $1)`,
            [userId, targetUserId],
          );

          // Get partner details for the response / notification
          const partnerResult = await query(
            `SELECT u.display_name, pp.url as photo_url
             FROM ${TABLES.USERS} u
             LEFT JOIN ${TABLES.PROFILE_PHOTOS} pp ON pp.user_id = u.id AND pp.is_primary = TRUE
             WHERE u.id = $1`,
            [targetUserId],
          );
          const partnerName = partnerResult.rows[0]?.display_name || 'Someone';
          const partnerPhotoUrl = partnerResult.rows[0]?.photo_url || '';

          // Side effects only for a freshly created match — a reused match
          // already had its event, opening line, and notification sent
          if (created) {
            // Also get swiper's photo URL for the match event
            const swiperPhotoResult = await query(
              `SELECT pp.url as photo_url
               FROM ${TABLES.PROFILE_PHOTOS} pp
               WHERE pp.user_id = $1 AND pp.is_primary = TRUE`,
              [userId],
            );
            const swiperPhotoUrl = swiperPhotoResult.rows[0]?.photo_url || '';

            // Auto-send an opening line as the first message. Insert it
            // BEFORE publishing match.created so that the moment either
            // side receives match:new, the conversation (and its unread
            // state) already exists server-side — clients refetch on
            // match:new and must not race a not-yet-written message.
            await sendOpeningLineAsMessage(match.id, userId, targetUserId);

            // Publish `match.created` event via Redis event bus.
            // initiatorId = the user who completed the match (the one who
            // liked back / swiped last). The realtime service passes it
            // through so the client shows the "It's a Match!" modal only to
            // this user — the other side learns about the match via the
            // chat badge (the opening line counts as an unseen message).
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
                initiatorId: userId,
                timestamp: new Date().toISOString(),
              },
            }).catch((err) => {
              console.error('[EventBus] Failed to publish match.created:', err);
            });

            // Send new message notification instead of match notification
            notificationEvents.newMessage(targetUserId, swiperName, 'You have a new match! Say hi').catch(() => {});
          }

          return reply.status(201).send({
            success: true,
            data: {
              matched: true,
              isSuperLike,
              matchId: match.id,
              partnerName,
              partnerId: targetUserId,
              swipesRemaining,
            },
          });
        }
        // No active match row could be created or found (pair unmatched in a
        // concurrent request) — fall through and treat this as a plain like.
      }

      // Who liked them is Premium only: a free recipient's live event and push
      // say that someone liked them, never who
      const targetCanSeeLikes = await hasActivePremium(targetUserId);

      // Publish `like.created` event via Redis event bus
      await eventBus.publish(EVENT_BUS_CHANNELS.MATCH_EVENTS, {
        type: 'like.created',
        payload: {
          actorId: targetCanSeeLikes ? userId : null,
          targetId: targetUserId,
          action,
          actorName: targetCanSeeLikes ? swiperName : null,
          timestamp: new Date().toISOString(),
        },
      }).catch((err) => {
        console.error('[EventBus] Failed to publish like.created:', err);
      });

      // Send push notification
      notificationEvents.newLike(targetUserId, targetCanSeeLikes ? swiperName : null).catch(() => {});

      return reply.send({
        success: true,
        data: {
          matched: false,
          isSuperLike,
          superLikesRemaining: action === 'super_like' ? superLikeRemaining - 1 : undefined,
          swipesRemaining,
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

    // Free users learn only how many people liked them: no ids, names or
    // photos leave the server. The app shows that many blurred cards.
    if (!(await hasActivePremium(userId))) {
      const countResult = await query(
        `SELECT COUNT(*)::int AS cnt FROM (
           SELECT 1 FROM ${TABLES.USER_INTERACTIONS} ui
           WHERE ui.target_id = $1
             AND ui.action IN ('like', 'super_like')
             AND ui.is_mutual = FALSE
             AND ui.responded_at IS NULL
           LIMIT 50
         ) pending`,
        [userId],
      );
      return reply.send({
        success: true,
        data: { likes: [], totalCount: countResult.rows[0]?.cnt ?? 0, locked: true },
      });
    }

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
              u.dating_category,
              pp.url as photo_url,
              pp.thumbnail_url as thumbnail_url
       FROM ${TABLES.USER_INTERACTIONS} ui
       JOIN ${TABLES.USERS} u ON u.id = ui.actor_id
       LEFT JOIN LATERAL (
         SELECT url, thumbnail_url
         FROM ${TABLES.PROFILE_PHOTOS}
         WHERE user_id = u.id AND is_primary = TRUE
         LIMIT 1
       ) pp ON TRUE
       WHERE ui.target_id = $1
        AND ui.action IN ('like', 'super_like')
        AND ui.is_mutual = FALSE
        -- Discarded likes are gone for good: /respond stamps responded_at,
        -- and the UNIQUE (actor_id, target_id) constraint means the liker
        -- can never create a fresh row to reappear here.
        AND ui.responded_at IS NULL
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
      datingCategory: row.dating_category || undefined,
      respondedAt: row.responded_at || undefined,
      isSuperLike: row.action === 'super_like',
    }));

    return reply.send({
      success: true,
      data: { likes, totalCount: likes.length, locked: false },
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

    // Like back — check chat limit before creating a match.
    const chatCheck = await checkChatLimit(userId);
    if (!chatCheck.allowed) {
      // Mark as responded (so the like shows up as responded)
      await query(
        `UPDATE ${TABLES.USER_INTERACTIONS} SET responded_at = NOW()
         WHERE actor_id = $1 AND target_id = $2`,
        [targetUserId, userId],
      );
      return reply.status(429).send({
        success: false,
        error: {
          code: ERROR_CODES.CHAT_LIMIT_REACHED,
          message: `You've reached the ${chatCheck.limit} chat limit. Upgrade to Premium for unlimited matches.`,
          details: { activeChats: chatCheck.activeCount, limit: chatCheck.limit },
        },
      });
    }

    // Create match (or reuse the active one if a racing /swipe
    // from the other side already created it)
    const { match, created } = await getOrCreateActiveMatch(targetUserId, userId);
    if (!match) {
      // Active match vanished in a concurrent unmatch — nothing to link to
      return reply.send({ success: true, data: { matched: false } });
    }

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

    // Side effects only for a freshly created match — a reused match already
    // had its event, opening line, and notifications sent
    if (created) {
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

      // Auto-send an opening line as the first message. Insert it BEFORE
      // publishing match.created so the conversation and its unread state
      // already exist when either side receives match:new (see /swipe).
      await sendOpeningLineAsMessage(match.id, userId, targetUserId);

      // Publish `match.created` event via Redis event bus.
      // The realtime service uses:
      //   - userAId (original liker) → sees userBName as their partner's name
      //   - userBId (responder)       → sees userAName as their partner's name
      // initiatorId = the responder (the one who liked back) — the only user
      // who should get the "It's a Match!" modal.
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
          initiatorId: userId,
          timestamp: new Date().toISOString(),
        },
      }).catch((err) => {
        console.error('[EventBus] Failed to publish match.created:', err);
      });

      // Notify both users via new message notification
      await notificationEvents.newMessage(userId, partnerName, 'You have a new match! Say hi');
      await notificationEvents.newMessage(targetUserId, responderName, 'You have a new match! Say hi');
    }

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

    // Locked chats stay listed (the user knows the match) but carry no message
    // text; unreadCount still shows that something is waiting
    const access = await getChatAccess(userId);

    const conversations = result.rows.map((row: any) => {
      const locked = access.isLocked(row.match_id);
      return {
        matchId: row.match_id,
        partnerId: row.partner_id,
        partnerName: row.partner_name,
        partnerPhotoUrl: row.partner_photo_url || undefined,
        partnerThumbnailUrl: row.partner_thumbnail_url || undefined,
        lastMessage: !locked && row.last_message_content
          ? decryptMessage(row.last_message_content, MESSAGE_ENCRYPTION_KEY)
          : undefined,
        lastMessageAt: row.last_message_at || undefined,
        lastMessageSenderId: row.last_message_sender_id || undefined,
        unreadCount: row.unread_count || 0,
        isActive: row.is_active,
        locked,
      };
    });

    return reply.send({ success: true, data: { conversations } });
  });

  // ─── Unmatch (Delete Conversation) ──────────────────
  // Permanently deletes all messages, media files, and deactivates the match.
  // Both users lose access to the conversation.
  //
  // Deletion order makes the operation atomic from the user's perspective:
  // media files are removed from object storage FIRST, and only if every
  // delete succeeds are the DB records removed. If storage is unreachable,
  // nothing is deleted and the client gets a retryable 503 — S3 DeleteObject
  // is idempotent (deleting a missing key succeeds), so retries are safe.
  app.delete('/conversations/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id: matchId } = request.params;
    const { sub: userId } = request.user as any;

    // Verify the user is part of this active match
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



    // ─── 1. Collect media file keys (read-only) ─────────
    const mediaResult = await query(
      `SELECT cm.url, cm.thumbnail_url FROM ${TABLES.CHAT_MEDIA} cm
       WHERE cm.message_id IN (SELECT id FROM ${TABLES.MESSAGES} WHERE match_id = $1)`,
      [matchId],
    );
    const chatMediaUrls: string[] = [];
    for (const row of mediaResult.rows) {
      if (row.url) chatMediaUrls.push(row.url);
      if (row.thumbnail_url) chatMediaUrls.push(row.thumbnail_url);
    }

    // ─── 2. Delete media files from object storage FIRST ─
    // Any failure aborts the unmatch before a single record is touched.
    try {
      for (const url of chatMediaUrls) {
        const key = chatMediaKeyFromUrl(url);
        if (!key) continue;
        await deleteChatFile(key);
        // Also delete thumbnails for /uploads/ webp files
        if (url.startsWith('/uploads/') && key.endsWith('.webp')) {
          const thumbKey = key.replace('.webp', '_thumb.webp');
          await deleteChatFile(thumbKey);
        }
      }
    } catch (err: any) {
      console.error(`[unmatch] Storage delete failed for match ${matchId}: ${err.message}`);
      return reply.status(503).send({
        success: false,
        error: {
          code: 'STORAGE_BUSY',
          message: 'Server is busy! Please try again in a few moments.',
        },
      });
    }

    // ─── 3. Delete records in a single transaction ───────
    const { user_a_id: userAId, user_b_id: userBId } = matchCheck.rows[0];
    await transaction(async (q) => {
      await q(`DELETE FROM ${TABLES.CHAT_MEDIA} WHERE message_id IN (SELECT id FROM ${TABLES.MESSAGES} WHERE match_id = $1)`, [matchId]);
      await q(`DELETE FROM ${TABLES.MESSAGES} WHERE match_id = $1`, [matchId]);
      await q(`UPDATE ${TABLES.MATCHES} SET is_active = FALSE WHERE id = $1`, [matchId]);
      // Clear the pair's interaction history so both users can organically
      // meet and like again after an unmatch. Without this the UNIQUE
      // (actor_id, target_id) rows lock the pair forever: every future
      // swipe between them 409s and no like can ever be delivered.
      await q(
        `DELETE FROM ${TABLES.USER_INTERACTIONS}
         WHERE (actor_id = $1 AND target_id = $2) OR (actor_id = $2 AND target_id = $1)`,
        [userAId, userBId],
      );
    });

    // Publish unmatch event so partner's realtime client removes the conversation
    publishChatMessage(REDIS_KEYS.CHAT_MESSAGES_CHANNEL, {
      type: 'match:unmatched',
      matchId,
      unmatchedByUserId: userId,
    });

    return reply.send({ success: true, data: { unmatched: true } });
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
    if (await isChatLocked(userId, matchId)) return sendChatLocked(reply);

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
       FROM (
         -- The newest 200, not the oldest: with the limit applied in
         -- ascending order a long chat never showed anything after its
         -- 200th message. The outer ORDER BY keeps the response oldest-first,
         -- which is the order the screen renders.
         SELECT id, match_id, sender_id, content, created_at, read_at
         FROM ${TABLES.MESSAGES}
         WHERE match_id = $1
         ORDER BY created_at DESC
         LIMIT 200
       ) m
       LEFT JOIN ${TABLES.CHAT_MEDIA} cm ON cm.message_id = m.id
       ORDER BY m.created_at ASC`,
      [matchId],
    );

    // Mark unread messages as read. Skipped when the page shows none from
    // the partner, which is most opens and every reconnect resync. A full
    // page (the 200 cap) may hide older unread rows, so it always runs then.
    const mayHaveUnread =
      messages.rows.length >= 200 ||
      messages.rows.some((m: any) => m.sender_id !== userId && m.read_at === null);
    if (mayHaveUnread) {
      await query(
        `UPDATE ${TABLES.MESSAGES} SET read_at = NOW()
         WHERE match_id = $1 AND sender_id != $2 AND read_at IS NULL`,
        [matchId, userId],
      );
    }

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

    // Verify user is part of this match. The lock check and the sender's
    // name are read-only and independent of it, so the three round trips
    // overlap instead of queueing; the decisions below are made in the
    // same order as before.
    const [matchCheck, senderLocked, senderResult] = await Promise.all([
      query(
        `SELECT id, user_a_id, user_b_id FROM ${TABLES.MATCHES}
         WHERE id = $1 AND (user_a_id = $2 OR user_b_id = $2) AND is_active = TRUE`,
        [matchId, userId],
      ),
      isChatLocked(userId, matchId),
      query(`SELECT display_name FROM ${TABLES.USERS} WHERE id = $1`, [userId]),
    ]);
    if (!matchCheck.rows[0]) {
      return reply.status(404).send({
        success: false,
        error: { code: ERROR_CODES.NOT_FOUND, message: 'Match not found or inactive' },
      });
    }
    if (senderLocked) return sendChatLocked(reply);

    const plainContent = content.trim();
    const encryptedContent = encryptMessage(plainContent, MESSAGE_ENCRYPTION_KEY);

    // The partner's lock state only feeds the push preview and needs nothing
    // from the insert, so it is fetched while the insert runs.
    const matchRow = matchCheck.rows[0];
    const partnerId = matchRow.user_a_id === userId ? matchRow.user_b_id : matchRow.user_a_id;
    const [result, partnerLocked] = await Promise.all([
      query(
        `INSERT INTO ${TABLES.MESSAGES} (match_id, sender_id, content)
         VALUES ($1, $2, $3) RETURNING *`,
        [matchId, userId, encryptedContent],
      ),
      isChatLocked(partnerId, matchId),
    ]);
    const message = result.rows[0];

    // Publish to Redis pub/sub with PLAINTEXT (clients render plaintext)
    const messagePayload = {
      id: message.id,
      matchId: message.match_id,
      senderId: message.sender_id,
      content: plainContent,
      createdAt: message.created_at,
    };
    // Publish with retry/backoff — this client fails fast on a Redis
    // reconnect blip, which would otherwise silently drop the live broadcast
    publishChatMessage(REDIS_KEYS.CHAT_MESSAGES_CHANNEL, messagePayload);

    // Notify the partner via push
    const senderName = senderResult.rows[0]?.display_name || 'Someone';
    // A partner whose side of this chat is locked gets no message text
    const preview = partnerLocked
      ? LOCKED_MESSAGE_PREVIEW
      : plainContent.length > 80 ? plainContent.slice(0, 80) + '…' : plainContent;

    notificationEvents.newMessage(partnerId, senderName, preview).catch(() => {});

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
              pp.thumbnail_url as partner_thumbnail_url
       FROM ${TABLES.MATCHES} m
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
    if (await isChatLocked(userId, matchId)) return sendChatLocked(reply);

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

    // Busboy silently truncates at the multipart fileSize limit — reject
    // instead of storing a corrupt (cut-off) file
    if ((file.file as any).truncated) {
      return reply.status(400).send({
        success: false,
        error: { code: 'FILE_TOO_LARGE', message: 'File too large. Max 10MB.' },
      });
    }

    const fileId = uuidv4();

    // Save to storage
    let url: string;
    let thumbnailUrl: string | null = null;

    if (mediaType === 'image') {
      const saved = await savePhoto(userId, fileBuffer, mimeType, { lossless: false });
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

    // Publish with retry/backoff — this client fails fast on a Redis
    // reconnect blip, which would otherwise silently drop the live broadcast
    publishChatMessage(REDIS_KEYS.CHAT_MESSAGES_CHANNEL, messagePayload);

    // Notify the partner
    const matchRow = matchCheck.rows[0];
    const partnerId = matchRow.user_a_id === userId ? matchRow.user_b_id : matchRow.user_a_id;
    const senderResult = await query(`SELECT display_name FROM ${TABLES.USERS} WHERE id = $1`, [userId]);
    const senderName = senderResult.rows[0]?.display_name || 'Someone';
    const preview = (await isChatLocked(partnerId, matchId))
      ? LOCKED_MESSAGE_PREVIEW
      : mediaType === 'image' ? 'Sent a photo' : `Sent ${mediaType}`;

    notificationEvents.newMessage(partnerId, senderName, preview).catch(() => {});

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
      // Media a match sent lives in that chat, so a locked chat locks it too
      if (await isChatLocked(userId, matchCheck.rows[0].id)) return sendChatLocked(reply);
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

      reply
        .header('Content-Type', contentType)
        .header('Accept-Ranges', 'bytes')
        .header('Cache-Control', 'private, max-age=3600');

      // Byte-range support — iOS AVPlayer requires it for audio/video streaming
      const total = buffer.length;
      const rangeMatch = typeof request.headers.range === 'string'
        ? /^bytes=(\d*)-(\d*)$/.exec(request.headers.range)
        : null;
      if (rangeMatch && (rangeMatch[1] !== '' || rangeMatch[2] !== '')) {
        const start = rangeMatch[1] === ''
          ? Math.max(0, total - parseInt(rangeMatch[2], 10))
          : parseInt(rangeMatch[1], 10);
        const end = rangeMatch[1] !== '' && rangeMatch[2] !== ''
          ? Math.min(parseInt(rangeMatch[2], 10), total - 1)
          : total - 1;
        if (start > end || start >= total) {
          return reply.status(416).header('Content-Range', `bytes */${total}`).send();
        }
        return reply
          .status(206)
          .header('Content-Range', `bytes ${start}-${end}/${total}`)
          .header('Content-Length', String(end - start + 1))
          .send(buffer.subarray(start, end + 1));
      }

      return reply.header('Content-Length', String(total)).send(buffer);
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

    // Opening view-once media is reading the chat: refuse it in a locked chat
    // before anything is marked viewed
    const owning = await query(
      `SELECT msg.match_id FROM ${TABLES.CHAT_MEDIA} cm
       JOIN ${TABLES.MESSAGES} msg ON msg.id = cm.message_id
       WHERE cm.id = $1`,
      [mediaId],
    );
    if (owning.rows[0] && (await isChatLocked(userId, owning.rows[0].match_id))) {
      return sendChatLocked(reply);
    }

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
      publishChatMessage(REDIS_KEYS.CHAT_MESSAGES_CHANNEL, {
        type: 'media:viewed',
        matchId: matchIdForEvent,
        mediaId,
        viewedAt: new Date().toISOString(),
      });
    }

    return reply.send({
      success: true,
      data: { viewedAt: new Date().toISOString() },
    });
  });

  // ─── Get Date Planner Data ─────────────────────────────
  // Returns the collaborative planner data (activities, todos, notes) for
  // a match. Both users share the same planner — changes are synced live
  // via the planner:update socket event.
  app.get('/:id/planner', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id: matchId } = request.params;
    const { sub: userId } = request.user as any;
    // Part of the conversation, so a locked chat locks it too
    if (await isChatLocked(userId, matchId)) return sendChatLocked(reply);

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

    const result = await query(
      `SELECT planner_data FROM ${TABLES.MATCHES} WHERE id = $1`,
      [matchId],
    );
    const plannerData = result.rows[0]?.planner_data || null;

    return reply.send({ success: true, data: { plannerData } });
  });

  // ─── Update Date Planner Data ──────────────────────────
  // Saves the collaborative planner data and notifies the partner via
  // the planner:update socket event so their open DM reflects changes
  // in real time.
  app.put('/:id/planner', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;
    const { id: matchId } = request.params;
    const { plannerData } = request.body as { plannerData?: any };
    // Part of the conversation, so a locked chat locks it too
    if (await isChatLocked(userId, matchId)) return sendChatLocked(reply);

    if (!plannerData || typeof plannerData !== 'object') {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'plannerData object is required' },
      });
    }

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

    await query(
      `UPDATE ${TABLES.MATCHES} SET planner_data = $1 WHERE id = $2`,
      [JSON.stringify(plannerData), matchId],
    );

    // Notify the partner in real time
    publishChatMessage(REDIS_KEYS.CHAT_MESSAGES_CHANNEL, {
      type: 'planner:update',
      matchId,
      plannerData,
      updatedByUserId: userId,
    });

    return reply.send({ success: true, data: { plannerData } });
  });

  // ─── Fix a Date ──────────────────────────────────────
  // Stores a date both users have agreed on for their meet-up (the DM
  // "fix a date" flow). The date is a plain YYYY-MM-DD (the sender's local
  // calendar day) so both ends display the same day regardless of timezone.
  // The row is kept after the date passes — the client treats a date before
  // "today" as expired and stops showing the pinned banner.
  app.put('/:id/date', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;
    const { id: matchId } = request.params;
    const { date } = request.body as { date?: string };
    // Part of the conversation, so a locked chat locks it too
    if (await isChatLocked(userId, matchId)) return sendChatLocked(reply);

    // Validate YYYY-MM-DD format AND that it is a real calendar date
    // (e.g. 2026-02-31 is rejected even though it matches the regex)
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'date (YYYY-MM-DD) is required' },
      });
    }
    const [y, m, d] = date.split('-').map(Number);
    const parsed = new Date(Date.UTC(y, m - 1, d));
    if (
      parsed.getUTCFullYear() !== y ||
      parsed.getUTCMonth() !== m - 1 ||
      parsed.getUTCDate() !== d
    ) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'date is not a valid calendar date' },
      });
    }

    // Verify the user is part of this active match
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

    const result = await query(
      `UPDATE ${TABLES.MATCHES} SET date_scheduled = $1::date
       WHERE id = $2
       RETURNING to_char(date_scheduled, 'YYYY-MM-DD') as date_scheduled`,
      [date, matchId],
    );
    const dateScheduled = result.rows[0]?.date_scheduled || null;

    // Live-update the partner's open DM via the chat room
    publishChatMessage(REDIS_KEYS.CHAT_MESSAGES_CHANNEL, {
      type: 'date:set',
      matchId,
      dateScheduled,
      setByUserId: userId,
    });

    return reply.send({ success: true, data: { dateScheduled } });
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
              v.name as venue_name,
              v.address as venue_address,
              v.category as venue_category,
              v.image_url as venue_image_url
       FROM ${TABLES.MATCHES} m
       LEFT JOIN ${TABLES.RESERVATIONS} r ON r.match_id = m.id
       LEFT JOIN ${TABLES.VENUES} v ON r.venue_id = v.id
       JOIN ${TABLES.USERS} u ON u.id = CASE WHEN m.user_a_id = $1 THEN m.user_b_id ELSE m.user_a_id END
       LEFT JOIN ${TABLES.PROFILE_PHOTOS} pp ON pp.user_id = u.id AND pp.is_primary = TRUE
       WHERE m.id = $1 AND (m.user_a_id = $2 OR m.user_b_id = $2)`,
      [id, userId],
    );

    const row = result.rows[0];
    if (!row) {
      return reply.status(404).send({
        success: false,
        error: { code: ERROR_CODES.NOT_FOUND, message: 'Match not found' },
      });
    }

    // Expose the scheduled date as a clean YYYY-MM-DD (it is stored at
    // midnight UTC; slicing the ISO keeps the calendar day exact)
    return reply.send({
      success: true,
      data: {
        ...row,
        dateScheduled: row.date_scheduled
          ? new Date(row.date_scheduled).toISOString().slice(0, 10)
          : null,
      },
    });
  });
}

// ─── Helper: Get-or-create the active match for a pair ────
// Insert an active match, or return the existing one. Backed by the
// uniq_matches_active_pair partial unique index (order-insensitive on the
// pair, active rows only), so two racing mutual-like requests can no longer
// create duplicate active matches.
/**
 * Check if a user has hit their active match (chat) limit.
 * Free users are limited to FREE_CHAT_LIMIT (3) active matches.
 * Premium users have unlimited matches.
 * Returns { allowed: boolean, activeCount: number, limit: number }.
 */
// knownTier: pass the caller's already-loaded tier to skip a redundant read.
async function checkChatLimit(userId: string, knownTier?: string): Promise<{ allowed: boolean; activeCount: number; limit: number }> {
  let tier = knownTier;
  if (!tier) {
    const subResult = await query(
      `SELECT tier FROM ${TABLES.SUBSCRIPTION_LEDGER} WHERE user_id = $1`,
      [userId],
    );
    tier = subResult.rows[0]?.tier || 'free';
  }

  if (tier !== 'free') {
    return { allowed: true, activeCount: 0, limit: PREMIUM_CHAT_LIMIT };
  }

  const countResult = await query(
    `SELECT COUNT(*)::int as cnt FROM ${TABLES.MATCHES}
     WHERE is_active = TRUE AND (user_a_id = $1 OR user_b_id = $1)`,
    [userId],
  );
  const activeCount = countResult.rows[0]?.cnt ?? 0;

  return {
    allowed: activeCount < FREE_CHAT_LIMIT,
    activeCount,
    limit: FREE_CHAT_LIMIT,
  };
}

async function getOrCreateActiveMatch(
  userAId: string,
  userBId: string,
): Promise<{ match: any | null; created: boolean }> {
  const inserted = await query(
    `INSERT INTO ${TABLES.MATCHES} (user_a_id, user_b_id, is_active)
     VALUES ($1, $2, TRUE)
     ON CONFLICT ((LEAST(user_a_id, user_b_id)), (GREATEST(user_a_id, user_b_id)))
     WHERE is_active = TRUE
     DO NOTHING
     RETURNING *`,
    [userAId, userBId],
  );
  if (inserted.rows[0]) {
    return { match: inserted.rows[0], created: true };
  }
  const existing = await query(
    `SELECT * FROM ${TABLES.MATCHES}
     WHERE is_active = TRUE
       AND ((user_a_id = $1 AND user_b_id = $2) OR (user_a_id = $2 AND user_b_id = $1))`,
    [userAId, userBId],
  );
  return { match: existing.rows[0] ?? null, created: false };
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
    publishChatMessage(REDIS_KEYS.CHAT_MESSAGES_CHANNEL, messagePayload);

    console.log(`[OpeningLine] Sent to match ${matchId} (category: ${category}): "${openingLine.slice(0, 50)}..."`);
  } catch (err) {
    // Non-critical — match already created, opening line is best-effort
    console.error('[OpeningLine] Failed to send opening line:', err);
  }
}

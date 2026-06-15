import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ERROR_CODES, geoToH3 } from '@kinetik/shared';
import { query, TABLES, findUserById, updateUser, getPreferences, upsertPreferences } from '../services/database';
import { kafkaProducer } from '../services/kafka';

const UpdateProfileSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  dateOfBirth: z.string().optional(),
  gender: z.enum(['male', 'female', 'non_binary', 'other', 'prefer_not_to_say']).optional(),
  pronouns: z.string().max(50).optional(),
  bio: z.string().max(500).optional(),
  occupation: z.string().max(100).optional(),
  education: z.string().max(255).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

const PreferencesSchema = z.object({
  ageMin: z.number().min(18).max(120).optional(),
  ageMax: z.number().min(18).max(120).optional(),
  maxDistanceKm: z.number().min(1).max(500).optional(),
  preferredGenders: z.array(z.enum(['male', 'female', 'non_binary', 'other', 'prefer_not_to_say'])).optional(),
  valuesAmbition: z.number().min(0).max(1).optional(),
  valuesSocial: z.number().min(0).max(1).optional(),
  valuesAdventure: z.number().min(0).max(1).optional(),
  valuesTradition: z.number().min(0).max(1).optional(),
  valuesIntellect: z.number().min(0).max(1).optional(),
  valuesEmotional: z.number().min(0).max(1).optional(),
  weightAge: z.number().min(0).max(1).optional(),
  weightDistance: z.number().min(0).max(1).optional(),
  weightValues: z.number().min(0).max(1).optional(),
  weightInterests: z.number().min(0).max(1).optional(),
  commStyleDirect: z.number().min(0).max(1).optional(),
  commStylePlayful: z.number().min(0).max(1).optional(),
  commStyleDeep: z.number().min(0).max(1).optional(),
});

const LocationUpdateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export async function userRoutes(app: FastifyInstance) {
  // All routes require authentication
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

  // ─── Get Profile ─────────────────────────────────────
  app.get('/profile', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;
    const user = await findUserById(userId);
    if (!user) {
      return reply.status(404).send({
        success: false,
        error: { code: ERROR_CODES.NOT_FOUND, message: 'User not found' },
      });
    }

    return reply.send({
      success: true,
      data: {
        id: user.id,
        phone: user.phone,
        email: user.email,
        displayName: user.display_name,
        dateOfBirth: user.date_of_birth,
        gender: user.gender,
        pronouns: user.pronouns,
        bio: user.bio,
        occupation: user.occupation,
        education: user.education,
        isVerified: user.is_verified,
        kycStatus: user.kyc_status,
        latitude: user.latitude,
        longitude: user.longitude,
        h3Index: user.h3_index,
        onboardingComplete: user.onboarding_complete,
        onboardingStep: user.onboarding_step,
        primaryPhoto: user.primary_photo_url ? {
          url: user.primary_photo_url,
          thumbnailUrl: user.primary_thumbnail_url,
        } : null,
      },
    });
  });

  // ─── Update Profile ──────────────────────────────────
  app.put('/profile', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;
    const validation = UpdateProfileSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid input',
          details: validation.error.flatten(),
        },
      });
    }

    const data = validation.data;
    const updateData: Record<string, any> = {};
    const fieldMap: Record<string, string> = {
      displayName: 'display_name',
      dateOfBirth: 'date_of_birth',
      gender: 'gender',
      pronouns: 'pronouns',
      bio: 'bio',
      occupation: 'occupation',
      education: 'education',
      latitude: 'latitude',
      longitude: 'longitude',
    };

    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        updateData[fieldMap[key] || key] = value;
      }
    }

    const updated = await updateUser(userId, updateData);

    await kafkaProducer.sendUserEvent({
      type: 'profile.updated',
      payload: { userId, ...updateData },
    });

    return reply.send({ success: true, data: updated });
  });

  // ─── Get Preferences ─────────────────────────────────
  app.get('/preferences', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;
    const prefs = await getPreferences(userId);

    if (!prefs) {
      return reply.send({
        success: true,
        data: {
          ageMin: 18, ageMax: 60, maxDistanceKm: 50,
          preferredGenders: [],
          valuesAmbition: 0.5, valuesSocial: 0.5, valuesAdventure: 0.5,
          valuesTradition: 0.5, valuesIntellect: 0.5, valuesEmotional: 0.5,
          weightAge: 0.5, weightDistance: 0.5, weightValues: 1.0, weightInterests: 0.7,
        },
      });
    }

    return reply.send({ success: true, data: prefs });
  });

  // ─── Update Preferences ──────────────────────────────
  app.put('/preferences', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;
    const validation = PreferencesSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid preferences',
          details: validation.error.flatten(),
        },
      });
    }

    const prefs = await upsertPreferences(userId, validation.data);

    await kafkaProducer.sendUserEvent({
      type: 'preferences.updated',
      payload: { userId, preferences: validation.data },
    });

    return reply.send({ success: true, data: prefs });
  });

  // ─── Update Location ─────────────────────────────────
  app.put('/location', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;
    const validation = LocationUpdateSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid coordinates',
          details: validation.error.flatten(),
        },
      });
    }

    const { latitude, longitude } = validation.data;
    // Compute real H3 index using h3-js at resolution 7
    const h3Index = geoToH3(latitude, longitude, 7);

    await updateUser(userId, {
      latitude,
      longitude,
      h3_index: h3Index,
      location_updated_at: new Date().toISOString(),
    });

    return reply.send({ success: true, data: { latitude, longitude, h3Index } });
  });

  // ─── Get Photos ──────────────────────────────────────
  app.get('/photos', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;
    const result = await query(
      `SELECT id, url, thumbnail_url, blur_hash, is_primary, order_index
       FROM ${TABLES.PROFILE_PHOTOS} WHERE user_id = $1 ORDER BY order_index ASC`,
      [userId],
    );
    return reply.send({ success: true, data: result.rows });
  });

  // ─── Get Interests ───────────────────────────────────
  app.get('/interests', async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await query(
      `SELECT id, name, category, emoji FROM ${TABLES.INTERESTS} ORDER BY category, name`,
    );
    return reply.send({ success: true, data: result.rows });
  });
}

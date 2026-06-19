import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ERROR_CODES, ONBOARDING_STEPS } from '@kinetik/shared';
import { updateUser, findUserById } from '../services/database';
import { getRedis } from '../services/redis';
import { syncVectorForUser } from '../services/vectorService';

const OnboardingStepSchema = z.object({
  step: z.enum(ONBOARDING_STEPS as any),
  data: z.record(z.unknown()).optional(),
});

export async function onboardingRoutes(app: FastifyInstance) {
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

  // ─── Get Onboarding Status ───────────────────────────
  app.get('/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;
    const user = await findUserById(userId);

    return reply.send({
      success: true,
      data: {
        complete: user?.onboarding_complete || false,
        currentStep: user?.onboarding_step || 'splash',
        steps: ONBOARDING_STEPS,
      },
    });
  });

  // ─── Update Onboarding Step ──────────────────────────
  app.post('/step', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;
    const validation = OnboardingStepSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid step',
          details: validation.error.flatten(),
        },
      });
    }

    const { step, data } = validation.data;
    const currentIndex = ONBOARDING_STEPS.indexOf(step);
    const isComplete = step === 'complete' || currentIndex >= ONBOARDING_STEPS.length - 1;

    await updateUser(userId, {
      onboarding_step: step,
      onboarding_complete: isComplete,
    });

    // Cache step data in Redis if provided
    if (data) {
      const redis = getRedis();
      await redis.set(
        `onboarding:${userId}:${step}`,
        JSON.stringify(data),
        'EX',
        86400, // 24 hours
      );
    }

    // When onboarding completes, trigger vector computation for the user.
    // The user has likely set preferences by this point, so the vector
    // will include meaningful values. Fail-safe: errors are logged internally.
    if (isComplete) {
      syncVectorForUser(userId).catch((err) =>
        console.error('[vector] syncVectorForUser failed for user', userId, err)
      );
    }

    return reply.send({
      success: true,
      data: {
        step,
        complete: isComplete,
        nextStep: !isComplete ? ONBOARDING_STEPS[currentIndex + 1] : null,
      },
    });
  });
}

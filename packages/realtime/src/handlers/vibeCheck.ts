import { Namespace, Socket } from 'socket.io';
import { Redis } from 'ioredis';
import {
  WsEvent,
  REDIS_KEYS,
  VIBE_CHECK_DURATION_SECONDS,
  VIBE_CHECK_SILHOUETTE_PHASE_SECONDS,
  VIBE_CHECK_BLUR_PHASE_SECONDS,
  VIBE_CHECK_REVEAL_PHASE_SECONDS,
  VIBE_CHECK_DECISION_TIMEOUT_SECONDS,
} from '@kinetik/shared';

interface ActiveVibeCheck {
  id: string;
  userAId: string;
  userBId: string;
  phase: 'silhouette' | 'blurred' | 'revealed' | 'decision';
  startTime: number;
  decisionA: boolean | null;
  decisionB: boolean | null;
  timer: NodeJS.Timeout | null;
}

export class VibeCheckHandler {
  private activeChecks: Map<string, ActiveVibeCheck> = new Map();

  constructor(
    private nsp: Namespace,
    private pubClient: Redis,
  ) {
    this.setupListeners();
  }

  private setupListeners() {
    this.nsp.on('connection', (socket: Socket) => {
      const userId = (socket as any).userId;
      console.log(`[VibeCheck] User ${userId} connected`);

      // Join personal room for vibe events
      socket.join(`user:${userId}`);

      // Start vibe check
      socket.on('vibe:start', async (data: { vibeId: string; partnerId: string }) => {
        const { vibeId, partnerId } = data;

        // Create active vibe check
        const check: ActiveVibeCheck = {
          id: vibeId,
          userAId: userId,
          userBId: partnerId,
          phase: 'silhouette',
          startTime: Date.now(),
          decisionA: null,
          decisionB: null,
          timer: null,
        };

        this.activeChecks.set(vibeId, check);

        // Store in Redis
        await this.pubClient.set(
          REDIS_KEYS.VIBE_CHECK(vibeId),
          JSON.stringify({ id: vibeId, userAId: userId, userBId: partnerId, phase: 'silhouette', startedAt: Date.now() }),
          'EX',
          300, // 5 minutes
        );

        // Notify both users
        this.nsp.to(`user:${userId}`).emit(WsEvent.VIBE_START, { vibeId, phase: 'silhouette', duration: VIBE_CHECK_SILHOUETTE_PHASE_SECONDS });
        this.nsp.to(`user:${partnerId}`).emit(WsEvent.VIBE_START, { vibeId, phase: 'silhouette', duration: VIBE_CHECK_SILHOUETTE_PHASE_SECONDS });

        // Start phase progression
        this.startPhaseProgression(vibeId);
      });

      // Audio toggle
      socket.on(WsEvent.VIBE_AUDIO_TOGGLE, (data: { vibeId: string; muted: boolean }) => {
        const check = this.activeChecks.get(data.vibeId);
        if (!check) return;

        const partnerId = check.userAId === userId ? check.userBId : check.userAId;
        this.nsp.to(`user:${partnerId}`).emit(WsEvent.VIBE_AUDIO_TOGGLE, {
          vibeId: data.vibeId,
          partnerMuted: data.muted,
        });
      });

      // Decision (Lock It In / Pass)
      socket.on(WsEvent.VIBE_DECISION, async (data: { vibeId: string; decision: 'lock' | 'pass' }) => {
        const check = this.activeChecks.get(data.vibeId);
        if (!check) return;

        if (userId === check.userAId) {
          check.decisionA = data.decision === 'lock';
        } else if (userId === check.userBId) {
          check.decisionB = data.decision === 'lock';
        }

        // Notify partner of decision
        const partnerId = check.userAId === userId ? check.userBId : check.userAId;
        this.nsp.to(`user:${partnerId}`).emit(WsEvent.VIBE_PARTNER_DECISION, {
          vibeId: data.vibeId,
          decisionMade: true,
        });

        // Check if both have decided
        if (check.decisionA !== null && check.decisionB !== null) {
          this.resolveVibeCheck(check);
        }
      });

      socket.on('disconnect', () => {
        console.log(`[VibeCheck] User ${userId} disconnected`);
        // Find and clean up any active vibe check for this user
        for (const [vibeId, check] of this.activeChecks) {
          if (check.userAId === userId || check.userBId === userId) {
            if (check.timer) clearTimeout(check.timer);
            this.nsp.to(`user:${check.userAId}`).emit(WsEvent.VIBE_END, { vibeId, reason: 'disconnect' });
            this.nsp.to(`user:${check.userBId}`).emit(WsEvent.VIBE_END, { vibeId, reason: 'disconnect' });
            this.activeChecks.delete(vibeId);
          }
        }
      });
    });
  }

  private startPhaseProgression(vibeId: string) {
    const check = this.activeChecks.get(vibeId);
    if (!check) return;

    // Phase 1: Silhouette (0-60s) -> Phase 2: Blurred (60-120s)
    setTimeout(() => {
      check.phase = 'blurred';
      this.broadcastPhase(check, 'blurred', VIBE_CHECK_BLUR_PHASE_SECONDS);
      this.updateRedisPhase(vibeId, 'blurred');
    }, VIBE_CHECK_SILHOUETTE_PHASE_SECONDS * 1000);

    // Phase 2: Blurred (60-120s) -> Phase 3: Revealed (120-180s)
    setTimeout(() => {
      check.phase = 'revealed';
      this.broadcastPhase(check, 'revealed', VIBE_CHECK_REVEAL_PHASE_SECONDS);
      this.updateRedisPhase(vibeId, 'revealed');
    }, (VIBE_CHECK_SILHOUETTE_PHASE_SECONDS + VIBE_CHECK_BLUR_PHASE_SECONDS) * 1000);

    // Phase 3: Revealed -> Decision (180s)
    const decisionTimer = setTimeout(() => {
      check.phase = 'decision';
      this.broadcastPhase(check, 'decision', VIBE_CHECK_DECISION_TIMEOUT_SECONDS);
      this.updateRedisPhase(vibeId, 'decision');

      // Auto-end after decision timeout
      const endTimer = setTimeout(() => {
        this.resolveVibeCheck(check, true);
      }, VIBE_CHECK_DECISION_TIMEOUT_SECONDS * 1000);

      check.timer = endTimer;
    }, (VIBE_CHECK_SILHOUETTE_PHASE_SECONDS + VIBE_CHECK_BLUR_PHASE_SECONDS + VIBE_CHECK_REVEAL_PHASE_SECONDS) * 1000);
  }

  private broadcastPhase(check: ActiveVibeCheck, phase: string, duration: number) {
    this.nsp.to(`user:${check.userAId}`).emit(WsEvent.VIBE_PHASE_CHANGE, {
      vibeId: check.id,
      phase,
      duration,
    });
    this.nsp.to(`user:${check.userBId}`).emit(WsEvent.VIBE_PHASE_CHANGE, {
      vibeId: check.id,
      phase,
      duration,
    });
  }

  private updateRedisPhase(vibeId: string, phase: string) {
    this.pubClient.get(REDIS_KEYS.VIBE_CHECK(vibeId)).then((data) => {
      if (data) {
        const check = JSON.parse(data);
        check.phase = phase;
        this.pubClient.set(REDIS_KEYS.VIBE_CHECK(vibeId), JSON.stringify(check), 'EX', 300);
      }
    });
  }

  private resolveVibeCheck(check: ActiveVibeCheck, timeout: boolean = false) {
    if (check.timer) clearTimeout(check.timer);

    const mutualLock = check.decisionA === true && check.decisionB === true;
    const result = timeout ? { mutualLock: false, reason: 'timeout' }
      : mutualLock ? { mutualLock: true, reason: 'mutual' }
      : { mutualLock: false, reason: 'no_match' };

    this.nsp.to(`user:${check.userAId}`).emit(WsEvent.VIBE_END, {
      vibeId: check.id,
      ...result,
      partnerDecision: check.decisionB,
    });
    this.nsp.to(`user:${check.userBId}`).emit(WsEvent.VIBE_END, {
      vibeId: check.id,
      ...result,
      partnerDecision: check.decisionA,
    });

    if (mutualLock) {
      this.nsp.to(`user:${check.userAId}`).emit(WsEvent.MATCH_SUCCESS, {
        vibeId: check.id,
        partnerId: check.userBId,
      });
      this.nsp.to(`user:${check.userBId}`).emit(WsEvent.MATCH_SUCCESS, {
        vibeId: check.id,
        partnerId: check.userAId,
      });
    }

    // Cleanup
    this.pubClient.del(REDIS_KEYS.VIBE_CHECK(check.id));
    this.pubClient.del(REDIS_KEYS.VIBE_CHECK_USER(check.userAId));
    this.pubClient.del(REDIS_KEYS.VIBE_CHECK_USER(check.userBId));
    this.activeChecks.delete(check.id);
  }
}

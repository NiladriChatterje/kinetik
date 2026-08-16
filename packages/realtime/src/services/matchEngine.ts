import { Redis } from 'ioredis';
import { gridDisk } from 'h3-js';
import { randomUUID } from 'crypto';
import {
  query,
  TABLES,
  REDIS_KEYS,
  EVENT_BUS_CHANNELS,
  VIBE_CHECK_DURATION_SECONDS,
} from '@kinetik/shared';

// Ported from packages/match-engine-py — purely spatial, no ML scoring:
// candidates are the nearby (H3) users in the same window, picked at random.
//
// Trigger model is event-driven, not polling: a match attempt runs when a
// user joins a window (window.joined). A retry sweep exists ONLY while at
// least one window is being tracked — it re-attempts users whose join-time
// attempt found no partner yet — and stops itself when every tracked window
// has ended. When no window is active this module does zero work.

const IN_PROGRESS_TTL_S = 30;     // per-user match lock (self-heals on crash)
const VIBE_ACTIVE_TTL_S = 300;    // "in a vibe check" marker — frees the user after 5 min
const SWEEP_INTERVAL_MS = 45_000;
const SWEEP_PARTICIPANT_CAP = 200; // bound per-window work per sweep

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export class MatchEngine {
  private trackedWindows = new Set<string>();
  private sweepTimer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(
    private redis: Redis,          // main Redis (H3 queues, locks)
    private eventBusPub: Redis,    // event-bus Redis, publish-capable connection
  ) {}

  /** Entry point — called from the event-bus subscriber on window.joined. */
  onWindowJoined(windowId: string, userId: string): void {
    this.trackedWindows.add(windowId);
    this.ensureSweep();
    this.tryMatchUser(windowId, userId).catch((err) => {
      console.error(`[MatchEngine] match attempt failed for ${userId}:`, err?.message || err);
    });
  }

  stop(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  // ── Retry sweep (runs only while a window is live) ─────────────

  private ensureSweep(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      this.sweep().catch((err) => console.error('[MatchEngine] sweep failed:', err?.message || err));
    }, SWEEP_INTERVAL_MS);
  }

  private async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      for (const windowId of [...this.trackedWindows]) {
        const win = await query(
          `SELECT id FROM ${TABLES.FLASH_WINDOWS}
           WHERE id = $1 AND status IN ('scheduled', 'active') AND ends_at > NOW()`,
          [windowId],
        );
        if (!win.rows[0]) {
          this.trackedWindows.delete(windowId);
          continue;
        }

        const participants = await query(
          `SELECT user_id FROM ${TABLES.WINDOW_PARTICIPANTS}
           WHERE window_id = $1 AND is_active = TRUE LIMIT ${SWEEP_PARTICIPANT_CAP}`,
          [windowId],
        );
        for (const row of shuffle(participants.rows)) {
          await this.tryMatchUser(windowId, row.user_id);
        }
      }
    } finally {
      this.sweeping = false;
      // Nothing left to watch — stop the timer entirely until the next join
      if (this.trackedWindows.size === 0) this.stop();
    }
  }

  // ── Core matching (spatial + random, mirrors the Python worker) ─

  private async tryMatchUser(windowId: string, userId: string): Promise<void> {
    // Already in a vibe check — skip
    if (await this.redis.exists(REDIS_KEYS.VIBE_CHECK_USER(userId))) return;

    // Atomic per-user lock — also makes concurrent instances/events safe
    const locked = await this.redis.set(
      REDIS_KEYS.MATCH_IN_PROGRESS(userId), '1', 'EX', IN_PROGRESS_TTL_S, 'NX',
    );
    if (!locked) return;

    try {
      const userRow = await query(
        `SELECT h3_index FROM ${TABLES.USERS} WHERE id = $1`, [userId],
      );
      const h3Index: string | null = userRow.rows[0]?.h3_index || null;
      if (!h3Index) return;

      // Adaptive search radius: dense window → own cell; sparse → wide ring
      const countRes = await query(
        `SELECT COUNT(*)::int AS c FROM ${TABLES.WINDOW_PARTICIPANTS}
         WHERE window_id = $1 AND is_active = TRUE`,
        [windowId],
      );
      const density: number = countRes.rows[0]?.c ?? 0;
      const radius = density > 500 ? 0 : density > 100 ? 1 : density > 20 ? 2 : 3;

      // Candidates from the H3 cell queues (single SUNION over the disk)
      const cells = gridDisk(h3Index, radius);
      const queued = await this.redis.sunion(...cells.map((c) => REDIS_KEYS.H3_QUEUE(c)));
      const candidateIds = queued.filter((id) => id !== userId);
      if (candidateIds.length === 0) return;

      // H3 queues are global — keep only active participants of THIS window
      const valid = await query(
        `SELECT wp.user_id, u.h3_index
         FROM ${TABLES.WINDOW_PARTICIPANTS} wp
         JOIN ${TABLES.USERS} u ON u.id = wp.user_id
         WHERE wp.window_id = $1 AND wp.is_active = TRUE AND wp.user_id = ANY($2)`,
        [windowId, candidateIds],
      );
      if (valid.rows.length === 0) return;

      // Drop candidates already in a vibe check (one pipelined round-trip)
      const pipeline = this.redis.pipeline();
      valid.rows.forEach((r: any) => pipeline.exists(REDIS_KEYS.VIBE_CHECK_USER(r.user_id)));
      const flags = await pipeline.exec();
      const free = valid.rows.filter((_: any, i: number) => flags?.[i]?.[1] === 0);
      if (free.length === 0) return;

      // Random pick; lock the partner too so no one else matches them meanwhile
      let partner: any = null;
      for (const cand of shuffle(free)) {
        const ok = await this.redis.set(
          REDIS_KEYS.MATCH_IN_PROGRESS(cand.user_id), '1', 'EX', IN_PROGRESS_TTL_S, 'NX',
        );
        if (ok) { partner = cand; break; }
      }
      if (!partner) return;

      try {
        const vibeId = randomUUID();
        await query(
          `INSERT INTO ${TABLES.VIBE_CHECKS}
             (id, window_id, user_a_id, user_b_id, status, started_at, call_duration_seconds)
           VALUES ($1, $2, $3, $4, 'pending', NOW(), $5)`,
          [vibeId, windowId, userId, partner.user_id, VIBE_CHECK_DURATION_SECONDS],
        );

        // Mark both users busy BEFORE releasing the locks; TTL frees them
        // automatically if the vibe check never completes
        await this.redis.set(REDIS_KEYS.VIBE_CHECK_USER(userId), vibeId, 'EX', VIBE_ACTIVE_TTL_S);
        await this.redis.set(REDIS_KEYS.VIBE_CHECK_USER(partner.user_id), vibeId, 'EX', VIBE_ACTIVE_TTL_S);

        // Out of the matching queues
        await this.redis.srem(REDIS_KEYS.H3_QUEUE(h3Index), userId);
        if (partner.h3_index) {
          await this.redis.srem(REDIS_KEYS.H3_QUEUE(partner.h3_index), partner.user_id);
        }

        // Every realtime instance (this one included) receives this via the
        // event bus and routes MATCH_FOUND to both users' vibe-check rooms
        const timestamp = new Date().toISOString();
        await this.eventBusPub.publish(EVENT_BUS_CHANNELS.MATCH_EVENTS, JSON.stringify({
          type: 'match.found',
          payload: { vibeId, userAId: userId, userBId: partner.user_id, windowId, timestamp },
          timestamp,
        }));

        console.log(`[MatchEngine] Match found — ${userId} <-> ${partner.user_id} (vibe=${vibeId})`);
      } finally {
        await this.redis.del(REDIS_KEYS.MATCH_IN_PROGRESS(partner.user_id)).catch(() => {});
      }
    } finally {
      await this.redis.del(REDIS_KEYS.MATCH_IN_PROGRESS(userId)).catch(() => {});
    }
  }
}

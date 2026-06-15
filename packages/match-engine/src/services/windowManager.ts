import { Redis } from 'ioredis';
import { Pool } from 'pg';
import { REDIS_KEYS } from '@kinetik/shared';

export class WindowManager {
  private activeWindows: Map<string, { id: string; startedAt: number; expiresAt: number }> = new Map();

  constructor(
    private redis: Redis,
    private pool: Pool,
  ) {}

  /**
   * Activate a flash window - moves participants into the matching pool
   */
  async activateWindow(windowId: string): Promise<void> {
    // Update window status in DB
    await this.pool.query(
      `UPDATE flash_windows SET status = 'active' WHERE id = $1`,
      [windowId],
    );

    // Get all participants
    const participants = await this.pool.query(
      `SELECT user_id FROM window_participants WHERE window_id = $1 AND is_active = TRUE`,
      [windowId],
    );

    // Add participants to Redis match pool
    if (participants.rows.length > 0) {
      const userIds = participants.rows.map((r: any) => r.user_id);
      await this.redis.sadd(REDIS_KEYS.MATCH_POOL(windowId), ...userIds);
      await this.redis.expire(REDIS_KEYS.MATCH_POOL(windowId), 3600);

      // Also add to individual H3 queues
      for (const { user_id } of participants.rows) {
        const user = await this.pool.query(
          `SELECT h3_index FROM users WHERE id = $1`,
          [user_id],
        );
        if (user.rows[0]?.h3_index) {
          await this.redis.sadd(REDIS_KEYS.H3_QUEUE(user.rows[0].h3_index), user_id);
        }
      }
    }

    // Track active window
    const expiresAt = Date.now() + 30 * 60 * 1000; // 30 minutes
    this.activeWindows.set(windowId, {
      id: windowId,
      startedAt: Date.now(),
      expiresAt,
    });

    console.log(`[WindowManager] Activated window ${windowId} with ${participants.rows.length} participants`);
  }

  /**
   * Close a flash window - clean up participants and queues
   */
  async closeWindow(windowId: string): Promise<void> {
    // Update DB status
    await this.pool.query(
      `UPDATE flash_windows SET status = 'closed' WHERE id = $1`,
      [windowId],
    );

    // Clean up Redis queues
    await this.redis.del(REDIS_KEYS.MATCH_POOL(windowId));
    await this.redis.del(REDIS_KEYS.WINDOW_PARTICIPANTS(windowId));
    await this.redis.del(REDIS_KEYS.WINDOW_STATE(windowId));

    // Remove from active tracking
    this.activeWindows.delete(windowId);

    console.log(`[WindowManager] Closed window ${windowId}`);
  }

  /**
   * Get number of active windows
   */
  getActiveWindowCount(): number {
    return this.activeWindows.size;
  }
}

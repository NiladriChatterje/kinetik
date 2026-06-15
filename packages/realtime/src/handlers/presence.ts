import { Namespace, Socket } from 'socket.io';
import { Redis } from 'ioredis';
import { WsEvent, REDIS_KEYS } from '@kinetik/shared';

interface PresenceData {
  userId: string;
  status: 'online' | 'away' | 'busy' | 'offline';
  lastSeen: number;
  currentWindow?: string;
  inVibeCheck?: boolean;
}

export class PresenceHandler {
  private onlineUsers: Map<string, Set<string>> = new Map(); // userId -> Set<socketId>

  constructor(
    private nsp: Namespace,
    private pubClient: Redis,
    private subClient: Redis,
  ) {
    this.setupListeners();
    this.setupPresenceCleanup();
  }

  private setupListeners() {
    this.nsp.on('connection', async (socket: Socket) => {
      const userId = (socket as any).userId;
      console.log(`[Presence] User ${userId} connected (socket: ${socket.id})`);

      // Track online users
      if (!this.onlineUsers.has(userId)) {
        this.onlineUsers.set(userId, new Set());
      }
      this.onlineUsers.get(userId)!.add(socket.id);

      // Update Redis presence
      const presence: PresenceData = {
        userId,
        status: 'online',
        lastSeen: Date.now(),
      };
      await this.pubClient.set(
        REDIS_KEYS.USER_PRESENCE(userId),
        JSON.stringify(presence),
        'EX',
        120, // 2 minutes (refreshed by heartbeat)
      );

      // Join personal room
      socket.join(`user:${userId}`);

      // Broadcast online status
      this.nsp.emit(WsEvent.PRESENCE_UPDATE, { userId, status: 'online' });

      // Update status
      socket.on('presence:status', async (data: { status: 'online' | 'away' | 'busy' }) => {
        const presenceData: PresenceData = {
          userId,
          status: data.status,
          lastSeen: Date.now(),
        };
        await this.pubClient.set(
          REDIS_KEYS.USER_PRESENCE(userId),
          JSON.stringify(presenceData),
          'EX',
          120,
        );
        this.nsp.emit(WsEvent.PRESENCE_UPDATE, { userId, status: data.status });
      });

      // Heartbeat
      socket.on(WsEvent.HEARTBEAT, async () => {
        const heartbeatData: PresenceData = {
          userId,
          status: 'online',
          lastSeen: Date.now(),
        };
        await this.pubClient.set(
          REDIS_KEYS.USER_PRESENCE(userId),
          JSON.stringify(heartbeatData),
          'EX',
          120,
        );
        socket.emit(WsEvent.HEARTBEAT, { timestamp: Date.now() });
      });

      // Disconnect
      socket.on('disconnect', async () => {
        console.log(`[Presence] User ${userId} disconnected (socket: ${socket.id})`);

        const userSockets = this.onlineUsers.get(userId);
        if (userSockets) {
          userSockets.delete(socket.id);
          if (userSockets.size === 0) {
            this.onlineUsers.delete(userId);
            // Set as offline with a short TTL
            const offlineData: PresenceData = {
              userId,
              status: 'offline',
              lastSeen: Date.now(),
            };
            await this.pubClient.set(
              REDIS_KEYS.USER_PRESENCE(userId),
              JSON.stringify(offlineData),
              'EX',
              30,
            );
            this.nsp.emit(WsEvent.PRESENCE_UPDATE, { userId, status: 'offline', lastSeen: Date.now() });
          }
        }
      });
    });

    // Cross-instance presence sync via Redis Pub/Sub
    this.subClient.subscribe('presence:events');
    this.subClient.on('message', (channel, message) => {
      if (channel === 'presence:events') {
        const event = JSON.parse(message);
        this.nsp.emit(WsEvent.PRESENCE_UPDATE, event);
      }
    });
  }

  private setupPresenceCleanup() {
    // Clean up stale presence entries every 5 minutes
    setInterval(async () => {
      try {
        const keys = await this.pubClient.keys('user:*:presence');
        for (const key of keys) {
          const ttl = await this.pubClient.ttl(key);
          if (ttl < 0) {
            await this.pubClient.del(key);
          }
        }
      } catch (err) {
        console.error('[Presence] Cleanup error:', err);
      }
    }, 5 * 60 * 1000);
  }

  // ─── Public Methods ─────────────────────────────────

  async getUserPresence(userId: string): Promise<PresenceData | null> {
    const data = await this.pubClient.get(REDIS_KEYS.USER_PRESENCE(userId));
    return data ? JSON.parse(data) : null;
  }

  async getOnlineUsers(userIds: string[]): Promise<Map<string, PresenceData>> {
    const results = new Map<string, PresenceData>();
    for (const userId of userIds) {
      const presence = await this.getUserPresence(userId);
      if (presence && presence.status !== 'offline') {
        results.set(userId, presence);
      }
    }
    return results;
  }
}

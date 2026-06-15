import { Namespace, Socket } from 'socket.io';
import { Redis } from 'ioredis';
import { WsEvent, REDIS_KEYS, H3_DEFAULT_RESOLUTION, H3_SEARCH_RING_RADIUS } from '@kinetik/shared';

export class FlashWindowHandler {
  constructor(
    private nsp: Namespace,
    private pubClient: Redis,
    private subClient: Redis,
  ) {
    this.setupListeners();
  }

  private setupListeners() {
    this.nsp.on('connection', (socket: Socket) => {
      const userId = (socket as any).userId;
      console.log(`[FlashWindow] User ${userId} connected`);

      // Join window room
      socket.on(WsEvent.WINDOW_JOIN, async (data: { windowId: string; h3Index?: string }) => {
        const { windowId, h3Index } = data;

        // Join the window room
        socket.join(`window:${windowId}`);

        // Store user's location for matching
        if (h3Index) {
          await this.pubClient.sadd(REDIS_KEYS.H3_QUEUE(h3Index), userId);
          await this.pubClient.set(
            REDIS_KEYS.USER_PRESENCE(userId),
            JSON.stringify({ windowId, h3Index, lastSeen: Date.now() }),
            'EX',
            1800, // 30 minutes
          );
        }

        // Get queue size
        const queueSize = await this.pubClient.scard(REDIS_KEYS.WINDOW_PARTICIPANTS(windowId));
        socket.emit(WsEvent.WINDOW_QUEUE_SIZE, { windowId, size: queueSize });

        // Broadcast to room
        socket.to(`window:${windowId}`).emit(WsEvent.PRESENCE_UPDATE, {
          userId,
          action: 'joined',
          queueSize,
        });
      });

      // Leave window room
      socket.on(WsEvent.WINDOW_LEAVE, async (data: { windowId: string; h3Index?: string }) => {
        const { windowId, h3Index } = data;
        socket.leave(`window:${windowId}`);

        if (h3Index) {
          await this.pubClient.srem(REDIS_KEYS.H3_QUEUE(h3Index), userId);
          await this.pubClient.del(REDIS_KEYS.USER_PRESENCE(userId));
        }

        socket.to(`window:${windowId}`).emit(WsEvent.WINDOW_LEAVE, { userId });
      });

      // Heartbeat
      socket.on(WsEvent.HEARTBEAT, async () => {
        await this.pubClient.set(
          REDIS_KEYS.USER_PRESENCE(userId),
          JSON.stringify({ lastSeen: Date.now() }),
          'EX',
          60,
        );
        socket.emit(WsEvent.HEARTBEAT, { timestamp: Date.now() });
      });

      socket.on('disconnect', async () => {
        console.log(`[FlashWindow] User ${userId} disconnected`);
        // Clean up presence
        const presenceStr = await this.pubClient.get(REDIS_KEYS.USER_PRESENCE(userId));
        if (presenceStr) {
          const presence = JSON.parse(presenceStr);
          if (presence.h3Index) {
            await this.pubClient.srem(REDIS_KEYS.H3_QUEUE(presence.h3Index), userId);
          }
          await this.pubClient.del(REDIS_KEYS.USER_PRESENCE(userId));
        }
      });
    });

    // Redis Pub/Sub for cross-instance communication
    this.subClient.subscribe('flash-window:events');
    this.subClient.on('message', (channel, message) => {
      if (channel === 'flash-window:events') {
        const event = JSON.parse(message);
        this.nsp.to(`window:${event.windowId}`).emit(event.type, event.payload);
      }
    });
  }

  // ─── Public Methods ─────────────────────────────────

  async broadcastWindowStatus(windowId: string, status: string, countdown: number) {
    this.nsp.to(`window:${windowId}`).emit(WsEvent.WINDOW_STATUS, {
      windowId,
      status,
      countdown,
    });
  }

  async broadcastCountdown(windowId: string, secondsRemaining: number) {
    this.nsp.to(`window:${windowId}`).emit(WsEvent.WINDOW_COUNTDOWN, {
      windowId,
      secondsRemaining,
    });
  }

  async notifyMatch(windowId: string, userAId: string, userBId: string, matchId: string) {
    const payload = { windowId, userAId, userBId, matchId };
    this.nsp.to(`window:${windowId}`).emit(WsEvent.MATCH_FOUND, payload);
    this.nsp.to(`user:${userAId}`).emit(WsEvent.MATCH_FOUND, payload);
    this.nsp.to(`user:${userBId}`).emit(WsEvent.MATCH_FOUND, payload);
  }
}

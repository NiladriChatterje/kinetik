import { Namespace, Socket } from 'socket.io';
import { Redis } from 'ioredis';
import {
  WsEvent,
  REDIS_KEYS,
} from '@kinetik/shared';

interface ChatMessagePayload {
  matchId: string;
  content: string;
}

interface ChatTypingPayload {
  matchId: string;
  isTyping: boolean;
}

export class ChatHandler {
  private userMatches: Map<string, Set<string>> = new Map(); // userId -> Set<matchId>

  constructor(
    private nsp: Namespace,
    private pubClient: Redis,
    private subClient: Redis,
  ) {
    this.setupListeners();
    this.setupCrossInstanceSubscriber();
  }

  /**
   * Subscribe to the Redis pub/sub channel for cross-instance chat message delivery.
   * When a message is published by another server instance (e.g. via api-core),
   * this handler broadcasts it to the appropriate match room.
   */
  private setupCrossInstanceSubscriber() {
    this.subClient.subscribe(REDIS_KEYS.CHAT_MESSAGES_CHANNEL, (err) => {
      if (err) {
        console.error('[Chat] Failed to subscribe to cross-instance channel:', err.message);
      } else {
        console.log(`[Chat] Subscribed to ${REDIS_KEYS.CHAT_MESSAGES_CHANNEL} for cross-instance messages`);
      }
    });

    this.subClient.on('message', (channel, message) => {
      if (channel === REDIS_KEYS.CHAT_MESSAGES_CHANNEL) {
        try {
          const payload = JSON.parse(message);
          this.broadcastMessage(payload.matchId, payload);
        } catch (err) {
          console.error('[Chat] Failed to parse cross-instance message:', err);
        }
      }
    });
  }

  private setupListeners() {
    this.nsp.on('connection', (socket: Socket) => {
      const userId = (socket as any).userId;
      console.log(`[Chat] User ${userId} connected`);

      // Join personal room
      socket.join(`user:${userId}`);

      // Join conversation rooms
      socket.on(WsEvent.CHAT_JOIN, async (data: { matchId: string }) => {
        const { matchId } = data;
        socket.join(`match:${matchId}`);

        // Track which matches this user is in
        if (!this.userMatches.has(userId)) {
          this.userMatches.set(userId, new Set());
        }
        this.userMatches.get(userId)!.add(matchId);

        console.log(`[Chat] User ${userId} joined match:${matchId}`);
      });

      // Leave conversation room
      socket.on(WsEvent.CHAT_LEAVE, (data: { matchId: string }) => {
        const { matchId } = data;
        socket.leave(`match:${matchId}`);

        const matches = this.userMatches.get(userId);
        if (matches) {
          matches.delete(matchId);
          if (matches.size === 0) {
            this.userMatches.delete(userId);
          }
        }
      });

      // Send a message
      // Delivery is handled by the Redis pub/sub subscriber below — when api-core
      // persists the message (via the client's HTTP POST), it publishes to Redis
      // and setupCrossInstanceSubscriber() broadcasts it to the match room.
      // This avoids double delivery (socket broadcast has no DB id, Redis message has one).
      socket.on(WsEvent.CHAT_MESSAGE, async (data: ChatMessagePayload) => {
        const { matchId, content } = data;

        if (!content || content.trim().length === 0) return;
        if (content.length > 2000) return;

        // No-op: real-time delivery happens via Redis pub/sub after api-core persists.
        // The client optimistically renders the message locally via the HTTP response.
      });

      // Typing indicator
      socket.on(WsEvent.CHAT_TYPING, (data: ChatTypingPayload) => {
        const { matchId, isTyping } = data;

        // Send to everyone in the room EXCEPT sender
        socket.to(`match:${matchId}`).emit(WsEvent.CHAT_TYPING, {
          matchId,
          userId,
          isTyping,
        });
      });

      // Mark messages as read
      socket.on(WsEvent.CHAT_READ, async (data: { matchId: string }) => {
        const { matchId } = data;
        this.nsp.to(`match:${matchId}`).emit(WsEvent.CHAT_READ, {
          matchId,
          userId,
          readAt: new Date().toISOString(),
        });
      });

      socket.on('disconnect', () => {
        console.log(`[Chat] User ${userId} disconnected`);
        this.userMatches.delete(userId);
      });
    });
  }

  /**
   * Broadcast a new message (called from api-core via Redis pub/sub).
   */
  async broadcastMessage(matchId: string, message: {
    id: string;
    matchId: string;
    senderId: string;
    content: string;
    createdAt: string;
  }) {
    this.nsp.to(`match:${matchId}`).emit(WsEvent.CHAT_MESSAGE, message);
  }
}

import { Namespace, Socket } from 'socket.io';
import { Redis } from 'ioredis';
import {
  WsEvent,
  WS_NAMESPACES,
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
  ) {
    this.setupListeners();
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
      socket.on(WsEvent.CHAT_MESSAGE, async (data: ChatMessagePayload) => {
        const { matchId, content } = data;

        if (!content || content.trim().length === 0) return;
        if (content.length > 2000) return;

        // Save message to database via HTTP to api-core
        // We emit the message to the room so both users see it instantly
        // The HTTP POST to /api/v1/matches/conversations/:id/messages
        // is made by the client separately for persistence.
        // This handler just relays the real-time delivery.

        // Emit to everyone in the match room (including sender for confirmation)
        this.nsp.to(`match:${matchId}`).emit(WsEvent.CHAT_MESSAGE, {
          matchId,
          senderId: userId,
          content: content.trim(),
          createdAt: new Date().toISOString(),
        });
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

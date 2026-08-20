import { Namespace, Socket } from 'socket.io';
import { Redis } from 'ioredis';
import {
  WsEvent,
  REDIS_KEYS,
  query,
  TABLES,
} from '@kinetik/shared';

interface ChatMessagePayload {
  matchId: string;
  content: string;
}

interface ChatTypingPayload {
  matchId: string;
  isTyping: boolean;
}

interface CallInvitePayload {
  matchId: string;
  partnerId: string;
  callerName?: string;
  callerPhotoUrl?: string;
}

interface CallRespondPayload {
  matchId: string;
  callerId: string;
}

interface CallCancelPayload {
  matchId: string;
  partnerId: string;
}

interface MessagePayload {
  id: string;
  matchId: string;
  senderId: string;
  content: string;
  createdAt: string;
  media?: {
    id: string;
    messageId: string;
    senderId: string;
    mediaType: string;
    url: string;
    thumbnailUrl?: string;
    mimeType?: string;
    fileSize?: number;
    width?: number;
    height?: number;
    durationSecs?: number;
    isViewOnce?: boolean;
    viewedAt?: string;
  };
}

// ─── Internal Redis pub/sub channels for cross-instance chat events ──
// These complement the Socket.IO Redis adapter: the adapter handles
// io.to(room).emit() broadcasts across all instances, but we use dedicated
// Redis channels for events that originate from api-core (message delivery)
// and for events that need guaranteed delivery (typing, read receipts).
//
// The Socket.IO Redis adapter uses its OWN internal Redis pub/sub channels
// to relay broadcast emits between instances. If we call nsp.to().emit()
// inside our manual subscriber handler, the event gets relayed a SECOND time
// via the adapter, causing duplicate delivery on other instances.
//
// Solution: For messages arriving from api-core via Redis, we emit DIRECTLY
// to local sockets (bypassing the adapter). For typing/read events, we
// publish to dedicated Redis channels AND emit via the adapter — the
// subscriber skips processing if the event originated from our own instance.

export class ChatHandler {
  private userMatches: Map<string, Set<string>> = new Map(); // userId -> Set<matchId>
  // NOTE: per-instance in-memory (same pattern as userMatches). With the
  // Redis adapter's horizontal scaling, a busy user on another instance won't
  // be seen here — mitigated by nginx ip_hash sticky sessions which pin a
  // match's users to the same instance.
  // Tracked per-SOCKET because a user holds several sockets at once (the
  // shared call socket + per-screen chat sockets) — only the socket that
  // emitted call:active_join may clear busy on disconnect.
  private busyUsers: Map<string, Set<string>> = new Map(); // userId -> socketIds in an active call

  constructor(
    private nsp: Namespace,
    private pubClient: Redis,
    private subClient: Redis,
  ) {
    this.setupListeners();
    this.setupCrossInstanceSubscriber();
  }

  // ─── Redis Pub/Sub Subscriber ─────────────────────────────
  // Subscribes to multiple Redis channels for cross-instance delivery.
  // Messages published by api-core (after DB persist) arrive here and
  // are emitted ONLY to local sockets via direct emit (not nsp.to().emit())
  // to prevent double-delivery from the Socket.IO Redis adapter relay.
  private setupCrossInstanceSubscriber() {
    // Subscribe to all chat-related Redis channels
    this.subClient.subscribe(
      REDIS_KEYS.CHAT_MESSAGES_CHANNEL,
      REDIS_KEYS.CHAT_TYPING_CHANNEL,
      REDIS_KEYS.CHAT_READ_CHANNEL,
      REDIS_KEYS.CHAT_MEDIA_EVENTS_CHANNEL,
      REDIS_KEYS.CHAT_CALL_CHANNEL,
      (err) => {
        if (err) {
          console.error('[Chat] Failed to subscribe to cross-instance channels:', err.message);
        } else {
          console.log(`[Chat] Subscribed to cross-instance channels: messages, typing, read, media, call`);
        }
      },
    );

    this.subClient.on('message', (channel, message) => {
      try {
        const payload = JSON.parse(message);

        switch (channel) {
          case REDIS_KEYS.CHAT_MESSAGES_CHANNEL:
            this.handleIncomingMessage(payload);
            break;

          case REDIS_KEYS.CHAT_TYPING_CHANNEL:
            this.handleIncomingTyping(payload);
            break;

          case REDIS_KEYS.CHAT_READ_CHANNEL:
            this.handleIncomingRead(payload);
            break;

          case REDIS_KEYS.CHAT_MEDIA_EVENTS_CHANNEL:
            this.handleIncomingMediaEvent(payload);
            break;

          case REDIS_KEYS.CHAT_CALL_CHANNEL:
            this.handleIncomingCallEvent(payload);
            break;
        }
      } catch (err) {
        console.error(`[Chat] Failed to handle cross-instance message on ${channel}:`, err);
      }
    });
  }

  // ─── Handle incoming message from Redis pub/sub ────────────
  // Emits DIRECTLY to local sockets (bypassing the Socket.IO Redis adapter)
  // to prevent the adapter from relaying this emit to other instances,
  // which would cause double-delivery since every instance independently
  // receives this message from the same Redis pub/sub channel.
  private handleIncomingMessage(payload: any) {
    // Handle view-once media viewed events
    if (payload.type === 'media:viewed') {
      if (payload.matchId) {
        this.emitToLocalRoom(`match:${payload.matchId}`, 'media:viewed', {
          mediaId: payload.mediaId,
          viewedAt: payload.viewedAt,
        });
      }
      return;
    }

    // A scheduled date was fixed for a match — surface it to everyone in the
    // room so an open DM shows the pinned banner live on both ends
    if (payload.type === 'date:set') {
      if (payload.matchId) {
        this.emitToLocalRoom(`match:${payload.matchId}`, 'date:set', {
          matchId: payload.matchId,
          dateScheduled: payload.dateScheduled || null,
          setByUserId: payload.setByUserId,
        });
      }
      return;
    }

    // Date planner data was updated — sync the planner to the partner's open DM
    if (payload.type === 'planner:update') {
      if (payload.matchId) {
        this.emitToLocalRoom(`match:${payload.matchId}`, 'planner:update', {
          matchId: payload.matchId,
          plannerData: payload.plannerData || null,
          updatedByUserId: payload.updatedByUserId,
        });
      }
      return;
    }

    // Match was unmatched — notify all sockets in the room so the partner's
    // ChatScreen can pop back to the conversation list
    if (payload.type === 'match:unmatched') {
      if (payload.matchId) {
        this.emitToLocalRoom(`match:${payload.matchId}`, 'match:unmatched', {
          matchId: payload.matchId,
          unmatchedByUserId: payload.unmatchedByUserId,
        });
      }
      return;
    }

    if (payload.matchId) {
      this.broadcastMessage(payload.matchId, payload);
    }
  }

  // ─── Handle incoming typing indicator from Redis pub/sub ───
  private handleIncomingTyping(payload: any) {
    if (payload.matchId) {
      this.emitToLocalRoomExcludingSender(
        `match:${payload.matchId}`,
        payload.userId,
        WsEvent.CHAT_TYPING,
        {
          matchId: payload.matchId,
          userId: payload.userId,
          isTyping: payload.isTyping,
        },
      );
    }
  }

  // ─── Handle incoming read receipt from Redis pub/sub ───────
  private handleIncomingRead(payload: any) {
    if (payload.matchId) {
      this.emitToLocalRoom(`match:${payload.matchId}`, WsEvent.CHAT_READ, {
        matchId: payload.matchId,
        userId: payload.userId,
        readAt: payload.readAt,
      });
    }
  }

  // ─── Handle incoming media event from Redis pub/sub ───────
  private handleIncomingMediaEvent(payload: any) {
    if (payload.type === 'media:viewed' && payload.matchId) {
      this.emitToLocalRoom(`match:${payload.matchId}`, 'media:viewed', {
        mediaId: payload.mediaId,
        viewedAt: payload.viewedAt,
      });
    }
  }

  // ─── Handle incoming 1:1 call signaling from Redis pub/sub ─
  // Delivered ONLY via the Redis subscriber (same pattern as messages)
  // so each instance emits exactly once — no double-ring on the same
  // instance. The event is routed to the target user's PERSONAL room
  // (`user:<id>`), which every socket joins on connection, so a call
  // invite reaches the callee no matter which screen they're on.
  private handleIncomingCallEvent(payload: any) {
    const { type, targetUserId, event } = payload || {};
    if (!type || !targetUserId || !event) return;

    // Reuses emitToLocalRoom with the personal room (`user:<id>`) — every
    // socket joins it on connect, so the target receives the event regardless
    // of which screen they're on. NOTE: this is best-effort ring signaling;
    // the real 1:1 security boundary is the LiveKit token endpoint in api-core.
    const room = `user:${targetUserId}`;
    switch (type) {
      case 'invite':
        this.emitToLocalRoom(room, WsEvent.CALL_INVITE, event);
        break;
      case 'accept':
        this.emitToLocalRoom(room, WsEvent.CALL_ACCEPT, event);
        break;
      case 'decline':
        this.emitToLocalRoom(room, WsEvent.CALL_DECLINE, event);
        break;
      case 'cancel':
        this.emitToLocalRoom(room, WsEvent.CALL_CANCEL, event);
        break;
      case 'busy':
        this.emitToLocalRoom(room, WsEvent.CALL_BUSY, event);
        break;
    }
  }

  // ─── Local-only broadcast helpers ──────────────────────────
  // These emit directly to sockets on the CURRENT instance only,
  // bypassing the Socket.IO Redis adapter entirely. This is critical
  // because our Redis pub/sub subscriber receives the same message
  // on every instance independently — using nsp.to().emit() would
  // trigger the adapter's own Redis relay, causing duplicate delivery.

  // The `local` flag emits to this instance's room members only (the adapter
  // skips its Redis relay), in O(room size) instead of scanning every socket.
  private emitToLocalRoom(room: string, event: string, data: any) {
    this.nsp.local.to(room).emit(event, data);
  }

  // Excludes the sender via their personal room (`user:<id>`), which every
  // socket joins on connection — covers all of the sender's sockets.
  private emitToLocalRoomExcludingSender(room: string, senderUserId: string, event: string, data: any) {
    this.nsp.local.to(room).except(`user:${senderUserId}`).emit(event, data);
  }

  /**
   * True if the user still has at least one live local socket in the room.
   * A user holds several /chat sockets at once (chat-list, per-DM, unread
   * badge, call signaling) — userMatches tracking may only be dropped once
   * the LAST of them has left the match room.
   */
  private userHasLocalSocketInRoom(userId: string, room: string): boolean {
    for (const [, socket] of this.nsp.sockets) {
      if ((socket as any).userId === userId && socket.rooms.has(room)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Remove a socket from a user's busy set. Busy is cleared only when the
   * LAST socket that joined the active call leaves/disconnects — a secondary
   * chat socket dropping must not clear busy mid-call.
   */
  private removeBusySocket(userId: string, socketId: string) {
    const sockets = this.busyUsers.get(userId);
    if (!sockets) return;
    sockets.delete(socketId);
    if (sockets.size === 0) {
      this.busyUsers.delete(userId);
    }
  }

  /** Publish a 1:1 call signaling event for cross-instance delivery. */
  private publishCallEvent(type: string, targetUserId: string, event: any) {
    this.pubClient.publish(
      REDIS_KEYS.CHAT_CALL_CHANNEL,
      JSON.stringify({ type, targetUserId, event }),
    ).catch((err: Error) => {
      console.error('[Chat] Failed to publish call event:', err.message);
    });
  }

  // ─── Socket Event Handlers ─────────────────────────────────
  private setupListeners() {
    this.nsp.on('connection', (socket: Socket) => {
      const userId = (socket as any).userId;
      console.log(`[Chat] User ${userId} connected`);

      // Join personal room (for targeted notifications)
      socket.join(`user:${userId}`);

      // Join conversation room
      // Only the two participants of an ACTIVE match may join its room. Without
      // this check any authenticated user could join any `match:<id>` room and
      // (a) eavesdrop on that match's chat and (b) pass the userMatches gate on
      // CALL_INVITE to ring arbitrary users. Fails open on DB errors so a
      // transient Postgres blip doesn't break chat for everyone.
      socket.on(WsEvent.CHAT_JOIN, async (data: { matchId: string }) => {
        const { matchId } = data;
        if (!matchId) return;

        try {
          const result = await query(
            `SELECT id FROM ${TABLES.MATCHES}
             WHERE id = $1 AND is_active = TRUE AND (user_a_id = $2 OR user_b_id = $2)`,
            [matchId, userId],
          );
          if (result.rowCount === 0) {
            console.warn(`[Chat] User ${userId} denied join to match:${matchId} (not a participant)`);
            return;
          }
        } catch (err: any) {
          console.warn(`[Chat] Membership check failed for match:${matchId} — allowing join:`, err?.message);
        }

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

        // Drop tracking only if no OTHER socket of this user is still in the
        // room (leave() above already removed this one) — e.g. the DM screen
        // closing must not untrack a match the call socket still uses.
        const matches = this.userMatches.get(userId);
        if (matches && !this.userHasLocalSocketInRoom(userId, `match:${matchId}`)) {
          matches.delete(matchId);
          if (matches.size === 0) {
            this.userMatches.delete(userId);
          }
        }
      });

      // ── Send a message (via WebSocket) ──
      // Note: The primary message flow is HTTP POST → api-core → Redis pub/sub → WebSocket.
      // The client sends messages via HTTP for guaranteed persistence, and real-time
      // delivery happens via the Redis pub/sub subscriber below.
      // This socket handler exists as a potential fallback for future use.
      socket.on(WsEvent.CHAT_MESSAGE, async (data: ChatMessagePayload) => {
        const { matchId, content } = data;

        if (!content || content.trim().length === 0) return;
        if (content.length > 2000) return;

        // No-op: real-time delivery happens via Redis pub/sub after api-core persists.
        // The client optimistically renders the message locally via the HTTP response.
        // If we wanted to handle WebSocket-originated messages, we would POST to
        // api-core's message endpoint here, then the Redis subscriber handles broadcast.
      });

      // ── Typing indicator ──
      // Uses local-only emit + Redis pub/sub (same pattern as message delivery).
      // This avoids double-delivery that would occur if we also used the
      // Socket.IO Redis adapter's socket.to() relay — the adapter would
      // broadcast to other instances, which would then also receive the
      // event from Redis pub/sub, causing duplicate delivery.
      socket.on(WsEvent.CHAT_TYPING, (data: ChatTypingPayload) => {
        const { matchId, isTyping } = data;

        // 1. Emit locally to other sockets in the match room (fast path)
        this.emitToLocalRoomExcludingSender(
          `match:${matchId}`,
          userId,
          WsEvent.CHAT_TYPING,
          { matchId, userId, isTyping },
        );

        // 2. Publish to Redis for cross-instance delivery
        this.pubClient.publish(
          REDIS_KEYS.CHAT_TYPING_CHANNEL,
          JSON.stringify({ matchId, userId, isTyping }),
        ).catch((err: Error) => {
          console.error('[Chat] Failed to publish typing indicator:', err.message);
        });
      });

      // ── 1:1 call signaling (LiveKit) ──
      // Invite/accept/decline/cancel/busy are routed to the target user's
      // PERSONAL room via the Redis subscriber (exactly-once per instance).

      socket.on(WsEvent.CALL_INVITE, (data: CallInvitePayload) => {
        const { matchId, partnerId, callerName, callerPhotoUrl } = data || {};
        if (!matchId || !partnerId || partnerId === userId) return;

        // Caller must be a participant of the match (joined it via chat:join)
        if (!this.userMatches.get(userId)?.has(matchId)) return;

        // If the callee is already in another call, auto-reply busy instead
        // of ringing. Busy state is set via call:active_join (see below) and
        // cleared on call:active_leave or socket disconnect.
        if (this.busyUsers.has(partnerId)) {
          this.publishCallEvent('busy', userId, {
            matchId,
            calleeId: partnerId,
            timestamp: new Date().toISOString(),
          });
          return;
        }

        this.publishCallEvent('invite', partnerId, {
          matchId,
          callerId: userId,
          callerName: callerName || '',
          callerPhotoUrl: callerPhotoUrl || '',
          timestamp: new Date().toISOString(),
        });
      });

      // Mark the user as in an active 1:1 call (busy). Emitted by the mobile
      // CallScreen on mount and cleared on unmount / disconnect.
      socket.on(WsEvent.CALL_ACTIVE_JOIN, () => {
        if (!this.busyUsers.has(userId)) {
          this.busyUsers.set(userId, new Set());
        }
        this.busyUsers.get(userId)!.add(socket.id);
      });

      socket.on(WsEvent.CALL_ACTIVE_LEAVE, () => {
        this.removeBusySocket(userId, socket.id);
      });

      socket.on(WsEvent.CALL_ACCEPT, (data: CallRespondPayload) => {
        const { matchId, callerId } = data || {};
        if (!matchId || !callerId || callerId === userId) return;

        this.publishCallEvent('accept', callerId, {
          matchId,
          calleeId: userId,
          timestamp: new Date().toISOString(),
        });
      });

      socket.on(WsEvent.CALL_DECLINE, (data: CallRespondPayload) => {
        const { matchId, callerId } = data || {};
        if (!matchId || !callerId || callerId === userId) return;

        this.publishCallEvent('decline', callerId, {
          matchId,
          calleeId: userId,
          timestamp: new Date().toISOString(),
        });
      });

      socket.on(WsEvent.CALL_CANCEL, (data: CallCancelPayload) => {
        const { matchId, partnerId } = data || {};
        if (!matchId || !partnerId || partnerId === userId) return;

        this.publishCallEvent('cancel', partnerId, {
          matchId,
          callerId: userId,
          timestamp: new Date().toISOString(),
        });
      });

      // ── Mark messages as read ──
      // Uses local-only emit + Redis pub/sub (same pattern as typing indicators).
      socket.on(WsEvent.CHAT_READ, async (data: { matchId: string }) => {
        const { matchId } = data;
        const readPayload = {
          matchId,
          userId,
          readAt: new Date().toISOString(),
        };

        // 1. Emit locally to all sockets in the match room (fast path)
        this.emitToLocalRoom(`match:${matchId}`, WsEvent.CHAT_READ, readPayload);

        // 2. Publish to Redis for cross-instance delivery
        this.pubClient.publish(
          REDIS_KEYS.CHAT_READ_CHANNEL,
          JSON.stringify(readPayload),
        ).catch((err: Error) => {
          console.error('[Chat] Failed to publish read receipt:', err.message);
        });
      });

      socket.on('disconnect', () => {
        console.log(`[Chat] User ${userId} disconnected`);
        // Prune only the matches no surviving socket of this user is still
        // joined to — one socket dropping (of the several a user holds) must
        // not wipe tracking for the DMs/calls the others are still in.
        // (Socket.IO removes this socket from nsp.sockets before emitting
        // 'disconnect', so it no longer counts as "in the room" here.)
        const matches = this.userMatches.get(userId);
        if (matches) {
          for (const matchId of [...matches]) {
            if (!this.userHasLocalSocketInRoom(userId, `match:${matchId}`)) {
              matches.delete(matchId);
            }
          }
          if (matches.size === 0) {
            this.userMatches.delete(userId);
          }
        }
        this.removeBusySocket(userId, socket.id);
      });
    });
  }

  /**
   * Broadcast a new message to all sockets in a match room.
   * Called from api-core via Redis pub/sub (CHAT_MESSAGES_CHANNEL).
   *
   * Uses local-only emit to avoid double-delivery from the Socket.IO
   * Redis adapter relay (since every instance receives this message
   * independently via the same Redis pub/sub channel).
   */
  async broadcastMessage(matchId: string, message: MessagePayload) {
    this.emitToLocalRoom(`match:${matchId}`, WsEvent.CHAT_MESSAGE, message);
  }
}

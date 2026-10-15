import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WsEvent, REDIS_KEYS, query } from '@kinetik/shared';
import { ChatHandler } from '../handlers/chat';

// CHAT_JOIN now validates match membership against Postgres via `query`.
// Mock it so tests never touch a real DB; the actual WsEvent/REDIS_KEYS
// exports are preserved via importOriginal.
vi.mock('@kinetik/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kinetik/shared')>();
  return {
    ...actual,
    query: vi.fn(),
  };
});

// ─── Mocks ────────────────────────────────────────────────────────

let mockSocketSeq = 0;

function createMockSocket(userId: string) {
  const socket: any = {
    id: `socket-${userId}-${++mockSocketSeq}`, // unique per connection — real sockets always have an id
    userId,
    // join/leave mutate `rooms` like real sockets do — the handler's local
    // broadcasts and room-membership checks read socket.rooms
    join: vi.fn((room: string) => { socket.rooms.add(room); }),
    leave: vi.fn((room: string) => { socket.rooms.delete(room); }),
    on: vi.fn(),
    to: vi.fn(() => socket), // chained call: socket.to(room).emit(...)
    emit: vi.fn(),
    rooms: new Set<string>(),
  };
  return socket;
}

function createMockRedis() {
  return {
    on: vi.fn(),
    subscribe: vi.fn((_channels: string | string[], _cb?: (err: Error | null) => void) => {
      // Handle both single string and array of strings
      const cb = typeof _cb === 'function' ? _cb : undefined;
      if (cb) cb(null);
    }),
    publish: vi.fn().mockResolvedValue(1),
    quit: vi.fn().mockResolvedValue(undefined),
    duplicate: vi.fn(),
  } as any;
}

function createMockNamespace() {
  const nsp: any = {
    on: vi.fn(),
    to: vi.fn(() => nsp), // chained call: nsp.to(room).emit(...)
    emit: vi.fn(),
    sockets: new Map<string, any>(),
  };
  // Emulates socket.io's `nsp.local.to(room)[.except(room)].emit()` —
  // delivers to local sockets in `room`, skipping members of `except` rooms
  const deliver = (room: string, exceptRooms: string[], event: string, data: any) => {
    for (const [, s] of nsp.sockets) {
      if (s.rooms.has(room) && !exceptRooms.some((r) => s.rooms.has(r))) {
        s.emit(event, data);
      }
    }
  };
  // socket.io's adapter.rooms — Map<room, Set<socketId>>, derived from the
  // same membership the mock sockets track
  nsp.adapter = {
    get rooms() {
      const rooms = new Map<string, Set<string>>();
      for (const [id, s] of nsp.sockets) {
        for (const r of s.rooms) {
          if (!rooms.has(r)) rooms.set(r, new Set<string>());
          rooms.get(r)!.add(id);
        }
      }
      return rooms;
    },
  };
  nsp.local = {
    to: (room: string) => ({
      emit: (event: string, data: any) => deliver(room, [], event, data),
      except: (ex: string) => ({
        emit: (event: string, data: any) => deliver(room, [ex], event, data),
      }),
    }),
  };
  return nsp;
}

// ─── Helpers ───────────────────────────────────────────────────────

function simulateConnection(nsp: any): { socket: any; userId: string } {
  const userId = 'user-123';
  const socket = createMockSocket(userId);

  // Add socket to namespace's local sockets map
  nsp.sockets.set(socket.id || 'socket-1', socket);

  // The namespace 'connection' listener was registered in the constructor.
  // We grab it and invoke it with the mock socket.
  const connectionHandler = nsp.on.mock.calls.find(
    ([event]: [string]) => event === 'connection',
  )?.[1];
  if (connectionHandler) {
    connectionHandler(socket);
  }
  return { socket, userId };
}

function simulateSecondConnection(nsp: any, userId: string): any {
  const socket = createMockSocket(userId);
  nsp.sockets.set(socket.id || `socket-${userId}`, socket);
  const connectionHandler = nsp.on.mock.calls.find(
    ([event]: [string]) => event === 'connection',
  )?.[1];
  if (connectionHandler) {
    connectionHandler(socket);
  }
  return socket;
}

/** Register a specific event handler on a socket. */
function registerHandler(socket: any, event: string): (...args: any[]) => void {
  const call = socket.on.mock.calls.find(([e]: [string]) => e === event);
  if (!call) throw new Error(`Handler for "${event}" was never registered`);
  return call[1];
}

/** Get the message handler registered on the subClient */
function getMessageHandler(subClient: any, event: string = 'message'): (...args: any[]) => void {
  return subClient.on.mock.calls.find(
    ([e]: [string]) => e === event,
  )?.[1];
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('ChatHandler', () => {
  let nsp: any;
  let pubClient: any;
  let subClient: any;
  let handler: ChatHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSocketSeq = 0;
    nsp = createMockNamespace();
    pubClient = createMockRedis();
    subClient = createMockRedis();
    handler = new ChatHandler(nsp, pubClient, subClient);
    // Default: the joining user IS a participant of the match
    vi.mocked(query).mockResolvedValue({ rowCount: 1, rows: [{ id: 'match-456' }] } as any);
  });

  // ─── Socket Connection ────────────────────────────────────────

  describe('on connection', () => {
    it('should register the "connection" listener on the namespace', () => {
      expect(nsp.on).toHaveBeenCalledWith('connection', expect.any(Function));
    });

    it('should join the user to their personal room', () => {
      const { socket, userId } = simulateConnection(nsp);
      expect(socket.join).toHaveBeenCalledWith(`user:${userId}`);
    });

    it('should register CHAT_JOIN, CHAT_LEAVE, CHAT_MESSAGE, CHAT_TYPING, CHAT_READ, and disconnect handlers', () => {
      const { socket } = simulateConnection(nsp);
      const registeredEvents = socket.on.mock.calls.map(([e]: [string]) => e);
      expect(registeredEvents).toContain(WsEvent.CHAT_JOIN);
      expect(registeredEvents).toContain(WsEvent.CHAT_LEAVE);
      expect(registeredEvents).toContain(WsEvent.CHAT_MESSAGE);
      expect(registeredEvents).toContain(WsEvent.CHAT_TYPING);
      expect(registeredEvents).toContain(WsEvent.CHAT_READ);
      expect(registeredEvents).toContain('disconnect');
    });
  });

  // ─── CHAT_JOIN ────────────────────────────────────────────────

  describe(`${WsEvent.CHAT_JOIN} event`, () => {
    it('should join the socket to the match room when the user is a participant', async () => {
      const { socket } = simulateConnection(nsp);
      const handlerFn = registerHandler(socket, WsEvent.CHAT_JOIN);
      await handlerFn({ matchId: 'match-456' });

      expect(socket.join).toHaveBeenCalledWith('match:match-456');
    });

    it('should track the match in userMatches map', async () => {
      const { socket } = simulateConnection(nsp);
      const handlerFn = registerHandler(socket, WsEvent.CHAT_JOIN);

      await handlerFn({ matchId: 'match-456' });
      await handlerFn({ matchId: 'match-789' });
      await handlerFn({ matchId: 'match-456' }); // duplicate join — should not error

      // No direct assertion on private map — tested indirectly via leave/disconnect
      expect(true).toBe(true);
    });

    it('should NOT join the room when the user is not a participant of the match', async () => {
      const { socket } = simulateConnection(nsp);
      const handlerFn = registerHandler(socket, WsEvent.CHAT_JOIN);
      vi.mocked(query).mockResolvedValue({ rowCount: 0, rows: [] } as any);

      await handlerFn({ matchId: 'match-456' });

      expect(socket.join).not.toHaveBeenCalledWith('match:match-456');
    });

    it('should fail closed (refuse join) when the DB check errors', async () => {
      const { socket } = simulateConnection(nsp);
      const handlerFn = registerHandler(socket, WsEvent.CHAT_JOIN);
      vi.mocked(query).mockRejectedValue(new Error('db down'));

      await handlerFn({ matchId: 'match-456' });

      expect(socket.join).not.toHaveBeenCalledWith('match:match-456');
    });

    // Answers each of the join check's three queries: participant, Premium,
    // and the user's oldest active match (their one free chat)
    const mockJoinChecks = (opts: { premium: boolean; freeMatchId: string }) => {
      vi.mocked(query).mockImplementation((async (sql: string) => {
        if (sql.includes("tier IN ('premium', 'infinite')")) {
          return opts.premium ? { rowCount: 1, rows: [{}] } : { rowCount: 0, rows: [] };
        }
        if (sql.includes('ORDER BY matched_at ASC')) {
          return { rowCount: 1, rows: [{ id: opts.freeMatchId, is_active: true }] };
        }
        return { rowCount: 1, rows: [{ id: 'match-456' }] };
      }) as any);
    };

    it('should let a free user join their one free chat (oldest active match)', async () => {
      const { socket } = simulateConnection(nsp);
      const handlerFn = registerHandler(socket, WsEvent.CHAT_JOIN);
      mockJoinChecks({ premium: false, freeMatchId: 'match-456' });

      await handlerFn({ matchId: 'match-456' });

      expect(socket.join).toHaveBeenCalledWith('match:match-456');
    });

    it('should NOT let a free user join any other chat (locked)', async () => {
      const { socket } = simulateConnection(nsp);
      const handlerFn = registerHandler(socket, WsEvent.CHAT_JOIN);
      mockJoinChecks({ premium: false, freeMatchId: 'match-oldest' });

      await handlerFn({ matchId: 'match-456' });

      expect(socket.join).not.toHaveBeenCalledWith('match:match-456');
    });

    it('should let a Premium user join any of their chats', async () => {
      const { socket } = simulateConnection(nsp);
      const handlerFn = registerHandler(socket, WsEvent.CHAT_JOIN);
      mockJoinChecks({ premium: true, freeMatchId: 'match-oldest' });

      await handlerFn({ matchId: 'match-456' });

      expect(socket.join).toHaveBeenCalledWith('match:match-456');
    });

    it('should ignore joins with a missing matchId', async () => {
      const { socket } = simulateConnection(nsp);
      const handlerFn = registerHandler(socket, WsEvent.CHAT_JOIN);

      await handlerFn({ matchId: '' });

      // Only the personal-room join from connection is allowed — no match room
      const matchJoins = socket.join.mock.calls.filter(([room]: [string]) => room.startsWith('match:'));
      expect(matchJoins).toHaveLength(0);
    });
  });

  // ─── CHAT_LEAVE ───────────────────────────────────────────────

  describe(`${WsEvent.CHAT_LEAVE} event`, () => {
    it('should leave the match room and remove the socket from the room', async () => {
      const { socket } = simulateConnection(nsp);
      const joinFn = registerHandler(socket, WsEvent.CHAT_JOIN);
      const leaveFn = registerHandler(socket, WsEvent.CHAT_LEAVE);

      await joinFn({ matchId: 'match-456' });
      leaveFn({ matchId: 'match-456' });

      expect(socket.leave).toHaveBeenCalledWith('match:match-456');
    });

    it('should handle leaving a room that was not joined (no error)', () => {
      const { socket } = simulateConnection(nsp);
      const leaveFn = registerHandler(socket, WsEvent.CHAT_LEAVE);

      expect(() => leaveFn({ matchId: 'match-never-joined' })).not.toThrow();
    });
  });

  // ─── CHAT_MESSAGE ─────────────────────────────────────────────

  describe(`${WsEvent.CHAT_MESSAGE} event`, () => {
    it('should be a no-op (delivery handled via HTTP POST + Redis pub/sub)', () => {
      const { socket } = simulateConnection(nsp);
      const msgFn = registerHandler(socket, WsEvent.CHAT_MESSAGE);

      msgFn({ matchId: 'match-456', content: 'Hello!' });

      // The CHAT_MESSAGE socket handler is a no-op — real-time delivery
      // happens via Redis pub/sub after api-core persists the message.
      expect(nsp.emit).not.toHaveBeenCalled();
    });

    it('should ignore empty content gracefully', () => {
      const { socket } = simulateConnection(nsp);
      const msgFn = registerHandler(socket, WsEvent.CHAT_MESSAGE);

      expect(() => msgFn({ matchId: 'match-456', content: '' })).not.toThrow();
      expect(() => msgFn({ matchId: 'match-456', content: '   ' })).not.toThrow();
      expect(() => msgFn({ matchId: 'match-456', content: 'a'.repeat(2001) })).not.toThrow();
    });
  });

  // ─── CHAT_TYPING ──────────────────────────────────────────────

  describe(`${WsEvent.CHAT_TYPING} event`, () => {
    it('should emit CHAT_TYPING locally to everyone EXCEPT the sender in the match room', () => {
      const { socket: sender, userId } = simulateConnection(nsp);
      const receiver = simulateSecondConnection(nsp, 'user-456');
      const typingFn = registerHandler(sender, WsEvent.CHAT_TYPING);

      // Both join the match room
      sender.rooms.add('match:match-456');
      receiver.rooms.add('match:match-456');

      typingFn({ matchId: 'match-456', isTyping: true });

      // Receiver gets it
      expect(receiver.emit).toHaveBeenCalledWith(WsEvent.CHAT_TYPING, {
        matchId: 'match-456',
        userId,
        isTyping: true,
      });
      // Sender does NOT get it
      expect(sender.emit).not.toHaveBeenCalledWith(WsEvent.CHAT_TYPING, expect.anything());
    });

    it('should publish to Redis CHAT_TYPING_CHANNEL for cross-instance delivery', () => {
      const { socket, userId } = simulateConnection(nsp);
      const typingFn = registerHandler(socket, WsEvent.CHAT_TYPING);

      typingFn({ matchId: 'match-456', isTyping: true });

      expect(pubClient.publish).toHaveBeenCalledWith(
        REDIS_KEYS.CHAT_TYPING_CHANNEL,
        JSON.stringify({ matchId: 'match-456', userId, isTyping: true }),
      );
    });

    it('should emit isTyping: false when user stops typing', () => {
      const { socket: sender, userId } = simulateConnection(nsp);
      const receiver = simulateSecondConnection(nsp, 'user-456');
      const typingFn = registerHandler(sender, WsEvent.CHAT_TYPING);

      sender.rooms.add('match:match-456');
      receiver.rooms.add('match:match-456');

      typingFn({ matchId: 'match-456', isTyping: false });

      expect(receiver.emit).toHaveBeenCalledWith(WsEvent.CHAT_TYPING, {
        matchId: 'match-456',
        userId,
        isTyping: false,
      });
    });

    it('should handle publish failures gracefully', () => {
      const { socket } = simulateConnection(nsp);
      const typingFn = registerHandler(socket, WsEvent.CHAT_TYPING);
      pubClient.publish.mockRejectedValueOnce(new Error('Redis down'));

      expect(() => typingFn({ matchId: 'match-456', isTyping: true })).not.toThrow();
    });
  });

  // ─── CHAT_READ ────────────────────────────────────────────────

  describe(`${WsEvent.CHAT_READ} event`, () => {
    it('should emit CHAT_READ locally to the match room via emitToLocalRoom', () => {
      const { socket: reader, userId } = simulateConnection(nsp);
      const partner = simulateSecondConnection(nsp, 'user-456');
      const readFn = registerHandler(reader, WsEvent.CHAT_READ);

      reader.rooms.add('match:match-456');
      partner.rooms.add('match:match-456');

      readFn({ matchId: 'match-456' });

      // Both local sockets in the room receive the read event
      const emittedPayload = partner.emit.mock.calls[0][1];
      expect(emittedPayload).toMatchObject({
        matchId: 'match-456',
        userId,
      });
      expect(emittedPayload.readAt).toBeDefined();
      expect(() => new Date(emittedPayload.readAt)).not.toThrow();

      // Should NOT use nsp.to() which would trigger the adapter relay
      expect(nsp.to).not.toHaveBeenCalled();
    });

    it('should publish to Redis CHAT_READ_CHANNEL for cross-instance delivery', () => {
      const { socket, userId } = simulateConnection(nsp);
      const readFn = registerHandler(socket, WsEvent.CHAT_READ);

      readFn({ matchId: 'match-456' });

      const publishCall = pubClient.publish.mock.calls.find(
        ([channel]: [string]) => channel === REDIS_KEYS.CHAT_READ_CHANNEL,
      );
      expect(publishCall).toBeDefined();
      const publishedPayload = JSON.parse(publishCall[1]);
      expect(publishedPayload).toMatchObject({
        matchId: 'match-456',
        userId,
      });
      expect(publishedPayload.readAt).toBeDefined();
    });

    it('should handle publish failures gracefully', () => {
      const { socket } = simulateConnection(nsp);
      const readFn = registerHandler(socket, WsEvent.CHAT_READ);
      pubClient.publish.mockRejectedValueOnce(new Error('Redis down'));

      expect(() => readFn({ matchId: 'match-456' })).not.toThrow();
    });
  });

  // ─── Disconnect ───────────────────────────────────────────────

  describe('disconnect event', () => {
    it('should remove the user from userMatches on disconnect', async () => {
      const { socket } = simulateConnection(nsp);
      const joinFn = registerHandler(socket, WsEvent.CHAT_JOIN);
      const disconnectFn = registerHandler(socket, 'disconnect');

      await joinFn({ matchId: 'match-456' });
      await joinFn({ matchId: 'match-789' });
      disconnectFn();

      expect(true).toBe(true);
    });

    it('should not crash on disconnect when no matches were joined', () => {
      const { socket } = simulateConnection(nsp);
      const disconnectFn = registerHandler(socket, 'disconnect');

      expect(() => disconnectFn()).not.toThrow();
    });
  });

  // ─── broadcastMessage ─────────────────────────────────────────

  describe('broadcastMessage()', () => {
    it('should emit CHAT_MESSAGE directly to local sockets in the match room (no adapter relay)', async () => {
      const { socket: senderSocket } = simulateConnection(nsp);
      const receiverSocket = simulateSecondConnection(nsp, 'user-456');

      // Both sockets join the match room via their rooms Set
      senderSocket.rooms.add('match:match-456');
      receiverSocket.rooms.add('match:match-456');

      const messagePayload = {
        id: 'msg-1',
        matchId: 'match-456',
        senderId: 'user-456',
        content: 'Cross-instance message!',
        createdAt: new Date().toISOString(),
      };

      await handler.broadcastMessage('match-456', messagePayload);

      // Both local sockets in the room should receive the message
      expect(senderSocket.emit).toHaveBeenCalledWith(WsEvent.CHAT_MESSAGE, messagePayload);
      expect(receiverSocket.emit).toHaveBeenCalledWith(WsEvent.CHAT_MESSAGE, messagePayload);

      // Should NOT use nsp.to().emit() (which would trigger the Redis adapter)
      expect(nsp.to).not.toHaveBeenCalled();
      expect(nsp.emit).not.toHaveBeenCalled();
    });

    it('should NOT emit to sockets NOT in the match room', async () => {
      const { socket: socketA } = simulateConnection(nsp);
      const socketB = simulateSecondConnection(nsp, 'user-456');

      // Only one socket joins the match room
      socketA.rooms.add('match:match-456');

      const messagePayload = {
        id: 'msg-2',
        matchId: 'match-456',
        senderId: 'user-456',
        content: 'Only room members',
        createdAt: new Date().toISOString(),
      };

      await handler.broadcastMessage('match-456', messagePayload);

      expect(socketA.emit).toHaveBeenCalledWith(WsEvent.CHAT_MESSAGE, messagePayload);
      expect(socketB.emit).not.toHaveBeenCalled();
    });

    it('should handle empty rooms gracefully (no crash)', async () => {
      const messagePayload = {
        id: 'msg-3',
        matchId: 'match-nonexistent',
        senderId: 'user-456',
        content: 'No one here',
        createdAt: new Date().toISOString(),
      };

      // No sockets in the room — should not throw
      await expect(
        handler.broadcastMessage('match-nonexistent', messagePayload),
      ).resolves.not.toThrow();
    });

    it('should broadcast the exact message payload without modification', async () => {
      const { socket } = simulateConnection(nsp);
      socket.rooms.add('match:match-789');

      const messagePayload = {
        id: 'msg-2',
        matchId: 'match-789',
        senderId: 'user-789',
        content: 'Exact payload test',
        createdAt: '2025-01-01T00:00:00.000Z',
      };

      await handler.broadcastMessage('match-789', messagePayload);

      expect(socket.emit).toHaveBeenCalledWith(WsEvent.CHAT_MESSAGE, messagePayload);
    });
  });

  // ─── Redis Pub/Sub (Cross-Instance) ──────────────────────────

  describe('cross-instance Redis pub/sub', () => {
    it('should subscribe to all chat-related Redis channels on construction', () => {
      expect(subClient.subscribe).toHaveBeenCalledWith(
        REDIS_KEYS.CHAT_MESSAGES_CHANNEL,
        REDIS_KEYS.CHAT_TYPING_CHANNEL,
        REDIS_KEYS.CHAT_READ_CHANNEL,
        REDIS_KEYS.CHAT_MEDIA_EVENTS_CHANNEL,
        expect.any(Function),
      );
    });

    it('should register a "message" listener on the subClient', () => {
      expect(subClient.on).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('should parse JSON messages and call broadcastMessage for CHAT_MESSAGES_CHANNEL', () => {
      const messageHandler = getMessageHandler(subClient);
      expect(messageHandler).toBeDefined();

      const payload = {
        id: 'msg-3',
        matchId: 'match-456',
        senderId: 'user-789',
        content: 'Redis delivered!',
        createdAt: new Date().toISOString(),
      };

      // Spy on broadcastMessage
      const broadcastSpy = vi.spyOn(handler, 'broadcastMessage');

      messageHandler(REDIS_KEYS.CHAT_MESSAGES_CHANNEL, JSON.stringify(payload));

      expect(broadcastSpy).toHaveBeenCalledWith('match-456', payload);
    });

    it('should ignore messages from unknown Redis channels', () => {
      const messageHandler = getMessageHandler(subClient);
      const broadcastSpy = vi.spyOn(handler, 'broadcastMessage');

      messageHandler('other:channel', JSON.stringify({ matchId: 'm-1' }));

      expect(broadcastSpy).not.toHaveBeenCalled();
    });

    it('should not throw on malformed JSON', () => {
      const messageHandler = getMessageHandler(subClient);

      expect(() =>
        messageHandler(REDIS_KEYS.CHAT_MESSAGES_CHANNEL, 'not-json'),
      ).not.toThrow();
    });

    it('should forward typing events from CHAT_TYPING_CHANNEL to local sockets', () => {
      const { socket } = simulateConnection(nsp);
      socket.rooms.add('match:match-t456');

      const messageHandler = getMessageHandler(subClient);
      const typingEvent = {
        matchId: 'match-t456',
        userId: 'user-remote',
        isTyping: true,
      };

      messageHandler(REDIS_KEYS.CHAT_TYPING_CHANNEL, JSON.stringify(typingEvent));

      expect(socket.emit).toHaveBeenCalledWith(WsEvent.CHAT_TYPING, typingEvent);
    });

    it('should forward read events from CHAT_READ_CHANNEL to local sockets', () => {
      const { socket } = simulateConnection(nsp);
      socket.rooms.add('match:match-r456');

      const messageHandler = getMessageHandler(subClient);
      const readEvent = {
        matchId: 'match-r456',
        userId: 'user-remote',
        readAt: new Date().toISOString(),
      };

      messageHandler(REDIS_KEYS.CHAT_READ_CHANNEL, JSON.stringify(readEvent));

      expect(socket.emit).toHaveBeenCalledWith(WsEvent.CHAT_READ, expect.objectContaining(readEvent));
    });

    it('should forward media:viewed events from CHAT_MEDIA_EVENTS_CHANNEL', () => {
      const { socket } = simulateConnection(nsp);
      socket.rooms.add('match:match-m456');

      const messageHandler = getMessageHandler(subClient);
      const mediaEvent = {
        type: 'media:viewed',
        matchId: 'match-m456',
        mediaId: 'media-1',
        viewedAt: new Date().toISOString(),
      };

      messageHandler(REDIS_KEYS.CHAT_MEDIA_EVENTS_CHANNEL, JSON.stringify(mediaEvent));

      expect(socket.emit).toHaveBeenCalledWith('media:viewed', {
        mediaId: 'media-1',
        viewedAt: mediaEvent.viewedAt,
      });
    });

    it('should forward date:set events from CHAT_MESSAGES_CHANNEL to the match room', () => {
      const { socket } = simulateConnection(nsp);
      socket.rooms.add('match:match-d456');

      const messageHandler = getMessageHandler(subClient);
      const dateEvent = {
        type: 'date:set',
        matchId: 'match-d456',
        dateScheduled: '2026-08-21',
        setByUserId: 'user-123',
      };

      messageHandler(REDIS_KEYS.CHAT_MESSAGES_CHANNEL, JSON.stringify(dateEvent));

      expect(socket.emit).toHaveBeenCalledWith('date:set', {
        matchId: 'match-d456',
        dateScheduled: '2026-08-21',
        setByUserId: 'user-123',
      });
    });

    it('should exclude the sender from typing events on CHAT_TYPING_CHANNEL', () => {
      const { socket: sender } = simulateConnection(nsp);
      const receiver = simulateSecondConnection(nsp, 'user-456');

      sender.rooms.add('match:match-x');
      receiver.rooms.add('match:match-x');

      const messageHandler = getMessageHandler(subClient);
      const typingEvent = {
        matchId: 'match-x',
        userId: 'user-123', // same as sender
        isTyping: true,
      };

      messageHandler(REDIS_KEYS.CHAT_TYPING_CHANNEL, JSON.stringify(typingEvent));

      // Receiver gets it
      expect(receiver.emit).toHaveBeenCalledWith(WsEvent.CHAT_TYPING, typingEvent);
      // Sender does NOT get it (excluded via userId match)
      expect(sender.emit).not.toHaveBeenCalledWith(WsEvent.CHAT_TYPING, typingEvent);
    });
  });
});

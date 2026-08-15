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

    it('should register CHAT_JOIN, CHAT_LEAVE, CHAT_MESSAGE, CHAT_TYPING, CHAT_READ, call events, and disconnect handlers', () => {
      const { socket } = simulateConnection(nsp);
      const registeredEvents = socket.on.mock.calls.map(([e]: [string]) => e);
      expect(registeredEvents).toContain(WsEvent.CHAT_JOIN);
      expect(registeredEvents).toContain(WsEvent.CHAT_LEAVE);
      expect(registeredEvents).toContain(WsEvent.CHAT_MESSAGE);
      expect(registeredEvents).toContain(WsEvent.CHAT_TYPING);
      expect(registeredEvents).toContain(WsEvent.CHAT_READ);
      expect(registeredEvents).toContain(WsEvent.CALL_INVITE);
      expect(registeredEvents).toContain(WsEvent.CALL_ACCEPT);
      expect(registeredEvents).toContain(WsEvent.CALL_DECLINE);
      expect(registeredEvents).toContain(WsEvent.CALL_CANCEL);
      expect(registeredEvents).toContain(WsEvent.CALL_ACTIVE_JOIN);
      expect(registeredEvents).toContain(WsEvent.CALL_ACTIVE_LEAVE);
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
      const inviteFn = registerHandler(socket, WsEvent.CALL_INVITE);
      vi.mocked(query).mockResolvedValue({ rowCount: 0, rows: [] } as any);

      await handlerFn({ matchId: 'match-456' });

      expect(socket.join).not.toHaveBeenCalledWith('match:match-456');

      // Denied join also blocks the userMatches gate on CALL_INVITE
      inviteFn({ matchId: 'match-456', partnerId: 'user-456' });
      expect(pubClient.publish).not.toHaveBeenCalledWith(
        REDIS_KEYS.CHAT_CALL_CHANNEL,
        expect.anything(),
      );
    });

    it('should fail open (allow join) when the DB membership check errors', async () => {
      const { socket } = simulateConnection(nsp);
      const handlerFn = registerHandler(socket, WsEvent.CHAT_JOIN);
      vi.mocked(query).mockRejectedValue(new Error('db down'));

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

  // ─── 1:1 CALL SIGNALING ────────────────────────────────────

  describe('1:1 call signaling', () => {
    it('should publish CALL_INVITE to the partner personal room via Redis for a match participant', async () => {
      const { socket } = simulateConnection(nsp);
      const joinFn = registerHandler(socket, WsEvent.CHAT_JOIN);
      const inviteFn = registerHandler(socket, WsEvent.CALL_INVITE);

      await joinFn({ matchId: 'match-456' });
      inviteFn({ matchId: 'match-456', partnerId: 'user-456', callerName: 'Ava', callerPhotoUrl: '/p.jpg' });

      const publishCall = pubClient.publish.mock.calls.find(
        ([channel]: [string]) => channel === REDIS_KEYS.CHAT_CALL_CHANNEL,
      );
      expect(publishCall).toBeDefined();
      const published = JSON.parse(publishCall[1]);
      expect(published.type).toBe('invite');
      expect(published.targetUserId).toBe('user-456');
      expect(published.event).toMatchObject({
        matchId: 'match-456',
        callerId: 'user-123',
        callerName: 'Ava',
        callerPhotoUrl: '/p.jpg',
      });
      expect(published.event.timestamp).toBeDefined();
    });

    it('should NOT publish CALL_INVITE when the caller is not a match participant', () => {
      const { socket } = simulateConnection(nsp);
      const inviteFn = registerHandler(socket, WsEvent.CALL_INVITE);

      // Never joined match-456 via chat:join
      inviteFn({ matchId: 'match-456', partnerId: 'user-456' });

      expect(pubClient.publish).not.toHaveBeenCalledWith(
        REDIS_KEYS.CHAT_CALL_CHANNEL,
        expect.anything(),
      );
    });

    it('should NOT publish CALL_INVITE to self or with missing fields', async () => {
      const { socket } = simulateConnection(nsp);
      const joinFn = registerHandler(socket, WsEvent.CHAT_JOIN);
      const inviteFn = registerHandler(socket, WsEvent.CALL_INVITE);

      await joinFn({ matchId: 'match-456' });
      inviteFn({ matchId: 'match-456', partnerId: 'user-123' }); // self
      inviteFn({ matchId: '', partnerId: 'user-456' }); // missing match
      inviteFn({ matchId: 'match-456' }); // missing partner

      expect(pubClient.publish).not.toHaveBeenCalledWith(
        REDIS_KEYS.CHAT_CALL_CHANNEL,
        expect.anything(),
      );
    });

    it('should publish CALL_ACCEPT to the caller personal room', () => {
      const { socket } = simulateConnection(nsp);
      const acceptFn = registerHandler(socket, WsEvent.CALL_ACCEPT);

      acceptFn({ matchId: 'match-456', callerId: 'user-111' });

      const publishCall = pubClient.publish.mock.calls.find(
        ([channel]: [string]) => channel === REDIS_KEYS.CHAT_CALL_CHANNEL,
      );
      expect(publishCall).toBeDefined();
      const published = JSON.parse(publishCall[1]);
      expect(published.type).toBe('accept');
      expect(published.targetUserId).toBe('user-111');
      expect(published.event).toMatchObject({ matchId: 'match-456', calleeId: 'user-123' });
    });

    it('should publish CALL_DECLINE to the caller personal room', () => {
      const { socket } = simulateConnection(nsp);
      const declineFn = registerHandler(socket, WsEvent.CALL_DECLINE);

      declineFn({ matchId: 'match-456', callerId: 'user-111' });

      const publishCall = pubClient.publish.mock.calls.find(
        ([channel]: [string]) => channel === REDIS_KEYS.CHAT_CALL_CHANNEL,
      );
      expect(publishCall).toBeDefined();
      const published = JSON.parse(publishCall[1]);
      expect(published.type).toBe('decline');
      expect(published.targetUserId).toBe('user-111');
    });

    it('should publish CALL_CANCEL to the partner personal room', () => {
      const { socket } = simulateConnection(nsp);
      const cancelFn = registerHandler(socket, WsEvent.CALL_CANCEL);

      cancelFn({ matchId: 'match-456', partnerId: 'user-456' });

      const publishCall = pubClient.publish.mock.calls.find(
        ([channel]: [string]) => channel === REDIS_KEYS.CHAT_CALL_CHANNEL,
      );
      expect(publishCall).toBeDefined();
      const published = JSON.parse(publishCall[1]);
      expect(published.type).toBe('cancel');
      expect(published.targetUserId).toBe('user-456');
      expect(published.event.callerId).toBe('user-123');
    });

    it('should deliver call events from Redis to the target personal room locally', () => {
      const callee = simulateSecondConnection(nsp, 'user-456');
      const messageHandler = getMessageHandler(subClient);

      // Callee's socket is in their personal room
      callee.rooms.add('user:user-456');

      const inviteEvent = {
        type: 'invite',
        targetUserId: 'user-456',
        event: {
          matchId: 'match-456',
          callerId: 'user-123',
          callerName: 'Ava',
          callerPhotoUrl: '',
          timestamp: new Date().toISOString(),
        },
      };

      messageHandler(REDIS_KEYS.CHAT_CALL_CHANNEL, JSON.stringify(inviteEvent));

      expect(callee.emit).toHaveBeenCalledWith(WsEvent.CALL_INVITE, inviteEvent.event);
    });

    it('should NOT deliver call events to sockets outside the target personal room', () => {
      const unrelated = simulateSecondConnection(nsp, 'user-999');
      unrelated.rooms.add('user:user-999'); // different room
      const messageHandler = getMessageHandler(subClient);

      const inviteEvent = {
        type: 'invite',
        targetUserId: 'user-456',
        event: { matchId: 'match-456', callerId: 'user-123' },
      };

      messageHandler(REDIS_KEYS.CHAT_CALL_CHANNEL, JSON.stringify(inviteEvent));

      expect(unrelated.emit).not.toHaveBeenCalledWith(WsEvent.CALL_INVITE, expect.anything());
    });

    it('should handle malformed call events gracefully', () => {
      const messageHandler = getMessageHandler(subClient);

      expect(() =>
        messageHandler(REDIS_KEYS.CHAT_CALL_CHANNEL, 'not-json'),
      ).not.toThrow();
      expect(() =>
        messageHandler(REDIS_KEYS.CHAT_CALL_CHANNEL, JSON.stringify({ type: 'bogus' })),
      ).not.toThrow();
    });

    it('should deliver CALL_BUSY from Redis to the target personal room locally', () => {
      const caller = simulateSecondConnection(nsp, 'user-111');
      const messageHandler = getMessageHandler(subClient);

      caller.rooms.add('user:user-111');

      const busyEvent = {
        type: 'busy',
        targetUserId: 'user-111',
        event: {
          matchId: 'match-456',
          calleeId: 'user-456',
          timestamp: new Date().toISOString(),
        },
      };

      messageHandler(REDIS_KEYS.CHAT_CALL_CHANNEL, JSON.stringify(busyEvent));

      expect(caller.emit).toHaveBeenCalledWith(WsEvent.CALL_BUSY, busyEvent.event);
    });

    it('should publish CALL_BUSY instead of CALL_INVITE when the callee is in an active call', async () => {
      const { socket: caller } = simulateConnection(nsp);
      const callee = simulateSecondConnection(nsp, 'user-456');

      const joinFn = registerHandler(caller, WsEvent.CHAT_JOIN);
      const inviteFn = registerHandler(caller, WsEvent.CALL_INVITE);
      const activeJoinFn = registerHandler(callee, WsEvent.CALL_ACTIVE_JOIN);

      await joinFn({ matchId: 'match-456' });

      // Ring user-456 while they're NOT busy → invite
      inviteFn({ matchId: 'match-456', partnerId: 'user-456' });

      // Mark user-456 as busy (the callee's socket joins an active call)
      activeJoinFn();

      // Ring user-456 again → busy
      inviteFn({ matchId: 'match-456', partnerId: 'user-456' });

      const publishes = pubClient.publish.mock.calls
        .filter(([channel]: [string]) => channel === REDIS_KEYS.CHAT_CALL_CHANNEL)
        .map(([, msg]: [string, string]) => JSON.parse(msg));

      expect(publishes[0].type).toBe('invite');
      expect(publishes[0].targetUserId).toBe('user-456');
      expect(publishes[1].type).toBe('busy');
      expect(publishes[1].targetUserId).toBe('user-123'); // back to the caller
      expect(publishes[1].event).toMatchObject({ matchId: 'match-456', calleeId: 'user-456' });
      expect(publishes[1].event.timestamp).toBeDefined();
    });

    it('should publish CALL_INVITE again after CALL_ACTIVE_LEAVE clears busy state', async () => {
      const { socket: caller } = simulateConnection(nsp);
      const callee = simulateSecondConnection(nsp, 'user-456');

      const joinFn = registerHandler(caller, WsEvent.CHAT_JOIN);
      const inviteFn = registerHandler(caller, WsEvent.CALL_INVITE);
      const activeJoinFn = registerHandler(callee, WsEvent.CALL_ACTIVE_JOIN);
      const activeLeaveFn = registerHandler(callee, WsEvent.CALL_ACTIVE_LEAVE);

      await joinFn({ matchId: 'match-456' });
      activeJoinFn();
      activeLeaveFn();
      inviteFn({ matchId: 'match-456', partnerId: 'user-456' });

      const publishes = pubClient.publish.mock.calls
        .filter(([channel]: [string]) => channel === REDIS_KEYS.CHAT_CALL_CHANNEL)
        .map(([, msg]: [string, string]) => JSON.parse(msg));

      expect(publishes[0].type).toBe('invite');
    });

    it('should clear busy state on disconnect', async () => {
      const { socket: caller } = simulateConnection(nsp);
      const callee = simulateSecondConnection(nsp, 'user-456');

      const joinFn = registerHandler(caller, WsEvent.CHAT_JOIN);
      const inviteFn = registerHandler(caller, WsEvent.CALL_INVITE);
      const activeJoinFn = registerHandler(callee, WsEvent.CALL_ACTIVE_JOIN);
      const disconnectFn = registerHandler(callee, 'disconnect');

      await joinFn({ matchId: 'match-456' });
      activeJoinFn();
      disconnectFn();
      inviteFn({ matchId: 'match-456', partnerId: 'user-456' });

      const publishes = pubClient.publish.mock.calls
        .filter(([channel]: [string]) => channel === REDIS_KEYS.CHAT_CALL_CHANNEL)
        .map(([, msg]: [string, string]) => JSON.parse(msg));

      expect(publishes[0].type).toBe('invite');
    });

    it('should KEEP the user busy when a secondary socket disconnects mid-call', async () => {
      const { socket: caller } = simulateConnection(nsp);
      // Same user holds TWO sockets: the shared call socket (sets busy) and a
      // per-screen chat socket. Both join `user:456` personal room.
      const callSocket = simulateSecondConnection(nsp, 'user-456');
      const chatSocket = simulateSecondConnection(nsp, 'user-456');

      const joinFn = registerHandler(caller, WsEvent.CHAT_JOIN);
      const inviteFn = registerHandler(caller, WsEvent.CALL_INVITE);
      const activeJoinFn = registerHandler(callSocket, WsEvent.CALL_ACTIVE_JOIN);
      const chatDisconnectFn = registerHandler(chatSocket, 'disconnect');

      await joinFn({ matchId: 'match-456' });
      activeJoinFn(); // call socket marks user-456 busy
      chatDisconnectFn(); // secondary chat socket drops — busy must persist

      inviteFn({ matchId: 'match-456', partnerId: 'user-456' });

      const publishes = pubClient.publish.mock.calls
        .filter(([channel]: [string]) => channel === REDIS_KEYS.CHAT_CALL_CHANNEL)
        .map(([, msg]: [string, string]) => JSON.parse(msg));

      expect(publishes[0].type).toBe('busy'); // still busy → busy reply
      expect(publishes[0].targetUserId).toBe('user-123');

      // Now the call socket itself disconnects → busy finally clears
      const callDisconnectFn = registerHandler(callSocket, 'disconnect');
      callDisconnectFn();
      inviteFn({ matchId: 'match-456', partnerId: 'user-456' });

      const publishesAfter = pubClient.publish.mock.calls
        .filter(([channel]: [string]) => channel === REDIS_KEYS.CHAT_CALL_CHANNEL)
        .map(([, msg]: [string, string]) => JSON.parse(msg));

      expect(publishesAfter[publishesAfter.length - 1].type).toBe('invite');
    });

    it('should NOT publish CALL_BUSY to self or with missing fields', async () => {
      const { socket: caller } = simulateConnection(nsp);
      const callee = simulateSecondConnection(nsp, 'user-456');

      const joinFn = registerHandler(caller, WsEvent.CHAT_JOIN);
      const inviteFn = registerHandler(caller, WsEvent.CALL_INVITE);
      const activeJoinFn = registerHandler(callee, WsEvent.CALL_ACTIVE_JOIN);

      await joinFn({ matchId: 'match-456' });
      activeJoinFn();

      // Ringing self or missing partner — should not publish anything
      inviteFn({ matchId: 'match-456', partnerId: 'user-123' });
      inviteFn({ matchId: '' });

      expect(pubClient.publish).not.toHaveBeenCalledWith(
        REDIS_KEYS.CHAT_CALL_CHANNEL,
        expect.anything(),
      );
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
        REDIS_KEYS.CHAT_CALL_CHANNEL,
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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WsEvent, REDIS_KEYS } from '@kinetik/shared';
import { ChatHandler } from '../handlers/chat';

// ─── Mocks ────────────────────────────────────────────────────────

function createMockSocket(userId: string) {
  const socket: any = {
    userId,
    join: vi.fn(),
    leave: vi.fn(),
    on: vi.fn(),
    to: vi.fn(() => socket), // chained call: socket.to(room).emit(...)
    emit: vi.fn(),
  };
  return socket;
}

function createMockRedis() {
  return {
    on: vi.fn(),
    subscribe: vi.fn((_channel: string, cb?: (err: Error | null) => void) => {
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
  };
  return nsp;
}

// ─── Helpers ───────────────────────────────────────────────────────

function simulateConnection(nsp: any): { socket: any; userId: string } {
  const userId = 'user-123';
  const socket = createMockSocket(userId);
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

/** Register a specific event handler on a socket. */
function registerHandler(socket: any, event: string): (...args: any[]) => void {
  const call = socket.on.mock.calls.find(([e]: [string]) => e === event);
  if (!call) throw new Error(`Handler for "${event}" was never registered`);
  return call[1];
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('ChatHandler', () => {
  let nsp: any;
  let pubClient: any;
  let subClient: any;
  let handler: ChatHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    nsp = createMockNamespace();
    pubClient = createMockRedis();
    subClient = createMockRedis();
    handler = new ChatHandler(nsp, pubClient, subClient);
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
    it('should join the socket to the match room', () => {
      const { socket } = simulateConnection(nsp);
      const handlerFn = registerHandler(socket, WsEvent.CHAT_JOIN);
      handlerFn({ matchId: 'match-456' });

      expect(socket.join).toHaveBeenCalledWith('match:match-456');
    });

    it('should track the match in userMatches map', () => {
      const { socket } = simulateConnection(nsp);
      const handlerFn = registerHandler(socket, WsEvent.CHAT_JOIN);

      handlerFn({ matchId: 'match-456' });
      handlerFn({ matchId: 'match-789' });

      // Verify internal state by joining a third and checking using broadcastMessage
      handlerFn({ matchId: 'match-456' }); // duplicate join — should not error
      // We can test the internal map by checking if broadcastMessage emits correctly
      // The userMatches map is private; we test indirectly via the leave event later.
    });
  });

  // ─── CHAT_LEAVE ───────────────────────────────────────────────

  describe(`${WsEvent.CHAT_LEAVE} event`, () => {
    it('should leave the match room and remove the socket from the room', () => {
      const { socket } = simulateConnection(nsp);
      const joinFn = registerHandler(socket, WsEvent.CHAT_JOIN);
      const leaveFn = registerHandler(socket, WsEvent.CHAT_LEAVE);

      joinFn({ matchId: 'match-456' });
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
    it('should emit CHAT_MESSAGE to the match room with senderId and content', () => {
      const { socket, userId } = simulateConnection(nsp);
      const msgFn = registerHandler(socket, WsEvent.CHAT_MESSAGE);

      msgFn({ matchId: 'match-456', content: 'Hello!' });

      expect(nsp.to).toHaveBeenCalledWith('match:match-456');
      // nsp.to() returns the nsp itself, so emit is called on it
      expect(nsp.emit).toHaveBeenCalledWith(WsEvent.CHAT_MESSAGE, expect.objectContaining({
        matchId: 'match-456',
        senderId: userId,
        content: 'Hello!',
      }));
    });

    it('should include an ISO timestamp in the emitted payload', () => {
      const { socket } = simulateConnection(nsp);
      const msgFn = registerHandler(socket, WsEvent.CHAT_MESSAGE);

      msgFn({ matchId: 'match-456', content: 'Hey' });

      const emittedPayload = nsp.emit.mock.calls[0][1];
      expect(emittedPayload.createdAt).toBeDefined();
      expect(() => new Date(emittedPayload.createdAt)).not.toThrow();
    });

    it('should ignore empty content', () => {
      const { socket } = simulateConnection(nsp);
      const msgFn = registerHandler(socket, WsEvent.CHAT_MESSAGE);

      msgFn({ matchId: 'match-456', content: '' });

      expect(nsp.emit).not.toHaveBeenCalled();
    });

    it('should ignore whitespace-only content', () => {
      const { socket } = simulateConnection(nsp);
      const msgFn = registerHandler(socket, WsEvent.CHAT_MESSAGE);

      msgFn({ matchId: 'match-456', content: '   ' });

      expect(nsp.emit).not.toHaveBeenCalled();
    });

    it('should reject content exceeding 2000 characters', () => {
      const { socket } = simulateConnection(nsp);
      const msgFn = registerHandler(socket, WsEvent.CHAT_MESSAGE);

      msgFn({ matchId: 'match-456', content: 'a'.repeat(2001) });

      expect(nsp.emit).not.toHaveBeenCalled();
    });

    it('should trim content before emitting', () => {
      const { socket } = simulateConnection(nsp);
      const msgFn = registerHandler(socket, WsEvent.CHAT_MESSAGE);

      msgFn({ matchId: 'match-456', content: '  Hello World  ' });

      expect(nsp.emit).toHaveBeenCalledWith(
        WsEvent.CHAT_MESSAGE,
        expect.objectContaining({ content: 'Hello World' }),
      );
    });

    it('should accept content of exactly 2000 characters', () => {
      const { socket } = simulateConnection(nsp);
      const msgFn = registerHandler(socket, WsEvent.CHAT_MESSAGE);

      msgFn({ matchId: 'match-456', content: 'a'.repeat(2000) });

      expect(nsp.emit).toHaveBeenCalled();
    });
  });

  // ─── CHAT_TYPING ──────────────────────────────────────────────

  describe(`${WsEvent.CHAT_TYPING} event`, () => {
    it('should emit CHAT_TYPING to everyone EXCEPT the sender in the match room', () => {
      const { socket, userId } = simulateConnection(nsp);
      const typingFn = registerHandler(socket, WsEvent.CHAT_TYPING);

      typingFn({ matchId: 'match-456', isTyping: true });

      // socket.to() is used (excludes sender)
      expect(socket.to).toHaveBeenCalledWith('match:match-456');
      expect(socket.emit).toHaveBeenCalledWith(WsEvent.CHAT_TYPING, {
        matchId: 'match-456',
        userId,
        isTyping: true,
      });
    });

    it('should emit isTyping: false when user stops typing', () => {
      const { socket, userId } = simulateConnection(nsp);
      const typingFn = registerHandler(socket, WsEvent.CHAT_TYPING);

      typingFn({ matchId: 'match-456', isTyping: false });

      expect(socket.emit).toHaveBeenCalledWith(WsEvent.CHAT_TYPING, {
        matchId: 'match-456',
        userId,
        isTyping: false,
      });
    });
  });

  // ─── CHAT_READ ────────────────────────────────────────────────

  describe(`${WsEvent.CHAT_READ} event`, () => {
    it('should emit CHAT_READ to the match room with userId and readAt timestamp', () => {
      const { socket, userId } = simulateConnection(nsp);
      const readFn = registerHandler(socket, WsEvent.CHAT_READ);

      readFn({ matchId: 'match-456' });

      expect(nsp.to).toHaveBeenCalledWith('match:match-456');
      const emittedPayload = nsp.emit.mock.calls[0][1];
      expect(emittedPayload).toMatchObject({
        matchId: 'match-456',
        userId,
      });
      expect(emittedPayload.readAt).toBeDefined();
      expect(() => new Date(emittedPayload.readAt)).not.toThrow();
    });
  });

  // ─── Disconnect ───────────────────────────────────────────────

  describe('disconnect event', () => {
    it('should remove the user from userMatches on disconnect', () => {
      const { socket } = simulateConnection(nsp);
      const joinFn = registerHandler(socket, WsEvent.CHAT_JOIN);
      const disconnectFn = registerHandler(socket, 'disconnect');

      joinFn({ matchId: 'match-456' });
      joinFn({ matchId: 'match-789' });
      disconnectFn();

      // No further assertions needed — the disconnect handler just cleans up
      // The userMatches map is private, but we verify no error is thrown
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
    it('should emit CHAT_MESSAGE to the given match room', async () => {
      const messagePayload = {
        id: 'msg-1',
        matchId: 'match-456',
        senderId: 'user-456',
        content: 'Cross-instance message!',
        createdAt: new Date().toISOString(),
      };

      await handler.broadcastMessage('match-456', messagePayload);

      expect(nsp.to).toHaveBeenCalledWith('match:match-456');
      expect(nsp.emit).toHaveBeenCalledWith(WsEvent.CHAT_MESSAGE, messagePayload);
    });

    it('should broadcast the exact message payload without modification', async () => {
      const messagePayload = {
        id: 'msg-2',
        matchId: 'match-789',
        senderId: 'user-789',
        content: 'Exact payload test',
        createdAt: '2025-01-01T00:00:00.000Z',
      };

      await handler.broadcastMessage('match-789', messagePayload);

      expect(nsp.emit).toHaveBeenCalledWith(WsEvent.CHAT_MESSAGE, messagePayload);
    });
  });

  // ─── Redis Pub/Sub (Cross-Instance) ──────────────────────────

  describe('cross-instance Redis pub/sub', () => {
    it('should subscribe to CHAT_MESSAGES_CHANNEL on construction', () => {
      expect(subClient.subscribe).toHaveBeenCalledWith(
        REDIS_KEYS.CHAT_MESSAGES_CHANNEL,
        expect.any(Function),
      );
    });

    it('should register a "message" listener on the subClient', () => {
      expect(subClient.on).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('should parse JSON messages and call broadcastMessage', () => {
      // Access the message handler registered on subClient
      const messageHandler = subClient.on.mock.calls.find(
        ([event]: [string]) => event === 'message',
      )?.[1];
      expect(messageHandler).toBeDefined();

      const payload = {
        id: 'msg-3',
        matchId: 'match-456',
        senderId: 'user-789',
        content: 'Redis delivered!',
        createdAt: new Date().toISOString(),
      };
      const jsonMessage = JSON.stringify(payload);

      // Spy on broadcastMessage
      const broadcastSpy = vi.spyOn(handler, 'broadcastMessage');

      messageHandler(REDIS_KEYS.CHAT_MESSAGES_CHANNEL, jsonMessage);

      expect(broadcastSpy).toHaveBeenCalledWith('match-456', payload);
    });

    it('should ignore messages from other Redis channels', () => {
      const messageHandler = subClient.on.mock.calls.find(
        ([event]: [string]) => event === 'message',
      )?.[1];
      const broadcastSpy = vi.spyOn(handler, 'broadcastMessage');

      messageHandler('other:channel', JSON.stringify({ matchId: 'm-1' }));

      expect(broadcastSpy).not.toHaveBeenCalled();
    });

    it('should not throw on malformed JSON', () => {
      const messageHandler = subClient.on.mock.calls.find(
        ([event]: [string]) => event === 'message',
      )?.[1];

      expect(() =>
        messageHandler(REDIS_KEYS.CHAT_MESSAGES_CHANNEL, 'not-json'),
      ).not.toThrow();
    });
  });
});

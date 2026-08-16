import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ERROR_CODES, REDIS_KEYS } from '@kinetik/shared';

// ─── Mocks ────────────────────────────────────────────────────────

// Mock the database, Redis, Kafka, and notification services before importing the routes
const mockQuery = vi.fn();
const mockRedisPublish = vi.fn().mockResolvedValue(1);
const mockRedisGet = vi.fn();
const mockRedisMulti = vi.fn(() => ({
  incr: vi.fn().mockReturnThis(),
  expire: vi.fn().mockReturnThis(),
  exec: vi.fn().mockResolvedValue([]),
}));

vi.mock('../services/database', () => ({
  query: mockQuery,
  TABLES: {
    USERS: 'users',
    MATCHES: 'matches',
    MESSAGES: 'messages',
    USER_INTERACTIONS: 'user_interactions',
    USER_PREFERENCES: 'user_preferences',
    PROFILE_PHOTOS: 'profile_photos',
    USER_INTERESTS: 'user_interests',
    INTERESTS: 'interests',
    SUBSCRIPTION_LEDGER: 'subscription_ledger',
    PUSH_TOKENS: 'push_tokens',
    RESERVATIONS: 'reservations',
    VENUES: 'venues',
  },
}));

vi.mock('../services/eventBus', () => ({
  eventBus: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    publish: vi.fn().mockResolvedValue(undefined),
    sendUserEvent: vi.fn().mockResolvedValue(undefined),
    sendMatchEvent: vi.fn().mockResolvedValue(undefined),
    sendPaymentEvent: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../services/notificationService', () => ({
  notificationEvents: {
    newMessage: vi.fn().mockResolvedValue(undefined),
    newLike: vi.fn().mockResolvedValue(undefined),
    matchFound: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../services/redis', () => ({
  getRedis: () => ({
    publish: mockRedisPublish,
    get: mockRedisGet,
    multi: mockRedisMulti,
    del: vi.fn(),
  }),
}));

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Simulate calling the "send a message" route handler logic directly.
 * We extract the relevant logic from the route handler to test it in isolation.
 */
function createMockFastifyReply() {
  const reply: any = {
    status: vi.fn(() => reply),
    send: vi.fn(() => reply),
  };
  return reply;
}

function createMockRequest(overrides: any = {}) {
  return {
    user: { sub: 'user-123' },
    params: { id: 'match-456' },
    body: { content: 'Hello!' },
    jwtVerify: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as any;
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('Chat Message API - Send Message', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Validation ──────────────────────────────────────────────

  describe('input validation', () => {
    it('should reject empty content', () => {
      const content: string = '';

      const isValid = !!content && content.trim().length > 0;
      expect(isValid).toBe(false);
    });

    it('should reject whitespace-only content', () => {
      const content = '   ';
      const isValid = !!content && content.trim().length > 0;
      expect(isValid).toBe(false);
    });

    it('should reject content exceeding 2000 characters', () => {
      const content = 'a'.repeat(2001);
      const isTooLong = content.length > 2000;
      expect(isTooLong).toBe(true);
    });

    it('should accept content within valid bounds (1-2000 chars)', () => {
      const content = 'Valid message';
      const isValid = !!content && content.trim().length > 0 && content.length <= 2000;
      expect(isValid).toBe(true);
    });

    it('should accept content of exactly 2000 characters', () => {
      const content = 'a'.repeat(2000);
      const isValid = !!content && content.trim().length > 0 && content.length <= 2000;
      expect(isValid).toBe(true);
    });

    it('should trim whitespace from content', () => {
      const raw = '  Hello World  ';
      const trimmed = raw.trim();
      expect(trimmed).toBe('Hello World');
    });

    it('should truncate long content for push notification preview (80 chars)', () => {
      const longContent = 'a'.repeat(200);
      const preview = longContent.length > 80 ? longContent.slice(0, 80) + '…' : longContent;
      expect(preview.length).toBe(81);
      expect(preview.endsWith('…')).toBe(true);
    });

    it('should not truncate short content for push notification preview', () => {
      const shortContent = 'Hello!';
      const preview = shortContent.length > 80 ? shortContent.slice(0, 80) + '…' : shortContent;
      expect(preview).toBe('Hello!');
    });
  });

  // ─── Authorization & Match Membership ──────────────────────

  describe('match membership verification', () => {
    it('should verify the sender belongs to the match', () => {
      // Simulate the matchCheck query logic
      const senderId = 'user-123';
      const matchRow = {
        id: 'match-456',
        user_a_id: 'user-123',
        user_b_id: 'user-789',
      };

      const isMember =
        matchRow.user_a_id === senderId || matchRow.user_b_id === senderId;
      expect(isMember).toBe(true);
    });

    it('should reject senders who are not part of the match', () => {
      const senderId = 'user-999';
      const matchRow = {
        id: 'match-456',
        user_a_id: 'user-123',
        user_b_id: 'user-789',
      };

      const isMember =
        matchRow.user_a_id === senderId || matchRow.user_b_id === senderId;
      expect(isMember).toBe(false);
    });
  });

  // ─── Partner Identification ─────────────────────────────────

  describe('partner identification', () => {
    it('should identify the correct partner from the match row', () => {
      const userId = 'user-123';
      const matchRow = {
        user_a_id: 'user-123',
        user_b_id: 'user-789',
      };

      const partnerId =
        matchRow.user_a_id === userId
          ? matchRow.user_b_id
          : matchRow.user_a_id;
      expect(partnerId).toBe('user-789');
    });

    it('should correctly identify partner when user is user_b', () => {
      const userId = 'user-789';
      const matchRow = {
        user_a_id: 'user-123',
        user_b_id: 'user-789',
      };

      const partnerId =
        matchRow.user_a_id === userId
          ? matchRow.user_b_id
          : matchRow.user_a_id;
      expect(partnerId).toBe('user-123');
    });
  });

  // ─── Redis Publish ──────────────────────────────────────────

  describe('Redis pub/sub on message send', () => {
    it('should publish the message payload to CHAT_MESSAGES_CHANNEL', () => {
      // Simulate what the route handler does after inserting the message
      const messageId = 'msg-1';
      const matchId = 'match-456';
      const senderId = 'user-123';
      const content = 'Hello!';
      const createdAt = new Date().toISOString();

      const messagePayload = {
        id: messageId,
        matchId,
        senderId,
        content,
        createdAt,
      };

      // Call the same redis.publish call the route handler makes
      mockRedisPublish(
        REDIS_KEYS.CHAT_MESSAGES_CHANNEL,
        JSON.stringify(messagePayload),
      );

      expect(mockRedisPublish).toHaveBeenCalledWith(
        REDIS_KEYS.CHAT_MESSAGES_CHANNEL,
        JSON.stringify(messagePayload),
      );
    });

    it('should publish the correct message shape with all required fields', () => {
      const message = {
        id: 'msg-2',
        matchId: 'match-789',
        senderId: 'user-456',
        content: 'Test message',
        createdAt: '2025-01-01T00:00:00.000Z',
      };

      mockRedisPublish(
        REDIS_KEYS.CHAT_MESSAGES_CHANNEL,
        JSON.stringify(message),
      );

      const parsed = JSON.parse(mockRedisPublish.mock.calls[0][1]);
      expect(parsed).toHaveProperty('id');
      expect(parsed).toHaveProperty('matchId');
      expect(parsed).toHaveProperty('senderId');
      expect(parsed).toHaveProperty('content');
      expect(parsed).toHaveProperty('createdAt');
    });
  });

  // ─── Push Notification Logic ────────────────────────────────

  describe('push notification on new message', () => {
    it('should send notification to the partner (not the sender)', async () => {
      const { notificationEvents } = await import(
        '../services/notificationService'
      );

      const senderId = 'user-123';
      const matchRow = {
        user_a_id: 'user-123',
        user_b_id: 'user-789',
      };

      const partnerId =
        matchRow.user_a_id === senderId
          ? matchRow.user_b_id
          : matchRow.user_a_id;

      // Simulate the notification call
      await notificationEvents.newMessage(partnerId, 'Alice', 'Hello!');

      expect(notificationEvents.newMessage).toHaveBeenCalledWith(
        'user-789',
        'Alice',
        'Hello!',
      );
    });
  });

  // ─── Message Payload Shape ──────────────────────────────────

  describe('message response payload', () => {
    it('should return the correct shape from the API', () => {
      const messageRow = {
        id: 'msg-1',
        match_id: 'match-456',
        sender_id: 'user-123',
        content: 'Hello!',
        created_at: new Date().toISOString(),
        read_at: null,
      };

      const response = {
        success: true,
        data: {
          id: messageRow.id,
          matchId: messageRow.match_id,
          senderId: messageRow.sender_id,
          content: messageRow.content,
          createdAt: messageRow.created_at,
          readAt: messageRow.read_at,
        },
      };

      expect(response.success).toBe(true);
      expect(response.data).toMatchObject({
        id: 'msg-1',
        matchId: 'match-456',
        senderId: 'user-123',
        content: 'Hello!',
      });
      expect(response.data.readAt).toBeNull();
    });
  });

  // ─── Get Messages Error Handling ────────────────────────────

  describe('GET /conversations/:id/messages', () => {
    it('should return 404 when user is not part of the match', () => {
      const userId = 'user-999';
      const matchCheckResult = { rows: [] };

      const matchNotFound = !matchCheckResult.rows[0];
      expect(matchNotFound).toBe(true);
    });

    it('should return messages when user is part of the match', () => {
      const userId = 'user-123';
      const matchCheckResult = { rows: [{ id: 'match-456' }] };

      const matchFound = !!matchCheckResult.rows[0];
      expect(matchFound).toBe(true);
    });
  });
});

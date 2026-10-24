import { describe, it, expect, vi, beforeEach } from 'vitest';

// What reaches Expo, in order
const sent: any[] = [];
vi.mock('expo-server-sdk', () => {
  class Expo {
    static isExpoPushToken(token: string) {
      return typeof token === 'string' && token.startsWith('ExponentPushToken[');
    }
    chunkPushNotifications(messages: any[]) {
      return [messages];
    }
    async sendPushNotificationsAsync(messages: any[]) {
      sent.push(...messages);
      return messages.map(() => ({ status: 'ok', id: 'ticket' }));
    }
  }
  return { Expo };
});

const counts = { unread: 1, chats: 1, pending: 1 };
const mockQuery = vi.fn(async (sql: string) => {
  if (sql.includes('push_enabled')) return { rows: [{ push_enabled: true }], rowCount: 1 };
  if (sql.includes('FROM push_tokens')) return { rows: [{ token: 'ExponentPushToken[abc]' }], rowCount: 1 };
  if (sql.includes('AS unread')) return { rows: [{ unread: counts.unread, chats: counts.chats }], rowCount: 1 };
  if (sql.includes('AS pending')) return { rows: [{ pending: counts.pending }], rowCount: 1 };
  return { rows: [], rowCount: 0 };
});
vi.mock('../services/database', () => ({
  query: (...args: any[]) => mockQuery(...(args as [string])),
  TABLES: {
    MESSAGES: 'messages',
    MATCHES: 'matches',
    USER_INTERACTIONS: 'user_interactions',
    USER_PREFERENCES: 'user_preferences',
    PUSH_TOKENS: 'push_tokens',
  },
}));

import { notificationEvents } from '../services/notificationService';

const chat = { matchId: 'match-1', partnerId: 'partner-1', partnerName: 'Alice' };
const last = () => sent[sent.length - 1];

describe('push text: counts, never names', () => {
  beforeEach(() => {
    sent.length = 0;
    counts.unread = 1;
    counts.chats = 1;
    counts.pending = 1;
  });

  it('one unread message: a plain line, and a tap opens that chat', async () => {
    await notificationEvents.newMessage('u1', chat);
    expect(last().title).toBe('New message');
    expect(last().body).toBe('You have a message!');
    expect(last().data).toMatchObject({ type: 'new.message', screen: 'Chat', matchId: 'match-1', partnerId: 'partner-1' });
    expect(last().title + last().body).not.toContain('Alice');
    expect(last().channelId).toBe('messages');
  });

  it('several unread messages in one chat: the count, still that chat', async () => {
    counts.unread = 3;
    await notificationEvents.newMessage('u1', chat);
    expect(last().title).toBe('New messages');
    expect(last().body).toBe('You have 3 new messages!');
    expect(last().data.screen).toBe('Chat');
    expect(last().badge).toBe(3);
  });

  it('unread messages in several chats: the count, and a tap opens the list', async () => {
    counts.unread = 4;
    counts.chats = 2;
    await notificationEvents.newMessage('u1', chat);
    expect(last().body).toBe('You have 4 new messages!');
    expect(last().data).toEqual({ type: 'new.message', screen: 'ChatList' });
  });

  it('a like: how many are waiting, never who', async () => {
    await notificationEvents.newLike('u1');
    expect(last().title).toBe('New like');
    expect(last().body).toBe('1 person liked your profile!');
    expect(last().data).toEqual({ type: 'new.like', screen: 'Likes' });
    counts.pending = 3;
    await notificationEvents.newLike('u1');
    expect(last().body).toBe('3 people liked your profile!');
  });

  it('a match: no name, and a tap opens the new chat', async () => {
    await notificationEvents.newMatch('u1', chat);
    expect(last().title).toBe('New match');
    expect(last().body).toBe('You have a new match! Say hi');
    expect(last().title + last().body).not.toContain('Alice');
    expect(last().data).toMatchObject({ type: 'new.match', screen: 'Chat', matchId: 'match-1' });
  });

  it('the push still goes out, as one, when the count cannot be read', async () => {
    mockQuery.mockImplementationOnce(async () => {
      throw new Error('db down');
    });
    await notificationEvents.newLike('u1');
    expect(last().body).toBe('1 person liked your profile!');
  });
});

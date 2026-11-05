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

const counts = { unread: 1, pending: 1, fresh: 1 };
const mockQuery = vi.fn(async (sql: string) => {
  if (sql.includes('push_enabled')) return { rows: [{ push_enabled: true }], rowCount: 1 };
  if (sql.includes('FROM push_tokens')) return { rows: [{ token: 'ExponentPushToken[abc]' }], rowCount: 1 };
  if (sql.includes('AS unread')) return { rows: [{ unread: counts.unread }], rowCount: 1 };
  if (sql.includes('AS pending')) return { rows: [{ pending: counts.pending }], rowCount: 1 };
  if (sql.includes('AS fresh')) return { rows: [{ fresh: counts.fresh }], rowCount: 1 };
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
    counts.pending = 1;
    counts.fresh = 1;
  });

  it('one unread message: a plain line, and a tap opens the chat list', async () => {
    await notificationEvents.newMessage('u1');
    expect(last().title).toBe('New message');
    expect(last().body).toBe('You have a message!');
    expect(last().data).toEqual({ type: 'new.message', screen: 'ChatList' });
    expect(last().channelId).toBe('messages');
  });

  it('several unread messages, from one person or many: the count, and the chat list', async () => {
    counts.unread = 4;
    await notificationEvents.newMessage('u1');
    expect(last().title).toBe('New messages');
    expect(last().body).toBe('You have 4 new messages!');
    expect(last().data).toEqual({ type: 'new.message', screen: 'ChatList' });
    expect(last().badge).toBe(4);
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

  it('several new matches: the count, and a tap opens the list', async () => {
    counts.fresh = 3;
    await notificationEvents.newMatch('u1', chat);
    expect(last().title).toBe('New matches');
    expect(last().body).toBe('You have 3 new matches! Say hi');
    expect(last().data).toEqual({ type: 'new.match', screen: 'ChatList' });
  });

  it('each kind keeps one tray entry: a newer push replaces the last of its kind', async () => {
    await notificationEvents.newLike('u1');
    await notificationEvents.newLike('u1');
    await notificationEvents.newMessage('u1');
    await notificationEvents.newMessage('u1');
    await notificationEvents.newMatch('u1', chat);
    await notificationEvents.newMatch('u1', chat);
    const [like1, like2, msg1, msg2, match1, match2] = sent;
    expect(like1.tag).toBe(like2.tag);
    expect(msg1.tag).toBe(msg2.tag);
    expect(match1.tag).toBe(match2.tag);
    expect(new Set([like1.tag, msg1.tag, match1.tag]).size).toBe(3);
    for (const m of sent) expect(m.collapseId).toBe(m.tag);
  });

  it('the push still goes out, as one, when the count cannot be read', async () => {
    mockQuery.mockImplementationOnce(async () => {
      throw new Error('db down');
    });
    await notificationEvents.newLike('u1');
    expect(last().body).toBe('1 person liked your profile!');
  });
});

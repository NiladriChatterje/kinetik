import { describe, it, expect } from 'vitest';
import { isMessageId, quoteFromRow, REPLY_SNIPPET_MAX } from '../services/messageReply';

// ─── Swipe-to-reply: the quote a reply carries ─────────────────────

describe('isMessageId', () => {
  it('accepts a UUID and nothing else', () => {
    expect(isMessageId('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(isMessageId('not-an-id')).toBe(false);
    expect(isMessageId('')).toBe(false);
    expect(isMessageId(undefined)).toBe(false);
    expect(isMessageId(42)).toBe(false);
  });
});

describe('quoteFromRow', () => {
  const id = '22222222-2222-4222-8222-222222222222';

  it('carries the text and sender of a text message', () => {
    expect(quoteFromRow({ id, sender_id: 'u1', content: 'Coffee first, plans later', media_type: null })).toEqual({
      id, senderId: 'u1', content: 'Coffee first, plans later', mediaType: null,
    });
  });

  it('cuts a long text to a snippet', () => {
    const long = 'x'.repeat(REPLY_SNIPPET_MAX + 50);
    const quote = quoteFromRow({ id, sender_id: 'u1', content: long });
    expect(quote!.content.length).toBe(REPLY_SNIPPET_MAX);
    expect(quote!.content.endsWith('…')).toBe(true);
  });

  it('keeps the media kind for a photo or voice message without text', () => {
    expect(quoteFromRow({ id, sender_id: 'u2', content: '', media_type: 'audio' })).toEqual({
      id, senderId: 'u2', content: '', mediaType: 'audio',
    });
    expect(quoteFromRow({ id, sender_id: 'u2', content: null, media_type: 'image' })!.mediaType).toBe('image');
  });

  it('is null when there is nothing quoted', () => {
    expect(quoteFromRow(null)).toBeNull();
    expect(quoteFromRow(undefined)).toBeNull();
    expect(quoteFromRow({ id: '', sender_id: 'u1', content: 'x' })).toBeNull();
  });
});

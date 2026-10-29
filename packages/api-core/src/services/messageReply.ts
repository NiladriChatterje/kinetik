/**
 * Swipe-to-reply: what a reply carries of the message it answers. The quote
 * is built from the quoted row at send time and again when history is
 * read, so a bubble can show it without another request. Only the first
 * REPLY_SNIPPET_MAX characters travel; the bubble shows two lines at most.
 */

export const REPLY_SNIPPET_MAX = 160;

export interface ReplyQuote {
  id: string;
  senderId: string;
  /** The quoted text, already decrypted, cut to a snippet; '' for media without a caption */
  content: string;
  /** image / video / audio / file when the quoted message was media, else null */
  mediaType: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A reply id the route will look up: a UUID string. Anything else is refused. */
export function isMessageId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** The quote for a quoted row (plain content), or null when there is none. */
export function quoteFromRow(
  row: { id: string; sender_id: string; content: string | null; media_type?: string | null } | null | undefined,
): ReplyQuote | null {
  if (!row || !row.id) return null;
  const text = (row.content ?? '').trim();
  return {
    id: row.id,
    senderId: row.sender_id,
    content: text.length > REPLY_SNIPPET_MAX ? `${text.slice(0, REPLY_SNIPPET_MAX - 1)}…` : text,
    mediaType: row.media_type ?? null,
  };
}

import { Linking } from 'react-native';

/**
 * Web links inside free text, for chat messages: found, split out of the
 * text around them, and opened through the system so the app that owns
 * the link (Instagram, YouTube, Maps…) takes it when installed and the
 * browser does otherwise.
 */

export interface TextPart {
  text: string;
  /** Present on a link: the address to open, with a scheme */
  url?: string;
}

// Endings common enough in chat to be taken as a link without a scheme or
// "www.": "example.com", "x.co.in", "site.app/page". Anything else needs
// http(s):// or www. in front, so "node.js", "e.g." and "1.5" stay text.
const BARE_TLDS = [
  'com', 'net', 'org', 'in', 'co', 'io', 'me', 'app', 'dev', 'xyz', 'info',
  'biz', 'edu', 'gov', 'tv', 'ly', 'gl', 'be', 'to', 'us', 'uk', 'ai', 'sh',
  'link', 'site', 'online', 'store', 'shop', 'live', 'news', 'blog', 'page',
  'tech', 'club',
].join('|');

// Group 1: the character before the link (or the start), so a link never
// starts in the middle of a word or after "@" (an email address is not a
// link). Group 2: the link itself. No lookbehind, which Hermes may lack.
const LINK_RE = new RegExp(
  '(^|[^A-Za-z0-9@._\\-/])'
  + '('
  + '(?:https?://|www\\.)[^\\s<>"\'`]+'
  + '|'
  + `(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\\.)+(?:${BARE_TLDS})(?:\\.[A-Za-z]{2})?(?![A-Za-z0-9-])(?::\\d{2,5})?(?:/[^\\s<>"'\`]*)?`
  + ')',
  'gi',
);

/** Punctuation that ends a sentence, not a link: "see x.com." or "(x.com)" */
function trimTrailing(raw: string): string {
  let s = raw;
  for (;;) {
    const last = s[s.length - 1];
    if (last === undefined) return s;
    if ('.,;:!?\'"'.includes(last)) {
      s = s.slice(0, -1);
      continue;
    }
    if ((last === ')' || last === ']' || last === '}')) {
      const open = last === ')' ? '(' : last === ']' ? '[' : '{';
      const opens = s.split(open).length - 1;
      const closes = s.split(last).length - 1;
      if (closes > opens) {
        s = s.slice(0, -1);
        continue;
      }
    }
    return s;
  }
}

/** The address as the system expects it: a scheme in front when the text has none */
export function normalizeUrl(link: string): string {
  if (/^https?:\/\//i.test(link)) return link;
  return `https://${link}`;
}

/**
 * The text split into plain runs and links, in order. Text without a link
 * comes back as one plain part.
 */
export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let cursor = 0;
  LINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LINK_RE.exec(text)) !== null) {
    const lead = match[1];
    const link = trimTrailing(match[2]);
    if (!link) continue;
    const start = match.index + lead.length;
    const end = start + link.length;
    if (start > cursor) parts.push({ text: text.slice(cursor, start) });
    parts.push({ text: link, url: normalizeUrl(link) });
    cursor = end;
    // The trimmed punctuation is text again; scanning resumes right after the link
    LINK_RE.lastIndex = end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  if (parts.length === 0) parts.push({ text });
  return parts;
}

/**
 * Opens a link through the system: the app registered for it when there is
 * one, otherwise the default browser. Resolves false when nothing could
 * take it, so the caller can say so.
 */
export async function openLink(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

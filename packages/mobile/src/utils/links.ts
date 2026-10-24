import { Linking } from 'react-native';

/**
 * Web links inside free text, for chat messages: found, split out of the
 * text around them, and opened through the system so the app that owns
 * the link (Instagram, YouTube, Maps…) takes it when installed and the
 * browser does otherwise.
 *
 * The text is read one whitespace-separated token at a time and each
 * token is matched against three plain patterns, so no regex feature
 * beyond ES5 is used: Hermes runs all of this exactly as Node does.
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

/** http:// or https:// followed by at least one host character */
const SCHEME_RE = /^https?:\/\/[^\s/]+/i;
/** www. then a host with at least one more dot: www.abc.tld, www.abc.tld/x */
const WWW_RE = /^www\.[^\s.]+\.\S+$/i;
/** host.tld, host.tld:port, host.tld/path, with "tld" from the list above */
const BARE_RE = new RegExp(
  '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*'
  + `\\.(?:${BARE_TLDS})(?:\\.[a-z]{2})?(?::\\d{2,5})?(?:/\\S*)?$`,
  'i',
);

/** Characters that wrap a link in prose and are not part of it: ("<[{ */
const LEADING_WRAP = '("\'<[{';
/** Punctuation that ends a sentence, not a link: "see x.com." or "x.com," */
const TRAILING_PUNCT = '.,;:!?\'">';
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

function countOf(s: string, ch: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === ch) n++;
  return n;
}

/** How many characters at the end of the token belong to the sentence, not the link */
function trailingLength(token: string): number {
  let end = token.length;
  for (;;) {
    const last = token[end - 1];
    if (last === undefined) return token.length - end;
    if (TRAILING_PUNCT.indexOf(last) >= 0) {
      end--;
      continue;
    }
    const opener = CLOSERS[last];
    if (opener !== undefined) {
      const core = token.slice(0, end);
      if (countOf(core, last) > countOf(core, opener)) {
        end--;
        continue;
      }
    }
    return token.length - end;
  }
}

/** The address as the system expects it: a scheme in front when the text has none */
export function normalizeUrl(link: string): string {
  if (/^https?:\/\//i.test(link)) return link;
  return `https://${link}`;
}

/** The address a bare token points at, or null when the token is not a link */
function linkOf(core: string): string | null {
  if (SCHEME_RE.test(core)) return core;
  // An email address is not a link, and neither is anything with "@" in
  // its host; with a scheme in front "@" is allowed (user@host)
  if (core.indexOf('@') >= 0) return null;
  if (WWW_RE.test(core)) return normalizeUrl(core);
  if (BARE_RE.test(core)) return normalizeUrl(core);
  return null;
}

/**
 * The text split into plain runs and links, in order. Text without a link
 * comes back as one plain part.
 */
export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let cursor = 0;
  const tokens = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(text)) !== null) {
    const token = match[0];
    let lead = 0;
    while (lead < token.length && LEADING_WRAP.indexOf(token[lead]) >= 0) lead++;
    const trail = trailingLength(token.slice(lead));
    const core = token.slice(lead, token.length - trail);
    if (!core) continue;
    const url = linkOf(core);
    if (!url) continue;
    const start = match.index + lead;
    if (start > cursor) parts.push({ text: text.slice(cursor, start) });
    parts.push({ text: core, url });
    cursor = start + core.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  if (parts.length === 0) parts.push({ text });
  return parts;
}

/** Every link in the text, in order, each address once */
export function findLinks(text: string): string[] {
  const urls: string[] = [];
  for (const part of splitLinks(text)) {
    if (part.url && urls.indexOf(part.url) < 0) urls.push(part.url);
  }
  return urls;
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

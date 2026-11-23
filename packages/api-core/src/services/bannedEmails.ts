/**
 * Email addresses barred from signing up again.
 *
 * A ban (admin/moderation.ts banUser) adds the account's address here, so the
 * address stays barred even if the user row later loses it, and the same
 * mailbox cannot come back under a variant spelling:
 *   - case and spaces:        " Name@Gmail.com"   → "name@gmail.com"
 *   - plus tags, any domain:  "name+2@x.com"      → "name@x.com"
 *   - Gmail dots and alias:   "n.a.me@googlemail.com" → "name@gmail.com"
 *
 * Only a SHA-256 of that canonical form is stored, never the address itself.
 * The same canonical form is computed in SQL by migration 032 for the backfill;
 * keep the two in step.
 */
import crypto from 'crypto';
import { query } from './database';

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/** The one spelling every variant of a mailbox maps to. */
export function canonicalEmail(email: string): string {
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf('@');
  if (at < 0) return lower;
  let local = lower.slice(0, at).split('+')[0];
  let domain = lower.slice(at + 1);
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, '');
    domain = 'gmail.com';
  }
  return `${local}@${domain}`;
}

export function emailBanKey(email: string): string {
  return crypto.createHash('sha256').update(canonicalEmail(email), 'utf8').digest('hex');
}

export async function isEmailBanned(email: string): Promise<boolean> {
  const result = await query(`SELECT 1 FROM banned_emails WHERE email_key = $1`, [emailBanKey(email)]);
  return (result.rows?.length ?? 0) > 0;
}

/** $1 = key, $2 = user id or null, $3 = reason. Safe to repeat. */
export const BAN_EMAIL_SQL = `INSERT INTO banned_emails (email_key, user_id, reason) VALUES ($1, $2, $3)
                              ON CONFLICT (email_key) DO NOTHING`;
export const UNBAN_EMAIL_SQL = `DELETE FROM banned_emails WHERE email_key = $1`;

/** What a barred address is told, at every sign-up step. */
export const EMAIL_BANNED_RESPONSE = {
  success: false,
  error: { code: 'FORBIDDEN', message: "This email can't be used to sign up for Kinetik." },
};

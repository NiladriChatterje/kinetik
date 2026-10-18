/**
 * Moderation tool for safety reports. Run on the server, inside the API
 * container; it is not reachable over HTTP.
 *
 *   docker compose exec api-core node packages/api-core/dist/admin/moderation.js <command>
 *
 * Commands
 *   reports                     Open reports, child-safety ones first, oldest first
 *   show <reportId>             One report in full, with the reported chat
 *   ban <userId> --yes          Ban an account (see banUser) and close its open reports
 *   resolve <reportId> actioned|dismissed
 *                               Close a report without banning anyone
 *   purge [--yes]               Delete reported chats whose reports were all resolved
 *                               more than RETENTION_DAYS ago (dry run without --yes)
 *
 * Every report also reaches the support inbox by email (routes/safety.ts);
 * this tool is how a reviewer reads the evidence and acts on it.
 */
import { transaction, closePool, decryptMessage, REDIS_KEYS } from '@kinetik/shared';
import { query, TABLES } from '../services/database';
import { getRedis, publishChatMessage } from '../services/redis';
import { deleteChatFile } from '../services/photoStorage';

/** Reported chats are kept this long after their last report is resolved.
 *  India's IT (Intermediary Guidelines) Rules 2021, rule 3(1)(g), require
 *  removed information and its records to be preserved for 180 days. */
export const RETENTION_DAYS = 180;

const URGENT_REASONS = ['child_safety', 'underage'];
const MESSAGE_ENCRYPTION_KEY = process.env.MESSAGE_ENCRYPTION_KEY || '';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Same mapping as routes/auth.ts and routes/matches.ts. */
function chatMediaKeyFromUrl(url: string): string | null {
  if (url.startsWith('/api/v1/matches/media/')) {
    const path = url.split('/api/v1/matches/media/')[1];
    return path ? path.split('?')[0] : null;
  }
  if (url.startsWith('/uploads/')) {
    const key = url.replace('/uploads/', '');
    return key || null;
  }
  return null;
}

// ─── Queries (exported for tests) ──────────────────────────

export const SQL = {
  openReports: `
    SELECT r.id, r.reason, r.created_at, r.updated_at, r.match_id, r.details,
           r.reporter_id, ru.display_name AS reporter_name, ru.email AS reporter_email,
           r.reported_id, tu.display_name AS reported_name, tu.email AS reported_email,
           tu.is_banned AS reported_banned
    FROM ${TABLES.USER_REPORTS} r
    JOIN ${TABLES.USERS} ru ON ru.id = r.reporter_id
    JOIN ${TABLES.USERS} tu ON tu.id = r.reported_id
    WHERE r.status = 'open'
    ORDER BY (r.reason = ANY($1::text[])) DESC, r.updated_at ASC`,

  report: `
    SELECT r.*, ru.display_name AS reporter_name, ru.email AS reporter_email,
           tu.display_name AS reported_name, tu.email AS reported_email,
           tu.date_of_birth AS reported_dob, tu.is_banned AS reported_banned,
           tu.deleted_at AS reported_deleted_at, tu.created_at AS reported_joined
    FROM ${TABLES.USER_REPORTS} r
    JOIN ${TABLES.USERS} ru ON ru.id = r.reporter_id
    JOIN ${TABLES.USERS} tu ON tu.id = r.reported_id
    WHERE r.id = $1`,

  /** The linked match, or the newest match between the pair */
  reportChat: `
    SELECT m.id, m.is_active FROM ${TABLES.MATCHES} m
    WHERE (m.id = $3)
       OR ((m.user_a_id = $1 AND m.user_b_id = $2) OR (m.user_a_id = $2 AND m.user_b_id = $1))
    ORDER BY (m.id = $3) DESC, m.matched_at DESC
    LIMIT 1`,

  chatMessages: `
    SELECT msg.sender_id, msg.content, msg.created_at,
           cm.media_type, cm.is_view_once, cm.viewed_at
    FROM ${TABLES.MESSAGES} msg
    LEFT JOIN ${TABLES.CHAT_MEDIA} cm ON cm.message_id = msg.id
    WHERE msg.match_id = $1
    ORDER BY msg.created_at DESC
    LIMIT 100`,

  /** Reported chats that are ended and whose reports were all resolved long enough ago */
  purgeable: `
    SELECT m.id
    FROM ${TABLES.MATCHES} m
    WHERE m.is_active = FALSE
      AND EXISTS (
        SELECT 1 FROM ${TABLES.USER_REPORTS} r
        WHERE (r.reporter_id = m.user_a_id AND r.reported_id = m.user_b_id)
           OR (r.reporter_id = m.user_b_id AND r.reported_id = m.user_a_id)
      )
      AND NOT EXISTS (
        SELECT 1 FROM ${TABLES.USER_REPORTS} r
        WHERE ((r.reporter_id = m.user_a_id AND r.reported_id = m.user_b_id)
            OR (r.reporter_id = m.user_b_id AND r.reported_id = m.user_a_id))
          AND (r.status = 'open' OR r.resolved_at IS NULL
               OR r.resolved_at > NOW() - make_interval(days => $1))
      )`,

  // banUser, in order, all with $1 = the user id
  banUser: `UPDATE ${TABLES.USERS} SET is_banned = TRUE, is_active = FALSE, updated_at = NOW()
            WHERE id = $1 RETURNING display_name`,
  banRevokeSessions: `UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
  banEndChats: `UPDATE ${TABLES.MATCHES} SET is_active = FALSE
                WHERE is_active = TRUE AND (user_a_id = $1 OR user_b_id = $1)
                RETURNING id`,
  banCloseLikes: `UPDATE ${TABLES.USER_INTERACTIONS} SET responded_at = NOW()
                  WHERE (actor_id = $1 OR target_id = $1) AND is_mutual = FALSE AND responded_at IS NULL`,
  banRemovePushTokens: `DELETE FROM ${TABLES.PUSH_TOKENS} WHERE user_id = $1`,
  banCloseReports: `UPDATE ${TABLES.USER_REPORTS} SET status = 'actioned', resolved_at = NOW(), updated_at = NOW()
                    WHERE reported_id = $1 AND status = 'open'`,

  /** $1 = report id, $2 = 'actioned' | 'dismissed' */
  resolveReport: `UPDATE ${TABLES.USER_REPORTS} SET status = $2, resolved_at = NOW(), updated_at = NOW()
                  WHERE id = $1 RETURNING id`,

  /** $1 = match id */
  purgeMedia: `SELECT cm.url, cm.thumbnail_url FROM ${TABLES.CHAT_MEDIA} cm
               WHERE cm.message_id IN (SELECT id FROM ${TABLES.MESSAGES} WHERE match_id = $1)`,
  purgeMatch: `DELETE FROM ${TABLES.MATCHES} WHERE id = $1 AND is_active = FALSE`,
};

/**
 * Ban an account. In one transaction: barred from logging in (is_banned) and
 * from signing up again with that email, hidden from every feed and Likes
 * (is_active), signed out everywhere (refresh tokens revoked; access tokens
 * expire within 15 minutes), its chats ended but kept as evidence, its
 * pending likes closed, its push tokens removed, and the open reports about
 * it marked actioned. Returns the ended match ids, or null if no such user.
 */
export async function banUser(userId: string): Promise<{ name: string; endedMatchIds: string[] } | null> {
  return transaction(async (q) => {
    const user = await q<{ display_name: string }>(SQL.banUser, [userId]);
    if (!user.rows[0]) return null;
    await q(SQL.banRevokeSessions, [userId]);
    const ended = await q<{ id: string }>(SQL.banEndChats, [userId]);
    await q(SQL.banCloseLikes, [userId]);
    await q(SQL.banRemovePushTokens, [userId]);
    await q(SQL.banCloseReports, [userId]);
    return { name: user.rows[0].display_name || 'Unknown', endedMatchIds: ended.rows.map((r) => r.id) };
  });
}

export async function resolveReport(reportId: string, outcome: 'actioned' | 'dismissed'): Promise<boolean> {
  const result = await query(SQL.resolveReport, [reportId, outcome]);
  return (result.rowCount ?? 0) > 0;
}

// ─── Command line ──────────────────────────────────────────

function short(text: string | null | undefined, max = 80): string {
  if (!text) return '';
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

function requireId(value: string | undefined, what: string): string {
  if (!value || !UUID_RE.test(value)) {
    console.error(`Give a ${what} id (a UUID).`);
    process.exit(2);
  }
  return value;
}

async function cmdReports() {
  const result = await query(SQL.openReports, [URGENT_REASONS]);
  if (result.rows.length === 0) {
    console.log('No open reports.');
    return;
  }
  for (const r of result.rows as any[]) {
    const urgent = URGENT_REASONS.includes(r.reason) ? '[URGENT] ' : '';
    console.log(`${urgent}${r.id}  ${r.reason}  ${new Date(r.updated_at).toISOString()}`);
    console.log(`   reported: ${r.reported_name} <${r.reported_email ?? 'deleted'}> ${r.reported_id}${r.reported_banned ? ' (banned)' : ''}`);
    console.log(`   by:       ${r.reporter_name} <${r.reporter_email ?? 'deleted'}> ${r.reporter_id}`);
    if (r.details) console.log(`   details:  ${short(r.details)}`);
  }
  console.log(`\n${result.rows.length} open report(s). Read one with: show <reportId>`);
}

async function cmdShow(reportId: string) {
  const result = await query(SQL.report, [reportId]);
  const r = result.rows[0] as any;
  if (!r) {
    console.error('No such report.');
    process.exit(1);
  }
  console.log(`Report ${r.id}`);
  console.log(`  status:   ${r.status}${r.resolved_at ? ` (resolved ${new Date(r.resolved_at).toISOString()})` : ''}`);
  console.log(`  reason:   ${r.reason}${URGENT_REASONS.includes(r.reason) ? '  [URGENT]' : ''}`);
  console.log(`  filed:    ${new Date(r.created_at).toISOString()}  (updated ${new Date(r.updated_at).toISOString()})`);
  console.log(`  reported: ${r.reported_name} <${r.reported_email ?? 'deleted'}> ${r.reported_id}`);
  console.log(`            born ${r.reported_dob ? new Date(r.reported_dob).toISOString().slice(0, 10) : 'unknown'}, joined ${new Date(r.reported_joined).toISOString().slice(0, 10)}${r.reported_banned ? ', BANNED' : ''}${r.reported_deleted_at ? ', account deleted' : ''}`);
  console.log(`  by:       ${r.reporter_name} <${r.reporter_email ?? 'deleted'}> ${r.reporter_id}`);
  console.log(`  details:  ${r.details || '(none)'}`);

  const chat = await query(SQL.reportChat, [r.reporter_id, r.reported_id, r.match_id]);
  const match = chat.rows[0] as any;
  if (!match) {
    console.log('\nNo chat between these two.');
    return;
  }
  const messages = await query(SQL.chatMessages, [match.id]);
  console.log(`\nChat ${match.id} (${match.is_active ? 'active' : 'ended'}), last ${messages.rows.length} message(s), oldest first:`);
  for (const m of (messages.rows as any[]).reverse()) {
    const who = m.sender_id === r.reported_id ? 'REPORTED' : m.sender_id === r.reporter_id ? 'reporter' : m.sender_id;
    let text = '';
    if (m.content) {
      try {
        text = decryptMessage(m.content, MESSAGE_ENCRYPTION_KEY);
      } catch {
        text = '(could not decrypt)';
      }
    }
    const media = m.media_type ? ` [${m.media_type}${m.is_view_once ? ', view once' : ''}${m.viewed_at ? ', viewed' : ''}]` : '';
    console.log(`  ${new Date(m.created_at).toISOString()}  ${who}:${media} ${text}`);
  }
}

async function cmdBan(userId: string, confirmed: boolean) {
  if (!confirmed) {
    console.error('Banning is not undone by this tool. Re-run with --yes to confirm.');
    process.exit(2);
  }
  const result = await banUser(userId);
  if (!result) {
    console.error('No such user.');
    process.exit(1);
  }
  // Both apps drop the ended conversations at once, as after an unmatch
  for (const matchId of result.endedMatchIds) {
    await publishChatMessage(REDIS_KEYS.CHAT_MESSAGES_CHANNEL, {
      type: 'match:unmatched',
      matchId,
      unmatchedByUserId: userId,
    });
  }
  console.log(`Banned ${result.name} (${userId}). ${result.endedMatchIds.length} chat(s) ended and kept as evidence.`);
  console.log('If this involved child sexual abuse material, report it at https://cybercrime.gov.in and to the police.');
}

async function cmdResolve(reportId: string, outcome: string | undefined) {
  if (outcome !== 'actioned' && outcome !== 'dismissed') {
    console.error('Say how it was resolved: actioned or dismissed.');
    process.exit(2);
  }
  if (!(await resolveReport(reportId, outcome))) {
    console.error('No such report.');
    process.exit(1);
  }
  console.log(`Report ${reportId} ${outcome}.`);
}

async function cmdPurge(confirmed: boolean) {
  const found = await query(SQL.purgeable, [RETENTION_DAYS]);
  const ids = (found.rows as any[]).map((r) => r.id as string);
  console.log(`${ids.length} reported chat(s) past the ${RETENTION_DAYS}-day retention period.`);
  if (!confirmed || ids.length === 0) {
    if (ids.length > 0) console.log('Dry run. Re-run with --yes to delete them.');
    return;
  }
  for (const matchId of ids) {
    const media = await query(SQL.purgeMedia, [matchId]);
    // Files first, as in unmatch: a storage failure leaves the records for a retry
    try {
      for (const row of media.rows as any[]) {
        for (const url of [row.url, row.thumbnail_url]) {
          if (!url) continue;
          const key = chatMediaKeyFromUrl(url);
          if (!key) continue;
          await deleteChatFile(key);
          if (url.startsWith('/uploads/') && key.endsWith('.webp')) {
            await deleteChatFile(key.replace('.webp', '_thumb.webp'));
          }
        }
      }
    } catch (err: any) {
      console.error(`Skipped ${matchId}: storage delete failed (${err?.message}). Run purge again later.`);
      continue;
    }
    // Messages, media rows and reservations cascade with the match
    await query(SQL.purgeMatch, [matchId]);
    console.log(`Purged ${matchId}`);
  }
}

async function main() {
  const [command, arg1, arg2] = process.argv.slice(2);
  const confirmed = process.argv.includes('--yes');
  switch (command) {
    case 'reports':
      await cmdReports();
      break;
    case 'show':
      await cmdShow(requireId(arg1, 'report'));
      break;
    case 'ban':
      await cmdBan(requireId(arg1, 'user'), confirmed);
      break;
    case 'resolve':
      await cmdResolve(requireId(arg1, 'report'), arg2);
      break;
    case 'purge':
      await cmdPurge(confirmed);
      break;
    default:
      console.log('Usage: moderation.js reports | show <reportId> | ban <userId> --yes | resolve <reportId> actioned|dismissed | purge [--yes]');
      process.exitCode = command ? 2 : 0;
  }
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(err?.message || err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePool().catch(() => {});
      try {
        getRedis().disconnect();
      } catch {
        // no Redis connection was opened
      }
    });
}

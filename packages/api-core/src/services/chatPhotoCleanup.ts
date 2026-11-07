import { query, TABLES } from './database';
import { deleteChatFile } from './photoStorage';

// Chat photos live on the phones. The server holds a sent photo only until
// the receiver's phone saves it (routes/matches.ts, /:id/media/:mediaId/saved);
// one nobody saved within CHAT_PHOTO_HOLD_DAYS (the receiver never opened the
// chat, or uses an app version that does not save photos) is deleted here.
// The row stays, with its blurred preview. One-time photos have their own
// rule and are left alone.
//
// Run by the daily cleanup (planCleanup.ts), so it never wakes the database.

export const CHAT_PHOTO_HOLD_DAYS = 30;
const BATCH = 200;
/** At most this many batches a run; the rest wait for the next day */
const MAX_BATCHES = 25;

export const UNSAVED_PHOTOS_SQL = `
  SELECT id, url, thumbnail_url FROM ${TABLES.CHAT_MEDIA}
   WHERE media_type = 'image' AND is_view_once = FALSE AND file_removed_at IS NULL
     AND created_at < NOW() - make_interval(days => $1)
   ORDER BY created_at
   LIMIT $2`;

export const MARK_REMOVED_SQL = `
  UPDATE ${TABLES.CHAT_MEDIA} SET file_removed_at = NOW()
   WHERE id = ANY($1::uuid[]) AND file_removed_at IS NULL`;

/** Deletes the files of chat photos nobody saved in time; returns how many. */
export async function removeUnsavedChatPhotos(): Promise<number> {
  let removed = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const rows = (await query<{ id: string; url: string; thumbnail_url: string | null }>(
      UNSAVED_PHOTOS_SQL, [CHAT_PHOTO_HOLD_DAYS, BATCH],
    )).rows;
    if (rows.length === 0) break;
    for (const row of rows) {
      // The photo, and the thumbnail file photos sent before this change have.
      // A file already gone is fine: the row is marked either way.
      for (const url of [row.url, row.thumbnail_url]) {
        const key = url?.startsWith('/uploads/') ? url.replace('/uploads/', '') : null;
        if (key) await deleteChatFile(key).catch(() => {});
      }
    }
    await query(MARK_REMOVED_SQL, [rows.map((r) => r.id)]);
    removed += rows.length;
    if (rows.length < BATCH) break;
  }
  return removed;
}

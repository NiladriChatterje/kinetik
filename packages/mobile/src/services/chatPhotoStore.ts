/**
 * Chat photos live on the phone.
 *
 * The server holds a sent photo only until the receiver's phone has saved
 * it, then deletes it (api-core routes/matches.ts, /:id/media/:mediaId/saved).
 * So this phone keeps every chat photo it sends or receives, in the app's
 * own storage:
 *
 *   <documents>/chat-photos/<userId>/<matchId>/<mediaId>
 *
 * (per account, so two accounts on one phone never touch each other's)
 * App storage needs no permission, is not shown in the gallery, and stays
 * until the app is uninstalled or its data cleared; after that a photo shows
 * only as its blurred preview. One folder per chat, so a chat that ends
 * takes its photos with it (deleteChatPhotos, pruneChatPhotos).
 *
 * Every function takes the signed-in user's id first (`owner`).
 *
 * One-time photos are never kept: they are opened once from the server.
 */

import { Directory, File, Paths } from 'expo-file-system';
import { api } from './api';
import { resolveUrl } from '../config';

const ROOT = 'chat-photos';
/** Downloads at a time: enough to fill a chat quickly without hogging the connection */
const PARALLEL = 2;

function ownerDir(owner: string): Directory {
  return new Directory(Paths.document, ROOT, owner);
}

function chatDir(owner: string, matchId: string): Directory {
  return new Directory(Paths.document, ROOT, owner, matchId);
}

function photoFile(owner: string, matchId: string, mediaId: string): File {
  return new File(Paths.document, ROOT, owner, matchId, mediaId);
}

function ensureChatDir(owner: string, matchId: string): Directory {
  const dir = chatDir(owner, matchId);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** The photo's file on this phone, or null when it is not here. */
export function localChatPhoto(owner: string, matchId: string, mediaId: string): string | null {
  try {
    const file = photoFile(owner, matchId, mediaId);
    return file.exists && (file.size ?? 0) > 0 ? file.uri : null;
  } catch {
    return null;
  }
}

/**
 * Keep the photo this phone just sent (the prepared file is moved, not
 * copied). Returns its new location, or null if it could not be kept.
 */
export function keepSentChatPhoto(owner: string, matchId: string, mediaId: string, preparedUri: string): string | null {
  try {
    ensureChatDir(owner, matchId);
    const target = photoFile(owner, matchId, mediaId);
    new File(preparedUri).moveSync(target, { overwrite: true });
    return target.uri;
  } catch (err) {
    console.warn('[ChatPhotos] Could not keep the sent photo:', err);
    return null;
  }
}

// ─── Saving received photos ─────────────────────────────────

export interface PhotoToSave {
  /** The signed-in user */
  owner: string;
  matchId: string;
  mediaId: string;
  /** The server's url; empty once the server no longer has it */
  url: string;
  /** Received (not sent by this phone): saving it lets the server delete its copy */
  received: boolean;
}

const queue: Array<{ photo: PhotoToSave; resolve: (uri: string | null) => void }> = [];
const inFlight = new Map<string, Promise<string | null>>();
let active = 0;

async function save(photo: PhotoToSave): Promise<string | null> {
  const { owner, matchId, mediaId, url, received } = photo;
  let uri = localChatPhoto(owner, matchId, mediaId);
  if (!uri) {
    if (!url) return null; // not here, and gone from the server
    ensureChatDir(owner, matchId);
    // Into a temporary name first, so a cut-off download never looks saved
    const partial = new File(chatDir(owner, matchId), `${mediaId}.part`);
    try {
      const downloaded = await File.downloadFileAsync(resolveUrl(url), partial, { idempotent: true });
      if (!downloaded.exists || (downloaded.size ?? 0) === 0) throw new Error('empty download');
      const target = photoFile(owner, matchId, mediaId);
      downloaded.moveSync(target, { overwrite: true });
      uri = target.uri;
    } catch (err) {
      try {
        if (partial.exists) partial.delete();
      } catch { /* cache-like leftovers are harmless */ }
      console.warn('[ChatPhotos] Download failed:', err);
      return null;
    }
  }
  // Saved here: the server may now delete its copy. Also said again for a
  // photo saved earlier whose message still carries a url (the last call
  // did not get through).
  if (received && url) {
    api.markChatPhotoSaved(matchId, mediaId).catch(() => {
      // Retried the next time the chat opens; the server keeps the file till then
    });
  }
  return uri;
}

function pump(): void {
  while (active < PARALLEL && queue.length > 0) {
    const job = queue.shift()!;
    active++;
    save(job.photo)
      .then(job.resolve, () => job.resolve(null))
      .finally(() => {
        active--;
        pump();
      });
  }
}

/**
 * The photo on this phone, saving it from the server first if needed.
 * Resolves null when it is neither here nor on the server (or the download
 * failed; calling again tries again).
 */
export function ensureChatPhoto(photo: PhotoToSave): Promise<string | null> {
  const existing = localChatPhoto(photo.owner, photo.matchId, photo.mediaId);
  if (existing && !(photo.received && photo.url)) return Promise.resolve(existing);
  const key = `${photo.owner}/${photo.matchId}/${photo.mediaId}`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const promise = new Promise<string | null>((resolve) => {
    queue.push({ photo, resolve });
    pump();
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

// ─── When chats end ─────────────────────────────────────────

/** Remove a chat's photos from this phone (the chat ended). */
export function deleteChatPhotos(owner: string, matchId: string): void {
  try {
    const dir = chatDir(owner, matchId);
    if (dir.exists) dir.delete();
  } catch (err) {
    console.warn('[ChatPhotos] Could not remove a chat\'s photos:', err);
  }
}

/** Remove every chat photo of this account from the phone (the account was deleted). */
export function deleteAllChatPhotos(owner: string): void {
  try {
    const dir = ownerDir(owner);
    if (dir.exists) dir.delete();
  } catch (err) {
    console.warn('[ChatPhotos] Could not remove chat photos:', err);
  }
}

const pruned = new Set<string>();

/**
 * Once per app start and account: ask the server which of this account's
 * chats with photos on the phone still exist, and remove the photos of the
 * others (unmatched while the app was closed, or the other account
 * deleted). Quiet on any failure; tried again next start.
 */
export async function pruneChatPhotos(owner: string): Promise<void> {
  if (pruned.has(owner)) return;
  try {
    const root = ownerDir(owner);
    if (!root.exists) {
      pruned.add(owner);
      return;
    }
    const ids = root.list().filter((e): e is Directory => e instanceof Directory).map((d) => d.name);
    if (ids.length === 0) {
      pruned.add(owner);
      return;
    }
    const active = new Set<string>();
    for (let i = 0; i < ids.length; i += 500) {
      const res = await api.checkActiveChats(ids.slice(i, i + 500));
      if (!res.success || !res.data) return;
      for (const id of res.data.active) active.add(id);
    }
    for (const id of ids) if (!active.has(id)) deleteChatPhotos(owner, id);
    pruned.add(owner);
  } catch {
    // Next start
  }
}

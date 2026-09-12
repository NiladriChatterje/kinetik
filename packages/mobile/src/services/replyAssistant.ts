/**
 * Reply assistant — on-demand download of the on-device LLM behind Tier A
 * of the DM suggestion chips (see dmSuggestions.ts).
 *
 * The model is never in the app bundle. Like a game that fetches a map only
 * when you pick it, the weights are downloaded when the user asks for them:
 * from the offer above the chat input once a conversation is going, or from
 * Profile → Reply assistant. The size is shown before anything starts, and
 * the download can be paused, resumed (across app restarts), cancelled or
 * deleted at any time. Until the file is on disk the heuristic chips serve
 * every device, so nothing here is ever on the critical path.
 *
 * This module owns the model file and its lifecycle. It never loads the
 * model — dmSuggestions.ts subscribes to the state and does that lazily.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as Device from 'expo-device';
import * as Network from 'expo-network';
import * as SecureStore from 'expo-secure-store';

export const MODEL_URL =
  'https://huggingface.co/LiquidAI/LFM2-1.2B-GGUF/resolve/main/LFM2-1.2B-Q4_K_M.gguf';
export const MODEL_FILE = 'LFM2-1.2B-Q4_K_M.gguf';
const PART_FILE = `${MODEL_FILE}.part`;
const RESUME_FILE = `${MODEL_FILE}.resume.json`;

/** Size of the file on Hugging Face; shown until a HEAD request answers. */
export const MODEL_SIZE_FALLBACK_BYTES = 730_893_248;
/** Below this the model cannot be held in memory next to the app. */
export const MIN_RAM_BYTES = 4 * 1024 * 1024 * 1024;
/** Keep this much free after the download so the phone stays usable. */
const FREE_SPACE_MARGIN_BYTES = 300 * 1024 * 1024;

const DISMISSED_KEY = 'reply_assistant_offer_dismissed';

export type ReplyAssistantPhase =
  | 'checking'
  | 'unsupported'
  | 'not_downloaded'
  | 'downloading'
  | 'paused'
  | 'ready'
  | 'error';

export interface ReplyAssistantState {
  phase: ReplyAssistantPhase;
  /** 0..1 while downloading or paused. */
  progress: number;
  bytesWritten: number;
  /** Best known size of the model file. */
  totalBytes: number;
  error: string | null;
  /** The user tapped "Not now" in a chat — offer only from settings. */
  offerDismissed: boolean;
}

type Listener = (state: ReplyAssistantState) => void;

let state: ReplyAssistantState = {
  phase: 'checking',
  progress: 0,
  bytesWritten: 0,
  totalBytes: MODEL_SIZE_FALLBACK_BYTES,
  error: null,
  offerDismissed: false,
};
const listeners = new Set<Listener>();
let initPromise: Promise<void> | null = null;
let resumable: FileSystem.DownloadResumable | null = null;
let sizeProbe: Promise<number> | null = null;

function emit(patch: Partial<ReplyAssistantState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => {
    try {
      l(state);
    } catch {
      // a broken subscriber must not take the others down
    }
  });
}

function uri(name: string): string | null {
  const dir = FileSystem.documentDirectory;
  return dir ? `${dir}${name}` : null;
}

/** `file://` URI of the downloaded model, or null when not ready. */
export function getModelUri(): string | null {
  return state.phase === 'ready' ? uri(MODEL_FILE) : null;
}

export function isDeviceEligible(): boolean {
  const ram = Device.totalMemory ?? 0;
  // Unknown RAM (null) is treated as eligible; the model load itself is
  // guarded and falls back to heuristics if the phone cannot hold it.
  return ram === 0 || ram >= MIN_RAM_BYTES;
}

export function getReplyAssistantState(): ReplyAssistantState {
  void ensureInit();
  return state;
}

export function subscribeReplyAssistant(listener: Listener): () => void {
  listeners.add(listener);
  void ensureInit();
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

/** Work out the phase from what is on disk. Runs once per app launch. */
function ensureInit(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    let offerDismissed = false;
    try {
      offerDismissed = (await SecureStore.getItemAsync(DISMISSED_KEY)) === '1';
    } catch {
      // treat as not dismissed
    }

    if (!isDeviceEligible()) {
      emit({ phase: 'unsupported', offerDismissed });
      return;
    }

    const modelUri = uri(MODEL_FILE);
    const partUri = uri(PART_FILE);
    if (!modelUri || !partUri) {
      emit({ phase: 'unsupported', error: 'No writable storage', offerDismissed });
      return;
    }

    try {
      const model = await FileSystem.getInfoAsync(modelUri);
      if (model.exists) {
        const size = 'size' in model && typeof model.size === 'number' ? model.size : state.totalBytes;
        emit({ phase: 'ready', progress: 1, bytesWritten: size, totalBytes: size, offerDismissed });
        return;
      }
      const part = await FileSystem.getInfoAsync(partUri);
      if (part.exists) {
        const written = 'size' in part && typeof part.size === 'number' ? part.size : 0;
        emit({
          phase: 'paused',
          bytesWritten: written,
          progress: Math.min(written / state.totalBytes, 0.999),
          offerDismissed,
        });
        return;
      }
    } catch {
      // fall through — treat as nothing downloaded
    }
    emit({ phase: 'not_downloaded', offerDismissed });
  })();
  return initPromise;
}

/** Real size from the server (bytes); falls back to the known constant. */
export function fetchModelSizeBytes(): Promise<number> {
  if (sizeProbe) return sizeProbe;
  sizeProbe = (async () => {
    try {
      const res = await fetch(MODEL_URL, { method: 'HEAD' });
      const len = Number(res.headers.get('content-length') ?? res.headers.get('x-linked-size'));
      if (Number.isFinite(len) && len > 0) {
        if (state.phase !== 'ready') emit({ totalBytes: len });
        return len;
      }
    } catch {
      // offline or blocked — the constant is close enough to decide on
    }
    return state.totalBytes;
  })();
  return sizeProbe;
}

export async function isOnWifi(): Promise<boolean> {
  try {
    const net = await Network.getNetworkStateAsync();
    return net.type === Network.NetworkStateType.WIFI || net.type === Network.NetworkStateType.ETHERNET;
  } catch {
    return false;
  }
}

/** Free bytes on the device, or null when the platform will not say. */
export async function getFreeSpaceBytes(): Promise<number | null> {
  try {
    return await FileSystem.getFreeDiskStorageAsync();
  } catch {
    return null;
  }
}

async function readResumeData(): Promise<string | undefined> {
  const resumeUri = uri(RESUME_FILE);
  if (!resumeUri) return undefined;
  try {
    const info = await FileSystem.getInfoAsync(resumeUri);
    if (!info.exists) return undefined;
    const raw = await FileSystem.readAsStringAsync(resumeUri);
    const saved = JSON.parse(raw) as { resumeData?: string };
    return saved.resumeData || undefined;
  } catch {
    return undefined;
  }
}

async function writeResumeData(): Promise<void> {
  const resumeUri = uri(RESUME_FILE);
  if (!resumeUri || !resumable) return;
  try {
    await FileSystem.writeAsStringAsync(resumeUri, JSON.stringify(resumable.savable()));
  } catch {
    // resume across restarts is best effort; the .part file still counts
  }
}

async function removeQuietly(name: string): Promise<void> {
  const target = uri(name);
  if (!target) return;
  try {
    await FileSystem.deleteAsync(target, { idempotent: true });
  } catch {
    // nothing to do
  }
}

function onProgress(p: FileSystem.DownloadProgressData) {
  if (state.phase !== 'downloading') return;
  const total = p.totalBytesExpectedToWrite > 0 ? p.totalBytesExpectedToWrite : state.totalBytes;
  emit({
    bytesWritten: p.totalBytesWritten,
    totalBytes: total,
    progress: total > 0 ? Math.min(p.totalBytesWritten / total, 0.999) : 0,
  });
}

/**
 * Drive one download attempt to completion. Resolves when the file is in
 * place, when the user paused (result undefined), or after an error.
 */
async function runDownload(task: FileSystem.DownloadResumable, start: () => Promise<FileSystem.FileSystemDownloadResult | undefined>) {
  emit({ phase: 'downloading', error: null });
  try {
    const result = await start();
    if (!result) return; // paused — pauseAsync already updated the phase
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Server answered ${result.status}`);
    }
    const partUri = uri(PART_FILE)!;
    const modelUri = uri(MODEL_FILE)!;
    const info = await FileSystem.getInfoAsync(partUri);
    const size = info.exists && 'size' in info && typeof info.size === 'number' ? info.size : 0;
    if (size < state.totalBytes * 0.95) {
      // A truncated file would crash the model loader; start over next time.
      await removeQuietly(PART_FILE);
      throw new Error('Download ended early');
    }
    await FileSystem.moveAsync({ from: partUri, to: modelUri });
    await removeQuietly(RESUME_FILE);
    if (resumable === task) resumable = null;
    emit({ phase: 'ready', progress: 1, bytesWritten: size, totalBytes: size });
  } catch (err: any) {
    if (resumable === task) resumable = null;
    if (state.phase === 'paused') return; // pause raced the failure
    emit({ phase: 'error', error: err?.message || 'Download failed' });
  }
}

/**
 * Start (or restart after an error) the model download. The caller has
 * already shown the size and asked; this does the disk check and goes.
 */
export async function startModelDownload(): Promise<void> {
  await ensureInit();
  if (state.phase === 'downloading' || state.phase === 'ready' || state.phase === 'unsupported') return;

  const partUri = uri(PART_FILE);
  if (!partUri) {
    emit({ phase: 'error', error: 'No writable storage' });
    return;
  }

  const total = await fetchModelSizeBytes();
  const free = await getFreeSpaceBytes();
  const needed = Math.max(total - state.bytesWritten, 0) + FREE_SPACE_MARGIN_BYTES;
  if (free !== null && free < needed) {
    emit({ phase: 'error', error: `Not enough free space — about ${formatBytes(needed)} needed` });
    return;
  }

  // Resume a partial file if one is there; otherwise start clean.
  const resumeData = state.bytesWritten > 0 ? await readResumeData() : undefined;
  if (!resumeData) {
    await removeQuietly(PART_FILE);
    await removeQuietly(RESUME_FILE);
    emit({ bytesWritten: 0, progress: 0 });
  }

  const task = FileSystem.createDownloadResumable(MODEL_URL, partUri, {}, onProgress, resumeData);
  resumable = task;
  await runDownload(task, () => (resumeData ? task.resumeAsync() : task.downloadAsync()));
}

export async function pauseModelDownload(): Promise<void> {
  const task = resumable;
  if (!task || state.phase !== 'downloading') return;
  try {
    await task.pauseAsync();
    await writeResumeData();
    emit({ phase: 'paused' });
  } catch (err: any) {
    emit({ phase: 'error', error: err?.message || 'Could not pause' });
  }
}

export async function resumeModelDownload(): Promise<void> {
  if (state.phase !== 'paused') return;
  const task = resumable;
  if (task) {
    await runDownload(task, () => task.resumeAsync());
    return;
  }
  // App was restarted since the pause — rebuild from what is on disk.
  await startModelDownload();
}

/** Stop and throw away a partial download. */
export async function cancelModelDownload(): Promise<void> {
  const task = resumable;
  resumable = null;
  if (task && state.phase === 'downloading') {
    try {
      await task.pauseAsync();
    } catch {
      // the task may already be gone
    }
  }
  await removeQuietly(PART_FILE);
  await removeQuietly(RESUME_FILE);
  emit({ phase: 'not_downloaded', progress: 0, bytesWritten: 0, error: null });
}

/** Remove the downloaded model. dmSuggestions releases its context on this. */
export async function deleteModel(): Promise<void> {
  if (state.phase === 'downloading' || state.phase === 'paused') {
    await cancelModelDownload();
    return;
  }
  await removeQuietly(MODEL_FILE);
  emit({ phase: 'not_downloaded', progress: 0, bytesWritten: 0, error: null });
}

/** "Not now" in the chat offer. The settings row keeps working. */
export async function dismissOffer(): Promise<void> {
  emit({ offerDismissed: true });
  try {
    await SecureStore.setItemAsync(DISMISSED_KEY, '1');
  } catch {
    // in-memory dismissal still holds for this session
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1000) return `${(mb / 1024).toFixed(2)} GB`;
  return `${Math.round(mb)} MB`;
}

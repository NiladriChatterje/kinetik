/**
 * Ambient DM reply suggestions — two tiers, always safe.
 *
 * Tier A (on-device LLM): a tiny instruct model (Qwen2.5 0.5B, Q4 GGUF,
 * ~400 MB) reads the last 20 messages and writes 3 strategic replies.
 * The conversation never leaves the device. llama.rn (the engine),
 * expo-device (RAM gate) and expo-network (Wi-Fi-only model download check)
 * are installed; Tier A activates on the first dev-client build that
 * includes their native sides ("llama.rn" is registered in app.json
 * plugins). Older builds simply keep serving Tier B.
 *
 * Tier B (heuristics): a zero-weight rule engine — who spoke last, question
 * detection, message energy, conversation age — picks from a curated bank of
 * re-engagement and momentum lines. Runs instantly on any device.
 *
 * Every native access is guarded: any missing module, failed download, or
 * slow generation silently degrades to Tier B. This file must never throw.
 */

const MODEL_URL =
  'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf';
const MODEL_FILE = 'qwen2.5-0.5b-instruct-q4_k_m.gguf';
const MIN_RAM_BYTES = 4 * 1024 * 1024 * 1024;
const LLM_TIMEOUT_MS = 25000;

export interface SuggestionMessage {
  senderId: string;
  content: string;
  createdAt?: string;
}

// ─── Guarded module access ────────────────────────────────
// Static literal requires so Metro bundles the JS of each module; the
// try/catch guards builds whose NATIVE side predates these packages —
// there the require (or first native call) throws and we serve Tier B.

type OptionalModule = 'llama.rn' | 'expo-device' | 'expo-network' | 'expo-file-system/legacy';

function tryRequire(name: OptionalModule): any | null {
  try {
    switch (name) {
      case 'llama.rn':
        return require('llama.rn');
      case 'expo-device':
        return require('expo-device');
      case 'expo-network':
        return require('expo-network');
      case 'expo-file-system/legacy':
        return require('expo-file-system/legacy');
    }
  } catch {
    // fall through
  }
  return null;
}

// ─── Tier A: on-device LLM ────────────────────────────────

let llamaContext: any | null = null;
let llamaUnavailable = false;
let modelDownloadStarted = false;

function getDeviceRamBytes(): number {
  try {
    const Device = tryRequire('expo-device');
    return Device?.totalMemory ?? 0;
  } catch {
    return 0;
  }
}

async function isOnWifi(): Promise<boolean> {
  try {
    const Network = tryRequire('expo-network');
    if (!Network?.getNetworkStateAsync) return false;
    const state = await Network.getNetworkStateAsync();
    return state?.type === Network.NetworkStateType?.WIFI;
  } catch {
    return false;
  }
}

function getModelPath(): string | null {
  try {
    const fs = tryRequire('expo-file-system/legacy');
    if (!fs?.documentDirectory) return null;
    return `${fs.documentDirectory}${MODEL_FILE}`;
  } catch {
    return null;
  }
}

/**
 * Kick off the one-time model download when the device qualifies and is on
 * Wi-Fi. Fire-and-forget: until the file exists, Tier B serves suggestions.
 */
async function ensureModelDownloaded(): Promise<string | null> {
  const path = getModelPath();
  if (!path) return null;
  try {
    const fs = tryRequire('expo-file-system/legacy');
    const info = await fs.getInfoAsync(path);
    if (info?.exists) return path;
    if (modelDownloadStarted) return null;
    if (!(await isOnWifi())) return null;
    modelDownloadStarted = true;
    fs.downloadAsync(MODEL_URL, path)
      .then(() => console.log('[dmSuggestions] LLM model downloaded'))
      .catch((err: any) => {
        modelDownloadStarted = false;
        console.warn('[dmSuggestions] Model download failed:', err?.message);
      });
    return null;
  } catch {
    return null;
  }
}

async function getLlamaContext(): Promise<any | null> {
  if (llamaUnavailable) return null;
  if (llamaContext) return llamaContext;

  if (getDeviceRamBytes() < MIN_RAM_BYTES) {
    llamaUnavailable = true;
    return null;
  }
  const llama = tryRequire('llama.rn');
  if (!llama?.initLlama) {
    llamaUnavailable = true;
    return null;
  }
  const modelPath = await ensureModelDownloaded();
  if (!modelPath) return null; // downloading or not on Wi-Fi yet — retry later

  try {
    llamaContext = await llama.initLlama({
      model: modelPath,
      n_ctx: 1024,
      n_gpu_layers: 0,
    });
    return llamaContext;
  } catch (err: any) {
    console.warn('[dmSuggestions] LLM init failed:', err?.message);
    llamaUnavailable = true;
    return null;
  }
}

async function llmSuggestions(
  messages: SuggestionMessage[],
  myUserId: string,
  partnerName: string,
): Promise<string[] | null> {
  const ctx = await getLlamaContext();
  if (!ctx) return null;

  const transcript = messages
    .slice(-20)
    .filter((m) => m.content)
    .map((m) => `${m.senderId === myUserId ? 'me' : partnerName}: ${m.content}`)
    .join('\n');

  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), LLM_TIMEOUT_MS));
  try {
    const result = await Promise.race([
      ctx.completion({
        messages: [
          {
            role: 'system',
            content:
              'You suggest replies for a dating app chat. Given the conversation, ' +
              'write exactly 3 short reply suggestions for "me". Stay strictly on the ' +
              'topic of the last few messages — do not change the subject. Mix the shapes: ' +
              'one witty or teasing statement, one sincere statement, and one that moves ' +
              'the conversation forward. At most ONE suggestion may be a question. ' +
              'Match the other person\'s tone and language. One line each, numbered 1-3, nothing else.',
          },
          { role: 'user', content: transcript || `The chat with ${partnerName} is empty. Suggest 3 openers.` },
        ],
        n_predict: 140,
        temperature: 0.8,
      }),
      timeout,
    ]);
    if (!result?.text) return null;

    const lines = String(result.text)
      .split('\n')
      .map((l: string) => l.replace(/^\s*\d+[).:-]?\s*/, '').trim())
      .filter((l: string) => l.length > 1 && l.length <= 160);
    return lines.length >= 2 ? lines.slice(0, 3) : null;
  } catch (err: any) {
    console.warn('[dmSuggestions] LLM completion failed:', err?.message);
    return null;
  }
}

// ─── Tier B: heuristic engine ─────────────────────────────
// Context-anchored: suggestions stay on the topic of the partner's last
// message (keyword-matched), mix statement/tease/mover shapes (at most one
// question per set), and are deterministic per message so the chips don't
// shuffle while the conversation hasn't moved.

/** Per-topic reply sets: [reaction/statement, tricky/tease, forward-mover]. */
const TOPIC_REPLIES: { keys: RegExp; replies: string[][] }[] = [
  {
    keys: /\b(food|hungry|biryani|pizza|momo|dosa|maggi|coffee|chai|cafe|restaurant|cook|lunch|dinner|breakfast|dessert|snack)\b/i,
    replies: [
      ["Okay now I'm craving that too, thanks a lot 😄", 'Great, now my whole evening is about food thoughts 🍜'],
      ['Bold food opinion. I respect it… barely 😏', "You clearly have good taste — in food at least 😏"],
      ["Fine — you pick the place, I'll judge the menu ☕", 'This settles it, a food trip is happening 🍛'],
    ],
  },
  {
    keys: /\b(movie|film|series|netflix|show|anime|episode|binge|watch(ing|ed)?)\b/i,
    replies: [
      ['Okay adding that to my watchlist right now 🎬', "That's a solid pick, I'll give you that 🎬"],
      ["If your taste in shows is this good, I'm slightly worried about the competition 😏", 'Careful, I judge people by their favourite series 😏'],
      ['Movie night sounds like a future plan honestly 🍿', "We're clearly overdue for a watch-party debate 🍿"],
    ],
  },
  {
    keys: /\b(song|music|playlist|concert|singer|band|spotify|gaana)\b/i,
    replies: [
      ['Playing that on loop now, blame yourself 🎵', 'Okay that artist is actually elite, respect 🎵'],
      ['Swap playlists? I promise mine will surprise you 😏', 'I was today years old when I found someone with decent music taste 😏'],
      ['A concert together would fix everything, just saying 🎤', 'You DJ, I drive — deal? 🚗'],
    ],
  },
  {
    keys: /\b(trip|travel|goa|mountain|beach|vacation|trek|flight|holiday)\b/i,
    replies: [
      ["Now you've put travel plans in my head, great 😄", 'That place is on my list too, no lie 🏔️'],
      ['You strike me as the makes-the-itinerary type… or the loses-the-tickets type 😏', 'Beach person energy. I can tell 😏'],
      ['One day this chat plans an actual trip, mark my words ✈️', 'First coffee, then we talk travel plans properly ☕'],
    ],
  },
  {
    keys: /\b(work|office|job|meeting|deadline|boss|college|exam|class|assignment|shift)\b/i,
    replies: [
      ['Sounds like you earned the weekend already 😅', 'The grind is real — respect for surviving it 💪'],
      ["Okay workaholic, don't forget to have fun sometimes 😏", 'Your boss should honestly pay you extra for texting me during this 😏'],
      ['You clearly need a proper break — I might know a good coffee place ☕', 'Post-deadline celebration should be a real thing 🎉'],
    ],
  },
  {
    keys: /\b(gym|workout|run(ning)?|yoga|fitness|cardio|leg day)\b/i,
    replies: [
      ['Discipline level: intimidating 💪', "Meanwhile my workout today was walking to the fridge 😅"],
      ["So you're strong AND fun to talk to. Suspiciously perfect 😏", 'Leg day and still texting back — impressive 😏'],
      ['Post-gym smoothies count as a date idea, right? 🥤', 'One day you drag me to the gym and I drag you to dessert after 😄'],
    ],
  },
];

/** Generic sets when no topic matches: same shape mix. */
const GENERIC_REPLIES: string[][] = [
  ['Haha okay that actually made me smile 😄', 'See, this is why this chat is the good part of my day', 'Fair point. Annoyingly fair 😄'],
  ["You're trouble, I can tell already 😏", 'Smooth. I noticed what you did there 😏', "I'd argue with that, but you'd probably win 😏"],
  ['We should test this chemistry over coffee sometime ☕', 'This conversation deserves a real-life sequel 🎬', 'Okay you pass the vibe check — weekend plans? 😄'],
];

/** Answer-shaped replies when the partner left a question hanging. */
const QUESTION_ANSWERS: string[][] = [
  ['Short answer: yes. Long answer: it needs a coffee date ☕', "Honest answer: it's a better story in person 😄"],
  ['If I tell you that, you owe me an equally good answer 😏', "Careful — that answer comes with follow-up questions 😏"],
  ["Okay, real answer coming… but you're answering the same right after 😄", "I'll trade you: my answer for your most embarrassing story 😏"],
];

/** Re-engagement when the ball is in the user's court or the chat stalled. */
const REENGAGE_REPLIES: string[][] = [
  ['Update: my day randomly improved and I decided to share that here 😄', 'Reviving this chat because it deserves better ☕'],
  ["Confession: I typed and deleted three messages before this one 😏", 'This is me refusing to let a good conversation die 😏'],
  ["So {name}, how's the week treating you?", "Tell me one good thing that happened today — I'll go second 😄"],
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** One deterministic pick per shape-row, seeded by the anchoring message. */
function assemble(sets: string[][], seed: number, name: string): string[] {
  return sets.map((variants, row) =>
    variants[(seed + row) % variants.length].replace(/\{name\}/g, name),
  );
}

/**
 * Rule-based suggestions anchored to the partner's last message: match its
 * topic and reply in-context with a statement, a tease, and a mover — at
 * most one question in the set.
 */
export function heuristicSuggestions(
  messages: SuggestionMessage[],
  myUserId: string,
  partnerName: string,
): string[] {
  const texts = messages.filter((m) => m.content);

  // Empty / brand-new chat — openers (the one all-question exception)
  if (texts.length <= 2) {
    return assemble(
      [
        ['Hey {name}! Quick vibe check — mountains or beaches? 🏔️🏖️'],
        ["Hi {name}! What's been the best part of your week so far?"],
        ['Okay {name}, important first question: coffee or chai? ☕'],
      ],
      0,
      partnerName,
    );
  }

  const last = texts[texts.length - 1];
  const lastFromPartner = last.senderId !== myUserId;
  const seed = hashString(last.content);

  // Anchor on the partner's most recent message so replies stay in context
  const anchor = lastFromPartner
    ? last
    : [...texts].reverse().find((m) => m.senderId !== myUserId) ?? last;

  // They asked something → answer-shaped (statements/teases), not more questions
  if (lastFromPartner && /\?\s*$/.test(last.content)) {
    return assemble(QUESTION_ANSWERS, seed, partnerName);
  }

  // Topic match on their message → in-context statement / tease / mover
  const topic = TOPIC_REPLIES.find((t) => t.keys.test(anchor.content));
  if (topic && lastFromPartner) {
    return assemble(topic.replies, seed, partnerName);
  }

  // Ball in the user's court / stalled chat → re-engage
  if (!lastFromPartner) {
    return assemble(REENGAGE_REPLIES, seed, partnerName);
  }

  // Partner spoke, no topic matched → generic mix, tone over topic
  return assemble(GENERIC_REPLIES, seed, partnerName);
}

// ─── Public API ───────────────────────────────────────────

/**
 * Suggestions for the DM screen. Tries the on-device LLM (Tier A) and falls
 * back to heuristics (Tier B). Never throws, never returns empty.
 */
export async function getDmSuggestions(
  messages: SuggestionMessage[],
  myUserId: string,
  partnerName: string,
): Promise<string[]> {
  try {
    const llm = await llmSuggestions(messages, myUserId, partnerName);
    if (llm && llm.length > 0) return llm;
  } catch {
    // fall through to heuristics
  }
  return heuristicSuggestions(messages, myUserId, partnerName);
}

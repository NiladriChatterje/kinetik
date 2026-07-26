import { DatingCategory } from '../types';

/**
 * Curated opening lines bucket, organized by dating category.
 * Lines are diverse — some playful, some genuine, some thoughtful —
 * so the sender has a natural conversation starter.
 */

const OPENING_LINES: Record<DatingCategory, string[]> = {
  casual: [
    "Hey! Looks like we're on the same wavelength.",
    "Well, this is a pleasant surprise! How's your day going?",
    "Hey there! What's the best thing that happened to you this week?",
    "Hi! I have a feeling we'd get along — what do you think?",
    "Hey! Since we matched, I'll go first — I'm really into good food and good conversations. You?",
    "Hello! Got any fun plans for the weekend?",
    "Hey! Your profile caught my eye — had to say hi.",
    "Well hello there! What's a hobby you could talk about for hours?",
    "Hey! Let's skip the awkward small talk — tell me something cool about yourself!",
    "Hi! I was hoping we'd match. How's your week treating you?",
  ],
  serious: [
    "Hi! I'm looking for something real, and your profile genuinely stood out to me.",
    "Hey! I believe the best connections start with honesty — so here I am. What's something you're truly passionate about?",
    "Hello! I'd love to get to know the person behind the profile. What's your story?",
    "Hi there! They say the best relationships start with a genuine conversation. Care to start one?",
    "Hey! I'm not here to waste time — I'm looking for someone special. What makes you, you?",
    "Hi! Your profile radiates good energy. I'd love to learn more about what drives you.",
    "Hello! Life's too short for surface-level chats. What's something you've always wanted to share with someone?",
    "Hey! I believe in building something meaningful. What does a perfect day look like to you?",
    "Hi! I value deep conversations and genuine connections. What's a book or idea that changed your perspective?",
    "Hello! Your profile suggests you're someone with depth. I'd love to discover more about the real you.",
  ],
  intimacy: [
    "Hi! There's something about your profile that feels magnetic.",
    "Hey! I'm drawn to your energy. Care to explore where this could go?",
    "Hello! Some connections are instant — and I have a feeling this could be one of them.",
    "Hi! You have an intriguing presence. I'd love to uncover the layers.",
    "Hey! Chemistry is rare, but I have a good feeling about this. What draws you to someone?",
    "Hi! I appreciate someone who knows what they want. Let's not pretend we're here for small talk.",
    "Hello! Confidence is attractive — and your profile has it in spades. Tell me something daring about yourself.",
    "Hey! I believe the best connections happen when two people are honest about what they want. So, what are you looking for?",
    "Hi! There's a certain electricity in the air when two compatible souls connect. Shall we see where this leads?",
    "Hey! I value authenticity and chemistry. What's the most spontaneous thing you've ever done?",
  ],
};

const usedLines = new Map<string, Set<number>>();

/**
 * Pick a (pseudo-)random opening line for the given category.
 * Avoids repeating the same line for the same matchId within a session.
 */
export function getOpeningLine(category: DatingCategory, matchId?: string): string {
  const lines = OPENING_LINES[category];
  const key = matchId || 'fallback';
  const used = usedLines.get(key) || new Set();

  // Find an unused line index
  const available = lines
    .map((_, i) => i)
    .filter((i) => !used.has(i));

  // If all lines have been used for this match, fall back to random
  const idx = available.length > 0
    ? available[Math.floor(Math.random() * available.length)]
    : Math.floor(Math.random() * lines.length);

  used.add(idx);
  usedLines.set(key, used);

  return lines[idx];
}

/**
 * Reset the line tracking for a given matchId (e.g. when match is deleted).
 */
export function resetLineTracking(matchId: string): void {
  usedLines.delete(matchId);
}

/**
 * Get all opening lines for a given category (for preview/debugging).
 */
export function getLinesForCategory(category: DatingCategory): string[] {
  return [...OPENING_LINES[category]];
}

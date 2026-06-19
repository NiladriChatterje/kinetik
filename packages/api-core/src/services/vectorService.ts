/**
 * Vector Computation Service
 *
 * Computes 1024-dimension embedding vectors from user preferences
 * using BGE-M3 via Ollama. All operations are fail-safe — errors
 * are logged and swallowed, never thrown.
 *
 * Fallback strategy: If Ollama is unavailable, a simple deterministic
 * hash-based vector is used so the application continues to function.
 */

import { query, TABLES, getPreferences, findUserById } from './database';
import { getEmbedding, buildPreferenceText, EMBEDDING_DIMENSIONS } from './ollamaClient';

// ─── Logger (inline, no external deps) ──────────────────

function logError(context: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[VectorService] ${context}: ${message}`);
}

function logInfo(msg: string): void {
  console.log(`[VectorService] ${msg}`);
}

// ─── Vector Computation ──────────────────────────────────

/**
 * Interface for the input data needed to compute a vector.
 */
export interface VectorInput {
  valuesAmbition?: number;
  valuesSocial?: number;
  valuesAdventure?: number;
  valuesTradition?: number;
  valuesIntellect?: number;
  valuesEmotional?: number;
  commStyleDirect?: number;
  commStylePlayful?: number;
  commStyleDeep?: number;
  bio?: string;
  [key: string]: unknown;
}

/**
 * Compute a 1024-dimension embedding vector from user preferences.
 *
 * Uses BGE-M3 via Ollama to generate a semantically meaningful embedding
 * from a natural-language description of the user's preferences.
 *
 * @param preferences - User preference values (0-1 range) and optional bio
 * @param bio - Optional user biography text to include in the embedding prompt
 * @returns 1024-element number array, or a fallback vector if Ollama fails
 */
export async function computeVector(
  preferences: VectorInput,
  bio?: string,
): Promise<number[]> {
  try {
    // Build a natural-language description from preferences
    const text = buildPreferenceText({
      valuesAmbition: clamp(preferences.valuesAmbition ?? 0.5),
      valuesSocial: clamp(preferences.valuesSocial ?? 0.5),
      valuesAdventure: clamp(preferences.valuesAdventure ?? 0.5),
      valuesTradition: clamp(preferences.valuesTradition ?? 0.5),
      valuesIntellect: clamp(preferences.valuesIntellect ?? 0.5),
      valuesEmotional: clamp(preferences.valuesEmotional ?? 0.5),
      commStyleDirect: clamp(preferences.commStyleDirect ?? 0.5),
      commStylePlayful: clamp(preferences.commStylePlayful ?? 0.5),
      commStyleDeep: clamp(preferences.commStyleDeep ?? 0.5),
      bio,
    });

    logInfo(`Generating BGE-M3 embedding from: "${text.slice(0, 100)}..."`);

    // Try to get a BGE-M3 embedding from Ollama
    const embedding = await getEmbedding(text);

    if (embedding) {
      logInfo(`BGE-M3 embedding generated successfully (${embedding.length} dim)`);
      return embedding;
    }

    // Fallback: Ollama unavailable — return a deterministic hash-based vector
    logInfo('Ollama unavailable, using deterministic fallback vector');
    return getFallbackVector(preferences);
  } catch (err) {
    logError('computeVector failed, returning fallback', err);
    return getFallbackVector(preferences);
  }
}

/**
 * Deterministic fallback vector when Ollama is unavailable.
 * Uses a seeded hash of the preference values to produce a consistent
 * but shallow vector. Not as semantically rich as BGE-M3, but keeps
 * the matching pipeline running.
 */
function getFallbackVector(preferences: VectorInput): number[] {
  try {
    const baseValues = [
      preferences.valuesAmbition ?? 0.5,
      preferences.valuesSocial ?? 0.5,
      preferences.valuesAdventure ?? 0.5,
      preferences.valuesTradition ?? 0.5,
      preferences.valuesIntellect ?? 0.5,
      preferences.valuesEmotional ?? 0.5,
      preferences.commStyleDirect ?? 0.5,
      preferences.commStylePlayful ?? 0.5,
      preferences.commStyleDeep ?? 0.5,
    ];

    // Create a unique seed from the base values
    const seed = Math.round(
      baseValues.reduce((acc, v, i) => acc + v * Math.pow(10, i + 1), 0) * 1000,
    );

    // Simple seeded LCG PRNG
    let state = (seed * 1664525 + 1013904223) & 0x7fffffff;
    const nextRandom = (): number => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };

    const vector = new Array<number>(EMBEDDING_DIMENSIONS);

    // First 9 dimensions: direct base values
    for (let i = 0; i < baseValues.length; i++) {
      vector[i] = baseValues[i];
    }

    // Remaining dimensions: seeded pseudo-random mixing
    for (let i = 9; i < EMBEDDING_DIMENSIONS; i++) {
      const numComponents = 3 + Math.floor(nextRandom() * 3);
      let sum = 0;
      let weightSum = 0;

      for (let c = 0; c < numComponents; c++) {
        const baseIdx = Math.floor(nextRandom() * baseValues.length);
        const weight = nextRandom() * 0.8 + 0.2;
        sum += baseValues[baseIdx] * weight;
        weightSum += weight;
      }

      const normalized = weightSum > 0 ? sum / weightSum : 0.5;
      vector[i] = clamp(normalized * 0.9 + 0.05 + (nextRandom() - 0.5) * 0.02);
    }

    return vector;
  } catch {
    // Ultimate fallback: flat vector
    return new Array(EMBEDDING_DIMENSIONS).fill(0.5);
  }
}

// ─── Database Operations ─────────────────────────────────

/**
 * Upsert a computed vector into the user_vectors table.
 * Fire-and-forget — errors are logged but not thrown.
 */
export async function storeVector(
  userId: string,
  vector: number[],
): Promise<void> {
  try {
    if (!userId) {
      logError('storeVector', 'userId is required');
      return;
    }

    if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) {
      logError(
        'storeVector',
        `Invalid vector: expected ${EMBEDDING_DIMENSIONS} dimensions, got ${vector?.length ?? 0}`,
      );
      return;
    }

    // PostgreSQL REAL[] format: {0.1,0.2,...}
    const vectorLiteral = `{${vector.map((v) => v.toFixed(6)).join(',')}}`;

    await query(
      `INSERT INTO ${TABLES.USER_VECTORS} (user_id, vector, version, updated_at)
       VALUES ($1, $2::real[], 1, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET vector = $2::real[], version = user_vectors.version + 1, updated_at = NOW()`,
      [userId, vectorLiteral],
    );

    logInfo(`Vector stored/updated for user ${userId} (${EMBEDDING_DIMENSIONS} dim)`);
  } catch (err) {
    logError(`storeVector(user=${userId})`, err);
  }
}

/**
 * Compute and store a vector for a user in one call.
 * Fetches their current preferences and profile, computes the BGE-M3
 * embedding, and stores it.
 *
 * Fire-and-forget helper — errors are logged internally, never thrown.
 */
export async function syncVectorForUser(userId: string): Promise<void> {
  try {
    if (!userId) {
      logError('syncVectorForUser', 'userId is required');
      return;
    }

    const prefs = await getPreferences(userId);

    // Try to get user's bio for richer embedding context
    let bio: string | undefined;
    try {
      const user = await findUserById(userId);
      if (user?.bio) {
        bio = user.bio;
      }
    } catch {
      // Bio fetch is optional — proceed without it
    }

    if (!prefs) {
      logInfo(`No preferences found for user ${userId}, using defaults for vector`);
      // Compute with defaults — this will try BGE-M3 first, then fallback
      const vector = await computeVector({}, bio);
      await storeVector(userId, vector);
      return;
    }

    // Map snake_case DB columns to camelCase expected by computeVector
    const input: VectorInput = {
      valuesAmbition: prefs.values_ambition ?? 0.5,
      valuesSocial: prefs.values_social ?? 0.5,
      valuesAdventure: prefs.values_adventure ?? 0.5,
      valuesTradition: prefs.values_tradition ?? 0.5,
      valuesIntellect: prefs.values_intellect ?? 0.5,
      valuesEmotional: prefs.values_emotional ?? 0.5,
      commStyleDirect: prefs.comm_style_direct ?? 0.5,
      commStylePlayful: prefs.comm_style_playful ?? 0.5,
      commStyleDeep: prefs.comm_style_deep ?? 0.5,
      bio,
    };

    const vector = await computeVector(input, bio);
    await storeVector(userId, vector);
  } catch (err) {
    logError(`syncVectorForUser(user=${userId})`, err);
  }
}

// ─── Utility ──────────────────────────────────────────────

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(Math.max(value, min), max);
}

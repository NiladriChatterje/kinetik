/**
 * Ollama Embedding Client
 *
 * Lightweight HTTP client for generating embeddings via Ollama's
 * /api/embed endpoint using the bge-m3 model. All operations are
 * fail-safe — errors are logged and never thrown.
 *
 * bge-m3 produces 1024-dimensional embedding vectors.
 */

import { request as httpsRequest } from 'https';
import { request as httpRequest } from 'http';
import { URL } from 'url';

// ─── Configuration ─────────────────────────────────────────

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || 'bge-m3';
const EMBEDDING_DIMENSIONS = 1024;
const REQUEST_TIMEOUT_MS = parseInt(
  process.env.OLLAMA_TIMEOUT_MS || '30000',
  10,
);

// ─── Logger (inline, no external deps) ─────────────────────

function logError(context: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[Ollama] ${context}: ${message}`);
}

function logInfo(msg: string): void {
  console.log(`[Ollama] ${msg}`);
}

// ─── HTTP Helper ────────────────────────────────────────────

/**
 * Make a JSON HTTP request using Node's built-in http/https modules.
 * No external dependencies required.
 */
function jsonRequest(
  urlStr: string,
  method: string,
  body: unknown,
  timeoutMs: number,
): Promise<unknown | null> {
  return new Promise((resolve) => {
    try {
      const url = new URL(urlStr);
      const isHttps = url.protocol === 'https:';
      const requester = isHttps ? httpsRequest : httpRequest;

      const bodyStr = JSON.stringify(body);

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr).toString(),
        },
        timeout: timeoutMs,
      };

      const req = requester(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const raw = Buffer.concat(chunks).toString('utf-8');
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(JSON.parse(raw));
            } else {
              logError(
                `HTTP ${res.statusCode} from ${urlStr}`,
                raw.slice(0, 500),
              );
              resolve(null);
            }
          } catch (parseErr) {
            logError(`Failed to parse response from ${urlStr}`, parseErr);
            resolve(null);
          }
        });
      });

      req.on('error', (err: Error) => {
        logError(`Request failed to ${urlStr}`, err);
        resolve(null);
      });

      req.on('timeout', () => {
        req.destroy();
        logError('Request timeout', `Timed out after ${timeoutMs}ms to ${urlStr}`);
        resolve(null);
      });

      req.write(bodyStr);
      req.end();
    } catch (err) {
      logError(`Unexpected error in request to ${urlStr}`, err);
      resolve(null);
    }
  });
}

// ─── Embedding API ──────────────────────────────────────────

/**
 * Generate an embedding vector for a text string using Ollama's
 * /api/embed endpoint with the configured model (default: bge-m3).
 *
 * @param text - Input text to embed
 * @returns 1024-element number array, or null if the request fails
 */
export async function getEmbedding(text: string): Promise<number[] | null> {
  try {
    if (!text || text.trim().length === 0) {
      logError('getEmbedding', 'Empty text provided');
      return null;
    }

    const url = `${OLLAMA_BASE_URL}/api/embed`;

    const response = (await jsonRequest(url, 'POST', {
      model: OLLAMA_MODEL,
      input: text.trim(),
      truncate: true,
    }, REQUEST_TIMEOUT_MS)) as Record<string, unknown> | null;

    if (!response) {
      logError('getEmbedding', 'No response from Ollama API');
      return null;
    }

    const embeddings = response.embeddings as number[][] | undefined;

    if (!Array.isArray(embeddings) || embeddings.length === 0) {
      logError('getEmbedding', 'No embeddings in response');
      return null;
    }

    const vector = embeddings[0];

    if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) {
      logError(
        'getEmbedding',
        `Expected ${EMBEDDING_DIMENSIONS}-dim vector, got ${vector?.length ?? 0}`,
      );
      return null;
    }

    logInfo(
      `Embedding generated: ${text.slice(0, 60)}... → ${vector.length} dim (model: ${response.model ?? OLLAMA_MODEL})`,
    );

    return vector;
  } catch (err) {
    logError('getEmbedding failed', err);
    return null;
  }
}

/**
 * Build a descriptive text prompt from user preferences for embedding.
 * The text is designed to capture the user's dating preferences in a
 * semantic way that BGE-M3 can meaningfully embed.
 */
export function buildPreferenceText(preferences: {
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
}): string {
  const parts: string[] = [];

  parts.push('I am looking for someone compatible in a dating context.');

  // Value dimensions — describe in natural language
  // Include all dimensions even at 0.5 ("moderately") so the embedding
  // always has meaningful semantic signal — never an empty prompt
  if (preferences.valuesAmbition !== undefined) {
    const level = describeLevel(preferences.valuesAmbition);
    parts.push(`I ${level} value ambition and career drive in a partner.`);
  }

  if (preferences.valuesSocial !== undefined) {
    const level = describeLevel(preferences.valuesSocial);
    parts.push(`I ${level} value social connection and meeting new people.`);
  }

  if (preferences.valuesAdventure !== undefined) {
    const level = describeLevel(preferences.valuesAdventure);
    parts.push(`I ${level} value adventure and trying new experiences.`);
  }

  if (preferences.valuesTradition !== undefined) {
    const level = describeLevel(preferences.valuesTradition);
    parts.push(`I ${level} value tradition and stability.`);
  }

  if (preferences.valuesIntellect !== undefined) {
    const level = describeLevel(preferences.valuesIntellect);
    parts.push(`I ${level} value intellectual conversations and learning.`);
  }

  if (preferences.valuesEmotional !== undefined) {
    const level = describeLevel(preferences.valuesEmotional);
    parts.push(`I ${level} value emotional depth and vulnerability.`);
  }

  // Communication style
  if (preferences.commStyleDirect !== undefined) {
    const level = describeLevel(preferences.commStyleDirect);
    parts.push(`I ${level} prefer direct and straightforward communication.`);
  }

  if (preferences.commStylePlayful !== undefined) {
    const level = describeLevel(preferences.commStylePlayful);
    parts.push(`I ${level} enjoy playful and flirty communication.`);
  }

  if (preferences.commStyleDeep !== undefined) {
    const level = describeLevel(preferences.commStyleDeep);
    parts.push(`I ${level} enjoy deep, meaningful conversations.`);
  }

  // User bio (if available)
  if (preferences.bio) {
    parts.push(`About me: ${preferences.bio}`);
  }

  return parts.join(' ');
}

/**
 * Convert a 0-1 numeric value to a natural language intensity descriptor.
 */
function describeLevel(value: number): string {
  if (value >= 0.9) return 'strongly';
  if (value >= 0.7) return 'very much';
  if (value >= 0.6) return 'moderately';
  if (value >= 0.4) return 'somewhat';
  if (value >= 0.3) return 'slightly';
  return 'hardly';
}

export { EMBEDDING_DIMENSIONS, OLLAMA_MODEL };

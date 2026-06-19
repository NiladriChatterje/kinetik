feat: Integrate BGE-M3 embedding model via Ollama for semantic user vector computation

## Why

The previous vector computation relied on a seeded pseudo-random number generator
to expand 9 numeric preference values into a 128-dimension "personality vector."
This approach had three major shortcomings:

1. **No semantic understanding** — Two users with different preference descriptions
   could get vectors that happened to be numerically close by chance, leading to
   false positive match signals.
2. **Flat 128-dim limit** — The fixed 128 dimensions couldn't capture the richness
   of user preferences and natural-language bios.
3. **No real-world embedding** — The vectors had no semantic meaning; cosine
   similarity between vectors wouldn't correspond to actual preference alignment.

## What changed

### BGE-M3 Embedding via Ollama (new: ollamaClient.ts)

- Lightweight HTTP client for Ollama's `/api/embed` endpoint using Node.js
  built-in `http`/`https` modules — zero external dependencies added.
- `buildPreferenceText()` converts 9 numeric preference dimensions (ambition,
  social, adventure, tradition, intellect, emotional, direct, playful, deep
  communication) into natural-language sentences: "I strongly value ambition
  and career drive in a partner."
- Optional user bio is appended for richer embedding context.
- All 9 dimensions are always included (even at neutral 0.5 → "moderately")
  so the embedding prompt is never empty — always semantically meaningful.
- Configurable via env vars: `OLLAMA_BASE_URL` (default localhost:11434),
  `OLLAMA_EMBEDDING_MODEL` (default bge-m3), `OLLAMA_TIMEOUT_MS` (default 30s).

### Rewritten vectorService.ts

- `computeVector()` is now async — calls Ollama BGE-M3 for a true 1024-dim
  embedding vector.
- Falls back to a deterministic seeded PRNG vector if Ollama is unreachable
  (server down, timeout, network error) — the matching pipeline never breaks.
- `syncVectorForUser()` also fetches the user's bio for richer embedding text.
- Every function wrapped in try/catch — never throws, never crashes a request.

### Updated vector dimensions (shared/constants)

- `VECTOR_DIMENSIONS` increased from 128 to 1024 to match BGE-M3's output.
- The `user_vectors` table already uses `REAL[]` — no schema migration needed.
- `VectorMatcher` in the match engine already uses `cosineSimilarity()` on
  the vector field, which works with any dimensionality.

### Fire-and-forget integration (routes/users.ts, routes/onboarding.ts)

- `PUT /preferences` fires `syncVectorForUser()` after upserting preferences.
- `POST /step` (onboarding completion) fires `syncVectorForUser()` when
  `isComplete === true`.
- Both use `.catch()` with error logging — never block the HTTP response.

## Fail-safe guarantees

| Scenario | Behavior |
|---|---|
| Ollama server down | Falls back to deterministic seeded PRNG vector |
| BGE-M3 returns wrong dimension | Logged error, service continues |
| HTTP timeout (default 30s) | Logged, falls back gracefully |
| DB unreachable | Error logged, vector silently skipped |
| Preference fetch fails | Defaults used for vector computation |
| Bio fetch fails | Proceeds without bio |

## Files changed

- packages/api-core/src/services/ollamaClient.ts       (new)
- packages/api-core/src/services/vectorService.ts       (rewritten)
- packages/shared/src/constants/index.ts                (VECTOR_DIMENSIONS: 128 → 1024)
- packages/api-core/src/routes/users.ts                 (fire-and-forget vector sync)
- packages/api-core/src/routes/onboarding.ts            (fire-and-forget vector sync)

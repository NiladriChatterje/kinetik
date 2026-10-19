import { Pool, PoolClient, PoolConfig, QueryResult, QueryResultRow } from 'pg';

let pool: Pool | null = null;

// ─── Waiting for a database that is waking up ─────────────
// The hosted Postgres sleeps when idle and takes 20-30 s to accept
// connections again. Getting a connection is retried, so a request waits for
// the wake-up instead of failing: three attempts of CONNECT_TIMEOUT_MS plus
// the pauses stay under nginx's 60 s proxy timeout. Only the connect step is
// retried. A query that was already sent is never sent again, so a write can
// never run twice.
const CONNECT_TIMEOUT_MS = Number(process.env.DB_CONNECT_TIMEOUT_MS) || 15000;
const CONNECT_ATTEMPTS = 3;
const CONNECT_RETRY_DELAYS_MS = [1000, 2000];

/** Failures while obtaining a connection that a wake-up or a blip explains. */
export function isTransientConnectError(error: any): boolean {
  const message = String(error?.message || '');
  return (
    message.includes('timeout exceeded when trying to connect') ||
    message.includes('Connection terminated due to connection timeout') ||
    message.includes('Connection terminated unexpectedly') ||
    ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', '57P03'].includes(error?.code)
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A pooled connection, retrying while the database wakes up (see above). */
export async function connectWithRetry(
  target: Pick<Pool, 'connect'> = getDatabasePool(),
  wait: (ms: number) => Promise<unknown> = sleep,
): Promise<PoolClient> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await target.connect();
    } catch (error: any) {
      if (attempt >= CONNECT_ATTEMPTS || !isTransientConnectError(error)) throw error;
      console.warn(
        `[DB] Connect attempt ${attempt}/${CONNECT_ATTEMPTS} failed (${error?.message || error}); ` +
          'retrying, the database may be waking up',
      );
      await wait(CONNECT_RETRY_DELAYS_MS[attempt - 1] ?? CONNECT_RETRY_DELAYS_MS[CONNECT_RETRY_DELAYS_MS.length - 1]);
    }
  }
}

export function getDatabasePool(config?: PoolConfig): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Connections per process. docker-compose sets DB_POOL_MAX per service;
      // the sum across services must stay under the managed Postgres limit.
      max: Number(process.env.DB_POOL_MAX) || 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      ...config,
    });

    pool.on('error', (err) => {
      console.error('Unexpected database pool error:', err);
    });
  }
  return pool;
}

export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[],
): Promise<QueryResult<T>> {
  const start = Date.now();
  let conn: PoolClient | null = null;
  try {
    conn = await connectWithRetry();
    let result: QueryResult<T>;
    try {
      result = await conn.query<T>(text, params);
    } catch (queryError: any) {
      // As pool.query does: a connection that failed a query is discarded
      conn.release(queryError);
      conn = null;
      throw queryError;
    }
    conn.release();
    conn = null;
    const duration = Date.now() - start;

    if (duration > 1000) {
      console.warn(`[DB] Slow query (${duration}ms):`, text.slice(0, 100));
    }

    return result;
  } catch (error: any) {
    const duration = Date.now() - start;
    const errorMessage = error?.message || String(error);
    const errorCode = error?.code || 'UNKNOWN';  // PostgreSQL error codes like '23505' (unique violation), '42P01' (undefined table), etc.
    const detail = error?.detail || '';

    console.error(
      `[DB] Query failed after ${duration}ms | code=${errorCode} | message=${errorMessage}` +
        (detail ? ` | detail=${detail}` : ''),
    );
    console.error(`[DB] SQL: ${text.slice(0, 500)}${text.length > 500 ? '...' : ''}`);
    if (params && params.length > 0) {
      // Log param types and lengths (not raw values, to avoid leaking PII like passwords)
      const paramSummary = params.map((p, i) => {
        if (p === null || p === undefined) return `$${i + 1}=null`;
        if (typeof p === 'string') return `$${i + 1}=string(${p.length})`;
        if (Buffer.isBuffer(p)) return `$${i + 1}=buffer(${p.length})`;
        return `$${i + 1}=${typeof p}`;
      });
      console.error(`[DB] Params: [${paramSummary.join(', ')}]`);
    }

    throw error;
  }
}

export async function transaction<T>(
  callback: (query: <R extends QueryResultRow>(text: string, params?: any[]) => Promise<QueryResult<R>>) => Promise<T>,
): Promise<T> {
  const conn = await connectWithRetry();
  try {
    await conn.query('BEGIN');
    const result = await callback(<R extends QueryResultRow = any>(text: string, params?: any[]) => conn.query<R>(text, params));
    await conn.query('COMMIT');
    return result;
  } catch (error) {
    await conn.query('ROLLBACK');
    throw error;
  } finally {
    conn.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// ─── Schema Table Names ───────────────────────────────────

export const TABLES = {
  USERS: 'users',
  PROFILE_PHOTOS: 'profile_photos',
  USER_PREFERENCES: 'user_preferences',
  INTERESTS: 'interests',
  USER_INTERESTS: 'user_interests',
  MATCHES: 'matches',
  VENUES: 'venues',
  RESERVATIONS: 'reservations',
  DUO_CREWS: 'duo_crews',
  SUBSCRIPTION_LEDGER: 'subscription_ledger',
  PLAY_PENDING_PURCHASES: 'play_pending_purchases',
  TRANSACTIONS: 'transactions',
  USER_INTERACTIONS: 'user_interactions',
  KYC_DOCUMENTS: 'kyc_documents',
  MESSAGES: 'messages',
  CHAT_MEDIA: 'chat_media',
  PUSH_TOKENS: 'push_tokens',
  AUDIT_LOG: 'audit_log',
  USER_REPORTS: 'user_reports',
  USER_BLOCKS: 'user_blocks',
} as const;

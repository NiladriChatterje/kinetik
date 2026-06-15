import { Pool, PoolConfig, QueryResult } from 'pg';

let pool: Pool | null = null;

export function getDatabasePool(config?: PoolConfig): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ...config,
    });

    pool.on('error', (err) => {
      console.error('Unexpected database pool error:', err);
    });
  }
  return pool;
}

export async function query<T = any>(
  text: string,
  params?: any[],
): Promise<QueryResult<T>> {
  const client = getDatabasePool();
  const start = Date.now();
  const result = await client.query<T>(text, params);
  const duration = Date.now() - start;

  if (duration > 1000) {
    console.warn(`Slow query (${duration}ms):`, text.slice(0, 100));
  }

  return result;
}

export async function transaction<T>(
  callback: (query: <R = any>(text: string, params?: any[]) => Promise<QueryResult<R>>) => Promise<T>,
): Promise<T> {
  const client = getDatabasePool();
  const conn = await client.connect();
  try {
    await conn.query('BEGIN');
    const result = await callback(<R = any>(text: string, params?: any[]) => conn.query<R>(text, params));
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
  FLASH_WINDOWS: 'flash_windows',
  WINDOW_PARTICIPANTS: 'window_participants',
  VIBE_CHECKS: 'vibe_checks',
  MATCHES: 'matches',
  VENUES: 'venues',
  RESERVATIONS: 'reservations',
  DUO_CREWS: 'duo_crews',
  SUBSCRIPTION_LEDGER: 'subscription_ledger',
  TRANSACTIONS: 'transactions',
  USER_INTERACTIONS: 'user_interactions',
  USER_VECTORS: 'user_vectors',
  KYC_DOCUMENTS: 'kyc_documents',
  AUDIT_LOG: 'audit_log',
} as const;

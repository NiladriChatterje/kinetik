import { getDatabasePool, query, TABLES } from '@kinetik/shared';

export function initializeDatabase() {
  const pool = getDatabasePool();
  console.log('🗄️  PostgreSQL pool initialized');
  return pool;
}

export { query, TABLES };

// ─── User Queries ─────────────────────────────────────────

export async function createUser(data: {
  phone?: string;
  email?: string;
  passwordHash?: string;
  authProvider?: string;
  authProviderId?: string;
}) {
  const result = await query(
    `INSERT INTO ${TABLES.USERS} (phone, email, password_hash, auth_provider, auth_provider_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, phone, email, created_at`,
    [data.phone, data.email, data.passwordHash, data.authProvider, data.authProviderId],
  );
  return result.rows[0];
}

export async function findUserByPhone(phone: string) {
  const result = await query(
    `SELECT id, phone, email, password_hash, display_name, is_verified,
            onboarding_complete, onboarding_step, created_at
     FROM ${TABLES.USERS}
     WHERE phone = $1 AND is_banned = FALSE`,
    [phone],
  );
  return result.rows[0] || null;
}

export async function findUserByEmail(email: string) {
  const result = await query(
    `SELECT id, phone, email, password_hash, display_name, is_verified,
            onboarding_complete, onboarding_step, created_at
     FROM ${TABLES.USERS}
     WHERE email = $1 AND is_banned = FALSE`,
    [email],
  );
  return result.rows[0] || null;
}

export async function findUserById(id: string) {
  const result = await query(
    `SELECT u.id, u.phone, u.email, u.display_name, u.date_of_birth, u.gender,
            u.pronouns, u.bio, u.occupation, u.education,
            u.is_verified, u.kyc_status, u.liveness_status,
            u.latitude, u.longitude, u.h3_index,
            u.is_active, u.onboarding_complete, u.onboarding_step,
            u.last_active_at, u.created_at, u.updated_at,
            pp.url as primary_photo_url, pp.thumbnail_url as primary_thumbnail_url
     FROM ${TABLES.USERS} u
     LEFT JOIN ${TABLES.PROFILE_PHOTOS} pp ON pp.user_id = u.id AND pp.is_primary = TRUE
     WHERE u.id = $1`,
    [id],
  );
  return result.rows[0] || null;
}

export async function updateUser(id: string, data: Record<string, any>) {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const setClause = keys.map((key, i) => `${key} = $${i + 2}`).join(', ');
  const result = await query(
    `UPDATE ${TABLES.USERS} SET ${setClause} WHERE id = $1 RETURNING *`,
    [id, ...values],
  );
  return result.rows[0];
}

// ─── Preferences Queries ──────────────────────────────────

export async function upsertPreferences(userId: string, data: Record<string, any>) {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const setClause = keys.map((key, i) => `${key} = $${i + 2}`).join(', ');
  const updateClause = keys.map((key) => `${key} = EXCLUDED.${key}`).join(', ');

  const result = await query(
    `INSERT INTO ${TABLES.USER_PREFERENCES} (user_id, ${keys.join(', ')})
     VALUES ($1, ${values.map((_, i) => `$${i + 2}`).join(', ')})
     ON CONFLICT (user_id) DO UPDATE SET ${updateClause}, updated_at = NOW()
     RETURNING *`,
    [userId, ...values],
  );
  return result.rows[0];
}

export async function getPreferences(userId: string) {
  const result = await query(
    `SELECT * FROM ${TABLES.USER_PREFERENCES} WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0] || null;
}

// ─── Subscription Queries ─────────────────────────────────

export async function getSubscription(userId: string) {
  const result = await query(
    `SELECT * FROM ${TABLES.SUBSCRIPTION_LEDGER} WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0] || null;
}

export async function createSubscription(userId: string, tier: string = 'free') {
  const result = await query(
    `INSERT INTO ${TABLES.SUBSCRIPTION_LEDGER} (user_id, tier)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET tier = $2, updated_at = NOW()
     RETURNING *`,
    [userId, tier],
  );
  return result.rows[0];
}

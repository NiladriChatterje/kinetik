import { getDatabasePool, query, TABLES } from '@kinetik/shared';
import { Pool } from 'pg';

export function initializeDatabase(): Pool {
  const pool = getDatabasePool();
  console.log('🗄️  PostgreSQL pool initialized');
  return pool;
}

export { query, TABLES };

// ─── User Queries ─────────────────────────────────────────

export async function createUser(data: {
  phone?: string;
  email?: string;
  /** Proven with an emailed code before the account was created */
  emailVerified?: boolean;
  passwordHash?: string;
  authProvider?: string;
  authProviderId?: string;
  displayName?: string;
  dateOfBirth?: string;
  /** ISO 3166-1 alpha-2 from the signup picker */
  countryCode?: string;
  // Signup city: seeds the location columns so the feed works before GPS
  city?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  h3Index?: string;
}) {
  try {
    const result = await query(
      `INSERT INTO ${TABLES.USERS} (phone, email, password_hash, auth_provider, auth_provider_id, display_name, date_of_birth, country_code,
                                    city, country, latitude, longitude, h3_index, email_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id, phone, email, display_name, created_at`,
      [
        data.phone, data.email, data.passwordHash, data.authProvider, data.authProviderId, data.displayName,
        data.dateOfBirth || null, data.countryCode || null,
        data.city || null, data.country || null, data.latitude ?? null, data.longitude ?? null, data.h3Index || null,
        data.emailVerified ?? false,
      ],
    );
    return result.rows[0];
  } catch (error: any) {
    console.error(`[createUser] Failed for phone=${data.phone ? data.phone.slice(0, 4) + '***' : 'N/A'}, authProvider=${data.authProvider}`, {
      error: error?.message || error,
      code: error?.code,
      detail: error?.detail,
    });
    throw error;
  }
}

export async function findUserByPhone(phone: string) {
  try {
    const result = await query(
      `SELECT id, phone, email, password_hash, display_name, is_verified,
              onboarding_complete, onboarding_step, created_at
       FROM ${TABLES.USERS}
       WHERE phone = $1 AND is_banned = FALSE`,
      [phone],
    );
    return result.rows[0] || null;
  } catch (error: any) {
    console.error(`[findUserByPhone] Failed for phone=${phone ? phone.slice(0, 4) + '***' : 'N/A'}`, {
      error: error?.message || error,
      code: error?.code,
    });
    throw error;
  }
}

export async function findUserByEmail(email: string) {
  try {
    const result = await query(
      `SELECT id, phone, email, password_hash, display_name, is_verified,
              onboarding_complete, onboarding_step, created_at
       FROM ${TABLES.USERS}
       WHERE email = $1 AND is_banned = FALSE`,
      [email],
    );
    return result.rows[0] || null;
  } catch (error: any) {
    console.error(`[findUserByEmail] Failed for email=${email ? email.slice(0, 3) + '***@***' : 'N/A'}`, {
      error: error?.message || error,
      code: error?.code,
    });
    throw error;
  }
}

export async function findUserById(id: string) {
  try {
    const result = await query(
      `      SELECT u.id, u.phone, u.email, u.display_name, u.date_of_birth, u.gender,
              u.pronouns, u.bio, u.occupation, u.education,
              u.is_verified, u.kyc_status, u.face_verification_status,
              u.latitude, u.longitude, u.h3_index, u.dating_category, u.about_answers,
              u.country_code, u.city, u.county, u.region, u.country,
              u.preferred_country_code, u.preferred_city, u.preferred_latitude, u.preferred_longitude,
              u.is_active, u.is_banned, u.deleted_at,
              u.onboarding_complete, u.onboarding_step,
              u.last_active_at, u.created_at, u.updated_at,
              pp.url as primary_photo_url, pp.thumbnail_url as primary_thumbnail_url
       FROM ${TABLES.USERS} u
       LEFT JOIN ${TABLES.PROFILE_PHOTOS} pp ON pp.user_id = u.id AND pp.is_primary = TRUE
       WHERE u.id = $1`,
      [id],
    );
    return result.rows[0] || null;
  } catch (error: any) {
    console.error(`[findUserById] Failed for id=${id}`, {
      error: error?.message || error,
      code: error?.code,
    });
    throw error;
  }
}

export async function updateUser(id: string, data: Record<string, any>) {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const setClause = keys.map((key, i) => `${key} = $${i + 2}`).join(', ');
  try {
    const result = await query(
      `UPDATE ${TABLES.USERS} SET ${setClause} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    return result.rows[0];
  } catch (error: any) {
    console.error(`[updateUser] Failed for id=${id}, fields=[${keys.join(', ')}]`, {
      error: error?.message || error,
      code: error?.code,
    });
    throw error;
  }
}

// ─── Preferences Queries ──────────────────────────────────

// The API speaks camelCase (ageMin, maxDistanceKm); the table is snake_case
// (age_min, max_distance_km). Using the API names as column names made every
// save fail, since Postgres folds them to agemin and the like. Only columns a
// user may set are listed; anything else in the body is ignored.
const PREFERENCE_COLUMNS = new Set([
  'age_min', 'age_max', 'max_distance_km', 'preferred_genders',
  'values_ambition', 'values_social', 'values_adventure',
  'values_tradition', 'values_intellect', 'values_emotional',
  'weight_age', 'weight_distance', 'weight_values', 'weight_interests',
  'comm_style_direct', 'comm_style_playful', 'comm_style_deep',
]);
const INTEGER_PREFERENCE_COLUMNS = new Set(['age_min', 'age_max', 'max_distance_km']);

const camelToSnake = (key: string) => key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
const snakeToCamel = (key: string) => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** A preferences row as the API returns it: camelCase, without the row plumbing. */
export function preferencesRowToApi(row: Record<string, any> | null) {
  if (!row) return null;
  const out: Record<string, any> = {};
  for (const [column, value] of Object.entries(row)) {
    if (column === 'id' || column === 'user_id') continue;
    out[snakeToCamel(column)] = value;
  }
  return out;
}

export async function upsertPreferences(userId: string, data: Record<string, any>) {
  const keys: string[] = [];
  const values: any[] = [];
  for (const [field, value] of Object.entries(data)) {
    if (value === undefined) continue;
    const column = camelToSnake(field);
    if (!PREFERENCE_COLUMNS.has(column)) continue;
    keys.push(column);
    // Sliders send fractions; the age and distance columns are integers.
    values.push(INTEGER_PREFERENCE_COLUMNS.has(column) && typeof value === 'number' ? Math.round(value) : value);
  }
  const updateClause = keys.map((key) => `${key} = EXCLUDED.${key}`).join(', ');

  try {
    const result = await query(
      keys.length === 0
        ? `INSERT INTO ${TABLES.USER_PREFERENCES} (user_id) VALUES ($1)
           ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
           RETURNING *`
        : `INSERT INTO ${TABLES.USER_PREFERENCES} (user_id, ${keys.join(', ')})
           VALUES ($1, ${values.map((_, i) => `${i + 2}`).join(', ')})
           ON CONFLICT (user_id) DO UPDATE SET ${updateClause}, updated_at = NOW()
           RETURNING *`,
      [userId, ...values],
    );
    return preferencesRowToApi(result.rows[0]);
  } catch (error: any) {
    console.error(`[upsertPreferences] Failed for userId=${userId}, fields=[${keys.join(', ')}]`, {
      error: error?.message || error,
      code: error?.code,
    });
    throw error;
  }
}

export async function getPreferences(userId: string) {
  try {
    const result = await query(
      `SELECT * FROM ${TABLES.USER_PREFERENCES} WHERE user_id = $1`,
      [userId],
    );
    return preferencesRowToApi(result.rows[0] || null);
  } catch (error: any) {
    console.error(`[getPreferences] Failed for userId=${userId}`, {
      error: error?.message || error,
      code: error?.code,
    });
    throw error;
  }
}

// ─── Photo Queries ────────────────────────────────────────

export async function insertPhoto(data: {
  userId: string;
  url: string;
  thumbnailUrl: string;
  orderIndex?: number;
}) {
  const result = await query(
    `INSERT INTO ${TABLES.PROFILE_PHOTOS} (user_id, url, thumbnail_url, order_index)
     VALUES ($1, $2, $3, $4)
     RETURNING id, url, thumbnail_url, is_primary, order_index, created_at`,
    [data.userId, data.url, data.thumbnailUrl, data.orderIndex ?? 0],
  );
  return result.rows[0];
}

export async function getPhotosByUserId(userId: string) {
  const result = await query(
    `SELECT id, url, thumbnail_url, blur_hash, is_primary, order_index, created_at
     FROM ${TABLES.PROFILE_PHOTOS}
     WHERE user_id = $1
     ORDER BY order_index ASC, created_at ASC`,
    [userId],
  );
  return result.rows;
}

export async function deletePhotoById(photoId: string, userId: string) {
  const result = await query(
    `DELETE FROM ${TABLES.PROFILE_PHOTOS} WHERE id = $1 AND user_id = $2 RETURNING id`,
    [photoId, userId],
  );
  return result.rows[0] || null;
}

export async function setPrimaryPhoto(photoId: string, userId: string) {
  // One statement: the chosen photo becomes primary and the others stop
  // being, only if the photo is the user's. Clearing first and then setting
  // left a profile with no primary at all when the id was not theirs.
  const result = await query(
    `UPDATE ${TABLES.PROFILE_PHOTOS} SET is_primary = (id = $1)
     WHERE user_id = $2
       AND EXISTS (SELECT 1 FROM ${TABLES.PROFILE_PHOTOS} WHERE id = $1 AND user_id = $2)
     RETURNING *`,
    [photoId, userId],
  );
  return result.rows.find((row: { id: string }) => row.id === photoId) || null;
}

export async function getPhotoCount(userId: string): Promise<number> {
  const result = await query(
    `SELECT COUNT(*) as count FROM ${TABLES.PROFILE_PHOTOS} WHERE user_id = $1`,
    [userId],
  );
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

// ─── Subscription Queries ─────────────────────────────────

export async function getSubscription(userId: string) {
  try {
    const result = await query(
      `SELECT * FROM ${TABLES.SUBSCRIPTION_LEDGER} WHERE user_id = $1`,
      [userId],
    );
    return result.rows[0] || null;
  } catch (error: any) {
    console.error(`[getSubscription] Failed for userId=${userId}`, {
      error: error?.message || error,
      code: error?.code,
    });
    throw error;
  }
}

export async function createSubscription(userId: string, tier: string = 'free') {
  try {
    const result = await query(
      `INSERT INTO ${TABLES.SUBSCRIPTION_LEDGER} (user_id, tier)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET tier = $2, updated_at = NOW()
       RETURNING *`,
      [userId, tier],
    );
    return result.rows[0];
  } catch (error: any) {
    console.error(`[createSubscription] Failed for userId=${userId}, tier=${tier}`, {
      error: error?.message || error,
      code: error?.code,
    });
    throw error;
  }
}

// ─── Application Constants ────────────────────────────────

export const APP_NAME = 'Kinetik';
export const APP_VERSION = '0.1.0';

// ─── Flash Window Constants ───────────────────────────────

export const FLASH_WINDOW_DURATION_MINUTES = 30;
export const FLASH_WINDOW_DEFAULT_START_HOUR = 20;    // 8 PM
export const FLASH_WINDOW_DEFAULT_START_MINUTE = 30;  // :30
export const FLASH_WINDOW_MAX_PARTICIPANTS = 5000;
export const FLASH_WINDOW_MIN_PARTICIPANTS = 10;

// ─── Vibe Check Constants ─────────────────────────────────

export const VIBE_CHECK_DURATION_SECONDS = 180;        // 3 minutes
export const VIBE_CHECK_SILHOUETTE_PHASE_SECONDS = 60;  // 0:00 - 1:00
export const VIBE_CHECK_BLUR_PHASE_SECONDS = 60;        // 1:00 - 2:00
export const VIBE_CHECK_REVEAL_PHASE_SECONDS = 60;      // 2:00 - 3:00
export const VIBE_CHECK_DECISION_TIMEOUT_SECONDS = 15;  // Decision window

// ─── Swipe / Interaction Limits ───────────────────────────

export const FREE_SWIPE_LIMIT_DAILY = 50;
export const PREMIUM_SWIPE_LIMIT_DAILY = 99999;
export const SUPER_LIKE_LIMIT_DAILY_FREE = 5;
export const SUPER_LIKE_LIMIT_DAILY_PREMIUM = 25;

// ─── Token & Premium ────────────────────────────────────

export const FAST_PASS_COST = 1;        // tokens
export const RAIN_CHECK_COST = 2;       // tokens
export const PREMIUM_MONTHLY_COST_INR = 499;
export const INFINITE_MONTHLY_COST_INR = 999;

// ─── H3 Geospatial ────────────────────────────────────────

export const H3_DEFAULT_RESOLUTION = 7;
export const H3_SEARCH_RING_RADIUS = 1;   // k-ring radius
export const H3_LOW_DENSITY_RING_RADIUS = 3;
export const H3_HIGH_DENSITY_THRESHOLD = 5000;  // users in 5km radius
export const DEFAULT_MAX_DISTANCE_KM = 50;

// ─── Vector Dimensions ───────────────────────────────────

export const VECTOR_DIMENSIONS = 1024;
export const VECTOR_SIMILARITY_TOP_K = 10;
export const MATCH_QUEUE_BATCH_SIZE = 50;

// ─── Redis Keys ───────────────────────────────────────────

export const REDIS_KEYS = {
  // User session
  USER_SESSION: (userId: string) => `user:${userId}:session`,
  USER_PRESENCE: (userId: string) => `user:${userId}:presence`,
  USER_SWIPE_COUNT: (userId: string) => `user:${userId}:swipes:daily`,

  // H3 Queue
  H3_QUEUE: (h3Index: string) => `queue:${h3Index}`,
  H3_QUEUE_LOCK: (h3Index: string) => `queue:${h3Index}:lock`,

  // Flash window
  WINDOW_STATE: (windowId: string) => `window:${windowId}:state`,
  WINDOW_PARTICIPANTS: (windowId: string) => `window:${windowId}:participants`,
  WINDOW_ACTIVE: 'windows:active',

  // Match
  MATCH_POOL: (windowId: string) => `match:${windowId}:pool`,
  MATCH_IN_PROGRESS: (userId: string) => `match:${userId}:in_progress`,

  // Vibe check
  VIBE_CHECK: (vibeId: string) => `vibe:${vibeId}`,
  VIBE_CHECK_USER: (userId: string) => `vibe:${userId}:active`,

  // Subscription limits
  SUBSCRIPTION: (userId: string) => `sub:${userId}`,

  // Rate limiting
  RATE_LIMIT: (key: string) => `ratelimit:${key}`,
} as const;

// ─── Kafka Topics ─────────────────────────────────────────

export const KAFKA_TOPICS = {
  USER_EVENTS: 'kinetik.user.events',
  MATCH_EVENTS: 'kinetik.match.events',
  VIBE_EVENTS: 'kinetik.vibe.events',
  WINDOW_EVENTS: 'kinetik.window.events',
  PAYMENT_EVENTS: 'kinetik.payment.events',
  NOTIFICATION_EVENTS: 'kinetik.notification.events',
} as const;

// ─── API Routes ───────────────────────────────────────────

export const API_ROUTES = {
  // Auth
  AUTH_PREFIX: '/api/v1/auth',
  AUTH_REGISTER: '/api/v1/auth/register',
  AUTH_LOGIN: '/api/v1/auth/login',
  AUTH_VERIFY_OTP: '/api/v1/auth/verify-otp',
  AUTH_REFRESH: '/api/v1/auth/refresh',

  // Users
  USERS_PREFIX: '/api/v1/users',
  USERS_PROFILE: '/api/v1/users/profile',
  USERS_PHOTOS: '/api/v1/users/photos',
  USERS_PREFERENCES: '/api/v1/users/preferences',
  USERS_INTERESTS: '/api/v1/users/interests',

  // Onboarding
  ONBOARDING_STATUS: '/api/v1/onboarding/status',
  ONBOARDING_STEP: (step: string) => `/api/v1/onboarding/${step}`,

  // Flash Windows
  WINDOWS_PREFIX: '/api/v1/windows',
  WINDOWS_ACTIVE: '/api/v1/windows/active',
  WINDOWS_JOIN: (id: string) => `/api/v1/windows/${id}/join`,
  WINDOWS_LEAVE: (id: string) => `/api/v1/windows/${id}/leave`,

  // Matches
  MATCHES_PREFIX: '/api/v1/matches',
  MATCHES_LIST: '/api/v1/matches',
  MATCHES_DETAIL: (id: string) => `/api/v1/matches/${id}`,

  // Fans / Likes
  FANS_LIST: '/api/v1/fans',
  FANS_UNLOCK: '/api/v1/fans/unlock',

  // Venues
  VENUES_PREFIX: '/api/v1/venues',
  VENUES_NEARBY: '/api/v1/venues/nearby',

  // Payments
  PAYMENTS_PREFIX: '/api/v1/payments',
  PAYMENTS_CREATE_ORDER: '/api/v1/payments/create-order',
  PAYMENTS_VERIFY: '/api/v1/payments/verify',
  PAYMENTS_SUBSCRIPTION: '/api/v1/payments/subscription',

  // Webhooks
  WEBHOOK_RAZORPAY: '/api/v1/webhooks/razorpay',

  // Duo Crew
  DUO_PREFIX: '/api/v1/duo',
  DUO_CREATE: '/api/v1/duo/create',
  DUO_JOIN: (code: string) => `/api/v1/duo/join/${code}`,

  // Notifications
  NOTIFICATIONS_PREFIX: '/api/v1/notifications',
  NOTIFICATIONS_REGISTER_TOKEN: '/api/v1/notifications/register-token',
  NOTIFICATIONS_UNREGISTER_TOKEN: '/api/v1/notifications/unregister-token',
  NOTIFICATIONS_PREFERENCES: '/api/v1/notifications/preferences',
} as const;

// ─── Notification Type Display Names ──────────────────────

export const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  'match.found': 'New Match',
  'vibe.check': 'Vibe Check',
  'flash.window': 'Flash Window',
  'new.message': 'Messages',
  'duo.invite': 'Duo Invites',
  'marketing': 'Marketing',
} as const;

// ─── Error Codes ──────────────────────────────────────────

export const ERROR_CODES = {
  // Auth
  UNAUTHORIZED: 'UNAUTHORIZED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INVALID_OTP: 'INVALID_OTP',
  PHONE_EXISTS: 'PHONE_EXISTS',
  EMAIL_EXISTS: 'EMAIL_EXISTS',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  INVALID_PASSWORD: 'INVALID_PASSWORD',

  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  MISSING_FIELD: 'MISSING_FIELD',
  INVALID_AGE: 'INVALID_AGE',

  // Limits
  SWIPE_LIMIT_REACHED: 'SWIPE_LIMIT_REACHED',
  SUPER_LIKE_LIMIT_REACHED: 'SUPER_LIKE_LIMIT_REACHED',
  RATE_LIMITED: 'RATE_LIMITED',

  // Matching
  NO_MATCH_FOUND: 'NO_MATCH_FOUND',
  MATCH_TIMEOUT: 'MATCH_TIMEOUT',
  ALREADY_MATCHED: 'ALREADY_MATCHED',
  NOT_IN_WINDOW: 'NOT_IN_WINDOW',

  // Payment
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_REQUIRED: 'PAYMENT_REQUIRED',

  // General
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
} as const;

// ─── Age Constraints ──────────────────────────────────────

export const MIN_AGE = 18;
export const MAX_AGE = 120;
export const DEFAULT_AGE_MIN = 18;
export const DEFAULT_AGE_MAX = 60;

// ─── Onboarding Steps Order ───────────────────────────────

export const ONBOARDING_STEPS: readonly string[] = [
  'splash',
  'identity',
  'location',
  'photos',
  'pose',
  'kyc',
  'complete',
] as const;

// ─── WebSocket Namespaces ─────────────────────────────────

export const WS_NAMESPACES = {
  FLASH_WINDOW: '/flash-window',
  VIBE_CHECK: '/vibe-check',
  PRESENCE: '/presence',
} as const;

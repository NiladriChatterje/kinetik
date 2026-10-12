// ─── Swipe / Interaction Limits ───────────────────────────

// Right-swipe (like / super_like) allowance PER ACCOUNT — lifetime, not daily.
// Once a free account has spent its 30 likes, only upgrading unlocks more.
export const FREE_SWIPE_LIMIT = 30;
export const PREMIUM_SWIPE_LIMIT = 99999; // Effectively unlimited
export const FREE_CHAT_LIMIT = 3;        // Max active matches for free users
export const PREMIUM_CHAT_LIMIT = 99999;  // Effectively unlimited for premium
export const SUPER_LIKE_LIMIT_DAILY_FREE = 5;
export const SUPER_LIKE_LIMIT_DAILY_PREMIUM = 25;

// ─── Token & Premium ────────────────────────────────────

export const PREMIUM_MONTHLY_COST_INR = 99;
export const INFINITE_MONTHLY_COST_INR = 999;

// ─── H3 Geospatial ────────────────────────────────────────

export const H3_HIGH_DENSITY_THRESHOLD = 5000;  // users in 5km radius

// ─── Redis Keys ───────────────────────────────────────────

export const REDIS_KEYS = {
  // User session
  USER_SESSION: (userId: string) => `user:${userId}:session`,
  USER_PRESENCE: (userId: string) => `user:${userId}:presence`,
  USER_SUPERLIKE_COUNT: (userId: string) => `user:${userId}:superlikes:daily`,

  // New likes counter (for unread badge)
  USER_UNREAD_LIKES: (userId: string) => `user:${userId}:likes:unread`,

  // Subscription limits
  SUBSCRIPTION: (userId: string) => `sub:${userId}`,

  // Profile metrics cache (matches, dates)
  USER_STATS: (userId: string) => `user:${userId}:stats`,

  // Rate limiting
  RATE_LIMIT: (key: string) => `ratelimit:${key}`,

  // Likes (pub/sub channel for cross-instance real-time like delivery)
  LIKES_EVENTS_CHANNEL: 'likes:events',

  // Chat messages (pub/sub channel for cross-instance chat message delivery)
  CHAT_MESSAGES_CHANNEL: 'chat:messages',

  // Chat typing (pub/sub channel for cross-instance typing indicator delivery)
  CHAT_TYPING_CHANNEL: 'chat:typing',

  // Chat read receipts (pub/sub channel for cross-instance read receipt delivery)
  CHAT_READ_CHANNEL: 'chat:read',

  // Chat media events (pub/sub channel for cross-instance media:viewed delivery)
  CHAT_MEDIA_EVENTS_CHANNEL: 'chat:media',
} as const;

// ─── Event Bus Channels (Redis Pub/Sub — replaces Kafka) ──────
// These channels are published/subscribed on the dedicated event-bus Redis instance.

export const EVENT_BUS_CHANNELS = {
  USER_EVENTS: 'event:user',
  MATCH_EVENTS: 'event:match',
  PAYMENT_EVENTS: 'event:payment',
} as const;

// ─── API Routes ───────────────────────────────────────────

export const API_ROUTES = {
  // Auth
  AUTH_PREFIX: '/api/v1/auth',
  AUTH_SIGNUP: '/api/v1/auth/signup',
  AUTH_SIGNUP_RESEND: '/api/v1/auth/signup/resend',
  AUTH_SIGNUP_VERIFY: '/api/v1/auth/signup/verify',
  AUTH_LOGIN: '/api/v1/auth/login',
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

  // Matches
  MATCHES_PREFIX: '/api/v1/matches',
  MATCHES_LIST: '/api/v1/matches',
  MATCHES_DETAIL: (id: string) => `/api/v1/matches/${id}`,
  MATCH_PROFILES: '/api/v1/matches/profiles',
  MATCH_SWIPE: '/api/v1/matches/swipe',
  MATCH_LIKES: '/api/v1/matches/likes',
  MATCH_RESPOND: '/api/v1/matches/respond',
  MATCH_CONVERSATIONS: '/api/v1/matches/conversations',
  MATCH_CONVERSATION_MESSAGES: (id: string) => `/api/v1/matches/conversations/${id}/messages`,

  // Fans / Likes

  // Venues
  VENUES_PREFIX: '/api/v1/venues',
  VENUES_NEARBY: '/api/v1/venues/nearby',

  // Payments (Google Play Billing)
  PAYMENTS_PREFIX: '/api/v1/payments',
  PAYMENTS_PRICING: '/api/v1/payments/pricing',
  PAYMENTS_SUBSCRIPTION_VERIFY: '/api/v1/payments/subscription/verify',
  PAYMENTS_SUBSCRIPTION_STATUS: '/api/v1/payments/subscription/status',
  PAYMENTS_SUBSCRIPTION_HISTORY: '/api/v1/payments/subscription/history',
  PAYMENTS_SUBSCRIPTION_CANCEL: '/api/v1/payments/subscription/cancel',

  // Webhooks — Play real-time developer notifications (Pub/Sub push)
  WEBHOOK_PLAY_RTDN: '/api/v1/webhooks/play',

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
  'new.message': 'Messages',
  'new.like': 'New Like',
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
  /** Sign-up codes for this email are used up for 24 hours. */
  SIGNUP_LOCKED: 'SIGNUP_LOCKED',
  /** The sign-up code expired or was already used: start the sign-up again. */
  SIGNUP_EXPIRED: 'SIGNUP_EXPIRED',
  /** Too many wrong sign-up codes: start the sign-up again. */
  SIGNUP_FAILED: 'SIGNUP_FAILED',

  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  MISSING_FIELD: 'MISSING_FIELD',
  INVALID_AGE: 'INVALID_AGE',

  // Limits
  SWIPE_LIMIT_REACHED: 'SWIPE_LIMIT_REACHED',
  CHAT_LIMIT_REACHED: 'CHAT_LIMIT_REACHED',
  SUPER_LIKE_LIMIT_REACHED: 'SUPER_LIKE_LIMIT_REACHED',
  RATE_LIMITED: 'RATE_LIMITED',

  // Matching
  ALREADY_MATCHED: 'ALREADY_MATCHED',

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
  'about',
  'location',
  'photos',
  'face',
  'kyc',
  'complete',
] as const;

// ─── WebSocket Namespaces ─────────────────────────────────

export const WS_NAMESPACES = {
  PRESENCE: '/presence',
  CHAT: '/chat',
} as const;

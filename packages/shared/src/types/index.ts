// ─── Core Domain Types ────────────────────────────────────

export type GenderIdentity = 'male' | 'female' | 'non_binary' | 'other' | 'prefer_not_to_say';
export type MatchStatus = 'pending' | 'matched' | 'passed' | 'expired';
export type SubscriptionTier = 'free' | 'premium' | 'infinite';
export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';
export type OnboardingStep = 'splash' | 'identity' | 'about' | 'location' | 'photos' | 'pose' | 'kyc' | 'complete';
export type InteractionAction = 'like' | 'pass' | 'super_like';
export type AuthProvider = 'phone' | 'google' | 'apple';
export type DatingCategory = 'casual' | 'serious' | 'intimacy';

// ─── Re-export match types ────────────────────────────────

// ─── User Types ───────────────────────────────────────────

export interface User {
  id: string;
  phone?: string;
  email?: string;
  displayName?: string;
  dateOfBirth?: string;
  gender: GenderIdentity;
  pronouns?: string;
  bio?: string;
  occupation?: string;
  education?: string;
  isVerified: boolean;
  kycStatus: VerificationStatus;
  livenessStatus: VerificationStatus;
  latitude?: number;
  longitude?: number;
  h3Index?: string;
  city?: string;
  county?: string;
  region?: string;
  country?: string;
  datingCategory?: DatingCategory;
  isActive: boolean;
  onboardingComplete: boolean;
  onboardingStep: OnboardingStep;
  lastActiveAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── 'Knowing more about you' Answers ─────────────────────
// Multi-select answers captured on the About onboarding screen.
// Each key maps to a question; values are the selected chips
// (built-in suggestions and user-added custom entries).

export interface AboutAnswers {
  nature: string[];         // e.g. ['Calm', 'Adventurous']
  hobbies: string[];        // e.g. ['Travel', 'Cooking']
  movieGenres: string[];    // e.g. ['Sci-Fi', 'Thriller']
  music: string[];          // e.g. ['Indie', 'Classical']
  dateStyle: string[];      // e.g. ['Coffee Date', 'Live Music']
}

export interface UserProfile {
  id: string;
  userId: string;
  photos: ProfilePhoto[];
  displayName: string;
  age: number;
  gender: GenderIdentity;
  bio: string;
  occupation?: string;
  education?: string;
  interests: Interest[];
  distanceKm?: number;
  isVerified: boolean;
}

export interface ProfilePhoto {
  id: string;
  url: string;
  thumbnailUrl?: string;
  blurHash?: string;
  isPrimary: boolean;
  orderIndex: number;
}

export interface Interest {
  id: string;
  name: string;
  category: string;
  emoji: string;
  weight?: number;
}

// ─── Preference Types ─────────────────────────────────────

export interface UserPreferences {
  ageMin: number;
  ageMax: number;
  maxDistanceKm: number;
  preferredGenders: GenderIdentity[];

  // Value matrix components (0-1)
  valuesAmbition: number;
  valuesSocial: number;
  valuesAdventure: number;
  valuesTradition: number;
  valuesIntellect: number;
  valuesEmotional: number;

  // User-adjustable priority weights
  weightAge: number;
  weightDistance: number;
  weightValues: number;
  weightInterests: number;

  // Communication style (0-1)
  commStyleDirect: number;
  commStylePlayful: number;
  commStyleDeep: number;
}

// ─── Match Types ──────────────────────────────────────────

export interface Match {
  id: string;
  userAId: string;
  userBId: string;
  matchedAt: string;
  dateScheduled?: string;
  venueId?: string;
  venueBooked: boolean;
  isActive: boolean;
}

export interface Venue {
  id: string;
  name: string;
  category: 'cafe' | 'bar' | 'lounge' | 'restaurant';
  description?: string;
  latitude: number;
  longitude: number;
  address?: string;
  city?: string;
  priceTier: number;
  imageUrl?: string;
  clickCost: number;
  bookingFee: number;
}

// ─── Duo Crew Types ───────────────────────────────────────

export interface DuoCrew {
  id: string;
  creatorId: string;
  inviteeId?: string;
  inviteCode: string;
  inviteAccepted: boolean;
  isActive: boolean;
}

// ─── Subscription & Payment Types ─────────────────────────

export interface SubscriptionLedger {
  id: string;
  userId: string;
  tier: SubscriptionTier;
  swipeAllowance: number;
  swipeUsedToday: number;
  fastPassesRemaining: number;
  rainChecksRemaining: number;
  razorpaySubscriptionId?: string;
  expiresAt?: string;
  autoRenew: boolean;
}

export interface Transaction {
  id: string;
  userId: string;
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  amount: number;
  currency: string;
  status: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

// ─── Date Planner Types ─────────────────────────────────

export interface PlannerTodo {
  id: string;
  text: string;
  done: boolean;
  addedBy: string;
}

export interface DatePlannerData {
  date: string | null; // 'YYYY-MM-DD'
  activities: string[]; // selected activity IDs
  todos: PlannerTodo[];
  notes: string;
}

// ─── Chat Media Types ────────────────────────────────────

export type ChatMediaType = 'image' | 'video' | 'audio' | 'file';

export interface ChatMedia {
  id: string;
  messageId: string;
  senderId: string;
  mediaType: ChatMediaType;
  url: string;
  thumbnailUrl?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  width?: number;
  height?: number;
  durationSecs?: number;
  isViewOnce?: boolean;
  viewedAt?: string;
  createdAt: string;
}

// ─── User Interaction Types ───────────────────────────────

export interface UserInteraction {
  id: string;
  actorId: string;
  targetId: string;
  action: InteractionAction;
}

// ─── Push Notification Types ────────────────────────────────

export interface PushToken {
  id: string;
  userId: string;
  token: string;
  platform: 'ios' | 'android' | 'web';
  isActive: boolean;
  createdAt: string;
}

export interface NotificationPreferences {
  pushEnabled: boolean;
}

export interface PushNotificationMessage {
  to: string;
  title?: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  badge?: number;
  priority?: 'default' | 'normal' | 'high';
}

export enum NotificationType {
  MATCH_FOUND = 'match.found',
  NEW_MESSAGE = 'new.message',
  NEW_LIKE = 'new.like',
  DUO_INVITE = 'duo.invite',
  MARKETING = 'marketing',
}

// ─── WebSocket Event Types ────────────────────────────────

export enum WsEvent {
  // Connection
  CONNECT = 'connect',
  DISCONNECT = 'disconnect',
  ERROR = 'error',

  // Matching
  MATCH_NEW = 'match:new',

  // Likes (real-time)
  LIKES_NEW = 'likes:new',
  LIKES_READ = 'likes:read',

  // Presence
  PRESENCE_UPDATE = 'presence:update',
  HEARTBEAT = 'heartbeat',

  // Chat
  CHAT_JOIN = 'chat:join',
  CHAT_LEAVE = 'chat:leave',
  CHAT_MESSAGE = 'chat:message',
  CHAT_TYPING = 'chat:typing',
  CHAT_READ = 'chat:read',

  // 1:1 Calls (LiveKit signaling)
  CALL_INVITE = 'call:invite',
  CALL_ACCEPT = 'call:accept',
  CALL_DECLINE = 'call:decline',
  CALL_CANCEL = 'call:cancel',
  CALL_BUSY = 'call:busy',
  CALL_ACTIVE_JOIN = 'call:active_join',
  CALL_ACTIVE_LEAVE = 'call:active_leave',
}

// ─── API Response Types ───────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
  };
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  cursor?: string;
}

// ─── Geospatial Types ─────────────────────────────────────

export interface GeoCoordinates {
  latitude: number;
  longitude: number;
}

export interface H3Ring {
  index: string;
  resolution: number;
  neighbors: string[];
}

// ─── Vector Types ─────────────────────────────────────────

export interface UserVector {
  userId: string;
  vector: number[];
  version: number;
}

export interface MatchResult {
  userId: string;
  similarity: number;
  metadata?: Record<string, unknown>;
}

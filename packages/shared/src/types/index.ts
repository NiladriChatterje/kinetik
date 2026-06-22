// ─── Core Domain Types ────────────────────────────────────

export type GenderIdentity = 'male' | 'female' | 'non_binary' | 'other' | 'prefer_not_to_say';
export type MatchStatus = 'pending' | 'matched' | 'passed' | 'expired';
export type SubscriptionTier = 'free' | 'premium' | 'infinite';
export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';
export type WindowStatus = 'scheduled' | 'active' | 'closed';
export type OnboardingStep = 'splash' | 'identity' | 'location' | 'photos' | 'pose' | 'kyc' | 'complete';
export type InteractionAction = 'like' | 'pass' | 'super_like';
export type AuthProvider = 'phone' | 'google' | 'apple';

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
  isActive: boolean;
  onboardingComplete: boolean;
  onboardingStep: OnboardingStep;
  lastActiveAt?: string;
  createdAt: string;
  updatedAt: string;
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

// ─── Flash Window Types ───────────────────────────────────

export interface FlashWindow {
  id: string;
  city: string;
  region?: string;
  country?: string;
  startsAt: string;
  endsAt: string;
  status: WindowStatus;
  maxParticipants: number;
  participantCount: number;
  h3Cells: string[];
}

export interface WindowParticipant {
  windowId: string;
  userId: string;
  joinedAt: string;
  isActive: boolean;
  matchedWith?: string;
}

// ─── Vibe Check Types ─────────────────────────────────────

export interface VibeCheck {
  id: string;
  windowId: string;
  userAId: string;
  userBId: string;
  status: MatchStatus;
  startedAt: string;
  callDurationSeconds: number;
  userADecision?: boolean;
  userBDecision?: boolean;
  decisionDeadline?: string;
  mutualLock: boolean;
  livekitRoomName?: string;
}

export interface VibeCheckState {
  phase: 'connecting' | 'silhouette' | 'blurred' | 'revealed' | 'decision';
  timeRemaining: number;        // seconds remaining in current phase
  partnerName?: string;
  partnerAge?: number;
  partnerSilhouette?: string;   // base64 silhouette SVG
  partnerBlurHash?: string;     // blur hash for progressive reveal
  isAudioMuted: boolean;
  decision?: 'lock' | 'pass' | null;
  partnerDecision?: 'lock' | 'pass' | null;
}

// ─── Match Types ──────────────────────────────────────────

export interface Match {
  id: string;
  vibeCheckId: string;
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
  flashWindowReminder: boolean;
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
  VIBE_CHECK = 'vibe.check',
  FLASH_WINDOW = 'flash.window',
  NEW_MESSAGE = 'new.message',
  DUO_INVITE = 'duo.invite',
  MARKETING = 'marketing',
}

// ─── WebSocket Event Types ────────────────────────────────

export enum WsEvent {
  // Connection
  CONNECT = 'connect',
  DISCONNECT = 'disconnect',
  ERROR = 'error',

  // Flash Window
  WINDOW_STATUS = 'window:status',
  WINDOW_JOIN = 'window:join',
  WINDOW_LEAVE = 'window:leave',
  WINDOW_COUNTDOWN = 'window:countdown',
  WINDOW_QUEUE_SIZE = 'window:queue_size',

  // Matching
  MATCH_FOUND = 'match:found',
  MATCH_CANCELLED = 'match:cancelled',

  // Vibe Check
  VIBE_START = 'vibe:start',
  VIBE_STATE = 'vibe:state',
  VIBE_PHASE_CHANGE = 'vibe:phase_change',
  VIBE_AUDIO_TOGGLE = 'vibe:audio_toggle',
  VIBE_DECISION = 'vibe:decision',
  VIBE_PARTNER_DECISION = 'vibe:partner_decision',
  VIBE_END = 'vibe:end',

  // Post-Match
  MATCH_SUCCESS = 'match:success',
  MATCH_EXPIRED = 'match:expired',

  // Presence
  PRESENCE_UPDATE = 'presence:update',
  HEARTBEAT = 'heartbeat',
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

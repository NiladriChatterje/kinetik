// ─── Swipe / Interaction Types ─────────────────────────────

export interface SwipeProfile {
  userId: string;
  displayName: string;
  age: number;
  bio: string;
  occupation?: string;
  education?: string;
  photos: {
    id: string;
    url: string;
    thumbnailUrl?: string;
    isPrimary: boolean;
  }[];
  interests: {
    id: string;
    name: string;
    emoji: string;
    category: string;
  }[];
  isVerified: boolean;
  distanceKm?: number;
}

export interface SwipeAction {
  targetUserId: string;
  action: 'like' | 'pass';
}

export interface SwipeResponse {
  matched: boolean;
  matchId?: string;
  conversationId?: string;
  partnerName?: string;
}

// ─── Like List Types ───────────────────────────────────────

export interface IncomingLike {
  likedAt: string;
  userId: string;
  displayName: string;
  bio: string;
  age: number;
  photoUrl?: string;
  thumbnailUrl?: string;
  isVerified: boolean;
  isMutual: boolean;
  respondedAt?: string;
}

export interface LikeRespondAction {
  targetUserId: string;
  action: 'like' | 'discard';
}

// ─── Chat / Message Types ──────────────────────────────────

export interface Message {
  id: string;
  matchId: string;
  senderId: string;
  content: string;
  createdAt: string;
  readAt: string | null;
}

export interface Conversation {
  matchId: string;
  partnerId: string;
  partnerName: string;
  partnerPhotoUrl?: string;
  partnerThumbnailUrl?: string;
  lastMessage?: string;
  lastMessageAt?: string;
  lastMessageSenderId?: string;
  unreadCount: number;
  isActive: boolean;
}

// ─── WebSocket Chat Events ─────────────────────────────────

export interface ChatMessageEvent {
  matchId: string;
  message: Message;
}

export interface ChatTypingEvent {
  matchId: string;
  userId: string;
  isTyping: boolean;
}

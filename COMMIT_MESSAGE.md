feat: real-time like/match pipeline — Kafka pub/sub + Socket.IO delivery

Implements a complete real-time event pipeline for match/like interactions
using Kafka for cross-service event delivery and Socket.IO for pushing
events to connected mobile clients.

Architecture:
  User A swipes right → api-core records like → Kafka `like.created`
    → realtime service consumes event → Socket.IO emits `likes:new`
      to User B's personal room → mobile badge increments + list refreshes

Changes:

  shared/src/types/index.ts
    - Add LIKES_NEW, LIKES_READ, MATCH_NEW to WsEvent enum

  shared/src/constants/index.ts
    - Add USER_UNREAD_LIKES Redis key for unread badge tracking
    - Add LIKES_EVENTS_CHANNEL Redis pub/sub channel for cross-instance sync

  api-core/src/routes/matches.ts
    - Publish `like.created` Kafka event on swipe (like/super_like)
    - Publish `match.created` Kafka event on mutual match detection
    - Publish `match.created` Kafka event on like response acceptance
    - Import and use kafkaProducer for event publishing

  realtime/src/index.ts
    - Handle `like.created` Kafka events → emit LIKES_NEW to
      target user's room on both presence and chat namespaces
    - Handle `match.created` Kafka events → emit MATCH_NEW to
      both users' rooms on both namespaces
    - Add payload existence guards for safety

  mobile/src/store/authStore.ts
    - Add persistent Socket.IO connection to /presence namespace
    - Add connectLikesSocket/disconnectLikesSocket actions
    - Auto-connect socket on login, OTP verify, and app restart
    - Listen for likes:new → increment unreadLikeCount badge
    - Listen for match:new → log match events
    - Add resetUnreadLikeCount action

  mobile/src/screens/match/LikeListScreen.tsx
    - Connect socket on mount for real-time likes:new events
    - Auto-refresh likes list when new like arrives via socket
    - Reset unread badge count on screen view and focus

  mobile/src/screens/match/MatchScreen.tsx
    - Show unread like count badge on the Likes heart icon
    - Listen for match:new events via socket to refresh profiles
    - Add badge count styles (red circle)

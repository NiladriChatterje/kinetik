feat: add read receipts, Super Like, and 'Liked You' tab badge

Three features added to the match/chat system:

─── Read Receipts ──────────────────────────────────────────

Why: Users needed to know when their messages have been seen
by the recipient, a standard expectation in dating apps.

What:
- ChatScreen now shows a single checkmark (✓) for sent-but-unread
  messages and a double checkmark (✓✓, green) when the partner
  has read the message
- Messages being sent (pending) show a timer icon
- Opening the chat automatically emits a `chat:read` event via
  Socket.IO, so the sender immediately sees their messages
  acknowledged
- Receiving a new message from the partner triggers an automatic
  `chat:read` emit back, providing instant delivery confirmation
- The `chat:read` event updates all unread own messages in
  real-time with the partner's read timestamp

─── Super Like ──────────────────────────────────────────────

Why: A Super Like lets users express heightened interest in a
profile. The recipient sees a special star indicator, making
the gesture stand out from a regular like.

What:
- MatchScreen: New Super Like button (star icon, blue border)
  between Pass and Like on the swipe card. Blue badge on card
  shows remaining daily super likes.
- Backend: POST /swipe accepts `'super_like'` action. Daily
  limit enforced via Redis INCR with 24h TTL (5 for free, 25
  for premium). Returns `isSuperLike` and `superLikesRemaining`.
- Mutual match detection handles all combinations: like↔like,
  like↔super_like, super_like↔super_like.
- GET /likes returns `isSuperLike` field so the recipient sees
  the special indicator.
- LikeListScreen: Super liked profiles show a blue star badge
  with "Super Like" text.

─── 'Liked You' Tab Badge ──────────────────────────────────

Why: Users should know at a glance when someone has liked them
without needing to open the Match tab.

What:
- authStore: Added `unreadLikeCount` state and
  `fetchUnreadLikeCount` action that calls GET /likes and stores
  the total count.
- RootNavigator: New MatchTabIcon component renders a red
  circular badge on the heart tab icon showing the number of
  incoming likes (caps at "9+").
- MatchScreen: Fetches the count on mount and on every screen
  focus event, so the badge updates after viewing the Likes
  screen or switching tabs.

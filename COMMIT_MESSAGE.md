feat: replace Duo tab with Match tab — Tinder-style swiping, incoming likes, real-time chat

Replaces the Duo Wingman tab in the bottom navigation with a full match/swipe/chat
system. Duo remains accessible from Profile > Settings.

─── What was introduced ─────────────────────────────────────

1. Match tab (bottom nav, heart icon)
   - Discover screen with Tinder-style swipeable profile cards
     (PanResponder drag gestures, LIKE/PASS stickers, card stack)
   - Shows full public profile: photos, name, age, bio, occupation,
     education, interests, verification badge
   - Swipe right = Like, swipe left = Pass
   - Mutual Like detection → auto-create match

2. Likes screen (incoming likes)
   - Users who liked you appear with profile preview (photo, name,
     age, bio, verification)
   - Like Back (heart) or Discard (X) buttons
   - Like Back creates an instant match → Alert with "Say Hello" nav

3. Conversations / Messages
   - ChatListScreen: matched conversations with last message preview,
     unread count badges, real-time updates via Socket.IO
   - ChatScreen: real-time messaging over Socket.IO /chat namespace
     with typing indicators, optimistic sends, read receipts

4. Backend API (api-core matches.ts)
   - GET /profiles — random profiles filtered by preferences, excluding
     already-interacted users
   - POST /swipe — record Like/Pass with mutual-match detection
   - GET /likes — incoming likes with full profile data
   - POST /respond — Like Back or Discard an incoming like
   - GET /conversations — match conversations with last message + unread count
   - GET|POST /conversations/:id/messages — fetch history / send message

5. Real-time chat (realtime chat.ts)
   - Socket.IO /chat namespace with chat:join/leave/message/typing/read
   - Messages broadcast to match:${matchId} rooms for instant delivery
   - ChatListScreen joins all match rooms to update previews in real-time

6. Push notifications
   - new.like — "X liked your profile!" when someone swipes right
   - match.found — "You matched with Y!" on mutual like
   - new.message — push when partner sends a message

7. Database migration (004_add_messages_table.sql)
   - messages table (match_id, sender_id, content, read_at)
   - user_interactions: added is_mutual, responded_at columns

8. Duo moved to Profile (kept as "Duo Wingman" in settings list,
   navigates to existing DuoWingmanScreen for invite code sharing)

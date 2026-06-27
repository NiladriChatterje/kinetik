feat: add Chat tab to bottom nav + chat_media table for message attachments

- **Chat tab** — Added to MainTabNavigator (chatbubbles-outline icon) between
  Match and Profile, replacing the Wallet tab that was moved into Profile.
  Shows the mutual-match conversation list.

- **ChatListScreen tab-aware** — Hides back button when rendered as a tab
  (uses canGoBack check); empty state "Discover People" navigates to the
  Match tab instead of calling goBack() which would be a no-op on the tab.

- **Migration 005_add_chat_media_table.sql** — New `chat_media` table for
  storing message attachments (image, video, audio, file) with metadata
  fields: url, thumbnail_url, file_name, file_size, mime_type, dimensions,
  duration. Indexed on message_id and sender_id.

- **TABLES.CHAT_MEDIA** — Added to shared database constants.

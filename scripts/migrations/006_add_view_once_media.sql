-- ─── View-Once Media Support ────────────────────────────
-- Adds support for one-time viewable media messages (like WhatsApp view once).
-- When is_view_once = TRUE, the media can only be viewed once.
-- After viewing, viewed_at is set and the file should be deleted from storage.

ALTER TABLE chat_media
  ADD COLUMN IF NOT EXISTS is_view_once BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS viewed_at   TIMESTAMPTZ;

-- Index for quickly finding unviewed one-time media
CREATE INDEX IF NOT EXISTS idx_chat_media_view_once
  ON chat_media(id, sender_id)
  WHERE is_view_once = TRUE AND viewed_at IS NULL;

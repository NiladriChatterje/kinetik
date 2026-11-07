-- 031_chat_photo_delivery.sql
-- Chat photos live on the phones, not on the server.
--
-- The server holds a sent photo only until the receiver's phone has saved
-- it (POST /api/v1/matches/:id/media/:mediaId/saved), then deletes the file.
-- A photo nobody saved is deleted after 30 days. What stays is this row,
-- with a tiny blurred preview (a ~20 px WebP, base64) and the photo's size,
-- so a phone that does not have the photo can still draw its place.
--
--   preview          tiny blurred WebP, base64 (images sent from now on)
--   delivered_at     when the receiver's phone saved it
--   file_removed_at  when the server file was deleted (saved, or 30 days old)
--
-- One-time photos keep their own rule (deleted when opened). Idempotent.

ALTER TABLE chat_media
    ADD COLUMN IF NOT EXISTS preview          TEXT,
    ADD COLUMN IF NOT EXISTS delivered_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS file_removed_at  TIMESTAMPTZ;

-- The daily sweep: photos still on the server, oldest first
CREATE INDEX IF NOT EXISTS idx_chat_media_photos_on_server
    ON chat_media (created_at)
    WHERE media_type = 'image' AND is_view_once = FALSE AND file_removed_at IS NULL;

-- ─── Chat Media ───────────────────────────────────────────
-- Stores media files (images, videos, audio, documents) sent
-- in chat messages between matched users.

CREATE TABLE chat_media (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_type      VARCHAR(20) NOT NULL CHECK (media_type IN ('image', 'video', 'audio', 'file')),
    url             TEXT NOT NULL,
    thumbnail_url   TEXT,
    file_name       VARCHAR(255),
    file_size       INTEGER,                    -- size in bytes
    mime_type       VARCHAR(100),
    width           INTEGER,                    -- for images/video
    height          INTEGER,                    -- for images/video
    duration_secs   INTEGER,                    -- for video/audio
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_media_message ON chat_media(message_id);
CREATE INDEX idx_chat_media_sender  ON chat_media(sender_id);

-- ─── Chat Messages ────────────────────────────────────────
-- Stores direct messages between matched users.
-- Each message belongs to a conversation which maps 1:1 to a match.

CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id        UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content         TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at         TIMESTAMPTZ          -- NULL until the receiver reads it
);

CREATE INDEX idx_messages_match     ON messages(match_id, created_at ASC);
CREATE INDEX idx_messages_sender    ON messages(sender_id);
CREATE INDEX idx_messages_unread    ON messages(match_id, read_at) WHERE read_at IS NULL;

-- ─── Notification for likes (new interaction type) ─────────
-- The existing user_interactions table already stores likes.
-- We add a 'responded' flag so we know if the target has responded.
ALTER TABLE user_interactions
    ADD COLUMN IF NOT EXISTS is_mutual BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ;

CREATE INDEX idx_interactions_likes_received
    ON user_interactions(target_id, action, created_at DESC)
    WHERE action = 'like' AND is_mutual = FALSE;

-- 029_message_reply_to.sql
-- The message a message answers (swipe-to-reply in the chat). NULL for an
-- ordinary message. The send route only accepts a message from the same
-- match, so a quote can never point into another conversation. Should the
-- quoted message ever go, the reply stays and simply loses its quote.
--
-- Nullable and without a default, so adding it rewrites nothing.
-- Idempotent: safe to re-run.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL;

-- 027_user_reports_and_blocks.sql
-- In-app safety: members can report and block each other (Google Play's
-- User Generated Content and Child Safety Standards policies require both).
--
-- user_blocks: one row per blocker → blocked pair. A block is one-way in the
-- table but two-way in effect: the API hides either person from the other in
-- every feed, refuses likes and like-backs between them, closes their chat and
-- closes any pending like. Blocks are removed with the blocker's or blocked
-- person's account (account deletion and the CASCADE below).
--
-- user_reports: what a member reported, about whom, and why. One row per
-- reporter → reported pair; reporting the same person again updates the row
-- and re-opens it. Reports are safety records: they stay when the match ends
-- or an account is deleted. The support inbox gets an email for each new
-- report; the moderation tool (packages/api-core/src/admin/moderation.ts)
-- lists, resolves and acts on them.
--
-- status: open | actioned | dismissed. resolved_at: when it stopped being
-- open; a reported chat is kept until its reports are resolved and the legal
-- retention period after that has passed.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS user_blocks (
    blocker_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
);

-- The primary key serves "who did I block"; this serves "who blocked me".
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id);

CREATE TABLE IF NOT EXISTS user_reports (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reported_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    match_id     UUID REFERENCES matches(id) ON DELETE SET NULL,
    reason       VARCHAR(32) NOT NULL,
    details      TEXT,
    status       VARCHAR(16) NOT NULL DEFAULT 'open',
    resolved_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (reporter_id, reported_id),
    CHECK (reporter_id <> reported_id)
);

CREATE INDEX IF NOT EXISTS idx_user_reports_reported ON user_reports(reported_id);
CREATE INDEX IF NOT EXISTS idx_user_reports_open ON user_reports(created_at) WHERE status = 'open';

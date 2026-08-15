-- ─── 009: Index for matched-profile exclusion in the discovery feed ────────
-- The /profiles feed now excludes anyone the user has an ACTIVE match with,
-- reading the existing matches table directly. No new columns, tables, or
-- duplicated state — match membership stays normalized in matches alone.
--
-- idx_matches_users(user_a_id, user_b_id) already serves the user_a_id
-- lookup. This partial index serves the user_b_id lookup and only covers
-- active matches, keeping the index footprint minimal.
CREATE INDEX IF NOT EXISTS idx_matches_user_b_active
    ON matches(user_b_id) WHERE is_active = TRUE;

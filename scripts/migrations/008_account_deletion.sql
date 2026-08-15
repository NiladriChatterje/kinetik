-- Migration 008: Account deletion support
--
-- 1. Soft-delete tombstone column on users (the row is kept ONLY so that
--    retained records — transactions, audit_log — keep a valid reference;
--    all PII is scrubbed by the DELETE /auth/account endpoint).
-- 2. Fix FK actions so a deleted user's owned records cascade away cleanly:
--      CASCADE   → row is removed with the user (vibe_checks, matches,
--                  duo_crews, user_interactions, reservations off matches)
--      SET NULL  → pointer is cleared, owning row is kept
--                  (window_participants.matched_with, audit_log.user_id)
--    transactions.user_id intentionally stays NO ACTION — payment records
--    are retained, and this also blocks any accidental hard DELETE of a
--    user row that has payment history (forces the tombstone path).

-- ─── users: tombstone column ─────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- ─── window_participants.matched_with → SET NULL ─────────
ALTER TABLE window_participants
    DROP CONSTRAINT IF EXISTS window_participants_matched_with_fkey,
    ADD CONSTRAINT window_participants_matched_with_fkey
        FOREIGN KEY (matched_with) REFERENCES users(id) ON DELETE SET NULL;

-- ─── vibe_checks → CASCADE (both participants) ───────────
ALTER TABLE vibe_checks
    DROP CONSTRAINT IF EXISTS vibe_checks_user_a_id_fkey,
    ADD CONSTRAINT vibe_checks_user_a_id_fkey
        FOREIGN KEY (user_a_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE vibe_checks
    DROP CONSTRAINT IF EXISTS vibe_checks_user_b_id_fkey,
    ADD CONSTRAINT vibe_checks_user_b_id_fkey
        FOREIGN KEY (user_b_id) REFERENCES users(id) ON DELETE CASCADE;

-- ─── matches → CASCADE (match + chat vanish with the user) ─
ALTER TABLE matches
    DROP CONSTRAINT IF EXISTS matches_user_a_id_fkey,
    ADD CONSTRAINT matches_user_a_id_fkey
        FOREIGN KEY (user_a_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE matches
    DROP CONSTRAINT IF EXISTS matches_user_b_id_fkey,
    ADD CONSTRAINT matches_user_b_id_fkey
        FOREIGN KEY (user_b_id) REFERENCES users(id) ON DELETE CASCADE;

-- ─── reservations → CASCADE off matches ──────────────────
ALTER TABLE reservations
    DROP CONSTRAINT IF EXISTS reservations_match_id_fkey,
    ADD CONSTRAINT reservations_match_id_fkey
        FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE;

-- ─── duo_crews → CASCADE ─────────────────────────────────
ALTER TABLE duo_crews
    DROP CONSTRAINT IF EXISTS duo_crews_creator_id_fkey,
    ADD CONSTRAINT duo_crews_creator_id_fkey
        FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE duo_crews
    DROP CONSTRAINT IF EXISTS duo_crews_invitee_id_fkey,
    ADD CONSTRAINT duo_crews_invitee_id_fkey
        FOREIGN KEY (invitee_id) REFERENCES users(id) ON DELETE CASCADE;

-- ─── user_interactions → CASCADE (likes/passes vanish) ───
ALTER TABLE user_interactions
    DROP CONSTRAINT IF EXISTS user_interactions_actor_id_fkey,
    ADD CONSTRAINT user_interactions_actor_id_fkey
        FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE user_interactions
    DROP CONSTRAINT IF EXISTS user_interactions_target_id_fkey,
    ADD CONSTRAINT user_interactions_target_id_fkey
        FOREIGN KEY (target_id) REFERENCES users(id) ON DELETE CASCADE;

-- ─── audit_log → SET NULL (retain the deletion trail) ─────
ALTER TABLE audit_log
    DROP CONSTRAINT IF EXISTS audit_log_user_id_fkey,
    ADD CONSTRAINT audit_log_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

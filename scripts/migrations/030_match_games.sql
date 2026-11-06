-- 030_match_games.sql
-- Games played inside a chat (Dots and Boxes first). One row per game; the
-- board lives in `state` (see api-core services/dotsAndBoxes.ts), and the
-- server checks every move against it.
--
-- status: 'active' while it is being played, 'finished' when the board is
-- full (winner_id NULL for a draw), 'ended' when a player stopped it early.
-- A chat has at most one active game. hidden_for lists the players who
-- closed a game that is over, so it stops showing in their chat only.
--
-- Goes with the match: deleting a match deletes its games.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS match_games (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id    UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    game_type   TEXT NOT NULL,
    state       JSONB NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished', 'ended')),
    started_by  UUID NOT NULL,
    ended_by    UUID,
    winner_id   UUID,
    hidden_for  UUID[] NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_match_games_active
    ON match_games (match_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_match_games_match_created
    ON match_games (match_id, created_at DESC);

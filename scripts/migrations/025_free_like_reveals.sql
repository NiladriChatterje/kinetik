-- A free account may reveal at most a fixed number of likers in its lifetime
-- (FREE_VISIBLE_LIKES in routes/matches.ts). Answering a revealed like, by
-- liking back or rejecting, never frees the slot: a free user who has seen
-- five likers has used their five, whatever became of them.
--
--   user_interactions.revealed_at   when this like was first shown to a free
--                                   target; NULL means still hidden
--   users.free_likes_revealed       how many likers this user has revealed,
--                                   ever; only ever increases
--
-- Existing pending likes stay unrevealed and are revealed newest-first on the
-- target's next load, up to the allowance. Idempotent: safe to re-run.

ALTER TABLE user_interactions
  ADD COLUMN IF NOT EXISTS revealed_at TIMESTAMPTZ;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS free_likes_revealed INT NOT NULL DEFAULT 0;

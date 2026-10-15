-- The free chat lives on the user, not in the matches table.
--
-- A free user may chat in one conversation: their first match. Until now that
-- was found by scanning their matches ordered by matched_at on every chat
-- gate, and an unmatched or deleted partner had to leave an inactive match
-- row behind just so the scan could tell the free chat was spent.
--
-- Two columns replace the scan:
--   free_chat_match_id  the match that is (or was) the free chat, set once on
--                       the user's first match, never moved
--   free_chat_spent     TRUE once that match ended, by unmatch or by the
--                       partner deleting their account; every chat is locked
--                       from then on for a free user
--
-- No foreign key on free_chat_match_id: the match row may be deleted later.
--
-- Idempotent: safe to re-run. The backfill only fills users that have no
-- value yet, using the same rule the scan applied.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS free_chat_match_id UUID,
  ADD COLUMN IF NOT EXISTS free_chat_spent    BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE users u
   SET free_chat_match_id = f.id,
       free_chat_spent    = NOT f.is_active
  FROM (
    SELECT DISTINCT ON (uid) uid, id, is_active
      FROM (
        SELECT user_a_id AS uid, id, is_active, matched_at FROM matches
        UNION ALL
        SELECT user_b_id AS uid, id, is_active, matched_at FROM matches
      ) x
     ORDER BY uid, matched_at ASC, id ASC
  ) f
 WHERE u.id = f.uid
   AND u.free_chat_match_id IS NULL;

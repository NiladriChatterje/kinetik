-- ─── 011: One active match per user pair ───────────────────────────────────
-- A pair of users must never have more than one ACTIVE match. Duplicates were
-- possible when both users right-swiped each other near-simultaneously (each
-- request saw the other's like and inserted its own match row), or when
-- /respond raced /swipe. A duplicate active match keeps the pair visible in
-- feeds/conversations twice and breaks the "already matched" exclusion.
--
-- Inactive (unmatched) rows are kept as history and do not block a re-match.

-- Deactivate duplicate active matches, keeping the earliest row per pair.
UPDATE matches m SET is_active = FALSE
WHERE m.is_active = TRUE
  AND EXISTS (
    SELECT 1 FROM matches m2
    WHERE m2.is_active = TRUE
      AND LEAST(m2.user_a_id, m2.user_b_id) = LEAST(m.user_a_id, m.user_b_id)
      AND GREATEST(m2.user_a_id, m2.user_b_id) = GREATEST(m.user_a_id, m.user_b_id)
      AND (m2.matched_at < m.matched_at
           OR (m2.matched_at = m.matched_at AND m2.id < m.id))
  );

-- Order-insensitive uniqueness on the pair, active rows only.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_matches_active_pair
    ON matches (LEAST(user_a_id, user_b_id), GREATEST(user_a_id, user_b_id))
    WHERE is_active = TRUE;

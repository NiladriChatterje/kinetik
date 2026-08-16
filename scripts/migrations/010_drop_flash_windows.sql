-- ─── 010: Remove the flash window / vibe check feature ─────────────────────
-- The flash-window flow was unreachable in the app and its matching pipeline
-- has been removed from the codebase. Matches now come exclusively from the
-- swipe/like flow, so the tables, the matches FK into vibe_checks, the
-- notification preference, and the window_status enum are all dropped.

ALTER TABLE matches DROP COLUMN IF EXISTS vibe_check_id;

DROP TABLE IF EXISTS vibe_checks;
DROP TABLE IF EXISTS window_participants;
DROP TABLE IF EXISTS flash_windows;

ALTER TABLE user_preferences DROP COLUMN IF EXISTS flash_window_reminder;

DROP TYPE IF EXISTS window_status;

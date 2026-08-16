-- 012_match_date_scheduled.sql
-- Ensures the matches.date_scheduled column exists on incremental DBs.
-- The base schema (scripts/init-db.sql) already defines it; this makes DBs
-- that were built purely from migrations match. Used by the "fix a date"
-- DM feature: a date fixed in a chat is stored here, visible to both
-- users, and treated as expired once the date has passed.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS date_scheduled TIMESTAMPTZ;

-- 032_banned_emails.sql
-- Addresses barred from signing up again after a ban.
--
-- email_key is the SHA-256 (hex) of the canonical address: lowercased and
-- trimmed, anything from the first '+' in the local part dropped, and for
-- gmail.com / googlemail.com the dots removed and the domain set to
-- gmail.com. services/bannedEmails.ts computes the same key; keep in step.
-- No foreign key: the bar outlives the user row and its email.
--
-- Backfills every account banned so far. Idempotent.

CREATE TABLE IF NOT EXISTS banned_emails (
    email_key   TEXT PRIMARY KEY,
    user_id     UUID,
    reason      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO banned_emails (email_key, user_id, reason)
SELECT encode(sha256(convert_to(
           CASE WHEN domain IN ('gmail.com', 'googlemail.com')
                THEN replace(local, '.', '') || '@gmail.com'
                ELSE local || '@' || domain
           END, 'UTF8')), 'hex'),
       id,
       'ban (backfill)'
FROM (
    SELECT id,
           split_part(substring(em FROM '^(.*)@[^@]*$'), '+', 1) AS local,
           substring(em FROM '@([^@]*)$') AS domain
    FROM (SELECT id, lower(trim(email)) AS em FROM users
          WHERE is_banned = TRUE AND email IS NOT NULL AND position('@' IN email) > 0) b
) parts
ON CONFLICT (email_key) DO NOTHING;

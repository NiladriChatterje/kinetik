-- Feed indexes. Both /profiles paths previously seq-scanned users:
-- the swipe deck filters on age/gender, Explore sorts by created_at.

CREATE INDEX IF NOT EXISTS idx_users_eligible
    ON users (date_of_birth, gender)
    WHERE is_active AND onboarding_complete;

CREATE INDEX IF NOT EXISTS idx_users_feed
    ON users (created_at DESC, id)
    WHERE is_active AND onboarding_complete;

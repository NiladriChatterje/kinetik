-- ─── Refresh Tokens ────────────────────────────────────────
-- Stores rotating refresh tokens for short-lived JWT access tokens.
-- Each login/OTP session gets a "family" of tokens; if a revoked token
-- is reused (replay attack), the entire family is revoked.

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      VARCHAR(255) NOT NULL,   -- SHA-256 of the refresh token
    family_id       UUID NOT NULL,           -- groups tokens from the same login session
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user    ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash    ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_family  ON refresh_tokens(family_id);
CREATE INDEX idx_refresh_tokens_expiry  ON refresh_tokens(expires_at) WHERE revoked_at IS NULL;

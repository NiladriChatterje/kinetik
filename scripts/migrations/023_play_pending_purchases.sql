-- Pending Google Play purchases.
--
-- A UPI Autopay subscription can leave the Play purchase sheet in
-- SUBSCRIPTION_STATE_PENDING: the bank has not confirmed the mandate yet.
-- /subscription/verify grants nothing in that state, and until now it also
-- stored nothing. The completion arrives later as a real-time developer
-- notification that carries ONLY the purchase token, so the webhook could not
-- tell whose purchase it was and dropped it. Premium then depended on the user
-- reopening the checkout screen within three days — otherwise Google
-- auto-refunded the unacknowledged purchase.
--
-- This table binds a pending token to the account that started the purchase
-- so the notification can be resolved. Rows are removed once Play reports a
-- terminal state (activated, cancelled, expired).
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS play_pending_purchases (
    purchase_token  TEXT PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_play_pending_purchases_user_id
  ON play_pending_purchases (user_id);

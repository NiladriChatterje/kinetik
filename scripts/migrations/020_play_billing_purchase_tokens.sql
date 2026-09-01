-- Google Play Billing migration.
--
-- Play purchase tokens are the identifier for a subscription and routinely run
-- well past 255 characters, so every gateway_* column that can hold one is
-- widened to TEXT. VARCHAR(255) would raise
--   value too long for type character varying(255)
-- on the very first real purchase.
--
-- Real-time developer notifications carry ONLY the purchase token — no user id
-- — so subscription_ledger.gateway_subscription_id becomes the lookup key for
-- every renewal, cancellation and expiry event. It needs an index.
--
-- Idempotent: safe to re-run.

ALTER TABLE subscription_ledger
  ALTER COLUMN gateway_subscription_id TYPE TEXT;

ALTER TABLE transactions
  ALTER COLUMN gateway_subscription_id TYPE TEXT,
  ALTER COLUMN gateway_payment_id      TYPE TEXT,
  ALTER COLUMN gateway_order_id        TYPE TEXT;

-- RTDN arrives with a purchase token and nothing else; this is how we find the
-- user it belongs to.
CREATE INDEX IF NOT EXISTS idx_subscription_ledger_gateway_subscription_id
  ON subscription_ledger (gateway_subscription_id)
  WHERE gateway_subscription_id IS NOT NULL;

-- Play redelivers notifications until they are acknowledged, and the same order
-- id can therefore arrive several times. The insert paths use ON CONFLICT DO
-- NOTHING against this index, which is race-free in a way the previous
-- "WHERE NOT EXISTS" subquery was not.
--
-- Drop any duplicates the old non-atomic check let through first, keeping the
-- earliest row — otherwise creating the unique index aborts the migration.
DELETE FROM transactions t
  USING transactions dup
 WHERE t.gateway_payment_id IS NOT NULL
   AND t.gateway_payment_id = dup.gateway_payment_id
   -- ctid breaks ties so rows sharing a created_at can't both survive
   AND (t.created_at, t.ctid) > (dup.created_at, dup.ctid);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_gateway_payment_id
  ON transactions (gateway_payment_id)
  WHERE gateway_payment_id IS NOT NULL;

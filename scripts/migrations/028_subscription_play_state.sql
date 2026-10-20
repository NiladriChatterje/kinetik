-- 028_subscription_play_state.sql
-- Play's last reported state for the subscription backing the ledger row,
-- e.g. SUBSCRIPTION_STATE_ACTIVE, SUBSCRIPTION_STATE_IN_GRACE_PERIOD or
-- SUBSCRIPTION_STATE_ON_HOLD. Written by applyPlayEntitlement
-- (packages/api-core/src/services/subscriptionEntitlement.ts) on every
-- purchase check, notification and sweep.
--
-- The app uses it to say when Google could not charge a renewal: in a grace
-- period the user is still Premium, on hold they have lost it, and either way
-- the fix is updating the payment method in Google Play. NULL for rows Play
-- has not reported on since this column was added, and for Premium granted
-- by hand.
--
-- Nullable and without a default, so adding it rewrites nothing.
-- Idempotent: safe to re-run.

ALTER TABLE subscription_ledger ADD COLUMN IF NOT EXISTS play_state VARCHAR(64);

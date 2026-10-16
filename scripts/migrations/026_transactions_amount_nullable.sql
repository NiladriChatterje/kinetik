-- A Play charge is recorded on every entitlement change, but the amount is only
-- known on the first purchase, when the app passes the price the Play sheet
-- showed. Renewals, pending-to-paid flips and cancellations arrive over
-- real-time developer notifications, which carry no amount, and the row was
-- written with NULL into a NOT NULL column: every such notification failed
-- with 500, Pub/Sub retried it forever, and a pending UPI purchase could never
-- be acknowledged. The billing history already renders an unknown amount as a
-- dash. Idempotent: safe to re-run.

ALTER TABLE transactions
  ALTER COLUMN amount DROP NOT NULL;

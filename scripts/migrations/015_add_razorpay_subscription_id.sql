ALTER TABLE subscription_ledger
  ADD COLUMN IF NOT EXISTS razorpay_subscription_id VARCHAR(255);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS razorpay_subscription_id VARCHAR(255);

-- Razorpay was removed in favour of Google Pay (autopay mandate via a payment
-- gateway). The columns hold generic gateway identifiers now — rename them.
-- Idempotent: each rename only runs if the old column still exists.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'subscription_ledger' AND column_name = 'razorpay_subscription_id') THEN
    ALTER TABLE subscription_ledger RENAME COLUMN razorpay_subscription_id TO gateway_subscription_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'subscription_ledger' AND column_name = 'razorpay_customer_id') THEN
    ALTER TABLE subscription_ledger RENAME COLUMN razorpay_customer_id TO gateway_customer_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'transactions' AND column_name = 'razorpay_payment_id') THEN
    ALTER TABLE transactions RENAME COLUMN razorpay_payment_id TO gateway_payment_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'transactions' AND column_name = 'razorpay_order_id') THEN
    ALTER TABLE transactions RENAME COLUMN razorpay_order_id TO gateway_order_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'transactions' AND column_name = 'razorpay_subscription_id') THEN
    ALTER TABLE transactions RENAME COLUMN razorpay_subscription_id TO gateway_subscription_id;
  END IF;
END $$;

-- Fresh databases created before migration 015 never got the column at all.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS gateway_subscription_id VARCHAR(255);

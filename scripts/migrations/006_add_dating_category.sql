-- Migration 006: Add dating_category to users
-- Stores the user's dating intent: 'casual', 'serious', or 'intimacy'
-- Required during onboarding (identity step)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS dating_category VARCHAR(20)
  CHECK (dating_category IN ('casual', 'serious', 'intimacy'));

-- Kinetik Database Migration 002
-- Adds human-readable location fields from reverse geocoding

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS city        VARCHAR(100),
  ADD COLUMN IF NOT EXISTS county      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS region      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS country     VARCHAR(100);

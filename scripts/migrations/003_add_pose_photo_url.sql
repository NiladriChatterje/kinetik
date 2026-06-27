-- Migration 003: Add pose_photo_url to users table
-- Stores the URL of the selfie submitted during pose verification,
-- so the future FastAPI pose verification service can retrieve it.

ALTER TABLE users ADD COLUMN pose_photo_url TEXT;

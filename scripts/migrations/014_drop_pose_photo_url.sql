-- Migration 014: Drop pose_photo_url from users table
-- Pose verification selfies are no longer uploaded — face verification runs
-- entirely on-device (see POSE_VERIFICATION_ONDEVICE.md). The column was
-- write-only dead weight (only ever reset to NULL on account deletion).

ALTER TABLE users DROP COLUMN IF EXISTS pose_photo_url;

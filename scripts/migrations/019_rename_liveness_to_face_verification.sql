-- Migration 019: drop the "pose"/"liveness" vocabulary from the schema.
--
-- Onboarding never performs a liveness or pose challenge. The only check is
-- that the selfie matches the photos the user already uploaded, done entirely
-- on-device (see FACE_VERIFICATION_ONDEVICE.md). The column and the onboarding
-- step were named after an earlier design that no longer exists.
--
-- Both statements are guarded so the migration can be re-run safely.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'liveness_status'
    ) THEN
        ALTER TABLE users RENAME COLUMN liveness_status TO face_verification_status;
    END IF;
END $$;

UPDATE users SET onboarding_step = 'face' WHERE onboarding_step = 'pose';

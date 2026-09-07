-- 022_add_aadhaar_ref_hash.sql
-- Aadhaar Paperless Offline e-KYC. We never store the Aadhaar number or the
-- e-KYC file. This column holds a sha256 over the signed demographic fields
-- plus the last four digits, only so one Aadhaar cannot verify many accounts.
-- Cleared on account deletion.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS aadhaar_ref_hash CHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_aadhaar_ref_hash
    ON users(aadhaar_ref_hash)
    WHERE aadhaar_ref_hash IS NOT NULL;

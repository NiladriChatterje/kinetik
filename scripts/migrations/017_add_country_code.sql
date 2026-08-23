-- Add country_code column to store the dial code (e.g. '+1', '+91') separately
-- from the phone number. This allows fetching the country code from the database
-- when needed, without auto-prepending it to the phone field.
ALTER TABLE users ADD COLUMN country_code VARCHAR(10);

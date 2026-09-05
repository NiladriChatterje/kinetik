-- 021_add_preferred_location.sql
-- Optional "search from here" location chosen on the profile page (country +
-- city from the offline dataset). NULL means the feed is centred on the
-- user's own location: GPS once granted, else the city picked at signup.
--
-- Signup itself reuses existing columns: country_code now holds the ISO
-- 3166-1 alpha-2 code (older rows hold a phone dial code), and city /
-- country / latitude / longitude / h3_index are seeded from the chosen city
-- centre until the first GPS update overwrites them.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS preferred_country_code VARCHAR(2),
    ADD COLUMN IF NOT EXISTS preferred_city         VARCHAR(100),
    ADD COLUMN IF NOT EXISTS preferred_latitude     DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS preferred_longitude    DOUBLE PRECISION;

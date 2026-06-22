-- Kinetik Database Schema
-- PostgreSQL 16

-- ─── Extensions ───────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "cube";          -- For vector operations fallback
CREATE EXTENSION IF NOT EXISTS "earthdistance";  -- For geo queries fallback

-- ─── Enums ────────────────────────────────────────────────
CREATE TYPE gender_identity AS ENUM ('male', 'female', 'non_binary', 'other', 'prefer_not_to_say');
CREATE TYPE match_status AS ENUM ('pending', 'matched', 'passed', 'expired');
CREATE TYPE subscription_tier AS ENUM ('free', 'premium', 'infinite');
CREATE TYPE verification_status AS ENUM ('unverified', 'pending', 'verified', 'rejected');
CREATE TYPE window_status AS ENUM ('scheduled', 'active', 'closed');

-- ─── Users Table ──────────────────────────────────────────
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone           VARCHAR(20) UNIQUE,
    email           VARCHAR(255) UNIQUE,
    password_hash   VARCHAR(255),
    auth_provider   VARCHAR(50),       -- 'phone', 'google', 'apple'
    auth_provider_id VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Profile
    display_name    VARCHAR(100),
    date_of_birth   DATE,
    gender          gender_identity DEFAULT 'prefer_not_to_say',
    pronouns        VARCHAR(50),
    bio             TEXT,
    occupation      VARCHAR(100),
    education       VARCHAR(255),

    -- Verification
    phone_verified  BOOLEAN DEFAULT FALSE,
    email_verified  BOOLEAN DEFAULT FALSE,
    kyc_status      verification_status DEFAULT 'unverified',
    liveness_status verification_status DEFAULT 'unverified',
    is_verified     BOOLEAN DEFAULT FALSE,

    -- Location
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    h3_index        VARCHAR(15),       -- Uber H3 hexagon index
    location_updated_at TIMESTAMPTZ,

    -- Status
    is_active       BOOLEAN DEFAULT TRUE,
    is_banned       BOOLEAN DEFAULT FALSE,
    last_active_at  TIMESTAMPTZ,

    -- Onboarding
    onboarding_complete BOOLEAN DEFAULT FALSE,
    onboarding_step VARCHAR(50) DEFAULT 'splash'
);

CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_h3 ON users(h3_index);
CREATE INDEX idx_users_active ON users(is_active, last_active_at);

-- ─── Profile Photos ───────────────────────────────────────
CREATE TABLE profile_photos (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url             TEXT NOT NULL,
    thumbnail_url   TEXT,
    blur_hash       VARCHAR(255),
    is_primary      BOOLEAN DEFAULT FALSE,
    order_index     INT DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profile_photos_user ON profile_photos(user_id);

-- ─── User Preferences (Hard Filters) ─────────────────────
CREATE TABLE user_preferences (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Filter boundaries
    age_min             INT DEFAULT 18,
    age_max             INT DEFAULT 60,
    max_distance_km     INT DEFAULT 50,
    preferred_genders   gender_identity[] DEFAULT '{}',

    -- Value matrix (weighted vector components)
    values_ambition     REAL DEFAULT 0.5,
    values_social       REAL DEFAULT 0.5,
    values_adventure    REAL DEFAULT 0.5,
    values_tradition    REAL DEFAULT 0.5,
    values_intellect    REAL DEFAULT 0.5,
    values_emotional    REAL DEFAULT 0.5,

    -- Priority weights (user-adjustable sliders)
    weight_age          REAL DEFAULT 0.5,
    weight_distance     REAL DEFAULT 0.5,
    weight_values       REAL DEFAULT 1.0,
    weight_interests    REAL DEFAULT 0.7,

    -- Communication style
    comm_style_direct   REAL DEFAULT 0.5,
    comm_style_playful  REAL DEFAULT 0.5,
    comm_style_deep     REAL DEFAULT 0.5,

    -- Notifications
    push_enabled        BOOLEAN DEFAULT TRUE,
    flash_window_reminder BOOLEAN DEFAULT TRUE,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── User Interests / Tags ────────────────────────────────
CREATE TABLE interests (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100) UNIQUE NOT NULL,
    category        VARCHAR(50),
    emoji           VARCHAR(10)
);

CREATE TABLE user_interests (
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    interest_id     UUID NOT NULL REFERENCES interests(id) ON DELETE CASCADE,
    weight          REAL DEFAULT 1.0,
    PRIMARY KEY (user_id, interest_id)
);

-- ─── Flash Windows ────────────────────────────────────────
CREATE TABLE flash_windows (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    city            VARCHAR(100) NOT NULL,
    region          VARCHAR(100),
    country         VARCHAR(100),
    starts_at       TIMESTAMPTZ NOT NULL,
    ends_at         TIMESTAMPTZ NOT NULL,
    status          window_status DEFAULT 'scheduled',
    max_participants INT DEFAULT 5000,
    participant_count INT DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- H3 cells covered by this window
    h3_cells        TEXT[] DEFAULT '{}'
);

CREATE INDEX idx_flash_windows_city ON flash_windows(city);
CREATE INDEX idx_flash_windows_status ON flash_windows(status, starts_at);

-- ─── Window Participants ──────────────────────────────────
CREATE TABLE window_participants (
    window_id       UUID NOT NULL REFERENCES flash_windows(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active       BOOLEAN DEFAULT TRUE,
    matched_with    UUID REFERENCES users(id),
    PRIMARY KEY (window_id, user_id)
);

CREATE INDEX idx_window_participants_active ON window_participants(window_id, is_active);

-- ─── Vibe Check Sessions (Audio Calls) ───────────────────
CREATE TABLE vibe_checks (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    window_id           UUID NOT NULL REFERENCES flash_windows(id),
    user_a_id           UUID NOT NULL REFERENCES users(id),
    user_b_id           UUID NOT NULL REFERENCES users(id),
    status              match_status DEFAULT 'pending',

    -- Timeline
    started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    call_duration_seconds INT DEFAULT 180,

    -- Results
    user_a_decision     BOOLEAN,       -- true = lock it in
    user_b_decision     BOOLEAN,
    decision_deadline   TIMESTAMPTZ,
    mutual_lock         BOOLEAN DEFAULT FALSE,

    -- Media metadata
    livekit_room_name   VARCHAR(255),
    livekit_token_a     TEXT,
    livekit_token_b     TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vibe_checks_window ON vibe_checks(window_id);
CREATE INDEX idx_vibe_checks_users ON vibe_checks(user_a_id, user_b_id);

-- ─── Matches ──────────────────────────────────────────────
CREATE TABLE matches (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vibe_check_id   UUID UNIQUE REFERENCES vibe_checks(id),
    user_a_id       UUID NOT NULL REFERENCES users(id),
    user_b_id       UUID NOT NULL REFERENCES users(id),
    matched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Scheduling
    date_scheduled  TIMESTAMPTZ,
    venue_id        UUID,
    venue_booked    BOOLEAN DEFAULT FALSE,
    rain_check_used BOOLEAN DEFAULT FALSE,

    -- Status
    is_active       BOOLEAN DEFAULT TRUE,
    user_a_unlocked BOOLEAN DEFAULT FALSE,
    user_b_unlocked BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_matches_users ON matches(user_a_id, user_b_id);
CREATE INDEX idx_matches_active ON matches(is_active);

-- ─── Venues (B2B) ─────────────────────────────────────────
CREATE TABLE venues (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    category        VARCHAR(50),       -- 'cafe', 'bar', 'lounge', 'restaurant'
    description     TEXT,
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    address         TEXT,
    city            VARCHAR(100),
    price_tier      INT DEFAULT 2,     -- 1-5
    image_url       TEXT,
    is_active       BOOLEAN DEFAULT TRUE,
    click_cost      DECIMAL(10,2),     -- Cost per click for B2B
    booking_fee     DECIMAL(10,2),     -- Reservation booking fee
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Reservations ─────────────────────────────────────────
CREATE TABLE reservations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id        UUID NOT NULL REFERENCES matches(id),
    venue_id        UUID NOT NULL REFERENCES venues(id),
    booked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reservation_time TIMESTAMPTZ,
    status          VARCHAR(50) DEFAULT 'pending',
    deposit_held    BOOLEAN DEFAULT FALSE,
    deposit_amount  DECIMAL(10,2)
);

-- ─── Duo Crews (Viral) ────────────────────────────────────
CREATE TABLE duo_crews (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id      UUID NOT NULL REFERENCES users(id),
    invitee_id      UUID REFERENCES users(id),
    invite_code     VARCHAR(20) UNIQUE NOT NULL,
    invite_accepted BOOLEAN DEFAULT FALSE,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_duo_crews_creator ON duo_crews(creator_id);
CREATE INDEX idx_duo_crews_invite ON duo_crews(invite_code);

-- ─── Subscriptions & Payments (Razorpay) ─────────────────
CREATE TABLE subscription_ledger (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                 UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tier                    subscription_tier DEFAULT 'free',
    swipe_allowance         INT DEFAULT 50,          -- Daily swipe limit
    swipe_used_today        INT DEFAULT 0,
    swipe_reset_at          TIMESTAMPTZ DEFAULT NOW(),
    fast_passes_remaining   INT DEFAULT 0,
    rain_checks_remaining   INT DEFAULT 0,
    razorpay_subscription_id VARCHAR(255),
    razorpay_customer_id    VARCHAR(255),
    expires_at              TIMESTAMPTZ,
    auto_renew              BOOLEAN DEFAULT FALSE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscription_user ON subscription_ledger(user_id);

-- ─── Transactions ─────────────────────────────────────────
CREATE TABLE transactions (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                 UUID NOT NULL REFERENCES users(id),
    razorpay_payment_id     VARCHAR(255),
    razorpay_order_id       VARCHAR(255),
    amount                  DECIMAL(10,2) NOT NULL,
    currency                VARCHAR(3) DEFAULT 'INR',
    status                  VARCHAR(50),
    description             TEXT,
    metadata                JSONB,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transactions_user ON transactions(user_id);

-- ─── User Interactions (Likes/Fans) ──────────────────────
CREATE TABLE user_interactions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_id        UUID NOT NULL REFERENCES users(id),
    target_id       UUID NOT NULL REFERENCES users(id),
    action          VARCHAR(20) NOT NULL,    -- 'like', 'pass', 'super_like'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (actor_id, target_id)
);

CREATE INDEX idx_interactions_target ON user_interactions(target_id, action);
CREATE INDEX idx_interactions_actor ON user_interactions(actor_id);

-- ─── Vector Embeddings Table (Cache Layer) ────────────────
CREATE TABLE user_vectors (
    user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    vector          REAL[] NOT NULL,         -- Multi-dimensional personality vector
    version         INT DEFAULT 1,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── KYC Documents ────────────────────────────────────────
CREATE TABLE kyc_documents (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_type   VARCHAR(50),             -- 'passport', 'drivers_license', 'national_id'
    document_url    TEXT NOT NULL,
    status          verification_status DEFAULT 'pending',
    rejection_reason TEXT,
    verified_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_kyc_user ON kyc_documents(user_id);

-- ─── Push Notification Tokens ────────────────────────────
CREATE TABLE push_tokens (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token           TEXT NOT NULL,
    platform        VARCHAR(10),       -- 'ios', 'android', 'web'
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, token)
);

CREATE INDEX idx_push_tokens_user ON push_tokens(user_id);
CREATE INDEX idx_push_tokens_active ON push_tokens(is_active);

-- ─── Audit Log ────────────────────────────────────────────
CREATE TABLE audit_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID REFERENCES users(id),
    action          VARCHAR(100) NOT NULL,
    entity_type     VARCHAR(50),
    entity_id       UUID,
    old_values      JSONB,
    new_values      JSONB,
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_user ON audit_log(user_id);
CREATE INDEX idx_audit_log_action ON audit_log(action, created_at);

-- ─── Functions & Triggers ─────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_preferences_updated_at
    BEFORE UPDATE ON user_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_subscription_updated_at
    BEFORE UPDATE ON subscription_ledger
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_push_tokens_updated_at
    BEFORE UPDATE ON push_tokens
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── Seed Data: Default Interests ─────────────────────────
INSERT INTO interests (name, category, emoji) VALUES
    ('Travel', 'Lifestyle', '✈️'),
    ('Fitness', 'Lifestyle', '💪'),
    ('Cooking', 'Lifestyle', '🍳'),
    ('Reading', 'Intellectual', '📚'),
    ('Music', 'Arts', '🎵'),
    ('Photography', 'Arts', '📷'),
    ('Gaming', 'Entertainment', '🎮'),
    ('Movies', 'Entertainment', '🎬'),
    ('Hiking', 'Outdoor', '🥾'),
    ('Yoga', 'Wellness', '🧘'),
    ('Dancing', 'Active', '💃'),
    ('Art', 'Arts', '🎨'),
    ('Technology', 'Intellectual', '💻'),
    ('Volunteering', 'Community', '🤝'),
    ('Coffee', 'Lifestyle', '☕'),
    ('Wine Tasting', 'Social', '🍷'),
    ('Board Games', 'Entertainment', '🎲'),
    ('Running', 'Fitness', '🏃'),
    ('Meditation', 'Wellness', '🧠'),
    ('Languages', 'Intellectual', '🗣️');

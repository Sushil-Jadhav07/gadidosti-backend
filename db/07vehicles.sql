-- ============================================================
--  SSK LOGISTICS — VEHICLES (trucks + driver profiles)
--  Database: ssk_logistics
--  File:     db/07vehicles.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "VEHICLES" block in src/config/migrate.js — keep both in sync)
-- ============================================================

DO $$ BEGIN
    CREATE TYPE truck_status AS ENUM ('available', 'on_trip', 'maintenance');
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'Type truck_status already exists, skipping.';
END $$;

DO $$ BEGIN
    CREATE TYPE driver_status AS ENUM ('available', 'on_trip', 'offline');
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'Type driver_status already exists, skipping.';
END $$;

-- ------------------------------------------------------------
-- TABLE: trucks
-- `registration` is the canonical field name (doc flagged registration vs regNo — picked registration).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trucks (
    id                UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    broker_id         UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    driver_id         UUID            REFERENCES users(id) ON DELETE SET NULL,
    registration      TEXT            NOT NULL UNIQUE,
    type              TEXT,
    category          truck_category,
    capacity          TEXT,
    make              TEXT,
    year              INT,
    insurance_expiry  DATE,
    status            truck_status    NOT NULL DEFAULT 'available',
    created_at        TIMESTAMPTZ     DEFAULT NOW(),
    updated_at        TIMESTAMPTZ     DEFAULT NOW()
);

-- ------------------------------------------------------------
-- TABLE: driver_profiles
-- One-to-one with users where role = 'driver'. aadhaar stored in full,
-- masked at the query layer (see driverProfile.model.js).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS driver_profiles (
    user_id         UUID            PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    broker_id       UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    license_no      TEXT,
    license_expiry  DATE,
    aadhaar         TEXT,
    truck_id        UUID            REFERENCES trucks(id) ON DELETE SET NULL,
    total_trips     INT             NOT NULL DEFAULT 0,
    avatar          TEXT,
    status          driver_status   NOT NULL DEFAULT 'available',
    created_at      TIMESTAMPTZ     DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trucks_broker           ON trucks(broker_id);
CREATE INDEX IF NOT EXISTS idx_trucks_driver           ON trucks(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_broker  ON driver_profiles(broker_id);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_truck   ON driver_profiles(truck_id);

DROP TRIGGER IF EXISTS update_trucks_updated_at ON trucks;
CREATE TRIGGER update_trucks_updated_at
    BEFORE UPDATE ON trucks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_driver_profiles_updated_at ON driver_profiles;
CREATE TRIGGER update_driver_profiles_updated_at
    BEFORE UPDATE ON driver_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- bookings.truck_id -> trucks(id). Added here (not inline in 06bookings.sql)
-- because trucks didn't exist yet when bookings was created.
DO $$ BEGIN
    ALTER TABLE bookings ADD CONSTRAINT fk_bookings_truck FOREIGN KEY (truck_id) REFERENCES trucks(id) ON DELETE SET NULL;
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'Constraint fk_bookings_truck already exists, skipping.';
END $$;

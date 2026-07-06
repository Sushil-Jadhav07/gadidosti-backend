-- ============================================================
--  SSK LOGISTICS — JOB REQUESTS + TRIPS
--  Database: ssk_logistics
--  File:     db/08jobs_trips.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "JOBS + TRIPS" block in src/config/migrate.js — keep both in sync)
-- ============================================================

DO $$ BEGIN
    CREATE TYPE job_status AS ENUM ('pending', 'accepted', 'expired', 'declined');
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'Type job_status already exists, skipping.';
END $$;

-- ------------------------------------------------------------
-- TABLE: job_requests
-- expiresIn/timestamp shown on the broker UI are computed in the controller, not stored.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_requests (
    id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id   UUID          NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    broker_id    UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    distance     NUMERIC(8,2),
    amount       NUMERIC(12,2),
    expires_at   TIMESTAMPTZ   NOT NULL,
    status       job_status    NOT NULL DEFAULT 'pending',
    created_at   TIMESTAMPTZ   DEFAULT NOW()
);

-- ------------------------------------------------------------
-- TABLE: trips
-- Richest shape in the system — backs broker ActiveJobs + driver MyTrip.
-- pickup_*/drop_* columns are projected as nested {location,address,contactPerson,contactPhone,time,lat,lng} objects.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trips (
    id                          UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id                  UUID            NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
    driver_id                   UUID            REFERENCES users(id) ON DELETE SET NULL,
    broker_id                   UUID            REFERENCES users(id) ON DELETE SET NULL,
    status                      booking_status  NOT NULL DEFAULT 'confirmed',
    pickup_contact_person       TEXT,
    pickup_contact_phone        TEXT,
    pickup_address              TEXT,
    pickup_time                 TIMESTAMPTZ,
    pickup_lat                  NUMERIC(9,6),
    pickup_lng                  NUMERIC(9,6),
    drop_contact_person         TEXT,
    drop_contact_phone          TEXT,
    drop_address                TEXT,
    drop_time                   TIMESTAMPTZ,
    drop_lat                    NUMERIC(9,6),
    drop_lng                    NUMERIC(9,6),
    distance                    NUMERIC(8,2),
    estimated_time              TEXT,
    cargo_material               TEXT,
    cargo_weight                NUMERIC(10,2),
    cargo_quantity              INT,
    cargo_special_instructions  TEXT,
    cargo_value                 NUMERIC(12,2),
    earnings                    NUMERIC(12,2),
    started_at                  TIMESTAMPTZ,
    current_lat                 NUMERIC(9,6),
    current_lng                 NUMERIC(9,6),
    pod_url                     TEXT,
    created_at                  TIMESTAMPTZ     DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     DEFAULT NOW()
);

-- ------------------------------------------------------------
-- TABLE: trip_timeline
-- Mirrors booking_timeline; projected as {step, done, time} objects for ActiveJobs.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trip_timeline (
    id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    trip_id      UUID         NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    step         TEXT         NOT NULL,
    done         BOOLEAN      NOT NULL DEFAULT FALSE,
    occurred_at  TIMESTAMPTZ,
    position     INT          NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_job_requests_broker  ON job_requests(broker_id);
CREATE INDEX IF NOT EXISTS idx_job_requests_status  ON job_requests(status);
CREATE INDEX IF NOT EXISTS idx_trips_driver         ON trips(driver_id);
CREATE INDEX IF NOT EXISTS idx_trips_broker         ON trips(broker_id);
CREATE INDEX IF NOT EXISTS idx_trip_timeline_trip   ON trip_timeline(trip_id);

DROP TRIGGER IF EXISTS update_trips_updated_at ON trips;
CREATE TRIGGER update_trips_updated_at
    BEFORE UPDATE ON trips
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

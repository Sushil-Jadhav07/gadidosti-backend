-- ============================================================
--  SSK LOGISTICS — BOOKINGS (client bookings + progress timeline)
--  Database: ssk_logistics
--  File:     db/06bookings.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "BOOKINGS" block in src/config/migrate.js — keep both in sync)
-- ============================================================

DO $$ BEGIN
    CREATE TYPE booking_status AS ENUM ('pending', 'confirmed', 'assigned', 'en_route_pickup', 'picked_up', 'in_transit', 'delivered', 'completed', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'Type booking_status already exists, skipping.';
END $$;

-- 'no_broker_available' was added after booking_status first shipped — back-fill it on
-- any DB that already had the type without this value (safe no-op otherwise). Set by the
-- offer-expiry cron sweep (src/cron/offerExpirySweep.js) when every job_request for a
-- booking has lapsed with none accepted.
DO $$ BEGIN
    ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'no_broker_available';
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'Value no_broker_available already exists, skipping.';
END $$;

DO $$ BEGIN
    CREATE TYPE truck_category AS ENUM ('small', 'medium', 'large', 'part');
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'Type truck_category already exists, skipping.';
END $$;

DO $$ BEGIN
    CREATE TYPE transport_type AS ENUM ('intra', 'inter');
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'Type transport_type already exists, skipping.';
END $$;

DO $$ BEGIN
    CREATE TYPE payment_status AS ENUM ('paid', 'pending', 'refunded');
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'Type payment_status already exists, skipping.';
END $$;

-- ------------------------------------------------------------
-- TABLE: bookings
-- truck_id has no inline FK — trucks table is created in 07vehicles.sql;
-- the FK constraint is added there (fk_bookings_truck) once it exists.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings (
    id                  UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id           UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    broker_id           UUID            REFERENCES users(id) ON DELETE SET NULL,
    driver_id           UUID            REFERENCES users(id) ON DELETE SET NULL,
    truck_id            UUID,
    status              booking_status  NOT NULL DEFAULT 'pending',
    pickup_location     TEXT            NOT NULL,
    pickup_lat          NUMERIC(9,6),
    pickup_lng          NUMERIC(9,6),
    drop_location       TEXT            NOT NULL,
    drop_lat            NUMERIC(9,6),
    drop_lng            NUMERIC(9,6),
    truck_type          TEXT,
    truck_category      truck_category,
    weight              NUMERIC(10,2),
    weight_unit         TEXT            NOT NULL DEFAULT 'tons',
    quantity            INT,
    material            TEXT,
    transport_type      transport_type  NOT NULL DEFAULT 'intra',
    scheduled_date      TIMESTAMPTZ,
    amount              NUMERIC(12,2),
    payment_status      payment_status  NOT NULL DEFAULT 'pending',
    current_step        INT             NOT NULL DEFAULT 0,
    pricing_breakdown   JSONB,
    rating              JSONB,
    distance            NUMERIC(8,2),
    platform_fee        NUMERIC(12,2),
    created_at          TIMESTAMPTZ     DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     DEFAULT NOW()
);

COMMENT ON COLUMN bookings.pricing_breakdown IS 'Snapshot of the quote breakdown at booking time — shape depends on transport_type, see pricing.model.js';

-- ------------------------------------------------------------
-- TABLE: booking_timeline
-- Backs the timeline[] + currentStep progress tracker on the client UI.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS booking_timeline (
    id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id   UUID         NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    step         TEXT         NOT NULL,
    done         BOOLEAN      NOT NULL DEFAULT FALSE,
    occurred_at  TIMESTAMPTZ,
    position     INT          NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_bookings_client         ON bookings(client_id);
CREATE INDEX IF NOT EXISTS idx_bookings_broker         ON bookings(broker_id);
CREATE INDEX IF NOT EXISTS idx_bookings_driver         ON bookings(driver_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status         ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_booking_timeline_booking ON booking_timeline(booking_id);

DROP TRIGGER IF EXISTS update_bookings_updated_at ON bookings;
CREATE TRIGGER update_bookings_updated_at
    BEFORE UPDATE ON bookings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

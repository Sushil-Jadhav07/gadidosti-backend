-- ============================================================
--  SSK LOGISTICS — SETTLEMENTS (payments) + DISPUTES
--  Database: ssk_logistics
--  File:     db/09payments_disputes.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "PAYMENTS + DISPUTES" block in src/config/migrate.js — keep both in sync)
-- ============================================================

DO $$ BEGIN
    CREATE TYPE settlement_status AS ENUM ('paid', 'pending');
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'Type settlement_status already exists, skipping.';
END $$;

DO $$ BEGIN
    CREATE TYPE dispute_status AS ENUM ('open', 'under_review', 'resolved');
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'Type dispute_status already exists, skipping.';
END $$;

DO $$ BEGIN
    CREATE TYPE dispute_raised_by AS ENUM ('client', 'broker');
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'Type dispute_raised_by already exists, skipping.';
END $$;

DO $$ BEGIN
    CREATE TYPE dispute_issue_type AS ENUM (
        'damaged_goods', 'payment_delay', 'cancellation_fee', 'route_dispute',
        'late_delivery', 'fuel_surcharge', 'wrong_items', 'weight_discrepancy'
    );
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'Type dispute_issue_type already exists, skipping.';
END $$;

-- ------------------------------------------------------------
-- TABLE: settlements
-- net_earnings is a generated column (amount - platform_fee) — every earnings
-- screen in the UI shows net, never just the gross amount.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settlements (
    id             UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id     UUID                NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    broker_id      UUID                REFERENCES users(id) ON DELETE SET NULL,
    driver_id      UUID                REFERENCES users(id) ON DELETE SET NULL,
    amount         NUMERIC(12,2)       NOT NULL,
    platform_fee   NUMERIC(12,2)       NOT NULL DEFAULT 0,
    net_earnings   NUMERIC(12,2)       GENERATED ALWAYS AS (amount - platform_fee) STORED,
    status         settlement_status   NOT NULL DEFAULT 'pending',
    settled_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ         DEFAULT NOW()
);

-- ------------------------------------------------------------
-- TABLE: disputes
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS disputes (
    id                 UUID                 PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id         UUID                 NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    raised_by_user_id  UUID                 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    raised_by_role     dispute_raised_by    NOT NULL,
    issue_type         dispute_issue_type   NOT NULL,
    description        TEXT                 NOT NULL,
    status             dispute_status       NOT NULL DEFAULT 'open',
    resolution         TEXT,
    created_at         TIMESTAMPTZ          DEFAULT NOW(),
    updated_at         TIMESTAMPTZ          DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settlements_booking  ON settlements(booking_id);
CREATE INDEX IF NOT EXISTS idx_settlements_broker   ON settlements(broker_id);
CREATE INDEX IF NOT EXISTS idx_settlements_driver   ON settlements(driver_id);
CREATE INDEX IF NOT EXISTS idx_disputes_booking     ON disputes(booking_id);
CREATE INDEX IF NOT EXISTS idx_disputes_raised_by   ON disputes(raised_by_user_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status      ON disputes(status);

DROP TRIGGER IF EXISTS update_disputes_updated_at ON disputes;
CREATE TRIGGER update_disputes_updated_at
    BEFORE UPDATE ON disputes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
--  SSK LOGISTICS — MONTHLY VEHICLE HIRING (ENQUIRY ONLY)
--  Database: ssk_logistics
--  File:     db/50monthly_hiring.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "MONTHLY VEHICLE HIRING" block in src/config/migrate.js — keep both in sync)
--
--  Deliberately NOT wired into the booking/trip/negotiation system — this is a lead-capture
--  pair, not a real booking flow. Clients raise an enquiry (monthly_hiring_enquiries);
--  drivers/brokers separately list a truck they own as available (monthly_vehicle_listings,
--  FK'd to an existing trucks row rather than re-collecting truck details). Nothing here
--  auto-matches the two — admin sees both lists in full and follows up manually.
-- ============================================================

CREATE TABLE IF NOT EXISTS monthly_hiring_enquiries (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  location         TEXT NOT NULL,
  truck_category   truck_category,
  duration_months  INT,
  pricing_type     TEXT NOT NULL DEFAULT 'fixed',
  budget_amount    NUMERIC(12,2),
  description      TEXT,
  status           TEXT NOT NULL DEFAULT 'open',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_monthly_enquiries_client ON monthly_hiring_enquiries(client_id);
CREATE INDEX IF NOT EXISTS idx_monthly_enquiries_status ON monthly_hiring_enquiries(status);

CREATE TABLE IF NOT EXISTS monthly_vehicle_listings (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  truck_id            UUID NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
  pricing_type        TEXT NOT NULL DEFAULT 'fixed',
  rate_amount         NUMERIC(12,2) NOT NULL,
  availability_notes  TEXT,
  status              TEXT NOT NULL DEFAULT 'active',
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_monthly_listings_owner ON monthly_vehicle_listings(owner_id);
CREATE INDEX IF NOT EXISTS idx_monthly_listings_status ON monthly_vehicle_listings(status);

DO $$ BEGIN
    ALTER TABLE monthly_hiring_enquiries ADD CONSTRAINT monthly_enquiries_pricing_type_chk
      CHECK (pricing_type IN ('fixed', 'per_km'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE monthly_hiring_enquiries ADD CONSTRAINT monthly_enquiries_status_chk
      CHECK (status IN ('open', 'contacted', 'closed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE monthly_vehicle_listings ADD CONSTRAINT monthly_listings_pricing_type_chk
      CHECK (pricing_type IN ('fixed', 'per_km'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE monthly_vehicle_listings ADD CONSTRAINT monthly_listings_status_chk
      CHECK (status IN ('active', 'inactive'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

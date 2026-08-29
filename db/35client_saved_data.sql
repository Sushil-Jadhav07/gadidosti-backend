-- ============================================================
--  SSK LOGISTICS — CLIENT SAVED ADDRESSES & PAYMENT METHODS
--  Database: ssk_logistics
--  File:     db/35client_saved_data.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "CLIENT SAVED DATA" block in src/config/migrate.js — keep both in sync)
-- ============================================================

-- A client's saved pickup/drop locations for reuse across bookings — label is the name they
-- give it ("Home", "Warehouse 2"), floor is a free-text unit/floor detail Google's address
-- fields don't carry, lat/lng come from the Google Places picker so BookTruck.jsx can prefill
-- coordinates the same way manual pickup/drop entry does. address_type/contact_name/
-- contact_phone mirror trips.pickup_contact_person/pickup_contact_phone (and the drop
-- equivalents) — a saved location's usual on-site contact, prefillable the same way.
CREATE TABLE IF NOT EXISTS saved_addresses (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label          TEXT NOT NULL,
  address        TEXT NOT NULL,
  floor          TEXT,
  lat            NUMERIC(9,6),
  lng            NUMERIC(9,6),
  city           TEXT,
  address_type   TEXT NOT NULL DEFAULT 'pickup' CHECK (address_type IN ('pickup', 'dropoff')),
  contact_name   TEXT,
  contact_phone  TEXT,
  is_default     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_saved_addresses_client ON saved_addresses(client_id);

-- Safe to re-run even if this file's CREATE TABLE above already ran once before these three
-- columns existed — CREATE TABLE IF NOT EXISTS would otherwise silently skip adding them to an
-- already-existing table. The CHECK is folded into the same ADD COLUMN IF NOT EXISTS (rather
-- than a separate ADD CONSTRAINT) since plain PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS —
-- this way the whole clause, constraint included, is simply skipped once the column exists.
ALTER TABLE saved_addresses ADD COLUMN IF NOT EXISTS address_type TEXT NOT NULL DEFAULT 'pickup'
  CHECK (address_type IN ('pickup', 'dropoff'));
ALTER TABLE saved_addresses ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE saved_addresses ADD COLUMN IF NOT EXISTS contact_phone TEXT;

-- A client's saved payment methods for reuse at checkout (PaymentSheet.jsx) — there's no real
-- payment gateway wired up yet (see PaymentSheet's own header comment), so this only ever
-- stores non-sensitive display data a client typed in the demo checkout flow: a UPI ID, or a
-- card's brand/last 4 digits. Full card numbers, expiry, and CVV are NEVER written here or
-- anywhere else — only what's safe to redisplay.
CREATE TABLE IF NOT EXISTS saved_payment_methods (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method_type  TEXT NOT NULL CHECK (method_type IN ('upi', 'card', 'netbanking', 'wallet')),
  label        TEXT NOT NULL,
  details      JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_saved_payment_methods_client ON saved_payment_methods(client_id);

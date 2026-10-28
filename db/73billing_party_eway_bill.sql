-- ============================================================
--  SSK LOGISTICS — BILLING PARTY (who pays) + MANDATORY E-WAY BILL
--  Database: ssk_logistics
--  File:     db/73billing_party_eway_bill.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "BILLING PARTY + E-WAY BILL" block in src/config/migrate.js)
--
--  Step 1 of the booking wizard now asks who's liable for the freight's GST (RCM) — the client
--  themselves ("You Pay", the default, unchanged from today) or a third-party receiver/consignee
--  ("Receiver Pays"), who must then be identified by name + GSTIN. Whatever name+GSTIN the client
--  enters is saved to client_billing_parties so it can be picked again on a future booking
--  instead of retyped — exactly the same "saved, selectable, or add new" pattern as Saved
--  Addresses, just for this.
--
--  Step 2 also gains a mandatory E-Way Bill number field — required for every booking now,
--  not threshold-based (the admin's explicit choice; see booking.validation.js).
-- ============================================================

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS billed_to TEXT NOT NULL DEFAULT 'self' CHECK (billed_to IN ('self', 'receiver'));
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS billing_party_name TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS billing_party_gstin TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS eway_bill_number TEXT;

CREATE TABLE IF NOT EXISTS client_billing_parties (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  gstin       TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (client_id, gstin)
);
CREATE INDEX IF NOT EXISTS idx_client_billing_parties_client ON client_billing_parties(client_id);

-- ============================================================
--  SSK LOGISTICS — 32FT SXL/MXL TRUCK TYPES + OPEN/CLOSED BODY TYPE
--  Database: ssk_logistics
--  File:     db/59truck_32ft_and_body_type.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the matching block in src/config/migrate.js — keep both in sync)
--
--  Adds two more truck sizes (32ft SXL, 32ft MXL) the same additive way as
--  db/51vehicle_pricing.sql's retaxonomy, plus a new, independent "body_type"
--  attribute (open / closed) — set when a truck is registered, and usable as a
--  search filter on top of the size category. Nullable on both trucks and
--  bookings — existing rows were never asked for one.
-- ============================================================

ALTER TYPE truck_category ADD VALUE IF NOT EXISTS '32ft_sxl';
ALTER TYPE truck_category ADD VALUE IF NOT EXISTS '32ft_mxl';

ALTER TABLE trucks ADD COLUMN IF NOT EXISTS body_type TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS truck_body_type TEXT;

DO $$ BEGIN
    ALTER TABLE trucks ADD CONSTRAINT trucks_body_type_chk CHECK (body_type IN ('open', 'closed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE bookings ADD CONSTRAINT bookings_truck_body_type_chk CHECK (truck_body_type IN ('open', 'closed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

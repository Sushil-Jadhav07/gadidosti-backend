-- ============================================================
--  SSK LOGISTICS — PART-TRUCK / FULL-TRUCK DRIVER TOGGLE
--  Database: ssk_logistics
--  File:     db/61part_truck_mode.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the matching block in src/config/migrate.js — keep both in sync)
--
--  Replaces the old "client searches a specific on-trip truck" part-load design
--  (trip_join_requests, GET /vehicles/trucks/nearby-on-trip) with a driver-side
--  toggle: a driver flips their own truck into "Part Truck" mode (willing to share
--  spare capacity with a second booking, whether idle or already on a trip) or
--  back to "Full Truck" (exclusive, one booking at a time — the long-standing
--  default). A Part Truck booking now goes through the exact same broadcast +
--  negotiation pipeline (driver_requests) as a normal Find Truck booking, just
--  filtered to drivers currently toggled into Part Truck mode.
--
--  accepting_loads is a second, separate switch — only meaningful while
--  part_truck_mode is true. Lets a driver pause new part-load requests (e.g.
--  physically full right now) without fully exiting Part Truck mode and without
--  affecting any part-load booking already assigned to them.
-- ============================================================

ALTER TABLE trucks ADD COLUMN IF NOT EXISTS part_truck_mode BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE trucks ADD COLUMN IF NOT EXISTS accepting_loads BOOLEAN NOT NULL DEFAULT true;

-- ============================================================
--  SSK LOGISTICS — PART TRUCK SIZE FILTER
--  Database: ssk_logistics
--  File:     db/62part_truck_size_filter.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the matching block in src/config/migrate.js — keep both in sync)
--
--  A Part Truck booking can optionally narrow its match to one truck size (e.g.
--  "only 32ft SXL trucks currently in Part Truck mode") instead of any size —
--  purely a matching filter, independent of truck_category (which stays 'part',
--  the signal that this booking IS a Part Truck one at all, used by pricing/
--  validation). NULL means "any size", same as leaving it unset today.
-- ============================================================

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS part_truck_size_category VARCHAR(50);

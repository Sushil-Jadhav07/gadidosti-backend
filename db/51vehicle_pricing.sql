-- ============================================================
--  SSK LOGISTICS — VEHICLE PRICING RETAXONOMY
--  Database: ssk_logistics
--  File:     db/51vehicle_pricing.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "VEHICLE PRICING RETAXONOMY" block in src/config/migrate.js — keep both in sync)
--
--  Replaces the old broad small/medium/large truck sizing with 8 specific types (3 Wheeler,
--  Tata Ace, Pickup 8ft/10ft, 14/17/19/22ft) — additive only, old values are NOT removed
--  (Postgres can't cheaply drop enum values anyway, and existing trucks/bookings keep working
--  under their old category rather than being force-migrated — see pricing.model.js's
--  LEGACY_CATEGORY_TO_VEHICLE_TYPE / VEHICLE_TYPE_TO_LEGACY_BUCKET for how fare/halting-rate
--  lookups still resolve a legacy category to something sensible). 'part' (part-load booking)
--  is untouched — it was never a truck size to begin with.
--
--  The actual per-type rate card (minimum fare + distance-tiered per-km rates + the 3 named-
--  region overrides) lives as code-level defaults in pricing.model.js
--  (DEFAULT_VEHICLE_PRICING / DEFAULT_REGION_RATES / DEFAULT_REGION_ZONES), the same pattern
--  already used for delivery SLA / advance-payment tiers — no schema change needed for that
--  part, it's plain JSON inside the existing pricing_config.config column, admin-editable via
--  PATCH /api/admin/pricing.
-- ============================================================

ALTER TYPE truck_category ADD VALUE IF NOT EXISTS '3_wheeler';
ALTER TYPE truck_category ADD VALUE IF NOT EXISTS 'tata_ace';
ALTER TYPE truck_category ADD VALUE IF NOT EXISTS 'pickup_8ft';
ALTER TYPE truck_category ADD VALUE IF NOT EXISTS 'pickup_10ft';
ALTER TYPE truck_category ADD VALUE IF NOT EXISTS '14ft';
ALTER TYPE truck_category ADD VALUE IF NOT EXISTS '17ft';
ALTER TYPE truck_category ADD VALUE IF NOT EXISTS '19ft';
ALTER TYPE truck_category ADD VALUE IF NOT EXISTS '22ft';

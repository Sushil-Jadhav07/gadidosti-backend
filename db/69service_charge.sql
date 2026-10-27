-- ============================================================
--  SSK LOGISTICS — TIERED SERVICE CHARGE (replaces flat platform fee)
--  Database: ssk_logistics
--  File:     db/69service_charge.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "SERVICE CHARGE" block in src/config/migrate.js)
--
--  Replaces the old per-bucket platformFee percentage (intraCity.small/medium/large,
--  interCity, partTruck) with one global tiered rule: 7% for orders <= threshold,
--  5% above it. See computeServiceCharge in pricing.model.js. The old platformFee
--  keys are left in place (harmless, simply unread from now on) rather than stripped,
--  to avoid a brittle jsonb surgery migration on a config blob admins may have already
--  hand-edited into slightly different shapes.
-- ============================================================

UPDATE pricing_config
SET config = config || '{
    "serviceCharge": { "threshold": 10000, "lowRate": 0.07, "highRate": 0.05 }
}'::jsonb
WHERE id = '00000000-0000-0000-0000-000000000001'
  AND NOT (config ? 'serviceCharge');

-- ============================================================
--  SSK LOGISTICS — COMMISSION + DRIVER/BROKER EARNINGS WALLET
--  Database: ssk_logistics
--  File:     db/70commission_and_earnings_wallet.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "COMMISSION + EARNINGS WALLET" block in src/config/migrate.js)
--
--  Commission is a cut the PLATFORM takes from a driver/broker's own earnings — distinct from
--  the client-facing service charge (computeServiceCharge in pricing.model.js), which is money
--  added on top of what the CLIENT pays. The two are independent: a trip's settlement already
--  nets out the service charge (settlements.net_earnings = amount - platform_fee); commission
--  then takes a further cut of THAT, credited to a wallet instead of paid out immediately.
--
--  admin_settings.commission_rate already existed (db/10settings_pricing.sql) as the global
--  default, but was never read anywhere — this is what actually wires it up. users.commission_rate
--  is a per-person override (NULL = use the global default) that works for either role, since a
--  single person is never both a driver and a broker.
--
--  The driver/broker earnings wallet reuses the exact wallets/wallet_transactions tables built
--  for the client prepaid-recharge wallet (db/66wallet.sql) rather than a parallel table —
--  same balance+ledger shape, just two new transaction types: 'earning' (credited automatically
--  when a trip completes) and 'payout' (debited when a superadmin manually logs having paid the
--  person outside the system — bank transfer, UPI, cash). A client's wallet and a driver/broker's
--  earnings wallet are still two conceptually different things that happen to share a table.
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2);

COMMENT ON COLUMN users.commission_rate IS 'Per-person commission override (%, NULL = use admin_settings.commission_rate). Only meaningful for driver/broker roles.';

ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS note TEXT;

-- Re-run-safe: DROP + re-ADD every time (no native IF NOT EXISTS for ADD CONSTRAINT), so this
-- stays correct whether the constraint already has the new values or still has the original three.
ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_type_check;
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_type_check
    CHECK (type IN ('recharge', 'booking_payment', 'refund', 'earning', 'payout'));

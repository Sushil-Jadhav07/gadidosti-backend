-- ============================================================
--  SSK LOGISTICS — CLIENT WALLET
--  Database: ssk_logistics
--  File:     db/66wallet.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "WALLET" block in src/config/migrate.js — keep both in sync)
--
--  Client-only rechargeable balance, usable as an alternative payment method at
--  booking time alongside Pay Now/Pay Later/Advance. Recharges go through the
--  existing payment provider (src/providers/payment/); booking-payment debits are
--  internal, no gateway round-trip. See src/models/wallet.model.js.
-- ============================================================

-- pending_recharge_order_id/amount cache the most recent recharge order this user opened, the
-- same way kyc_submissions.aadhaar_otp_ref_id caches a pending OTP — so verify-time can look up
-- the amount THIS order was actually created for server-side, instead of trusting whatever
-- amount the client's /recharge/verify call claims (which would otherwise let a client credit
-- any amount they like once the gateway signature check passes for a real, smaller payment).
CREATE TABLE IF NOT EXISTS wallets (
    id                         UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                    UUID         NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    balance                    NUMERIC(12,2) NOT NULL DEFAULT 0,
    pending_recharge_order_id  TEXT,
    pending_recharge_amount    NUMERIC(12,2),
    created_at                 TIMESTAMPTZ  DEFAULT NOW(),
    updated_at                 TIMESTAMPTZ  DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_wallets_updated_at ON wallets;
CREATE TRIGGER update_wallets_updated_at
    BEFORE UPDATE ON wallets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS wallet_transactions (
    id                     UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id              UUID         NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    type                   TEXT         NOT NULL CHECK (type IN ('recharge', 'booking_payment', 'refund')),
    amount                 NUMERIC(12,2) NOT NULL,
    balance_after          NUMERIC(12,2) NOT NULL,
    reference_booking_id   UUID         REFERENCES bookings(id) ON DELETE SET NULL,
    reference_order_id     TEXT,
    created_at             TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_wallet_id ON wallet_transactions(wallet_id);

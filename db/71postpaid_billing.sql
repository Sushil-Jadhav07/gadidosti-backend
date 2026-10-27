-- ============================================================
--  SSK LOGISTICS — POSTPAID BILLING (admin-set account type + credit limit)
--  Database: ssk_logistics
--  File:     db/71postpaid_billing.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "POSTPAID BILLING" block in src/config/migrate.js)
--
--  Admin can flip a client from 'prepaid' (today's normal Pay Now/Advance/Wallet/To Pay flow,
--  completely unchanged) to 'postpaid' with a credit limit. A postpaid client's bookings skip
--  the payment step entirely — auto-marked payment_status='to_be_billed' at creation, no action
--  from them — and accumulate against their credit limit. Once outstanding (to_be_billed +
--  billed-but-unpaid) reaches the limit, a bill is generated immediately for everything
--  outstanding and further postpaid bookings are blocked until that bill is paid. Separately, a
--  monthly cron bills out whatever's still outstanding on the 1st of each month regardless.
--
--  'billed' is a new payment_status: a booking's charge has been bundled into a bill that's
--  still awaiting payment (distinct from 'to_be_billed' = not yet bundled into any bill). Once
--  the bill is paid, every booking in it flips 'billed' -> 'paid'.
-- ============================================================

DO $$ BEGIN
    CREATE TYPE billing_type AS ENUM ('prepaid', 'postpaid');
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'Type billing_type already exists, skipping.';
END $$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_type billing_type NOT NULL DEFAULT 'prepaid';
ALTER TABLE users ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12,2);

COMMENT ON COLUMN users.billing_type IS 'Only meaningful for role=client. prepaid (default): unchanged Pay Now/Advance/Wallet/To Pay flow. postpaid: bookings skip payment, accumulate against credit_limit.';

DO $$ BEGIN
    ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'billed';
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'Value billed already exists, skipping.';
END $$;

CREATE TABLE IF NOT EXISTS postpaid_bills (
    id            UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period_start  TIMESTAMPTZ,
    period_end    TIMESTAMPTZ,
    total_amount  NUMERIC(12,2) NOT NULL,
    status        TEXT         NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
    trigger       TEXT         NOT NULL DEFAULT 'monthly' CHECK (trigger IN ('monthly', 'credit_limit')),
    sent_at       TIMESTAMPTZ,
    paid_at       TIMESTAMPTZ,
    payment_mode  TEXT,
    note          TEXT,
    created_at    TIMESTAMPTZ  DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_postpaid_bills_client ON postpaid_bills(client_id);
CREATE INDEX IF NOT EXISTS idx_postpaid_bills_status ON postpaid_bills(status);

DROP TRIGGER IF EXISTS update_postpaid_bills_updated_at ON postpaid_bills;
CREATE TRIGGER update_postpaid_bills_updated_at
    BEFORE UPDATE ON postpaid_bills
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS postpaid_bill_items (
    id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    bill_id     UUID         NOT NULL REFERENCES postpaid_bills(id) ON DELETE CASCADE,
    booking_id  UUID         NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    amount      NUMERIC(12,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_postpaid_bill_items_bill ON postpaid_bill_items(bill_id);

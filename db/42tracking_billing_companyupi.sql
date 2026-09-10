-- Three independent features:
--
-- 1. Live tracking sharing — an opaque, unguessable token per booking (generated on-demand,
--    the first time the client taps "Share"), backing a public, unauthenticated tracking view.
--    Deliberately NOT the booking id itself — a share link should be explicit-opt-in and
--    revocable, not reuse an identifier that already appears elsewhere (notifications, receipts).
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS tracking_share_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_tracking_share_token ON bookings(tracking_share_token) WHERE tracking_share_token IS NOT NULL;

-- 2. "To Be Billed" — a new payment stage alongside the existing pending/partial/paid/refunded:
--    nothing is collected at booking time OR at delivery: the booking is billed/settled out of
--    band later. Trip.controller.js's payment-collection step must treat this the same as
--    "already handled" (exclude it, same as 'paid') so the driver isn't asked to collect COD.
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'to_be_billed';

-- 3. Company UPI — a single platform-wide UPI ID/payee-name a driver can show instead of their
--    own personal one at collection time (their own choice, per collection — see
--    DeliveryCompletionFlow.jsx's PaymentsStep). Lives on the existing admin_settings singleton,
--    the same table platform_name/contact_email etc. already live on.
ALTER TABLE admin_settings ADD COLUMN IF NOT EXISTS company_upi_id TEXT;
ALTER TABLE admin_settings ADD COLUMN IF NOT EXISTS company_upi_name TEXT;

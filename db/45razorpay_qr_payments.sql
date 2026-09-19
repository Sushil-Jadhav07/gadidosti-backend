-- Verified in-person payment collection via Razorpay's own QR Code API, as an alternative to
-- the existing raw UPI-intent QR (Personal/Company): that one is a free peer-to-peer bank
-- transfer with no independent proof the customer actually paid — the driver just self-reports
-- "Payment Received". A Razorpay QR code is tied to an exact amount and confirmed by Razorpay
-- itself (webhook + poll-on-demand), the same way Ola/Rapido confirm driver collections.
-- One active QR per trip at a time — created fresh each time the driver opens the Payments step
-- (or reuses an unpaid one still open), never more than one concurrently.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS razorpay_qr_code_id TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS razorpay_qr_image_url TEXT;
-- Razorpay's own qr_code.status values: 'active' | 'closed'. Tracked here mainly so a stale
-- 'closed' one is never reused — a fresh create call replaces it instead.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS razorpay_qr_status TEXT;

CREATE INDEX IF NOT EXISTS idx_trips_razorpay_qr_code_id ON trips(razorpay_qr_code_id) WHERE razorpay_qr_code_id IS NOT NULL;

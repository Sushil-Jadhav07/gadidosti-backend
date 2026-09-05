-- The driver's own UPI VPA (e.g. "driver123@okhdfcbank"), entered once in their profile —
-- lets the app generate a fresh UPI-intent QR code (with the exact trip amount baked in) on
-- the Payments step instead of the driver uploading a static QR image with no amount encoded
-- (that upload feature was removed — see the DeliveryCompletionFlow.jsx PaymentsStep history).
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS upi_id TEXT;

-- Mirrors the "AADHAAR OTP REF_ID CACHE" block in src/config/migrate.js.
-- Cashfree rate-limits repeat OTP requests for the same Aadhaar within a cooldown window and,
-- in that response, omits ref_id entirely — even though the OTP it sent on the earlier,
-- successful call is still valid. Caching that ref_id here lets a rate-limited retry fall
-- back to it instead of stranding someone who already received the OTP but has no ref_id to
-- submit it with (see kyc.controller.js's sendAadhaarOtp).
ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS aadhaar_otp_ref_id TEXT;
ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS aadhaar_otp_sent_at TIMESTAMPTZ;

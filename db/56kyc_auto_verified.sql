-- Mirrors the "AUTOMATIC KYC APPROVAL" block in src/config/migrate.js.
-- Once PAN + Aadhaar (+ Driving License for drivers) all come back 'verified' in
-- verification_results, submitKyc flips kyc_status straight to 'verified' itself — no
-- admin/broker click required. This column just distinguishes that from a human-reviewed
-- verification (KycModel.review sets it back to false), so the admin/broker dashboards can
-- show "Auto-verified" vs "Reviewed by X" instead of guessing from reviewed_by being null.
ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS auto_verified BOOLEAN NOT NULL DEFAULT false;

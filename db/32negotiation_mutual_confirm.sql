-- Mutual-confirmation negotiation: either side accepting now only commits their own side;
-- the booking/trip only finalizes once the OTHER side also explicitly confirms. See
-- docs/MUTUAL_CONFIRMATION_FLOW.md.

ALTER TYPE driver_request_status ADD VALUE IF NOT EXISTS 'awaiting_confirmation';
ALTER TABLE driver_requests ADD COLUMN IF NOT EXISTS pending_confirmation_by TEXT
  CHECK (pending_confirmation_by IN ('client', 'respondent'));

ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'awaiting_confirmation';
ALTER TABLE job_requests ADD COLUMN IF NOT EXISTS pending_confirmation_by TEXT
  CHECK (pending_confirmation_by IN ('client', 'broker'));

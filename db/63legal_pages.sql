-- ============================================================
--  SSK LOGISTICS — LEGAL / COMPLIANCE PAGES
--  Database: ssk_logistics
--  File:     db/63legal_pages.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the matching block in src/config/migrate.js — keep both in sync)
--
--  Admin-editable static pages (Privacy Policy, Terms & Conditions, Account Deletion
--  Request, Contact/Support, Cancellation & Refund Policy, Safety Policy), one set
--  per audience (client / driver / broker — see src/constants/legalPages.js), served
--  publicly with no auth for app-store listing compliance links. account_deletion
--  additionally backs a public request form (see account_deletion_requests below),
--  logged for an admin to action manually rather than deleting anything automatically.
-- ============================================================

CREATE TABLE IF NOT EXISTS legal_pages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  audience    VARCHAR(20) NOT NULL,
  page_key    VARCHAR(50) NOT NULL,
  title       VARCHAR(200) NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (audience, page_key)
);

DROP TRIGGER IF EXISTS update_legal_pages_updated_at ON legal_pages;
CREATE TRIGGER update_legal_pages_updated_at
  BEFORE UPDATE ON legal_pages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- One empty row per audience x page_key so the admin list always shows all 18 slots (nothing
-- to silently miss) and the public GET never 404s for a page that just hasn't been written
-- yet — it 200s with empty content, which the frontend renders as "Content coming soon."
INSERT INTO legal_pages (audience, page_key, title)
SELECT audience, page_key, title FROM (VALUES
  ('client',  'privacy_policy',    'Privacy Policy'),
  ('client',  'terms_conditions',  'Terms & Conditions'),
  ('client',  'account_deletion',  'Account Deletion Request'),
  ('client',  'contact_support',   'Contact / Support'),
  ('client',  'refund_policy',     'Cancellation & Refund Policy'),
  ('client',  'safety_policy',     'Safety Policy'),
  ('driver',  'privacy_policy',    'Privacy Policy'),
  ('driver',  'terms_conditions',  'Terms & Conditions'),
  ('driver',  'account_deletion',  'Account Deletion Request'),
  ('driver',  'contact_support',   'Contact / Support'),
  ('driver',  'refund_policy',     'Cancellation & Refund Policy'),
  ('driver',  'safety_policy',     'Safety Policy'),
  ('broker',  'privacy_policy',    'Privacy Policy'),
  ('broker',  'terms_conditions',  'Terms & Conditions'),
  ('broker',  'account_deletion',  'Account Deletion Request'),
  ('broker',  'contact_support',   'Contact / Support'),
  ('broker',  'refund_policy',     'Cancellation & Refund Policy'),
  ('broker',  'safety_policy',     'Safety Policy')
) AS seed(audience, page_key, title)
ON CONFLICT (audience, page_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  audience      VARCHAR(20) NOT NULL,
  name          VARCHAR(200),
  email         VARCHAR(200),
  phone         VARCHAR(20),
  reason        TEXT,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending',
  admin_notes   TEXT,
  processed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  processed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_status ON account_deletion_requests(status);

DROP TRIGGER IF EXISTS update_account_deletion_requests_updated_at ON account_deletion_requests;
CREATE TRIGGER update_account_deletion_requests_updated_at
  BEFORE UPDATE ON account_deletion_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

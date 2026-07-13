-- ------------------------------------------------------------
-- TABLE: kyc_files
-- Stores uploaded KYC document bytes directly in Postgres (via
-- PostgresStorageProvider) instead of local disk or a third-party bucket —
-- avoids losing files to Render's ephemeral filesystem without needing a
-- separate cloud storage account. One row per uploaded file.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kyc_files (
    id            UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_key  TEXT            NOT NULL,
    filename      TEXT            NOT NULL,
    mime_type     TEXT            NOT NULL,
    data          BYTEA           NOT NULL,
    created_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE kyc_files IS 'Uploaded KYC document files (PAN/Aadhaar/license photos etc.), stored as bytea when STORAGE_PROVIDER=postgres';

CREATE INDEX IF NOT EXISTS idx_kyc_files_user_id ON kyc_files(user_id);

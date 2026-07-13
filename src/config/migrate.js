require('dotenv').config();
const pool = require('./db');

const runMigrations = async (client) => {
  try {
    console.log('🚀 Running migrations...');

    await client.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

      -- ENUM types
      DO $$ BEGIN
        CREATE TYPE user_role AS ENUM ('client', 'broker', 'driver', 'admin');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE user_status AS ENUM ('active', 'inactive', 'blocked', 'pending_verification');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE otp_purpose AS ENUM ('registration', 'login', 'password_reset', 'phone_verify');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      -- USERS table
      CREATE TABLE IF NOT EXISTS users (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name            VARCHAR(100) NOT NULL,
        email           VARCHAR(150) UNIQUE,
        phone           VARCHAR(15) UNIQUE NOT NULL,
        password_hash   TEXT,
        role            user_role NOT NULL DEFAULT 'client',
        status          user_status NOT NULL DEFAULT 'pending_verification',
        is_phone_verified BOOLEAN DEFAULT FALSE,
        is_email_verified BOOLEAN DEFAULT FALSE,
        profile_image   TEXT,
        last_login_at   TIMESTAMPTZ,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW()
      );

      -- OTP table
      CREATE TABLE IF NOT EXISTS otps (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        phone       VARCHAR(15) NOT NULL,
        otp_code    VARCHAR(6) NOT NULL,
        purpose     otp_purpose NOT NULL DEFAULT 'login',
        is_used     BOOLEAN DEFAULT FALSE,
        attempts    INT DEFAULT 0,
        expires_at  TIMESTAMPTZ NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      -- REFRESH TOKENS table
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash  TEXT NOT NULL UNIQUE,
        is_revoked  BOOLEAN DEFAULT FALSE,
        user_agent  TEXT,
        ip_address  INET,
        expires_at  TIMESTAMPTZ NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      -- AUDIT LOG table
      CREATE TABLE IF NOT EXISTS audit_logs (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
        action      VARCHAR(100) NOT NULL,
        entity      VARCHAR(100),
        entity_id   UUID,
        meta        JSONB,
        ip_address  INET,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_users_phone   ON users(phone);
      CREATE INDEX IF NOT EXISTS idx_users_email   ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_role    ON users(role);
      CREATE INDEX IF NOT EXISTS idx_users_status  ON users(status);
      CREATE INDEX IF NOT EXISTS idx_otps_phone    ON otps(phone);
      CREATE INDEX IF NOT EXISTS idx_otps_expires  ON otps(expires_at);
      CREATE INDEX IF NOT EXISTS idx_refresh_user  ON refresh_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_logs(user_id);

      -- Auto-update updated_at trigger
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
      $$ language 'plpgsql';

      DROP TRIGGER IF EXISTS update_users_updated_at ON users;
      CREATE TRIGGER update_users_updated_at
        BEFORE UPDATE ON users
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);

    // ── Google Sign-In columns (idempotent) ──
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) NOT NULL DEFAULT 'phone';
      ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
    `);

    // ── Profile fields (address, company name) + notifications table ──
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS company_name VARCHAR(150);

      CREATE TABLE IF NOT EXISTS notifications (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title       VARCHAR(150) NOT NULL,
        message     TEXT NOT NULL,
        type        VARCHAR(50) NOT NULL DEFAULT 'general',
        is_read     BOOLEAN NOT NULL DEFAULT FALSE,
        meta        JSONB,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_notifications_user_id  ON notifications(user_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_unread   ON notifications(user_id, is_read);
      CREATE INDEX IF NOT EXISTS idx_notifications_created  ON notifications(created_at DESC);
    `);

    // ── KYC (broker/driver document verification) ──
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE kyc_status AS ENUM ('not_submitted', 'pending', 'approved', 'rejected');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_status kyc_status NOT NULL DEFAULT 'not_submitted';

      CREATE TABLE IF NOT EXISTS kyc_submissions (
        id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id           UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        documents         JSONB NOT NULL DEFAULT '{}'::jsonb,
        rejection_reason  TEXT,
        reviewed_by       UUID REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at       TIMESTAMPTZ,
        submitted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_kyc_submissions_user_id ON kyc_submissions(user_id);
      CREATE INDEX IF NOT EXISTS idx_users_kyc_status ON users(kyc_status);
    `);

    // ── KYC status rename: not_submitted/pending/approved -> pending/submitted/verified ──
    // (idempotent — only runs if the old label 'not_submitted' still exists)
    await client.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'kyc_status' AND e.enumlabel = 'not_submitted'
        ) THEN
          ALTER TYPE kyc_status RENAME VALUE 'approved' TO 'verified';
          ALTER TYPE kyc_status RENAME VALUE 'pending' TO 'submitted';
          ALTER TYPE kyc_status RENAME VALUE 'not_submitted' TO 'pending';
        END IF;
      END $$;
    `);

    // ── BOOKINGS (client bookings + progress timeline) ──
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE booking_status AS ENUM ('pending', 'confirmed', 'assigned', 'en_route_pickup', 'picked_up', 'in_transit', 'delivered', 'completed', 'cancelled');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      -- 'assigned' was added after booking_status first shipped — back-fill it on
      -- any DB that already had the type without this value (safe no-op otherwise).
      DO $$ BEGIN
        ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'assigned' AFTER 'confirmed';
      EXCEPTION WHEN others THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE truck_category AS ENUM ('small', 'medium', 'large', 'part');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE transport_type AS ENUM ('intra', 'inter');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE payment_status AS ENUM ('paid', 'pending', 'refunded');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      CREATE TABLE IF NOT EXISTS bookings (
        id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        booking_number      VARCHAR(20),
        client_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        broker_id           UUID REFERENCES users(id) ON DELETE SET NULL,
        driver_id           UUID REFERENCES users(id) ON DELETE SET NULL,
        truck_id            UUID,
        status              booking_status NOT NULL DEFAULT 'pending',
        pickup_location     TEXT NOT NULL,
        pickup_lat          NUMERIC(9,6),
        pickup_lng          NUMERIC(9,6),
        drop_location       TEXT NOT NULL,
        drop_lat            NUMERIC(9,6),
        drop_lng            NUMERIC(9,6),
        truck_type          TEXT,
        truck_category      truck_category,
        weight              NUMERIC(10,2),
        weight_unit         TEXT NOT NULL DEFAULT 'tons',
        quantity            INT,
        material            TEXT,
        transport_type      transport_type NOT NULL DEFAULT 'intra',
        scheduled_date      TIMESTAMPTZ,
        amount              NUMERIC(12,2),
        payment_status      payment_status NOT NULL DEFAULT 'pending',
        current_step        INT NOT NULL DEFAULT 0,
        pricing_breakdown   JSONB,
        rating              JSONB,
        distance            NUMERIC(8,2),
        platform_fee        NUMERIC(12,2),
        created_at          TIMESTAMPTZ DEFAULT NOW(),
        updated_at          TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS booking_timeline (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        booking_id   UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        step         TEXT NOT NULL,
        done         BOOLEAN NOT NULL DEFAULT FALSE,
        occurred_at  TIMESTAMPTZ,
        position     INT NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_bookings_client   ON bookings(client_id);
      CREATE INDEX IF NOT EXISTS idx_bookings_broker   ON bookings(broker_id);
      CREATE INDEX IF NOT EXISTS idx_bookings_driver   ON bookings(driver_id);
      CREATE INDEX IF NOT EXISTS idx_bookings_status   ON bookings(status);
      CREATE INDEX IF NOT EXISTS idx_booking_timeline_booking ON booking_timeline(booking_id);

      DROP TRIGGER IF EXISTS update_bookings_updated_at ON bookings;
      CREATE TRIGGER update_bookings_updated_at
        BEFORE UPDATE ON bookings
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);

    // ── VEHICLES (trucks + driver profiles) ──
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE truck_status AS ENUM ('available', 'on_trip', 'maintenance');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE driver_status AS ENUM ('available', 'on_trip', 'offline');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      CREATE TABLE IF NOT EXISTS trucks (
        id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        broker_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        driver_id         UUID REFERENCES users(id) ON DELETE SET NULL,
        registration      TEXT NOT NULL UNIQUE,
        type              TEXT,
        category          truck_category,
        capacity          TEXT,
        make              TEXT,
        year              INT,
        insurance_expiry  DATE,
        status            truck_status NOT NULL DEFAULT 'available',
        created_at        TIMESTAMPTZ DEFAULT NOW(),
        updated_at        TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS driver_profiles (
        user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        broker_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        license_no      TEXT,
        license_expiry  DATE,
        aadhaar         TEXT,
        truck_id        UUID REFERENCES trucks(id) ON DELETE SET NULL,
        total_trips     INT NOT NULL DEFAULT 0,
        avatar          TEXT,
        status          driver_status NOT NULL DEFAULT 'available',
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_trucks_broker           ON trucks(broker_id);
      CREATE INDEX IF NOT EXISTS idx_trucks_driver           ON trucks(driver_id);
      CREATE INDEX IF NOT EXISTS idx_driver_profiles_broker  ON driver_profiles(broker_id);
      CREATE INDEX IF NOT EXISTS idx_driver_profiles_truck   ON driver_profiles(truck_id);

      DROP TRIGGER IF EXISTS update_trucks_updated_at ON trucks;
      CREATE TRIGGER update_trucks_updated_at
        BEFORE UPDATE ON trucks
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

      DROP TRIGGER IF EXISTS update_driver_profiles_updated_at ON driver_profiles;
      CREATE TRIGGER update_driver_profiles_updated_at
        BEFORE UPDATE ON driver_profiles
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);

    // bookings.truck_id -> trucks(id): trucks table is created above (vehicles block runs after
    // bookings), so the FK is added here rather than inline on the bookings table.
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE bookings ADD CONSTRAINT fk_bookings_truck FOREIGN KEY (truck_id) REFERENCES trucks(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    // rating was added to the bookings table after it first shipped — the inline
    // column in CREATE TABLE IF NOT EXISTS above is a no-op on any DB that already
    // had the table, so back-fill it explicitly here.
    await client.query(`
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rating JSONB;
    `);

    // booking_number is a short human-readable reference (BKG-YYYYMM-NNN) shown in the UI
    // instead of the raw UUID. Same no-op-on-existing-table caveat as rating above.
    await client.query(`
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_number VARCHAR(20);
    `);

    // Back-fill any bookings created before booking_number existed, numbering them
    // sequentially within their creation month in chronological order.
    await client.query(`
      WITH numbered AS (
        SELECT id, 'BKG-' || TO_CHAR(created_at, 'YYYYMM') || '-' ||
               LPAD(ROW_NUMBER() OVER (PARTITION BY TO_CHAR(created_at, 'YYYYMM') ORDER BY created_at)::text, 3, '0') AS generated
        FROM bookings
        WHERE booking_number IS NULL
      )
      UPDATE bookings b SET booking_number = numbered.generated
      FROM numbered WHERE b.id = numbered.id;
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_booking_number ON bookings(booking_number);
    `);

    // ── JOBS + TRIPS ──
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE job_status AS ENUM ('pending', 'accepted', 'expired', 'declined');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      CREATE TABLE IF NOT EXISTS job_requests (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        booking_id   UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        broker_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        distance     NUMERIC(8,2),
        amount       NUMERIC(12,2),
        expires_at   TIMESTAMPTZ NOT NULL,
        status       job_status NOT NULL DEFAULT 'pending',
        created_at   TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS trips (
        id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        booking_id                  UUID NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
        driver_id                   UUID REFERENCES users(id) ON DELETE SET NULL,
        broker_id                   UUID REFERENCES users(id) ON DELETE SET NULL,
        status                      booking_status NOT NULL DEFAULT 'confirmed',
        pickup_contact_person       TEXT,
        pickup_contact_phone        TEXT,
        pickup_address              TEXT,
        pickup_time                 TIMESTAMPTZ,
        pickup_lat                  NUMERIC(9,6),
        pickup_lng                  NUMERIC(9,6),
        drop_contact_person         TEXT,
        drop_contact_phone          TEXT,
        drop_address                TEXT,
        drop_time                   TIMESTAMPTZ,
        drop_lat                    NUMERIC(9,6),
        drop_lng                    NUMERIC(9,6),
        distance                    NUMERIC(8,2),
        estimated_time              TEXT,
        cargo_material              TEXT,
        cargo_weight                NUMERIC(10,2),
        cargo_quantity              INT,
        cargo_special_instructions  TEXT,
        cargo_value                 NUMERIC(12,2),
        earnings                    NUMERIC(12,2),
        started_at                  TIMESTAMPTZ,
        current_lat                 NUMERIC(9,6),
        current_lng                 NUMERIC(9,6),
        pod_url                     TEXT,
        created_at                  TIMESTAMPTZ DEFAULT NOW(),
        updated_at                  TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS trip_timeline (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        trip_id      UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        step         TEXT NOT NULL,
        done         BOOLEAN NOT NULL DEFAULT FALSE,
        occurred_at  TIMESTAMPTZ,
        position     INT NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_job_requests_broker   ON job_requests(broker_id);
      CREATE INDEX IF NOT EXISTS idx_job_requests_status   ON job_requests(status);
      CREATE INDEX IF NOT EXISTS idx_trips_driver          ON trips(driver_id);
      CREATE INDEX IF NOT EXISTS idx_trips_broker          ON trips(broker_id);
      CREATE INDEX IF NOT EXISTS idx_trip_timeline_trip    ON trip_timeline(trip_id);

      DROP TRIGGER IF EXISTS update_trips_updated_at ON trips;
      CREATE TRIGGER update_trips_updated_at
        BEFORE UPDATE ON trips
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);

    // ── PAYMENTS (settlements) + DISPUTES ──
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE settlement_status AS ENUM ('paid', 'pending');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE dispute_status AS ENUM ('open', 'under_review', 'resolved');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE dispute_raised_by AS ENUM ('client', 'broker');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE dispute_issue_type AS ENUM (
          'damaged_goods', 'payment_delay', 'cancellation_fee', 'route_dispute',
          'late_delivery', 'fuel_surcharge', 'wrong_items', 'weight_discrepancy'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      CREATE TABLE IF NOT EXISTS settlements (
        id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        booking_id     UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        broker_id      UUID REFERENCES users(id) ON DELETE SET NULL,
        driver_id      UUID REFERENCES users(id) ON DELETE SET NULL,
        amount         NUMERIC(12,2) NOT NULL,
        platform_fee   NUMERIC(12,2) NOT NULL DEFAULT 0,
        net_earnings   NUMERIC(12,2) GENERATED ALWAYS AS (amount - platform_fee) STORED,
        status         settlement_status NOT NULL DEFAULT 'pending',
        settled_at     TIMESTAMPTZ,
        created_at     TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS disputes (
        id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        booking_id         UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        raised_by_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        raised_by_role     dispute_raised_by NOT NULL,
        issue_type         dispute_issue_type NOT NULL,
        description        TEXT NOT NULL,
        status             dispute_status NOT NULL DEFAULT 'open',
        resolution         TEXT,
        created_at         TIMESTAMPTZ DEFAULT NOW(),
        updated_at         TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_settlements_booking  ON settlements(booking_id);
      CREATE INDEX IF NOT EXISTS idx_settlements_broker   ON settlements(broker_id);
      CREATE INDEX IF NOT EXISTS idx_settlements_driver   ON settlements(driver_id);
      CREATE INDEX IF NOT EXISTS idx_disputes_booking     ON disputes(booking_id);
      CREATE INDEX IF NOT EXISTS idx_disputes_raised_by   ON disputes(raised_by_user_id);
      CREATE INDEX IF NOT EXISTS idx_disputes_status      ON disputes(status);

      DROP TRIGGER IF EXISTS update_disputes_updated_at ON disputes;
      CREATE TRIGGER update_disputes_updated_at
        BEFORE UPDATE ON disputes
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);

    // ── SETTINGS + PRICING (singleton config rows) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS pricing_config (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        config      JSONB NOT NULL,
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS admin_settings (
        id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        platform_name        TEXT NOT NULL DEFAULT 'SSK Logistics',
        contact_email        TEXT NOT NULL DEFAULT 'support@ssklogistics.in',
        commission_rate      NUMERIC(5,2) NOT NULL DEFAULT 10,
        email_alerts         BOOLEAN NOT NULL DEFAULT TRUE,
        sms_alerts           BOOLEAN NOT NULL DEFAULT TRUE,
        push_notifications   BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at           TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Fixed IDs so app code can address these singleton rows without a lookup query.
    await client.query(
      `INSERT INTO pricing_config (id, config)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [
        '00000000-0000-0000-0000-000000000001',
        JSON.stringify({
          intraCity: {
            small:  { baseFare: 500,  perKmRate: 25, platformFee: 0.10, waitingCharge: 100, demandMultiplier: 1 },
            medium: { baseFare: 800,  perKmRate: 35, platformFee: 0.10, waitingCharge: 150, demandMultiplier: 1 },
            large:  { baseFare: 1200, perKmRate: 45, platformFee: 0.10, waitingCharge: 200, demandMultiplier: 1 },
          },
          interCity: {
            baseRatePerKm: 40,
            fuelSurcharge: 0.15,
            tollHandling: 'fixed',
            tollFixedAmount: 500,
            platformFee: 0.08,
          },
          partTruck: {
            platformFee: 0.12,
          },
        }),
      ]
    );

    await client.query(
      `INSERT INTO admin_settings (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
      ['00000000-0000-0000-0000-000000000002']
    );

    // ── BROKER PROFILES (service zone + availability, mirrors db/13broker_profiles.sql) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS broker_profiles (
        user_id         UUID            PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        service_city    TEXT,
        is_online       BOOLEAN         NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMPTZ     DEFAULT NOW(),
        updated_at      TIMESTAMPTZ     DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_broker_profiles_service_city ON broker_profiles(service_city);

      DROP TRIGGER IF EXISTS update_broker_profiles_updated_at ON broker_profiles;
      CREATE TRIGGER update_broker_profiles_updated_at
        BEFORE UPDATE ON broker_profiles
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);

    // 'no_broker_available' was added after booking_status first shipped — same
    // defensive backfill pattern as 'assigned' above (own client.query call so the
    // ADD VALUE runs in its own implicit transaction).
    await client.query(`
      DO $$ BEGIN
        ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'no_broker_available';
      EXCEPTION WHEN others THEN NULL; END $$;
    `);

    // ── IDEMPOTENCY KEYS (mirrors db/14idempotency_keys.sql) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        idempotency_key    TEXT         NOT NULL,
        user_id            UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint           TEXT         NOT NULL,
        response_snapshot  JSONB        NOT NULL,
        created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_keys_unique
        ON idempotency_keys(idempotency_key, user_id, endpoint);
    `);

    // ── DRIVER LOCATION (live location on driver_profiles, mirrors db/12driver_location.sql) ──
    await client.query(`
      ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS current_lat NUMERIC(9,6);
      ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS current_lng NUMERIC(9,6);
      ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS last_location_at TIMESTAMPTZ;
    `);

    // ── TRIP INCIDENTS (mid-trip issue reporting, mirrors db/15trip_incidents.sql) ──
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE trip_incident_reason AS ENUM ('accident', 'breakdown', 'traffic_block', 'medical', 'other');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE trip_incident_status AS ENUM ('reported', 'acknowledged', 'resolved');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      CREATE TABLE IF NOT EXISTS trip_incidents (
        id            UUID                    PRIMARY KEY DEFAULT uuid_generate_v4(),
        trip_id       UUID                    NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        driver_id     UUID                    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reason        trip_incident_reason    NOT NULL,
        notes         TEXT,
        status        trip_incident_status    NOT NULL DEFAULT 'reported',
        reported_at   TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
        resolved_at   TIMESTAMPTZ,
        resolution    TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_trip_incidents_trip    ON trip_incidents(trip_id);
      CREATE INDEX IF NOT EXISTS idx_trip_incidents_driver  ON trip_incidents(driver_id);
      CREATE INDEX IF NOT EXISTS idx_trip_incidents_status  ON trip_incidents(status);
    `);

    // ── DISPUTE NUMBER (mirrors db/16dispute_number.sql) ──
    await client.query(`
      ALTER TABLE disputes ADD COLUMN IF NOT EXISTS dispute_number VARCHAR(20);
    `);

    // Back-fill any disputes created before dispute_number existed, numbering them
    // sequentially in chronological order.
    await client.query(`
      WITH numbered AS (
        SELECT id, 'DSP-' || LPAD(ROW_NUMBER() OVER (ORDER BY created_at)::text, 3, '0') AS generated
        FROM disputes
        WHERE dispute_number IS NULL
      )
      UPDATE disputes d SET dispute_number = numbered.generated
      FROM numbered WHERE d.id = numbered.id;
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_disputes_dispute_number ON disputes(dispute_number);
    `);

    // ── KYC FILES (uploaded document bytes when STORAGE_PROVIDER=postgres, mirrors db/17kyc_files.sql) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS kyc_files (
        id            UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id       UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        document_key  TEXT            NOT NULL,
        filename      TEXT            NOT NULL,
        mime_type     TEXT            NOT NULL,
        data          BYTEA           NOT NULL,
        created_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_kyc_files_user_id ON kyc_files(user_id);
    `);

    console.log('✅ Migrations complete!');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    throw err;
  }
};

const migrate = async () => {
  const client = await pool.connect();
  try {
    await runMigrations(client);
  } finally {
    client.release();
    await pool.end();
  }
};

if (require.main === module) {
  migrate().catch(() => process.exit(1));
}

module.exports = { runMigrations };

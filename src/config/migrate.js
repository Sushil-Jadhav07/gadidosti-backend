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

    // Client Rating's `rating` column was added to the bookings table after it first
    // shipped — the inline column in CREATE TABLE IF NOT EXISTS above is a no-op on any
    // DB that already had the table, so back-fill it explicitly here.
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
        expires_at   TIMESTAMPTZ,
        status       job_status NOT NULL DEFAULT 'pending',
        created_at   TIMESTAMPTZ DEFAULT NOW()
      );

      -- Job requests no longer expire; expires_at is a harmless nullable leftover column.
      ALTER TABLE job_requests ALTER COLUMN expires_at DROP NOT NULL;

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

    // ── PROOF OF DELIVERY ── Stores POD photo bytes the same way kyc_files does (bytea,
    // not local disk) for STORAGE_PROVIDER=postgres — see PostgresStorageProvider.js.
    // Served back out via GET /api/trips/pod/file/:id (trip.controller.js).
    await client.query(`
      CREATE TABLE IF NOT EXISTS pod_files (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        trip_id     UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        filename    TEXT,
        mime_type   TEXT,
        data        BYTEA NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_pod_files_trip ON pod_files(trip_id);
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

    // ── NEGOTIATION OFFERS (bid/counter-offer pricing, mirrors db/18negotiation_offers.sql) ──
    // 'countered' sits between 'pending' (awaiting broker) and 'accepted'/'declined' — a
    // job_request flips pending -> countered when a broker counters, and countered -> pending
    // when the client counters back, so the two sides take turns responding. Own client.query
    // call so the ADD VALUE runs in its own implicit transaction (same as 'assigned' above).
    await client.query(`
      DO $$ BEGIN
        ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'countered' AFTER 'pending';
      EXCEPTION WHEN others THEN NULL; END $$;
    `);

    await client.query(`
      ALTER TABLE job_requests ADD COLUMN IF NOT EXISTS offer_history JSONB NOT NULL DEFAULT '[]'::jsonb;
    `);

    // ── MECHANIC REQUESTS (breakdown assistance workflow, mirrors db/19mechanic_requests.sql) ──
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE mechanic_request_status AS ENUM ('requested', 'mechanic_assigned', 'in_progress', 'resolved');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      CREATE TABLE IF NOT EXISTS mechanic_requests (
        id                UUID                        PRIMARY KEY DEFAULT uuid_generate_v4(),
        trip_incident_id  UUID                        NOT NULL UNIQUE REFERENCES trip_incidents(id) ON DELETE CASCADE,
        status            mechanic_request_status     NOT NULL DEFAULT 'requested',
        mechanic_name     TEXT,
        mechanic_phone    TEXT,
        notes             TEXT,
        created_at        TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ                 NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_mechanic_requests_incident ON mechanic_requests(trip_incident_id);
      CREATE INDEX IF NOT EXISTS idx_mechanic_requests_status   ON mechanic_requests(status);

      DROP TRIGGER IF EXISTS update_mechanic_requests_updated_at ON mechanic_requests;
      CREATE TRIGGER update_mechanic_requests_updated_at
        BEFORE UPDATE ON mechanic_requests
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);

    // ── LIVE CHAT (chat_threads + chat_messages, mirrors db/20chat.sql) ──
    // One thread per booking; participants (client/broker/driver) are derived live from
    // bookings.client_id/broker_id/driver_id at access-check time, not duplicated here.
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_threads (
        id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
        booking_id  UUID          NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
        created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
        thread_id   UUID          NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
        sender_id   UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        message     TEXT          NOT NULL,
        read_at     TIMESTAMPTZ,
        created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_chat_messages_thread  ON chat_messages(thread_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_unread  ON chat_messages(thread_id, read_at) WHERE read_at IS NULL;
    `);

    // ── DELIVERY COMPLETION (multi-photo POD + driver QR + COD tracking, mirrors db/21delivery_completion.sql) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS trip_pod_photos (
        id            UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
        trip_id       UUID            NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        url           TEXT            NOT NULL,
        uploaded_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_trip_pod_photos_trip ON trip_pod_photos(trip_id);

      ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS payment_qr_url TEXT;

      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_mode TEXT;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

      -- Free-text notes the client leaves at booking time (special instructions, requested
      -- add-on services like "Helper Required") — previously only lived in the client app's
      -- form state and was never actually sent to or stored by the API.
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS notes TEXT;
    `);

    // ── BOOKING CITY (mirrors db/22booking_city.sql) ──
    // The single city both pickup_location and drop_location must fall within for an
    // intra-city booking (enforced in booking.validation.js) — null for inter-city bookings,
    // which cross city lines by definition and have no single "city" to record.
    await client.query(`
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS city TEXT;
    `);

    // ── BOOKING EXTRA STOPS + NOTHING REQUIRED (mirrors db/23booking_stops.sql) ──
    // Extra pickup/drop stops beyond the single pickup_location/drop_location pair — e.g.
    // picking up from two warehouses before heading to drop. Each is a JSONB array of
    // { location, lat, lng } objects; defaults to an empty array rather than null so callers
    // never have to null-check before iterating.
    // Also drops the NOT NULL constraint on pickup_location/drop_location — createBookingValidation
    // no longer requires either, and the DB constraint has to match or every omitted-location
    // booking would 500 on insert instead of saving.
    await client.query(`
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS loading_locations JSONB NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS unloading_locations JSONB NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE bookings ALTER COLUMN pickup_location DROP NOT NULL;
      ALTER TABLE bookings ALTER COLUMN drop_location DROP NOT NULL;
    `);

    // ── DRIVER ASSIGNMENT TIMEOUT (mirrors db/24driver_timeout.sql) ──
    // Marks when the "driver not available" notification was sent for a booking stuck in
    // 'confirmed' (client accepted a broker) with no driver assigned 5+ minutes later — see
    // src/cron/driverAssignmentTimeoutSweep.js. Kept null until sent so the sweep (running
    // every minute) never notifies the same booking twice.
    await client.query(`
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS driver_timeout_notified_at TIMESTAMPTZ;
    `);

    // ── DRIVER REQUESTS (mirrors db/25driver_requests.sql) ──
    // Parallel path to job_requests (broker-broadcast negotiation) — this one is for a client
    // who picks a specific truck+driver directly off GET /api/vehicles/trucks/nearby instead
    // of waiting for brokers to respond to a broadcast. Mirrors job_requests' shape (status
    // enum, offer_history) deliberately, just client<->driver instead of client<->broker.
    await client.query(`
      DO $$ BEGIN
          CREATE TYPE driver_request_status AS ENUM ('pending', 'countered', 'accepted', 'declined');
      EXCEPTION
          WHEN duplicate_object THEN RAISE NOTICE 'Type driver_request_status already exists, skipping.';
      END $$;

      CREATE TABLE IF NOT EXISTS driver_requests (
          id                  UUID                    PRIMARY KEY DEFAULT uuid_generate_v4(),
          booking_id          UUID                    NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
          truck_id            UUID                    NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
          driver_id           UUID                    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          broker_id           UUID                    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          amount              NUMERIC(12,2),
          status              driver_request_status  NOT NULL DEFAULT 'pending',
          offer_history       JSONB                   NOT NULL DEFAULT '[]'::jsonb,
          driver_timeout_at   TIMESTAMPTZ,
          created_at          TIMESTAMPTZ             DEFAULT NOW(),
          updated_at          TIMESTAMPTZ             DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_driver_requests_booking ON driver_requests(booking_id);
      CREATE INDEX IF NOT EXISTS idx_driver_requests_driver  ON driver_requests(driver_id);
      CREATE INDEX IF NOT EXISTS idx_driver_requests_broker  ON driver_requests(broker_id);
      CREATE INDEX IF NOT EXISTS idx_driver_requests_timeout_sweep
          ON driver_requests(status, driver_timeout_at, updated_at);

      DROP TRIGGER IF EXISTS update_driver_requests_updated_at ON driver_requests;
      CREATE TRIGGER update_driver_requests_updated_at
          BEFORE UPDATE ON driver_requests
          FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);

    // ── BOOKING SOFT DELETE (mirrors db/26booking_soft_delete.sql) ──
    // Broker/driver "delete" is a soft hide (deleted_at set) — never removes the row, so it
    // stays fully visible to admin (GET /api/bookings ignores deleted_at for role='admin').
    // Only DELETE /api/bookings/:id called by an actual admin does a real DELETE FROM.
    // deleted_by records who hid it (the broker_id owner — see booking.controller.js's
    // deleteBooking, which uses this same broker_id match for both a real broker and a
    // self-registered driver who is their own broker_id).
    await client.query(`
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;
    `);

    // ── DEVICE TOKENS (mirrors db/27device_tokens.sql) ──
    // One row per device a user is logged into — token is globally unique; re-registering it
    // (e.g. a different account logs into the same device) reassigns user_id via ON CONFLICT
    // rather than erroring. Also adds driver_profiles.stale_notified_at, which debounces the
    // "driver's live location has gone stale mid-trip" notification (see
    // src/cron/staleDriverLocationSweep.js) so it's sent once per stale period, not every tick.
    await client.query(`
      CREATE TABLE IF NOT EXISTS device_tokens (
          id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
          user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token       TEXT         NOT NULL UNIQUE,
          platform    TEXT,
          created_at  TIMESTAMPTZ  DEFAULT NOW(),
          updated_at  TIMESTAMPTZ  DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);

      ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS stale_notified_at TIMESTAMPTZ;
    `);

    // ── DRIVER REQUESTS: LINK TO BROKER-ASSIGN ORIGIN (mirrors db/28_driver_request_job_link.sql) ──
    // Distinguishes the two origins a driver_requests row can come from: NULL = direct
    // client-pick (client chose the truck themselves), set = broker-assign (broker picked the
    // driver from their fleet for an already-negotiated job_requests booking). Needed so
    // decline/expiry notifications go to the right party — see driverRequest.controller.js and
    // driverRequestTimeoutSweep.js's brokerSweep.
    await client.query(`
      ALTER TABLE driver_requests ADD COLUMN IF NOT EXISTS job_request_id UUID REFERENCES job_requests(id) ON DELETE CASCADE;

      CREATE INDEX IF NOT EXISTS idx_driver_requests_job_request ON driver_requests(job_request_id);
    `);

    // ── TRIP DELIVERED_AT (mirrors db/29trip_delivered_at.sql) ──
    // Set once, the first time a trip's status moves to 'delivered' — same one-time-write
    // pattern trips.started_at already uses. Lets "time taken" be computed as
    // delivered_at - started_at (see trip.controller.js's projectTrip).
    await client.query(`
      ALTER TABLE trips ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
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

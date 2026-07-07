require('dotenv').config();
const pool = require('./db');
const bcrypt = require('bcryptjs');

const seed = async () => {
  const client = await pool.connect();
  try {
    console.log('🌱 Seeding database...');

    const passwordHash = await bcrypt.hash('Admin@123456', 12);

    await client.query(`
      INSERT INTO users (name, email, phone, password_hash, role, status, is_phone_verified, is_email_verified)
      VALUES
        ('Super Admin',   'admin@ssklogistics.in',   '9000000001', $1, 'admin',  'active', true, true),
        ('Test Client',   'client@ssklogistics.in',  '9000000002', $1, 'client', 'active', true, true),
        ('Test Broker',   'broker@ssklogistics.in',  '9000000003', $1, 'broker', 'active', true, true),
        ('Test Driver',   'driver@ssklogistics.in',  '9000000004', $1, 'driver', 'active', true, true),
        ('Agarwal Transport', 'agarwal.broker@ssklogistics.in', '9000000005', $1, 'broker', 'active', true, true),
        ('Ramesh Yadav',      'ramesh.driver@ssklogistics.in',  '9000000006', $1, 'driver', 'active', true, true),
        ('Suresh Patil',      'suresh.driver@ssklogistics.in',  '9000000007', $1, 'driver', 'active', true, true)
      ON CONFLICT (phone) DO NOTHING;
    `, [passwordHash]);

    // ── Trucks + driver profiles (broker fleet test data) ──
    // Wrapped in a DO block so it's a no-op on re-run (registration is UNIQUE).
    await client.query(`
      DO $$
      DECLARE
        v_broker1   UUID := (SELECT id FROM users WHERE phone = '9000000003');
        v_broker2   UUID := (SELECT id FROM users WHERE phone = '9000000005');
        v_driver1   UUID := (SELECT id FROM users WHERE phone = '9000000004');
        v_driver2   UUID := (SELECT id FROM users WHERE phone = '9000000006');
        v_driver3   UUID := (SELECT id FROM users WHERE phone = '9000000007');
        v_truck1    UUID;
        v_truck2    UUID;
        v_truck3    UUID;
        v_truck4    UUID;
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM trucks WHERE registration = 'MH-12-AB-1234') THEN
          INSERT INTO trucks (broker_id, driver_id, registration, type, category, capacity, make, year, insurance_expiry, status)
          VALUES (v_broker1, v_driver1, 'MH-12-AB-1234', 'Medium Truck', 'medium', '5 Tons', 'Tata Ace', 2021, CURRENT_DATE + INTERVAL '90 days', 'on_trip')
          RETURNING id INTO v_truck1;

          INSERT INTO trucks (broker_id, driver_id, registration, type, category, capacity, make, year, insurance_expiry, status)
          VALUES (v_broker1, v_driver2, 'MH-14-CD-5678', 'Large Truck', 'large', '10 Tons', 'Ashok Leyland', 2020, CURRENT_DATE + INTERVAL '20 days', 'available')
          RETURNING id INTO v_truck2;

          INSERT INTO trucks (broker_id, driver_id, registration, type, category, capacity, make, year, insurance_expiry, status)
          VALUES (v_broker2, v_driver3, 'GJ-01-EF-9012', 'Small Truck', 'small', '1.5 Tons', 'Mahindra Bolero', 2022, CURRENT_DATE + INTERVAL '200 days', 'maintenance')
          RETURNING id INTO v_truck3;

          INSERT INTO trucks (broker_id, driver_id, registration, type, category, capacity, make, year, insurance_expiry, status)
          VALUES (v_broker2, NULL, 'GJ-05-GH-3456', 'Part Truck', 'part', '2 Tons', 'Eicher Pro', 2023, CURRENT_DATE - INTERVAL '10 days', 'available')
          RETURNING id INTO v_truck4;

          INSERT INTO driver_profiles (user_id, broker_id, license_no, license_expiry, aadhaar, truck_id, total_trips, status)
          VALUES
            (v_driver1, v_broker1, 'MH2020123456789', CURRENT_DATE + INTERVAL '400 days', '123456789012', v_truck1, 142, 'on_trip'),
            (v_driver2, v_broker1, 'MH2019987654321', CURRENT_DATE + INTERVAL '45 days',  '234567890123', v_truck2, 87,  'available'),
            (v_driver3, v_broker2, 'GJ2021445566778', CURRENT_DATE + INTERVAL '600 days', '345678901234', v_truck3, 23,  'offline')
          ON CONFLICT (user_id) DO NOTHING;
        END IF;
      END $$;
    `);

    console.log('✅ Seed complete!');
    console.log('   Admin   → phone: 9000000001 | password: Admin@123456');
    console.log('   Client  → phone: 9000000002 | password: Admin@123456');
    console.log('   Broker  → phone: 9000000003 | password: Admin@123456');
    console.log('   Driver  → phone: 9000000004 | password: Admin@123456');
    console.log('   + 2nd broker, 2 more drivers, and 4 test trucks (see src/config/seed.js)');
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
};

seed();

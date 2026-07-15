require('dotenv').config();
const pool = require('./db');
const bcrypt = require('bcryptjs');

const IDS = {
  bookings: {
    pending: '20000000-0000-0000-0000-000000000001',
    request: '20000000-0000-0000-0000-000000000002',
    accepted: '20000000-0000-0000-0000-000000000003',
    active: '20000000-0000-0000-0000-000000000004',
    completed: '20000000-0000-0000-0000-000000000005',
    cancelled: '20000000-0000-0000-0000-000000000006',
  },
  trips: {
    active: '30000000-0000-0000-0000-000000000001',
    completed: '30000000-0000-0000-0000-000000000002',
  },
  jobs: {
    pending: '40000000-0000-0000-0000-000000000001',
    accepted: '40000000-0000-0000-0000-000000000002',
  },
  settlements: {
    completed: '50000000-0000-0000-0000-000000000001',
  },
  disputes: {
    open: '60000000-0000-0000-0000-000000000001',
    resolved: '60000000-0000-0000-0000-000000000002',
  },
  notifications: {
    broker: '70000000-0000-0000-0000-000000000001',
    driver: '70000000-0000-0000-0000-000000000002',
    client: '70000000-0000-0000-0000-000000000003',
  },
};

// Second dataset — seeds the ad-hoc accounts created via real sign-up during manual browser
// testing (broker@gmail.com / driver@gmail.com / client@gmail.com), which otherwise have zero
// trucks/drivers/bookings and show empty states everywhere in the UI.
const IDS2 = {
  bookings: {
    pending: '80000000-0000-0000-0000-000000000001',
    confirmed: '80000000-0000-0000-0000-000000000002',
    active: '80000000-0000-0000-0000-000000000003',
    completedLastMonth: '80000000-0000-0000-0000-000000000004',
    completedTwoMonthsAgo: '80000000-0000-0000-0000-000000000005',
    cancelled: '80000000-0000-0000-0000-000000000006',
  },
  trips: {
    active: '90000000-0000-0000-0000-000000000001',
    completedLastMonth: '90000000-0000-0000-0000-000000000002',
    completedTwoMonthsAgo: '90000000-0000-0000-0000-000000000003',
  },
  jobs: {
    pending: 'a0000000-0000-0000-0000-000000000001',
    accepted: 'a0000000-0000-0000-0000-000000000002',
  },
  settlements: {
    lastMonth: 'b0000000-0000-0000-0000-000000000001',
    twoMonthsAgo: 'b0000000-0000-0000-0000-000000000002',
  },
  notifications: {
    broker: 'c0000000-0000-0000-0000-000000000001',
    driver: 'c0000000-0000-0000-0000-000000000002',
    client: 'c0000000-0000-0000-0000-000000000003',
  },
};

const seed = async () => {
  const client = await pool.connect();

  try {
    console.log('Seeding demo data...');
    await client.query('BEGIN');

    const passwordHash = await bcrypt.hash('Admin@123456', 12);

    await client.query(
      `
      INSERT INTO users (name, email, phone, password_hash, role, status, is_phone_verified, is_email_verified, address, company_name)
      VALUES
        ('Super Admin', 'admin@ssklogistics.in', '9000000001', $1, 'admin', 'active', true, true, 'Mumbai HQ', 'SSK Logistics'),
        ('Test Client', 'client@ssklogistics.in', '9000000002', $1, 'client', 'active', true, true, 'Powai, Mumbai', NULL),
        ('Test Broker', 'broker@ssklogistics.in', '9000000003', $1, 'broker', 'active', true, true, 'Bhosari, Pune', 'GadiDost Fleet One'),
        ('Test Driver', 'driver@ssklogistics.in', '9000000004', $1, 'driver', 'active', true, true, 'Pimpri, Pune', NULL),
        ('Agarwal Transport', 'agarwal.broker@ssklogistics.in', '9000000005', $1, 'broker', 'active', true, true, 'Narol, Ahmedabad', 'Agarwal Transport'),
        ('Ramesh Yadav', 'ramesh.driver@ssklogistics.in', '9000000006', $1, 'driver', 'active', true, true, 'Nigdi, Pune', NULL),
        ('Suresh Patil', 'suresh.driver@ssklogistics.in', '9000000007', $1, 'driver', 'active', true, true, 'Vapi, Gujarat', NULL)
      ON CONFLICT (phone) DO UPDATE
      SET
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        password_hash = EXCLUDED.password_hash,
        role = EXCLUDED.role,
        status = EXCLUDED.status,
        is_phone_verified = EXCLUDED.is_phone_verified,
        is_email_verified = EXCLUDED.is_email_verified,
        address = EXCLUDED.address,
        company_name = EXCLUDED.company_name
      `,
      [passwordHash]
    );

    const userResult = await client.query(`
      SELECT phone, id FROM users
      WHERE phone IN ('9000000001', '9000000002', '9000000003', '9000000004', '9000000005', '9000000006', '9000000007')
    `);
    const usersByPhone = Object.fromEntries(userResult.rows.map((row) => [row.phone, row.id]));

    await client.query(
      `
      UPDATE users
      SET kyc_status = CASE
        WHEN role IN ('broker', 'driver') THEN 'verified'
        ELSE kyc_status
      END
      WHERE phone IN ('9000000003', '9000000004', '9000000005', '9000000006', '9000000007')
      `
    );

    await client.query(
      `
      INSERT INTO kyc_submissions (user_id, documents, reviewed_by, reviewed_at)
      VALUES
        ($1, '{"pan_number":"AABCT1234C","aadhaar_number":"XXXX-XXXX-1001","gst_number":"27AABCT1234C1Z5","bank_account_number":"50100123456789","business_registration_number":"U60200MH2019PTC123456"}'::jsonb, $2, NOW() - INTERVAL '12 days'),
        ($3, '{"license_number":"MH2020123456789","aadhaar_number":"XXXX-XXXX-1002","vehicle_registration_number":"MH-12-AB-1234","vehicle_insurance_number":"INS-2024-100001"}'::jsonb, $2, NOW() - INTERVAL '12 days'),
        ($4, '{"pan_number":"AAECA5678D","aadhaar_number":"XXXX-XXXX-1003","gst_number":"24AAECA5678D1Z2","bank_account_number":"50200234567890","business_registration_number":"U60200GJ2018PTC098765"}'::jsonb, $2, NOW() - INTERVAL '11 days'),
        ($5, '{"license_number":"MH2019987654321","aadhaar_number":"XXXX-XXXX-1004","vehicle_registration_number":"MH-14-CD-5678","vehicle_insurance_number":"INS-2024-100002"}'::jsonb, $2, NOW() - INTERVAL '10 days'),
        ($6, '{"license_number":"GJ2021445566778","aadhaar_number":"XXXX-XXXX-1005","vehicle_registration_number":"GJ-01-EF-9012","vehicle_insurance_number":"INS-2024-100003"}'::jsonb, $2, NOW() - INTERVAL '9 days')
      ON CONFLICT (user_id) DO UPDATE
      SET documents = EXCLUDED.documents, reviewed_by = EXCLUDED.reviewed_by, reviewed_at = EXCLUDED.reviewed_at, updated_at = NOW()
      `,
      [
        usersByPhone['9000000003'],
        usersByPhone['9000000001'],
        usersByPhone['9000000004'],
        usersByPhone['9000000005'],
        usersByPhone['9000000006'],
        usersByPhone['9000000007'],
      ]
    );

    await client.query(
      `
      INSERT INTO trucks (broker_id, driver_id, registration, type, category, capacity, make, year, insurance_expiry, status)
      VALUES
        ($1, $2, 'MH-12-AB-1234', 'Medium Truck', 'medium', '5 Tons', 'Tata 407', 2021, CURRENT_DATE + INTERVAL '120 days', 'on_trip'),
        ($1, $3, 'MH-14-CD-5678', 'Large Truck', 'large', '10 Tons', 'Ashok Leyland', 2020, CURRENT_DATE + INTERVAL '45 days', 'available'),
        ($4, $5, 'GJ-01-EF-9012', 'Small Truck', 'small', '1.5 Tons', 'Mahindra Bolero', 2022, CURRENT_DATE + INTERVAL '200 days', 'maintenance'),
        ($4, NULL, 'GJ-05-GH-3456', 'Part Truck', 'part', '2 Tons', 'Eicher Pro', 2023, CURRENT_DATE + INTERVAL '300 days', 'available')
      ON CONFLICT (registration) DO UPDATE
      SET
        broker_id = EXCLUDED.broker_id,
        driver_id = EXCLUDED.driver_id,
        type = EXCLUDED.type,
        category = EXCLUDED.category,
        capacity = EXCLUDED.capacity,
        make = EXCLUDED.make,
        year = EXCLUDED.year,
        insurance_expiry = EXCLUDED.insurance_expiry,
        status = EXCLUDED.status
      `,
      [
        usersByPhone['9000000003'],
        usersByPhone['9000000004'],
        usersByPhone['9000000006'],
        usersByPhone['9000000005'],
        usersByPhone['9000000007'],
      ]
    );

    const truckResult = await client.query(`
      SELECT id, registration FROM trucks
      WHERE registration IN ('MH-12-AB-1234', 'MH-14-CD-5678', 'GJ-01-EF-9012', 'GJ-05-GH-3456')
    `);
    const truckIds = Object.fromEntries(truckResult.rows.map((row) => [row.registration, row.id]));

    await client.query(
      `
      INSERT INTO driver_profiles (user_id, broker_id, license_no, license_expiry, aadhaar, truck_id, total_trips, avatar, status)
      VALUES
        ($1, $4, 'MH2020123456789', CURRENT_DATE + INTERVAL '400 days', '123456789012', $6, 142, NULL, 'on_trip'),
        ($2, $4, 'MH2019987654321', CURRENT_DATE + INTERVAL '180 days', '234567890123', $7, 87, NULL, 'available'),
        ($3, $5, 'GJ2021445566778', CURRENT_DATE + INTERVAL '600 days', '345678901234', $8, 23, NULL, 'offline')
      ON CONFLICT (user_id) DO UPDATE
      SET
        broker_id = EXCLUDED.broker_id,
        license_no = EXCLUDED.license_no,
        license_expiry = EXCLUDED.license_expiry,
        aadhaar = EXCLUDED.aadhaar,
        truck_id = EXCLUDED.truck_id,
        total_trips = EXCLUDED.total_trips,
        status = EXCLUDED.status,
        updated_at = NOW()
      `,
      [
        usersByPhone['9000000004'],
        usersByPhone['9000000006'],
        usersByPhone['9000000007'],
        usersByPhone['9000000003'],
        usersByPhone['9000000005'],
        truckIds['MH-12-AB-1234'],
        truckIds['MH-14-CD-5678'],
        truckIds['GJ-01-EF-9012'],
      ]
    );

    const bookingRows = [
      {
        id: IDS.bookings.pending,
        bookingNumber: 'BKG-SEED-001',
        brokerId: null,
        driverId: null,
        truckId: null,
        status: 'pending',
        pickup: 'Mumbai',
        drop: 'Pune',
        truckType: 'Tata Ace / Pickup',
        truckCategory: 'small',
        weight: 1.0,
        quantity: 18,
        material: 'Electronics',
        transportType: 'intra',
        scheduledDate: "NOW() + INTERVAL '1 day'",
        amount: 4200,
        paymentStatus: 'pending',
        currentStep: 0,
        distance: 150,
        platformFee: 420,
        pricing: '{"baseFare":500,"distanceFare":3200,"platformFee":420,"total":4200}',
      },
      {
        id: IDS.bookings.request,
        bookingNumber: 'BKG-SEED-002',
        brokerId: usersByPhone['9000000003'],
        driverId: null,
        truckId: null,
        status: 'pending',
        pickup: 'Pune',
        drop: 'Nashik',
        truckType: 'Medium Truck',
        truckCategory: 'medium',
        weight: 3.5,
        quantity: 42,
        material: 'FMCG',
        transportType: 'inter',
        scheduledDate: "NOW() + INTERVAL '2 days'",
        amount: 8650,
        paymentStatus: 'pending',
        currentStep: 0,
        distance: 210,
        platformFee: 692,
        pricing: '{"distanceFare":7350,"platformFee":692,"total":8650}',
      },
      {
        id: IDS.bookings.accepted,
        bookingNumber: 'BKG-SEED-003',
        brokerId: usersByPhone['9000000003'],
        driverId: null,
        truckId: null,
        status: 'confirmed',
        pickup: 'Delhi',
        drop: 'Jaipur',
        truckType: 'Large Truck',
        truckCategory: 'large',
        weight: 8.5,
        quantity: 65,
        material: 'Construction',
        transportType: 'inter',
        scheduledDate: "NOW() + INTERVAL '10 hours'",
        amount: 14200,
        paymentStatus: 'pending',
        currentStep: 1,
        distance: 280,
        platformFee: 1136,
        pricing: '{"distanceFare":12564,"platformFee":1136,"total":14200}',
      },
      {
        id: IDS.bookings.active,
        bookingNumber: 'BKG-SEED-004',
        brokerId: usersByPhone['9000000003'],
        driverId: usersByPhone['9000000004'],
        truckId: truckIds['MH-12-AB-1234'],
        status: 'in_transit',
        pickup: 'Mumbai',
        drop: 'Surat',
        truckType: 'Medium Truck',
        truckCategory: 'medium',
        weight: 4.5,
        quantity: 30,
        material: 'Pharma Products',
        transportType: 'inter',
        scheduledDate: "NOW() - INTERVAL '4 hours'",
        amount: 18250,
        paymentStatus: 'paid',
        currentStep: 5,
        distance: 280,
        platformFee: 1460,
        pricing: '{"distanceFare":16790,"platformFee":1460,"total":18250}',
      },
      {
        id: IDS.bookings.completed,
        bookingNumber: 'BKG-SEED-005',
        brokerId: usersByPhone['9000000003'],
        driverId: usersByPhone['9000000006'],
        truckId: truckIds['MH-14-CD-5678'],
        status: 'completed',
        pickup: 'Bengaluru',
        drop: 'Chennai',
        truckType: 'Large Truck',
        truckCategory: 'large',
        weight: 6.8,
        quantity: 26,
        material: 'Auto Parts',
        transportType: 'inter',
        scheduledDate: "NOW() - INTERVAL '6 days'",
        amount: 22400,
        paymentStatus: 'paid',
        currentStep: 7,
        distance: 350,
        platformFee: 1792,
        pricing: '{"distanceFare":20608,"platformFee":1792,"total":22400}',
      },
      {
        id: IDS.bookings.cancelled,
        bookingNumber: 'BKG-SEED-006',
        brokerId: usersByPhone['9000000005'],
        driverId: null,
        truckId: null,
        status: 'cancelled',
        pickup: 'Hyderabad',
        drop: 'Chennai',
        truckType: 'Part Truck',
        truckCategory: 'part',
        weight: 1.2,
        quantity: 14,
        material: 'Textiles',
        transportType: 'inter',
        scheduledDate: "NOW() - INTERVAL '2 days'",
        amount: 6400,
        paymentStatus: 'refunded',
        currentStep: 0,
        distance: 630,
        platformFee: 768,
        pricing: '{"distanceFare":5632,"platformFee":768,"total":6400}',
      },
    ];

    for (const booking of bookingRows) {
      await client.query(
        `
        INSERT INTO bookings (
          id, booking_number, client_id, broker_id, driver_id, truck_id, status, pickup_location, drop_location,
          truck_type, truck_category, weight, weight_unit, quantity, material, transport_type,
          scheduled_date, amount, payment_status, current_step, pricing_breakdown, distance, platform_fee,
          created_at, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, 'tons', $13, $14, $15,
          ${booking.scheduledDate}, $16, $17, $18, $19::jsonb, $20, $21,
          ${booking.scheduledDate}, NOW()
        )
        ON CONFLICT (id) DO UPDATE
        SET
          booking_number = COALESCE(bookings.booking_number, EXCLUDED.booking_number),
          client_id = EXCLUDED.client_id,
          broker_id = EXCLUDED.broker_id,
          driver_id = EXCLUDED.driver_id,
          truck_id = EXCLUDED.truck_id,
          status = EXCLUDED.status,
          pickup_location = EXCLUDED.pickup_location,
          drop_location = EXCLUDED.drop_location,
          truck_type = EXCLUDED.truck_type,
          truck_category = EXCLUDED.truck_category,
          weight = EXCLUDED.weight,
          quantity = EXCLUDED.quantity,
          material = EXCLUDED.material,
          transport_type = EXCLUDED.transport_type,
          scheduled_date = EXCLUDED.scheduled_date,
          amount = EXCLUDED.amount,
          payment_status = EXCLUDED.payment_status,
          current_step = EXCLUDED.current_step,
          pricing_breakdown = EXCLUDED.pricing_breakdown,
          distance = EXCLUDED.distance,
          platform_fee = EXCLUDED.platform_fee,
          updated_at = NOW()
        `,
        [
          booking.id,
          booking.bookingNumber,
          usersByPhone['9000000002'],
          booking.brokerId,
          booking.driverId,
          booking.truckId,
          booking.status,
          booking.pickup,
          booking.drop,
          booking.truckType,
          booking.truckCategory,
          booking.weight,
          booking.quantity,
          booking.material,
          booking.transportType,
          booking.amount,
          booking.paymentStatus,
          booking.currentStep,
          booking.pricing,
          booking.distance,
          booking.platformFee,
        ]
      );
    }

    await client.query(`DELETE FROM booking_timeline WHERE booking_id = ANY($1::uuid[])`, [Object.values(IDS.bookings)]);
    const bookingTimelineRows = [
      [IDS.bookings.pending, 'pending', true, 0, "NOW() - INTERVAL '2 hours'"],
      [IDS.bookings.request, 'pending', true, 0, "NOW() - INTERVAL '3 hours'"],
      [IDS.bookings.accepted, 'pending', true, 0, "NOW() - INTERVAL '1 day'"],
      [IDS.bookings.accepted, 'confirmed', true, 1, "NOW() - INTERVAL '22 hours'"],
      [IDS.bookings.active, 'pending', true, 0, "NOW() - INTERVAL '8 hours'"],
      [IDS.bookings.active, 'confirmed', true, 1, "NOW() - INTERVAL '7 hours'"],
      [IDS.bookings.active, 'assigned', true, 2, "NOW() - INTERVAL '6 hours'"],
      [IDS.bookings.active, 'en_route_pickup', true, 3, "NOW() - INTERVAL '5 hours'"],
      [IDS.bookings.active, 'picked_up', true, 4, "NOW() - INTERVAL '4 hours'"],
      [IDS.bookings.active, 'in_transit', true, 5, "NOW() - INTERVAL '3 hours'"],
      [IDS.bookings.completed, 'pending', true, 0, "NOW() - INTERVAL '8 days'"],
      [IDS.bookings.completed, 'confirmed', true, 1, "NOW() - INTERVAL '7 days 20 hours'"],
      [IDS.bookings.completed, 'assigned', true, 2, "NOW() - INTERVAL '7 days 18 hours'"],
      [IDS.bookings.completed, 'en_route_pickup', true, 3, "NOW() - INTERVAL '7 days 16 hours'"],
      [IDS.bookings.completed, 'picked_up', true, 4, "NOW() - INTERVAL '7 days 14 hours'"],
      [IDS.bookings.completed, 'in_transit', true, 5, "NOW() - INTERVAL '7 days 10 hours'"],
      [IDS.bookings.completed, 'delivered', true, 6, "NOW() - INTERVAL '7 days 5 hours'"],
      [IDS.bookings.completed, 'completed', true, 7, "NOW() - INTERVAL '7 days 4 hours'"],
      [IDS.bookings.cancelled, 'pending', true, 0, "NOW() - INTERVAL '3 days'"],
      [IDS.bookings.cancelled, 'cancelled', true, 99, "NOW() - INTERVAL '2 days 20 hours'"],
    ];
    for (const [bookingId, step, done, position, occurredAt] of bookingTimelineRows) {
      await client.query(
        `INSERT INTO booking_timeline (booking_id, step, done, occurred_at, position) VALUES ($1, $2, $3, ${occurredAt}, $4)`,
        [bookingId, step, done, position]
      );
    }

    await client.query(
      `
      INSERT INTO job_requests (id, booking_id, broker_id, distance, amount, status, created_at)
      VALUES
        ($1, $3, $5, 210, 8650, 'pending', NOW() - INTERVAL '30 minutes'),
        ($2, $4, $5, 280, 14200, 'accepted', NOW() - INTERVAL '1 day')
      ON CONFLICT (id) DO UPDATE
      SET
        booking_id = EXCLUDED.booking_id,
        broker_id = EXCLUDED.broker_id,
        distance = EXCLUDED.distance,
        amount = EXCLUDED.amount,
        status = EXCLUDED.status,
        created_at = EXCLUDED.created_at
      `,
      [
        IDS.jobs.pending,
        IDS.jobs.accepted,
        IDS.bookings.request,
        IDS.bookings.accepted,
        usersByPhone['9000000003'],
      ]
    );

    await client.query(
      `
      INSERT INTO trips (
        id, booking_id, driver_id, broker_id, status,
        pickup_contact_person, pickup_contact_phone, pickup_address, pickup_time,
        drop_contact_person, drop_contact_phone, drop_address, drop_time,
        distance, estimated_time, cargo_material, cargo_weight, cargo_quantity, cargo_special_instructions, cargo_value, earnings,
        started_at, current_lat, current_lng, created_at, updated_at
      )
      VALUES
        (
          $1, $3, $5, $7, 'in_transit',
          'Warehouse Manager', '9876543210', 'Mumbai', NOW() - INTERVAL '5 hours',
          'Surat Pharma Hub', '9876500001', 'Surat', NOW() + INTERVAL '3 hours',
          280, '5h 30m', 'Pharma Products', 4.5, 30, 'Handle with care', 18250, 16790,
          NOW() - INTERVAL '4 hours', 21.1702, 72.8311, NOW() - INTERVAL '5 hours', NOW()
        ),
        (
          $2, $4, $6, $7, 'completed',
          'Factory Supervisor', '9988776655', 'Bengaluru', NOW() - INTERVAL '7 days 16 hours',
          'Plant Receiver', '9988776656', 'Chennai', NOW() - INTERVAL '7 days 4 hours',
          350, '6h 10m', 'Auto Parts', 6.8, 26, 'Unload at Bay 4', 22400, 20608,
          NOW() - INTERVAL '7 days 15 hours', 13.0827, 80.2707, NOW() - INTERVAL '7 days 16 hours', NOW()
        )
      ON CONFLICT (id) DO UPDATE
      SET
        booking_id = EXCLUDED.booking_id,
        driver_id = EXCLUDED.driver_id,
        broker_id = EXCLUDED.broker_id,
        status = EXCLUDED.status,
        pickup_contact_person = EXCLUDED.pickup_contact_person,
        pickup_contact_phone = EXCLUDED.pickup_contact_phone,
        pickup_address = EXCLUDED.pickup_address,
        pickup_time = EXCLUDED.pickup_time,
        drop_contact_person = EXCLUDED.drop_contact_person,
        drop_contact_phone = EXCLUDED.drop_contact_phone,
        drop_address = EXCLUDED.drop_address,
        drop_time = EXCLUDED.drop_time,
        distance = EXCLUDED.distance,
        estimated_time = EXCLUDED.estimated_time,
        cargo_material = EXCLUDED.cargo_material,
        cargo_weight = EXCLUDED.cargo_weight,
        cargo_quantity = EXCLUDED.cargo_quantity,
        cargo_special_instructions = EXCLUDED.cargo_special_instructions,
        cargo_value = EXCLUDED.cargo_value,
        earnings = EXCLUDED.earnings,
        started_at = EXCLUDED.started_at,
        current_lat = EXCLUDED.current_lat,
        current_lng = EXCLUDED.current_lng,
        updated_at = NOW()
      `,
      [
        IDS.trips.active,
        IDS.trips.completed,
        IDS.bookings.active,
        IDS.bookings.completed,
        usersByPhone['9000000004'],
        usersByPhone['9000000006'],
        usersByPhone['9000000003'],
      ]
    );

    await client.query(`DELETE FROM trip_timeline WHERE trip_id = ANY($1::uuid[])`, [Object.values(IDS.trips)]);
    const tripTimelineRows = [
      [IDS.trips.active, 'Pickup', true, 0, "NOW() - INTERVAL '5 hours'"],
      [IDS.trips.active, 'In Transit', true, 1, "NOW() - INTERVAL '3 hours'"],
      [IDS.trips.active, 'Delivered', false, 2, "NULL"],
      [IDS.trips.completed, 'Pickup', true, 0, "NOW() - INTERVAL '7 days 16 hours'"],
      [IDS.trips.completed, 'In Transit', true, 1, "NOW() - INTERVAL '7 days 12 hours'"],
      [IDS.trips.completed, 'Delivered', true, 2, "NOW() - INTERVAL '7 days 4 hours'"],
    ];
    for (const [tripId, step, done, position, occurredAt] of tripTimelineRows) {
      await client.query(
        `INSERT INTO trip_timeline (trip_id, step, done, occurred_at, position) VALUES ($1, $2, $3, ${occurredAt}, $4)`,
        [tripId, step, done, position]
      );
    }

    await client.query(
      `
      INSERT INTO settlements (id, booking_id, broker_id, driver_id, amount, platform_fee, status, settled_at, created_at)
      VALUES
        ($1, $2, $3, $4, 22400, 1792, 'paid', NOW() - INTERVAL '7 days 3 hours', NOW() - INTERVAL '7 days 3 hours')
      ON CONFLICT (id) DO UPDATE
      SET
        booking_id = EXCLUDED.booking_id,
        broker_id = EXCLUDED.broker_id,
        driver_id = EXCLUDED.driver_id,
        amount = EXCLUDED.amount,
        platform_fee = EXCLUDED.platform_fee,
        status = EXCLUDED.status,
        settled_at = EXCLUDED.settled_at,
        created_at = EXCLUDED.created_at
      `,
      [
        IDS.settlements.completed,
        IDS.bookings.completed,
        usersByPhone['9000000003'],
        usersByPhone['9000000006'],
      ]
    );

    await client.query(
      `
      INSERT INTO disputes (id, booking_id, raised_by_user_id, raised_by_role, issue_type, description, status, resolution, created_at, updated_at)
      VALUES
        ($1, $3, $5, 'client', 'late_delivery', 'Driver was delayed by 2 hours.', 'open', NULL, NOW() - INTERVAL '5 hours', NOW() - INTERVAL '5 hours'),
        ($2, $4, $6, 'broker', 'payment_delay', 'Settlement release took longer than expected.', 'resolved', 'Settlement marked paid and broker informed.', NOW() - INTERVAL '9 days', NOW() - INTERVAL '8 days')
      ON CONFLICT (id) DO UPDATE
      SET
        booking_id = EXCLUDED.booking_id,
        raised_by_user_id = EXCLUDED.raised_by_user_id,
        raised_by_role = EXCLUDED.raised_by_role,
        issue_type = EXCLUDED.issue_type,
        description = EXCLUDED.description,
        status = EXCLUDED.status,
        resolution = EXCLUDED.resolution,
        updated_at = NOW()
      `,
      [
        IDS.disputes.open,
        IDS.disputes.resolved,
        IDS.bookings.active,
        IDS.bookings.completed,
        usersByPhone['9000000002'],
        usersByPhone['9000000003'],
      ]
    );

    await client.query(
      `
      INSERT INTO notifications (id, user_id, title, message, type, is_read, meta, created_at)
      VALUES
        ($1, $4, 'New Job Request', 'A new Pune to Nashik job request is waiting for review.', 'booking', false, '{"booking_id":"${IDS.bookings.request}","job_request_id":"${IDS.jobs.pending}"}'::jsonb, NOW() - INTERVAL '30 minutes'),
        ($2, $5, 'New Trip Assigned', 'Mumbai to Surat shipment is ready to move.', 'booking', false, '{"booking_id":"${IDS.bookings.active}","trip_id":"${IDS.trips.active}"}'::jsonb, NOW() - INTERVAL '4 hours'),
        ($3, $6, 'Booking Completed', 'Your Bengaluru to Chennai booking was completed successfully.', 'booking', false, '{"booking_id":"${IDS.bookings.completed}"}'::jsonb, NOW() - INTERVAL '7 days 3 hours')
      ON CONFLICT (id) DO UPDATE
      SET
        user_id = EXCLUDED.user_id,
        title = EXCLUDED.title,
        message = EXCLUDED.message,
        type = EXCLUDED.type,
        is_read = EXCLUDED.is_read,
        meta = EXCLUDED.meta,
        created_at = EXCLUDED.created_at
      `,
      [
        IDS.notifications.broker,
        IDS.notifications.driver,
        IDS.notifications.client,
        usersByPhone['9000000003'],
        usersByPhone['9000000004'],
        usersByPhone['9000000002'],
      ]
    );

    // --- Phase 2: enrich the ad-hoc accounts created via real sign-up in manual testing ---
    await client.query(
      `
      INSERT INTO users (name, email, phone, password_hash, role, status, is_phone_verified, is_email_verified, address, company_name)
      VALUES ('Vikram Singh', 'vikram.driver@example.com', '9800000011', $1, 'driver', 'active', true, true, 'Kothrud, Pune', NULL)
      ON CONFLICT (phone) DO UPDATE
      SET name = EXCLUDED.name, email = EXCLUDED.email, password_hash = EXCLUDED.password_hash,
          role = EXCLUDED.role, status = EXCLUDED.status, is_phone_verified = EXCLUDED.is_phone_verified,
          is_email_verified = EXCLUDED.is_email_verified, address = EXCLUDED.address
      `,
      [passwordHash]
    );

    const adhocResult = await client.query(`
      SELECT phone, id FROM users WHERE phone IN ('9854623568', '9874558695', '8745896235', '9800000011')
    `);
    const adhoc = Object.fromEntries(adhocResult.rows.map((row) => [row.phone, row.id]));
    const adhocBrokerId = adhoc['9854623568'];
    const adhocDriverId = adhoc['9874558695'];
    const adhocClientId = adhoc['8745896235'];
    const vikramId = adhoc['9800000011'];

    await client.query(
      `
      UPDATE users
      SET kyc_status = 'verified'
      WHERE phone IN ('9854623568', '9874558695', '9800000011')
      `
    );

    await client.query(
      `
      INSERT INTO kyc_submissions (user_id, documents, reviewed_by, reviewed_at)
      VALUES
        ($1, '{"pan_number":"AAFCB4321E","aadhaar_number":"XXXX-XXXX-2001","gst_number":"27AAFCB4321E1Z9","bank_account_number":"50300345678901","business_registration_number":"U60200MH2021PTC112233"}'::jsonb, $4, NOW() - INTERVAL '20 days'),
        ($2, '{"license_number":"MH2021556677889","aadhaar_number":"XXXX-XXXX-2002","vehicle_registration_number":"MH-12-XY-7788","vehicle_insurance_number":"INS-2024-200001"}'::jsonb, $4, NOW() - INTERVAL '19 days'),
        ($3, '{"license_number":"MH2022667788990","aadhaar_number":"XXXX-XXXX-2003","vehicle_registration_number":"MH-12-ZP-3344","vehicle_insurance_number":"INS-2024-200002"}'::jsonb, $4, NOW() - INTERVAL '18 days')
      ON CONFLICT (user_id) DO UPDATE
      SET documents = EXCLUDED.documents, reviewed_by = EXCLUDED.reviewed_by, reviewed_at = EXCLUDED.reviewed_at, updated_at = NOW()
      `,
      [adhocBrokerId, adhocDriverId, vikramId, usersByPhone['9000000001']]
    );

    await client.query(
      `
      INSERT INTO trucks (broker_id, driver_id, registration, type, category, capacity, make, year, insurance_expiry, status)
      VALUES
        ($1, $2, 'MH-12-XY-7788', 'Medium Truck', 'medium', '5 Tons', 'Tata 407', 2022, CURRENT_DATE + INTERVAL '150 days', 'on_trip'),
        ($1, $3, 'MH-12-ZP-3344', 'Small Truck', 'small', '2 Tons', 'Mahindra Bolero', 2021, CURRENT_DATE + INTERVAL '90 days', 'available')
      ON CONFLICT (registration) DO UPDATE
      SET broker_id = EXCLUDED.broker_id, driver_id = EXCLUDED.driver_id, type = EXCLUDED.type,
          category = EXCLUDED.category, capacity = EXCLUDED.capacity, make = EXCLUDED.make,
          year = EXCLUDED.year, insurance_expiry = EXCLUDED.insurance_expiry, status = EXCLUDED.status
      `,
      [adhocBrokerId, adhocDriverId, vikramId]
    );

    const adhocTruckResult = await client.query(`
      SELECT id, registration FROM trucks WHERE registration IN ('MH-12-XY-7788', 'MH-12-ZP-3344')
    `);
    const adhocTruckIds = Object.fromEntries(adhocTruckResult.rows.map((row) => [row.registration, row.id]));

    await client.query(
      `
      INSERT INTO driver_profiles (user_id, broker_id, license_no, license_expiry, aadhaar, truck_id, total_trips, avatar, status)
      VALUES
        ($1, $3, 'MH2021556677889', CURRENT_DATE + INTERVAL '500 days', '456789012345', $4, 34, NULL, 'on_trip'),
        ($2, $3, 'MH2022667788990', CURRENT_DATE + INTERVAL '350 days', '567890123456', $5, 12, NULL, 'available')
      ON CONFLICT (user_id) DO UPDATE
      SET broker_id = EXCLUDED.broker_id, license_no = EXCLUDED.license_no, license_expiry = EXCLUDED.license_expiry,
          aadhaar = EXCLUDED.aadhaar, truck_id = EXCLUDED.truck_id, total_trips = EXCLUDED.total_trips,
          status = EXCLUDED.status, updated_at = NOW()
      `,
      [adhocDriverId, vikramId, adhocBrokerId, adhocTruckIds['MH-12-XY-7788'], adhocTruckIds['MH-12-ZP-3344']]
    );

    const adhocBookingRows = [
      {
        id: IDS2.bookings.pending,
        bookingNumber: 'BKG-SEED-101',
        brokerId: null,
        driverId: null,
        truckId: null,
        status: 'pending',
        pickup: 'Pune',
        drop: 'Mumbai',
        truckType: 'Tata Ace / Pickup',
        truckCategory: 'small',
        weight: 1.2,
        quantity: 20,
        material: 'FMCG',
        transportType: 'intra',
        scheduledDate: "NOW() + INTERVAL '1 day'",
        amount: 3800,
        paymentStatus: 'pending',
        currentStep: 0,
        distance: 150,
        platformFee: 380,
        pricing: '{"baseFare":500,"distanceFare":2920,"platformFee":380,"total":3800}',
      },
      {
        id: IDS2.bookings.confirmed,
        bookingNumber: 'BKG-SEED-102',
        brokerId: adhocBrokerId,
        driverId: null,
        truckId: null,
        status: 'confirmed',
        pickup: 'Pune',
        drop: 'Nagpur',
        truckType: 'Medium Truck',
        truckCategory: 'medium',
        weight: 4.0,
        quantity: 35,
        material: 'Textiles',
        transportType: 'inter',
        scheduledDate: "NOW() + INTERVAL '8 hours'",
        amount: 11200,
        paymentStatus: 'pending',
        currentStep: 1,
        distance: 320,
        platformFee: 896,
        pricing: '{"distanceFare":10304,"platformFee":896,"total":11200}',
      },
      {
        id: IDS2.bookings.active,
        bookingNumber: 'BKG-SEED-103',
        brokerId: adhocBrokerId,
        driverId: adhocDriverId,
        truckId: adhocTruckIds['MH-12-XY-7788'],
        status: 'in_transit',
        pickup: 'Pune',
        drop: 'Aurangabad',
        truckType: 'Medium Truck',
        truckCategory: 'medium',
        weight: 4.2,
        quantity: 28,
        material: 'Electronics',
        transportType: 'inter',
        scheduledDate: "NOW() - INTERVAL '3 hours'",
        amount: 9600,
        paymentStatus: 'paid',
        currentStep: 5,
        distance: 235,
        platformFee: 768,
        pricing: '{"distanceFare":8832,"platformFee":768,"total":9600}',
      },
      {
        id: IDS2.bookings.completedLastMonth,
        bookingNumber: 'BKG-SEED-104',
        brokerId: adhocBrokerId,
        driverId: vikramId,
        truckId: adhocTruckIds['MH-12-ZP-3344'],
        status: 'completed',
        pickup: 'Pune',
        drop: 'Kolhapur',
        truckType: 'Small Truck',
        truckCategory: 'small',
        weight: 2.0,
        quantity: 16,
        material: 'Furniture',
        transportType: 'inter',
        scheduledDate: "NOW() - INTERVAL '35 days'",
        amount: 7200,
        paymentStatus: 'paid',
        currentStep: 7,
        distance: 230,
        platformFee: 576,
        pricing: '{"distanceFare":6624,"platformFee":576,"total":7200}',
      },
      {
        id: IDS2.bookings.completedTwoMonthsAgo,
        bookingNumber: 'BKG-SEED-105',
        brokerId: adhocBrokerId,
        driverId: adhocDriverId,
        truckId: adhocTruckIds['MH-12-XY-7788'],
        status: 'completed',
        pickup: 'Pune',
        drop: 'Indore',
        truckType: 'Medium Truck',
        truckCategory: 'medium',
        weight: 5.5,
        quantity: 40,
        material: 'Auto Parts',
        transportType: 'inter',
        scheduledDate: "NOW() - INTERVAL '65 days'",
        amount: 15400,
        paymentStatus: 'paid',
        currentStep: 7,
        distance: 420,
        platformFee: 1232,
        pricing: '{"distanceFare":14168,"platformFee":1232,"total":15400}',
      },
      {
        id: IDS2.bookings.cancelled,
        bookingNumber: 'BKG-SEED-106',
        brokerId: adhocBrokerId,
        driverId: null,
        truckId: null,
        status: 'cancelled',
        pickup: 'Pune',
        drop: 'Goa',
        truckType: 'Part Truck',
        truckCategory: 'part',
        weight: 1.0,
        quantity: 10,
        material: 'Other',
        transportType: 'inter',
        scheduledDate: "NOW() - INTERVAL '4 days'",
        amount: 5200,
        paymentStatus: 'refunded',
        currentStep: 0,
        distance: 460,
        platformFee: 624,
        pricing: '{"distanceFare":4576,"platformFee":624,"total":5200}',
      },
    ];

    for (const booking of adhocBookingRows) {
      await client.query(
        `
        INSERT INTO bookings (
          id, booking_number, client_id, broker_id, driver_id, truck_id, status, pickup_location, drop_location,
          truck_type, truck_category, weight, weight_unit, quantity, material, transport_type,
          scheduled_date, amount, payment_status, current_step, pricing_breakdown, distance, platform_fee,
          created_at, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, 'tons', $13, $14, $15,
          ${booking.scheduledDate}, $16, $17, $18, $19::jsonb, $20, $21,
          ${booking.scheduledDate}, NOW()
        )
        ON CONFLICT (id) DO UPDATE
        SET
          booking_number = COALESCE(bookings.booking_number, EXCLUDED.booking_number),
          client_id = EXCLUDED.client_id, broker_id = EXCLUDED.broker_id, driver_id = EXCLUDED.driver_id,
          truck_id = EXCLUDED.truck_id, status = EXCLUDED.status, pickup_location = EXCLUDED.pickup_location,
          drop_location = EXCLUDED.drop_location, truck_type = EXCLUDED.truck_type, truck_category = EXCLUDED.truck_category,
          weight = EXCLUDED.weight, quantity = EXCLUDED.quantity, material = EXCLUDED.material,
          transport_type = EXCLUDED.transport_type, scheduled_date = EXCLUDED.scheduled_date, amount = EXCLUDED.amount,
          payment_status = EXCLUDED.payment_status, current_step = EXCLUDED.current_step,
          pricing_breakdown = EXCLUDED.pricing_breakdown, distance = EXCLUDED.distance, platform_fee = EXCLUDED.platform_fee,
          updated_at = NOW()
        `,
        [
          booking.id,
          booking.bookingNumber,
          adhocClientId,
          booking.brokerId,
          booking.driverId,
          booking.truckId,
          booking.status,
          booking.pickup,
          booking.drop,
          booking.truckType,
          booking.truckCategory,
          booking.weight,
          booking.quantity,
          booking.material,
          booking.transportType,
          booking.amount,
          booking.paymentStatus,
          booking.currentStep,
          booking.pricing,
          booking.distance,
          booking.platformFee,
        ]
      );
    }

    await client.query(`DELETE FROM booking_timeline WHERE booking_id = ANY($1::uuid[])`, [Object.values(IDS2.bookings)]);
    const adhocBookingTimelineRows = [
      [IDS2.bookings.pending, 'pending', true, 0, "NOW() - INTERVAL '1 hour'"],
      [IDS2.bookings.confirmed, 'pending', true, 0, "NOW() - INTERVAL '10 hours'"],
      [IDS2.bookings.confirmed, 'confirmed', true, 1, "NOW() - INTERVAL '8 hours'"],
      [IDS2.bookings.active, 'pending', true, 0, "NOW() - INTERVAL '6 hours'"],
      [IDS2.bookings.active, 'confirmed', true, 1, "NOW() - INTERVAL '5 hours'"],
      [IDS2.bookings.active, 'assigned', true, 2, "NOW() - INTERVAL '4 hours'"],
      [IDS2.bookings.active, 'en_route_pickup', true, 3, "NOW() - INTERVAL '4 hours'"],
      [IDS2.bookings.active, 'picked_up', true, 4, "NOW() - INTERVAL '3 hours'"],
      [IDS2.bookings.active, 'in_transit', true, 5, "NOW() - INTERVAL '3 hours'"],
      [IDS2.bookings.completedLastMonth, 'pending', true, 0, "NOW() - INTERVAL '36 days'"],
      [IDS2.bookings.completedLastMonth, 'confirmed', true, 1, "NOW() - INTERVAL '35 days 20 hours'"],
      [IDS2.bookings.completedLastMonth, 'assigned', true, 2, "NOW() - INTERVAL '35 days 18 hours'"],
      [IDS2.bookings.completedLastMonth, 'delivered', true, 6, "NOW() - INTERVAL '35 days 5 hours'"],
      [IDS2.bookings.completedLastMonth, 'completed', true, 7, "NOW() - INTERVAL '35 days 4 hours'"],
      [IDS2.bookings.completedTwoMonthsAgo, 'pending', true, 0, "NOW() - INTERVAL '66 days'"],
      [IDS2.bookings.completedTwoMonthsAgo, 'confirmed', true, 1, "NOW() - INTERVAL '65 days 20 hours'"],
      [IDS2.bookings.completedTwoMonthsAgo, 'assigned', true, 2, "NOW() - INTERVAL '65 days 18 hours'"],
      [IDS2.bookings.completedTwoMonthsAgo, 'delivered', true, 6, "NOW() - INTERVAL '65 days 5 hours'"],
      [IDS2.bookings.completedTwoMonthsAgo, 'completed', true, 7, "NOW() - INTERVAL '65 days 4 hours'"],
      [IDS2.bookings.cancelled, 'pending', true, 0, "NOW() - INTERVAL '4 days'"],
      [IDS2.bookings.cancelled, 'cancelled', true, 99, "NOW() - INTERVAL '3 days 20 hours'"],
    ];
    for (const [bookingId, step, done, position, occurredAt] of adhocBookingTimelineRows) {
      await client.query(
        `INSERT INTO booking_timeline (booking_id, step, done, occurred_at, position) VALUES ($1, $2, $3, ${occurredAt}, $4)`,
        [bookingId, step, done, position]
      );
    }

    await client.query(
      `
      INSERT INTO job_requests (id, booking_id, broker_id, distance, amount, status, created_at)
      VALUES
        ($1, $3, $5, 320, 11200, 'pending', NOW() - INTERVAL '20 minutes'),
        ($2, $4, $5, 235, 9600, 'accepted', NOW() - INTERVAL '6 hours')
      ON CONFLICT (id) DO UPDATE
      SET booking_id = EXCLUDED.booking_id, broker_id = EXCLUDED.broker_id, distance = EXCLUDED.distance,
          amount = EXCLUDED.amount, status = EXCLUDED.status, created_at = EXCLUDED.created_at
      `,
      [IDS2.jobs.pending, IDS2.jobs.accepted, IDS2.bookings.confirmed, IDS2.bookings.active, adhocBrokerId]
    );

    await client.query(
      `
      INSERT INTO trips (
        id, booking_id, driver_id, broker_id, status,
        pickup_contact_person, pickup_contact_phone, pickup_address, pickup_time,
        drop_contact_person, drop_contact_phone, drop_address, drop_time,
        distance, estimated_time, cargo_material, cargo_weight, cargo_quantity, cargo_special_instructions, cargo_value, earnings,
        started_at, current_lat, current_lng, created_at, updated_at
      )
      VALUES
        (
          $1, $4, $6, $7, 'in_transit',
          'Warehouse Manager', '9876500011', 'Pune', NOW() - INTERVAL '4 hours',
          'Aurangabad Hub', '9876500012', 'Aurangabad', NOW() + INTERVAL '2 hours',
          235, '4h 45m', 'Electronics', 4.2, 28, 'Fragile items', 9600, 8832,
          NOW() - INTERVAL '3 hours', 19.8762, 75.3433, NOW() - INTERVAL '4 hours', NOW()
        ),
        (
          $2, $5, $8, $7, 'completed',
          'Furniture Store Owner', '9876500013', 'Pune', NOW() - INTERVAL '35 days 18 hours',
          'Kolhapur Receiver', '9876500014', 'Kolhapur', NOW() - INTERVAL '35 days 5 hours',
          230, '4h 30m', 'Furniture', 2.0, 16, 'Stack carefully', 7200, 6624,
          NOW() - INTERVAL '35 days 17 hours', 16.7050, 74.2433, NOW() - INTERVAL '35 days 18 hours', NOW()
        ),
        (
          $3, $9, $6, $7, 'completed',
          'Factory Manager', '9876500015', 'Pune', NOW() - INTERVAL '65 days 18 hours',
          'Indore Receiver', '9876500016', 'Indore', NOW() - INTERVAL '65 days 5 hours',
          420, '7h 40m', 'Auto Parts', 5.5, 40, 'Handle with care', 15400, 14168,
          NOW() - INTERVAL '65 days 17 hours', 22.7196, 75.8577, NOW() - INTERVAL '65 days 18 hours', NOW()
        )
      ON CONFLICT (id) DO UPDATE
      SET
        booking_id = EXCLUDED.booking_id, driver_id = EXCLUDED.driver_id, broker_id = EXCLUDED.broker_id,
        status = EXCLUDED.status, pickup_contact_person = EXCLUDED.pickup_contact_person,
        pickup_contact_phone = EXCLUDED.pickup_contact_phone, pickup_address = EXCLUDED.pickup_address,
        pickup_time = EXCLUDED.pickup_time, drop_contact_person = EXCLUDED.drop_contact_person,
        drop_contact_phone = EXCLUDED.drop_contact_phone, drop_address = EXCLUDED.drop_address,
        drop_time = EXCLUDED.drop_time, distance = EXCLUDED.distance, estimated_time = EXCLUDED.estimated_time,
        cargo_material = EXCLUDED.cargo_material, cargo_weight = EXCLUDED.cargo_weight,
        cargo_quantity = EXCLUDED.cargo_quantity, cargo_special_instructions = EXCLUDED.cargo_special_instructions,
        cargo_value = EXCLUDED.cargo_value, earnings = EXCLUDED.earnings, started_at = EXCLUDED.started_at,
        current_lat = EXCLUDED.current_lat, current_lng = EXCLUDED.current_lng, updated_at = NOW()
      `,
      [
        IDS2.trips.active,
        IDS2.trips.completedLastMonth,
        IDS2.trips.completedTwoMonthsAgo,
        IDS2.bookings.active,
        IDS2.bookings.completedLastMonth,
        adhocDriverId,
        adhocBrokerId,
        vikramId,
        IDS2.bookings.completedTwoMonthsAgo,
      ]
    );

    await client.query(`DELETE FROM trip_timeline WHERE trip_id = ANY($1::uuid[])`, [Object.values(IDS2.trips)]);
    const adhocTripTimelineRows = [
      [IDS2.trips.active, 'Pickup', true, 0, "NOW() - INTERVAL '4 hours'"],
      [IDS2.trips.active, 'In Transit', true, 1, "NOW() - INTERVAL '3 hours'"],
      [IDS2.trips.active, 'Delivered', false, 2, "NULL"],
      [IDS2.trips.completedLastMonth, 'Pickup', true, 0, "NOW() - INTERVAL '35 days 18 hours'"],
      [IDS2.trips.completedLastMonth, 'In Transit', true, 1, "NOW() - INTERVAL '35 days 14 hours'"],
      [IDS2.trips.completedLastMonth, 'Delivered', true, 2, "NOW() - INTERVAL '35 days 5 hours'"],
      [IDS2.trips.completedTwoMonthsAgo, 'Pickup', true, 0, "NOW() - INTERVAL '65 days 18 hours'"],
      [IDS2.trips.completedTwoMonthsAgo, 'In Transit', true, 1, "NOW() - INTERVAL '65 days 12 hours'"],
      [IDS2.trips.completedTwoMonthsAgo, 'Delivered', true, 2, "NOW() - INTERVAL '65 days 5 hours'"],
    ];
    for (const [tripId, step, done, position, occurredAt] of adhocTripTimelineRows) {
      await client.query(
        `INSERT INTO trip_timeline (trip_id, step, done, occurred_at, position) VALUES ($1, $2, $3, ${occurredAt}, $4)`,
        [tripId, step, done, position]
      );
    }

    await client.query(
      `
      INSERT INTO settlements (id, booking_id, broker_id, driver_id, amount, platform_fee, status, settled_at, created_at)
      VALUES
        ($1, $3, $5, $6, 7200, 576, 'paid', NOW() - INTERVAL '35 days 3 hours', NOW() - INTERVAL '35 days 3 hours'),
        ($2, $4, $5, $7, 15400, 1232, 'paid', NOW() - INTERVAL '65 days 3 hours', NOW() - INTERVAL '65 days 3 hours')
      ON CONFLICT (id) DO UPDATE
      SET booking_id = EXCLUDED.booking_id, broker_id = EXCLUDED.broker_id, driver_id = EXCLUDED.driver_id,
          amount = EXCLUDED.amount, platform_fee = EXCLUDED.platform_fee, status = EXCLUDED.status,
          settled_at = EXCLUDED.settled_at, created_at = EXCLUDED.created_at
      `,
      [
        IDS2.settlements.lastMonth,
        IDS2.settlements.twoMonthsAgo,
        IDS2.bookings.completedLastMonth,
        IDS2.bookings.completedTwoMonthsAgo,
        adhocBrokerId,
        vikramId,
        adhocDriverId,
      ]
    );

    await client.query(
      `
      INSERT INTO notifications (id, user_id, title, message, type, is_read, meta, created_at)
      VALUES
        ($1, $4, 'New Job Request', 'A new Pune to Nagpur job request is waiting for review.', 'booking', false, '{"booking_id":"${IDS2.bookings.confirmed}","job_request_id":"${IDS2.jobs.pending}"}'::jsonb, NOW() - INTERVAL '20 minutes'),
        ($2, $5, 'New Trip Assigned', 'Pune to Aurangabad shipment is ready to move.', 'booking', false, '{"booking_id":"${IDS2.bookings.active}","trip_id":"${IDS2.trips.active}"}'::jsonb, NOW() - INTERVAL '3 hours'),
        ($3, $6, 'Booking Completed', 'Your Pune to Kolhapur booking was completed successfully.', 'booking', true, '{"booking_id":"${IDS2.bookings.completedLastMonth}"}'::jsonb, NOW() - INTERVAL '35 days 3 hours')
      ON CONFLICT (id) DO UPDATE
      SET user_id = EXCLUDED.user_id, title = EXCLUDED.title, message = EXCLUDED.message, type = EXCLUDED.type,
          is_read = EXCLUDED.is_read, meta = EXCLUDED.meta, created_at = EXCLUDED.created_at
      `,
      [
        IDS2.notifications.broker,
        IDS2.notifications.driver,
        IDS2.notifications.client,
        adhocBrokerId,
        adhocDriverId,
        adhocClientId,
      ]
    );

    await client.query('COMMIT');

    console.log('Seed complete.');
    console.log('Admin   -> admin@ssklogistics.in / Admin@123456');
    console.log('Client  -> client@ssklogistics.in / Admin@123456');
    console.log('Broker  -> broker@ssklogistics.in / Admin@123456');
    console.log('Driver  -> driver@ssklogistics.in / Admin@123456');
    console.log('Demo dataset includes bookings, job requests, trips, settlements, disputes, notifications, and verified KYC.');
    console.log('Ad-hoc test accounts (broker@gmail.com, driver@gmail.com, client@gmail.com) now have trucks/drivers/bookings/trips/settlements too.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
};

seed();

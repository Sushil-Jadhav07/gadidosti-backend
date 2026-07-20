const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'SSK Logistics — Role-Based Auth & Management API',
      version: '2.0.0',
      contact: {
        name: 'SSK Logistics Dev Team',
        email: 'dev@ssklogistics.in',
      },
    },
    servers:
      process.env.NODE_ENV === 'production'
        ? [
            {
              url: 'https://gadidosti-backend.onrender.com',
              description: 'Production Server',
            },
          ]
        : [
            {
              url: 'http://localhost:5000',
              description: 'Development Server',
            },
            {
              url: 'https://gadidosti-backend.onrender.com',
              description: 'Production Server',
            },
          ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter the JWT access_token obtained from login',
        },
      },
      schemas: {

        // ── Core entity ────────────────────────────────────────────────────────
        User: {
          type: 'object',
          properties: {
            id:                { type: 'string', format: 'uuid',      example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
            name:              { type: 'string',                       example: 'Rajesh Kumar' },
            email:             { type: 'string', format: 'email',     example: 'rajesh@example.com', nullable: true },
            phone:             { type: 'string',                       example: '9876543210' },
            role: {
              type: 'string',
              enum: ['client', 'broker', 'driver', 'admin'],
              example: 'client',
              description: 'client → Client Portal | broker/driver → Broker-Driver Portal | admin → Admin Dashboard (full access)',
            },
            status: {
              type: 'string',
              enum: ['active', 'inactive', 'blocked', 'pending_verification'],
              example: 'active',
              description: 'pending_verification = phone OTP not yet verified',
            },
            is_phone_verified: { type: 'boolean', example: true },
            is_email_verified: { type: 'boolean', example: false },
            profile_image:     { type: 'string',  nullable: true,     example: null },
            address:           { type: 'string',  nullable: true,     example: '12 MG Road, Pune, Maharashtra 411001' },
            company_name:      { type: 'string',  nullable: true,     example: 'Suresh Transport Co.' },
            kyc_status: {
              type: 'string',
              enum: ['pending', 'submitted', 'verified', 'rejected'],
              example: 'pending',
              description: 'Broker/driver document verification status. Always pending (unused) for client/admin.',
            },
            last_login_at:     { type: 'string',  format: 'date-time', nullable: true },
            created_at:        { type: 'string',  format: 'date-time' },
            updated_at:        { type: 'string',  format: 'date-time' },
          },
        },

        KycSubmission: {
          type: 'object',
          properties: {
            id:               { type: 'string', format: 'uuid' },
            user_id:          { type: 'string', format: 'uuid' },
            documents:        { type: 'object', additionalProperties: { type: 'string' }, example: { license_number: 'MH-2020123456789', license_photo_url: 'https://gadidosti-backend.onrender.com/api/kyc/documents/file/<id>', vehicle_registration_number: 'MH-12-CD-5678' } },
            rejection_reason: { type: 'string', nullable: true, example: 'Aadhaar number does not match uploaded name' },
            reviewed_at:      { type: 'string', format: 'date-time', nullable: true },
            submitted_at:     { type: 'string', format: 'date-time' },
            updated_at:       { type: 'string', format: 'date-time' },
          },
        },

        Notification: {
          type: 'object',
          properties: {
            id:         { type: 'string', format: 'uuid', example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' },
            title:      { type: 'string', example: 'Booking Confirmed' },
            message:    { type: 'string', example: 'Your booking #SSK1042 has been accepted by the driver.' },
            type:       { type: 'string', example: 'booking', description: 'Category, e.g. booking | payment | system | general' },
            is_read:    { type: 'boolean', example: false },
            meta:       { type: 'object', nullable: true, example: { booking_id: 'SSK1042' } },
            created_at: { type: 'string', format: 'date-time' },
          },
        },

        AuthTokens: {
          type: 'object',
          properties: {
            access_token:  { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
            refresh_token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
            token_type:    { type: 'string', example: 'Bearer' },
            expires_in:    { type: 'string', example: '7d' },
          },
        },

        // ── Request schemas — role-specific registration ────────────────────────
        ClientRegisterRequest: {
          type: 'object',
          required: ['name', 'phone', 'password'],
          properties: {
            name:     { type: 'string',                   example: 'Rajesh Kumar',       minLength: 2, maxLength: 100 },
            phone:    { type: 'string',                   example: '9876543210',          description: '10-digit Indian mobile number' },
            email:    { type: 'string', format: 'email', example: 'rajesh@example.com',  nullable: true },
            password: { type: 'string', format: 'password', example: 'Client@123',       description: 'Min 6 characters' },
            role:     { type: 'string', enum: ['client'], default: 'client',              example: 'client' },
          },
        },

        BrokerRegisterRequest: {
          type: 'object',
          required: ['name', 'phone', 'password'],
          properties: {
            name:     { type: 'string',                   example: 'Suresh Transport Co.', minLength: 2, maxLength: 100 },
            phone:    { type: 'string',                   example: '9000000003',            description: '10-digit Indian mobile number' },
            email:    { type: 'string', format: 'email', example: 'suresh@transport.in',   nullable: true },
            password: { type: 'string', format: 'password', example: 'Broker@123',         description: 'Min 6 characters' },
            role:     { type: 'string', enum: ['broker'], default: 'broker',                example: 'broker' },
          },
        },

        DriverRegisterRequest: {
          type: 'object',
          required: ['name', 'phone', 'password'],
          properties: {
            name:     { type: 'string',                   example: 'Ramesh Singh',         minLength: 2, maxLength: 100 },
            phone:    { type: 'string',                   example: '9000000004',            description: '10-digit Indian mobile number' },
            email:    { type: 'string', format: 'email', example: 'ramesh@driver.com',     nullable: true },
            password: { type: 'string', format: 'password', example: 'Driver@123',         description: 'Min 6 characters' },
            role:     { type: 'string', enum: ['driver'], default: 'driver',                example: 'driver' },
          },
        },

        // ── Request schemas — login ────────────────────────────────────────────
        AdminRegisterRequest: {
          type: 'object',
          required: ['name', 'phone', 'email', 'password'],
          properties: {
            name: {
              type: 'string',
              example: 'Operations Manager',
              minLength: 2,
              maxLength: 100,
            },
            phone: {
              type: 'string',
              example: '9000000099',
              description: '10-digit Indian mobile number',
            },
            email: {
              type: 'string',
              format: 'email',
              example: 'manager@ssklogistics.in',
              description: 'Email is required for admin accounts (used for login)',
            },
            password: {
              type: 'string',
              format: 'password',
              example: 'Manager123',
              description: 'Min 6 characters (no complexity requirement for admin creation)',
            },
          },
        },

        AdminLoginRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: {
              type: 'string',
              format: 'email',
              example: 'admin@ssklogistics.in',
              description: 'Email address of the pre-seeded admin account',
            },
            password: {
              type: 'string',
              format: 'password',
              example: 'Admin@123456',
              description: 'Admin password',
            },
          },
        },

        PhoneLoginRequest: {
          type: 'object',
          required: ['phone', 'password'],
          properties: {
            phone: {
              type: 'string',
              example: '9876543210',
              description: 'Registered 10-digit phone number (must be OTP-verified)',
            },
            password: {
              type: 'string',
              format: 'password',
              example: 'Client@123',
            },
          },
        },

        // ── Request schemas — Google Sign-In ─────────────────────────────────
        GoogleSignInRequest: {
          type: 'object',
          required: ['id_token'],
          properties: {
            id_token: {
              type: 'string',
              description: 'Google ID token / credential from the frontend',
              example: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
            },
            role: {
              type: 'string',
              enum: ['client', 'broker', 'driver'],
              default: 'client',
              description: 'Role for new accounts (ignored for existing users)',
            },
          },
        },

        // ── Request schemas — password management ─────────────────────────────
        ForgotPasswordRequest: {
          type: 'object',
          required: ['phone'],
          properties: {
            phone: {
              type: 'string',
              example: '9876543210',
              description: '10-digit phone number linked to the account',
            },
          },
        },

        ResetPasswordRequest: {
          type: 'object',
          required: ['phone', 'otp', 'new_password'],
          properties: {
            phone:        { type: 'string',                   example: '9876543210' },
            otp:          { type: 'string',                   example: '482619',         description: '6-digit OTP received on phone' },
            new_password: { type: 'string', format: 'password', example: 'NewPass@123', description: 'Min 6 characters' },
          },
        },

        // ── Response wrappers ─────────────────────────────────────────────────
        SuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string',  example: 'Operation successful' },
            data:    { type: 'object' },
          },
        },

        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string',  example: 'Something went wrong' },
            errors:  { type: 'array',   items: { type: 'object' }, nullable: true },
          },
        },

        AuthResponse: {
          allOf: [
            { $ref: '#/components/schemas/SuccessResponse' },
            {
              type: 'object',
              properties: {
                data: {
                  type: 'object',
                  properties: {
                    user:   { $ref: '#/components/schemas/User' },
                    tokens: { $ref: '#/components/schemas/AuthTokens' },
                  },
                },
              },
            },
          ],
        },

        RegisterResponse: {
          allOf: [
            { $ref: '#/components/schemas/SuccessResponse' },
            {
              type: 'object',
              properties: {
                data: {
                  type: 'object',
                  properties: {
                    user: { $ref: '#/components/schemas/User' },
                  },
                },
              },
            },
          ],
        },

        PaginatedUsers: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: {
              type: 'object',
              properties: {
                users:       { type: 'array', items: { $ref: '#/components/schemas/User' } },
                total:       { type: 'integer', example: 120 },
                page:        { type: 'integer', example: 1 },
                limit:       { type: 'integer', example: 10 },
                total_pages: { type: 'integer', example: 12 },
              },
            },
          },
        },

        // ── Bookings ────────────────────────────────────────────────────────
        Booking: {
          type: 'object',
          properties: {
            id:             { type: 'string', format: 'uuid' },
            bookingNumber:  { type: 'string', example: 'BKG-202412-003', description: 'Short human-readable reference for display' },
            clientId:       { type: 'string', format: 'uuid' },
            brokerId:       { type: 'string', format: 'uuid', nullable: true, description: 'Null until a broker accepts the job request' },
            driverId:       { type: 'string', format: 'uuid', nullable: true, description: 'Null until the broker assigns a driver' },
            truckId:        { type: 'string', format: 'uuid', nullable: true, description: 'Null until the broker assigns a truck' },
            status:         { type: 'string', enum: ['pending', 'confirmed', 'assigned', 'en_route_pickup', 'picked_up', 'in_transit', 'delivered', 'completed', 'cancelled', 'no_broker_available'], description: "Job requests no longer auto-expire, so a booking stays 'pending' indefinitely until a broker accepts. no_broker_available is only ever set manually by an admin via PATCH /api/bookings/{id}/status; see AnalyticsModel.dashboard's stalePendingBookings count for operational visibility into bookings sitting unaccepted." },
            pickup:         { type: 'string', example: 'Pune, Maharashtra' },
            drop:           { type: 'string', example: 'Mumbai, Maharashtra' },
            truckType:      { type: 'string', nullable: true },
            truckCategory:  { type: 'string', enum: ['small', 'medium', 'large', 'part'], nullable: true },
            weight:         { type: 'number', nullable: true },
            weightUnit:     { type: 'string', example: 'tons' },
            quantity:       { type: 'integer', nullable: true },
            material:       { type: 'string', nullable: true },
            transportType:  { type: 'string', enum: ['intra', 'inter'] },
            date:           { type: 'string', format: 'date-time', nullable: true },
            amount:         { type: 'number', nullable: true },
            paymentStatus:  { type: 'string', enum: ['paid', 'pending', 'refunded'] },
            driver:         { type: 'object', properties: { name: { type: 'string', nullable: true }, phone: { type: 'string', nullable: true } } },
            truckReg:       { type: 'string', nullable: true },
            broker:         { type: 'string', nullable: true },
            timeline:       { type: 'array', items: { type: 'string' }, example: ['pending', 'confirmed'] },
            currentStep:    { type: 'integer', example: 1 },
            pricing:        { type: 'object', nullable: true },
            distance:       { type: 'number', nullable: true },
            platformFee:    { type: 'number', nullable: true },
            rating:         { type: 'object', nullable: true, description: "Client Rating of this delivery, set via POST /api/bookings/{id}/rate. Null until the client rates it.", properties: { stars: { type: 'integer', minimum: 1, maximum: 5 }, review: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } } },
            podUrl:         { type: 'string', nullable: true, description: 'Proof-of-delivery photo URL, set via POST /api/trips/{id}/pod. Null until the driver uploads one.' },
            client:         { type: 'string', nullable: true, description: 'Admin projection only' },
            clientPhone:    { type: 'string', nullable: true, description: 'Admin projection only' },
            clientEmail:    { type: 'string', nullable: true, description: 'Admin projection only' },
            driverPhone:    { type: 'string', nullable: true, description: 'Admin projection only' },
            brokerPhone:    { type: 'string', nullable: true, description: 'Admin projection only — click-to-call on the admin dashboard' },
            createdAt:      { type: 'string', format: 'date-time' },
            updatedAt:      { type: 'string', format: 'date-time' },
          },
        },

        PricingBreakdown: {
          type: 'object',
          description: 'Shape varies — intra/inter-city client view uses baseFare/distanceFare/subtotal; inter-city admin view adds fuel/toll; part-load uses totalTruckCost/capacityUsedPct.',
          properties: {
            baseFare:         { type: 'number', nullable: true },
            distance:         { type: 'number' },
            distanceFare:     { type: 'number', nullable: true },
            subtotal:         { type: 'number', nullable: true },
            fuel:             { type: 'number', nullable: true },
            toll:             { type: 'number', nullable: true },
            totalTruckCost:   { type: 'number', nullable: true },
            capacityUsedPct:  { type: 'number', nullable: true },
            platformFee:      { type: 'number' },
            total:            { type: 'number' },
          },
        },

        PricingConfig: {
          type: 'object',
          properties: {
            intraCity: {
              type: 'object',
              properties: {
                small:  { $ref: '#/components/schemas/IntraCityTier' },
                medium: { $ref: '#/components/schemas/IntraCityTier' },
                large:  { $ref: '#/components/schemas/IntraCityTier' },
              },
            },
            interCity: {
              type: 'object',
              properties: {
                baseRatePerKm:   { type: 'number', example: 40 },
                fuelSurcharge:   { type: 'number', example: 0.15 },
                tollHandling:    { type: 'string', enum: ['fixed', 'actual'], example: 'fixed' },
                tollFixedAmount: { type: 'number', example: 500 },
                platformFee:     { type: 'number', example: 0.08 },
              },
            },
            partTruck: {
              type: 'object',
              properties: { platformFee: { type: 'number', example: 0.12 } },
            },
          },
        },

        IntraCityTier: {
          type: 'object',
          properties: {
            baseFare:         { type: 'number', example: 800 },
            perKmRate:        { type: 'number', example: 35 },
            platformFee:      { type: 'number', example: 0.10 },
            waitingCharge:    { type: 'number', example: 150 },
            demandMultiplier: { type: 'number', example: 1 },
          },
        },

        // ── Vehicles ───────────────────────────────────────────────────────────
        Truck: {
          type: 'object',
          properties: {
            id:               { type: 'string', format: 'uuid' },
            brokerId:         { type: 'string', format: 'uuid' },
            driverId:         { type: 'string', format: 'uuid', nullable: true },
            driver:           { type: 'string', nullable: true },
            registration:     { type: 'string', example: 'MH-12-AB-1234' },
            type:             { type: 'string', nullable: true },
            category:         { type: 'string', enum: ['small', 'medium', 'large', 'part'], nullable: true },
            capacity:         { type: 'string', nullable: true },
            make:             { type: 'string', nullable: true },
            year:             { type: 'integer', nullable: true },
            insuranceExpiry:  { type: 'string', format: 'date', nullable: true },
            status:           { type: 'string', enum: ['available', 'on_trip', 'maintenance'] },
            lastTrip:         { type: 'string', nullable: true, example: 'Pune -> Mumbai' },
          },
        },

        CreateTruckRequest: {
          type: 'object',
          required: ['registration', 'type', 'category', 'capacity'],
          properties: {
            registration:     { type: 'string', example: 'MH-12-AB-1234', description: 'Indian vehicle registration format, e.g. MH-12-AB-1234' },
            driver_id:        { type: 'string', format: 'uuid', nullable: true },
            type:             { type: 'string' },
            category:         { type: 'string', enum: ['small', 'medium', 'large', 'part'] },
            capacity:         { type: 'string' },
            make:             { type: 'string', nullable: true },
            year:             { type: 'integer', nullable: true },
            insurance_expiry: { type: 'string', format: 'date', nullable: true },
            broker_id:        { type: 'string', format: 'uuid', nullable: true, description: "Required when called by an admin (trucks.broker_id is NOT NULL) — the broker whose fleet this truck is added to. Ignored for a broker caller, who always adds to their own fleet regardless of what's sent here." },
          },
        },

        UpdateTruckRequest: {
          type: 'object',
          properties: {
            driver_id:        { type: 'string', format: 'uuid', nullable: true },
            type:             { type: 'string', nullable: true },
            category:         { type: 'string', enum: ['small', 'medium', 'large', 'part'] },
            capacity:         { type: 'string', nullable: true },
            make:             { type: 'string', nullable: true },
            year:             { type: 'integer', nullable: true },
            insurance_expiry: { type: 'string', format: 'date', nullable: true },
            status:           { type: 'string', enum: ['available', 'on_trip', 'maintenance'] },
          },
        },

        DriverProfile: {
          type: 'object',
          properties: {
            id:             { type: 'string', format: 'uuid' },
            name:           { type: 'string' },
            phone:          { type: 'string' },
            brokerId:       { type: 'string', format: 'uuid' },
            licenseNo:      { type: 'string', nullable: true },
            licenseExpiry:  { type: 'string', format: 'date', nullable: true },
            aadhaar:        { type: 'string', nullable: true, example: 'XXXX-XXXX-1234' },
            truckId:        { type: 'string', format: 'uuid', nullable: true },
            truckReg:       { type: 'string', nullable: true },
            totalTrips:     { type: 'integer' },
            avatar:         { type: 'string', nullable: true },
            status:         { type: 'string', enum: ['available', 'on_trip', 'offline'] },
            kycStatus:      { type: 'string', enum: ['pending', 'submitted', 'verified', 'rejected'] },
            currentLat:     { type: 'number', nullable: true, description: 'Last location reported via PATCH /api/vehicles/drivers/me/location' },
            currentLng:     { type: 'number', nullable: true },
            lastLocationAt: { type: 'string', format: 'date-time', nullable: true },
            distanceKm:     { type: 'number', nullable: true, description: 'Only present when GET /api/vehicles/drivers was called with near_lat/near_lng' },
          },
        },

        CreateDriverRequest: {
          type: 'object',
          required: ['user_id'],
          properties: {
            user_id:        { type: 'string', format: 'uuid', description: 'Existing user with role=driver' },
            license_no:     { type: 'string', nullable: true },
            license_expiry: { type: 'string', format: 'date', nullable: true },
            aadhaar:        { type: 'string', nullable: true },
            truck_id:       { type: 'string', format: 'uuid', nullable: true },
            avatar:         { type: 'string', nullable: true },
            broker_id:      { type: 'string', format: 'uuid', nullable: true, description: "Required when called by an admin (driver_profiles.broker_id is NOT NULL) — the broker whose fleet this driver joins. Ignored for a broker caller, who always adds to their own fleet regardless of what's sent here." },
          },
        },

        RegisterDriverRequest: {
          type: 'object',
          required: ['name', 'phone', 'email'],
          description: 'Creates a brand-new driver users row and links it to a fleet in one step — unlike CreateDriverRequest, which requires the driver to already have an account.',
          properties: {
            name:           { type: 'string', example: 'Ramesh Kumar' },
            phone:          { type: 'string', example: '9876543210' },
            email:          { type: 'string', format: 'email', example: 'ramesh.driver@gmail.com' },
            license_no:     { type: 'string', nullable: true },
            license_expiry: { type: 'string', format: 'date', nullable: true },
            aadhaar:        { type: 'string', nullable: true, description: '12 digits' },
            truck_id:       { type: 'string', format: 'uuid', nullable: true },
            broker_id:      { type: 'string', format: 'uuid', nullable: true, description: 'Required when called by an admin — the broker whose fleet this driver joins. Ignored for a broker caller.' },
          },
        },

        UpdateDriverRequest: {
          type: 'object',
          properties: {
            license_no:     { type: 'string', nullable: true },
            license_expiry: { type: 'string', format: 'date', nullable: true },
            aadhaar:        { type: 'string', nullable: true },
            truck_id:       { type: 'string', format: 'uuid', nullable: true },
            avatar:         { type: 'string', nullable: true },
            status:         { type: 'string', enum: ['available', 'on_trip', 'offline'] },
          },
        },

        // ── Broker profile ────────────────────────────────────────────────────
        BrokerProfile: {
          type: 'object',
          properties: {
            serviceCity: { type: 'string', nullable: true, example: 'Mumbai', description: 'Narrows which new bookings get broadcast to this broker — null means never set, treated as no zone restriction' },
            isOnline:    { type: 'boolean', example: true, description: 'While false, this broker is excluded from new booking job-request broadcasts. Defaults true if never explicitly set.' },
          },
        },

        // ── Jobs / Trips ────────────────────────────────────────────────────
        JobRequest: {
          type: 'object',
          description: "A single broker's offer on a booking. Job requests never expire on their own — 'pending' means it's that side's turn to respond (see status description).",
          properties: {
            id:            { type: 'string', format: 'uuid' },
            bookingId:     { type: 'string', format: 'uuid' },
            bookingNumber: { type: 'string', example: 'BKG-202412-003', description: 'Short human-readable reference for display' },
            clientName:  { type: 'string' },
            clientPhone: { type: 'string' },
            brokerName:  { type: 'string', nullable: true },
            brokerPhone: { type: 'string', nullable: true },
            pickup:      { type: 'string' },
            drop:        { type: 'string' },
            distance:    { type: 'number', nullable: true },
            truckType:   { type: 'string', nullable: true },
            weight:      { type: 'string', nullable: true, example: '3.5 tons' },
            amount:      { type: 'number', nullable: true, description: 'The latest offer amount — matches the most recent entry in offerHistory' },
            status: {
              type: 'string',
              enum: ['pending', 'countered', 'accepted', 'expired', 'declined'],
              description: "pending = awaiting the broker's response (fresh broadcast, or the client just countered back); countered = the broker countered and it's awaiting the client's response; accepted/declined are terminal.",
            },
            offerHistory: {
              type: 'array',
              description: 'Full negotiation back-and-forth, oldest first — not just the latest number.',
              items: { $ref: '#/components/schemas/OfferHistoryEntry' },
            },
            timestamp:   { type: 'string', example: '2 min ago' },
          },
        },

        OfferHistoryEntry: {
          type: 'object',
          properties: {
            by:     { type: 'string', enum: ['client', 'broker'] },
            amount: { type: 'number' },
            note:   { type: 'string', nullable: true },
            at:     { type: 'string', format: 'date-time' },
          },
        },

        BookingOffer: {
          type: 'object',
          description: "One broker's negotiation offer on a booking — the booking-scoped view of a JobRequest, returned by GET /api/bookings/{id}/offers.",
          properties: {
            id:           { type: 'string', format: 'uuid', description: 'The underlying job_request id — used with the /api/jobs/requests/{id}/... negotiation endpoints' },
            brokerId:     { type: 'string', format: 'uuid' },
            brokerName:   { type: 'string', nullable: true },
            brokerPhone:  { type: 'string', nullable: true },
            amount:       { type: 'number', nullable: true },
            status:       { type: 'string', enum: ['pending', 'countered', 'accepted', 'expired', 'declined'] },
            offerHistory: { type: 'array', items: { $ref: '#/components/schemas/OfferHistoryEntry' } },
            createdAt:    { type: 'string', format: 'date-time' },
          },
        },

        Trip: {
          type: 'object',
          properties: {
            id:             { type: 'string', format: 'uuid' },
            bookingId:      { type: 'string', format: 'uuid' },
            bookingNumber:  { type: 'string', example: 'BKG-202412-003', description: 'Short human-readable reference for display' },
            status:         { type: 'string' },
            broker:         { type: 'string', nullable: true },
            brokerPhone:    { type: 'string', nullable: true },
            clientName:     { type: 'string' },
            clientPhone:    { type: 'string' },
            pickup: {
              type: 'object',
              properties: {
                location: { type: 'string', nullable: true }, address: { type: 'string', nullable: true },
                contactPerson: { type: 'string', nullable: true }, contactPhone: { type: 'string', nullable: true },
                time: { type: 'string', format: 'date-time', nullable: true }, lat: { type: 'number', nullable: true }, lng: { type: 'number', nullable: true },
              },
            },
            drop: {
              type: 'object',
              properties: {
                location: { type: 'string', nullable: true }, address: { type: 'string', nullable: true },
                contactPerson: { type: 'string', nullable: true }, contactPhone: { type: 'string', nullable: true },
                time: { type: 'string', format: 'date-time', nullable: true }, lat: { type: 'number', nullable: true }, lng: { type: 'number', nullable: true },
              },
            },
            distance:       { type: 'number', nullable: true },
            estimatedTime:  { type: 'string', nullable: true },
            cargo: {
              type: 'object',
              properties: {
                material: { type: 'string', nullable: true }, weight: { type: 'number', nullable: true },
                quantity: { type: 'integer', nullable: true }, specialInstructions: { type: 'string', nullable: true },
                value: { type: 'number', nullable: true },
              },
            },
            earnings:       { type: 'number', nullable: true },
            startedAt:      { type: 'string', format: 'date-time', nullable: true },
            currentLocation: { type: 'object', properties: { lat: { type: 'number', nullable: true }, lng: { type: 'number', nullable: true } } },
            podUrl:         { type: 'string', nullable: true },
            timeline: {
              type: 'array',
              items: { type: 'object', properties: { step: { type: 'string' }, done: { type: 'boolean' }, time: { type: 'string', format: 'date-time', nullable: true } } },
            },
          },
        },

        TripIncident: {
          type: 'object',
          properties: {
            id:         { type: 'string', format: 'uuid' },
            tripId:     { type: 'string', format: 'uuid' },
            driverId:   { type: 'string', format: 'uuid' },
            reason:     { type: 'string', enum: ['accident', 'breakdown', 'traffic_block', 'medical', 'other'] },
            notes:      { type: 'string', nullable: true },
            status:     { type: 'string', enum: ['reported', 'acknowledged', 'resolved'] },
            reportedAt: { type: 'string', format: 'date-time' },
            resolvedAt: { type: 'string', format: 'date-time', nullable: true },
            resolution: { type: 'string', nullable: true, description: 'Set only once status is resolved' },
            mechanicRequest: {
              allOf: [{ $ref: '#/components/schemas/MechanicRequest' }],
              nullable: true,
              description: "Only populated when reason='breakdown' — every breakdown report gets one of these automatically. Null for every other reason.",
            },
            bookingId:     { type: 'string', format: 'uuid', description: 'GET /api/admin/incidents only' },
            bookingNumber: { type: 'string', example: 'BKG-202412-003', description: 'GET /api/admin/incidents only' },
            driverName:    { type: 'string', nullable: true, description: 'GET /api/admin/incidents only' },
            driverPhone:   { type: 'string', nullable: true, description: 'GET /api/admin/incidents only — click-to-call on the admin dashboard' },
            brokerId:      { type: 'string', format: 'uuid', nullable: true, description: 'GET /api/admin/incidents only' },
            brokerName:    { type: 'string', nullable: true, description: 'GET /api/admin/incidents only' },
            brokerPhone:   { type: 'string', nullable: true, description: 'GET /api/admin/incidents only — click-to-call on the admin dashboard' },
          },
        },

        MechanicRequest: {
          type: 'object',
          description: 'Breakdown-assistance dispatch sub-workflow, one per breakdown trip_incident. Simple text fields for the mechanic — not a full mechanic user role.',
          properties: {
            id:             { type: 'string', format: 'uuid' },
            status:         { type: 'string', enum: ['requested', 'mechanic_assigned', 'in_progress', 'resolved'] },
            mechanicName:   { type: 'string', nullable: true },
            mechanicPhone:  { type: 'string', nullable: true },
            notes:          { type: 'string', nullable: true, description: "Broker's dispatch notes — separate from the driver's original report notes on the parent incident" },
            updatedAt:      { type: 'string', format: 'date-time' },
          },
        },

        // ── Payments / Disputes ─────────────────────────────────────────────
        Settlement: {
          type: 'object',
          properties: {
            id:           { type: 'string', format: 'uuid' },
            bookingId:    { type: 'string', format: 'uuid' },
            bookingNumber: { type: 'string', example: 'BKG-202412-003', description: 'Short human-readable reference for display' },
            brokerId:     { type: 'string', format: 'uuid', nullable: true },
            driverId:     { type: 'string', format: 'uuid', nullable: true },
            route:        { type: 'string', example: 'Pune -> Mumbai' },
            truck:        { type: 'string', nullable: true },
            driver:       { type: 'string', nullable: true },
            amount:       { type: 'number' },
            platformFee:  { type: 'number' },
            net:          { type: 'number' },
            netEarnings:  { type: 'number' },
            status:       { type: 'string', enum: ['paid', 'pending'] },
            settledAt:    { type: 'string', format: 'date-time', nullable: true },
            date:         { type: 'string', format: 'date-time' },
          },
        },

        CreateDisputeRequest: {
          type: 'object',
          required: ['booking_id', 'issue_type', 'description'],
          properties: {
            booking_id:  { type: 'string', format: 'uuid' },
            issue_type: {
              type: 'string',
              enum: ['damaged_goods', 'payment_delay', 'cancellation_fee', 'route_dispute', 'late_delivery', 'fuel_surcharge', 'wrong_items', 'weight_discrepancy'],
            },
            description: { type: 'string' },
          },
        },

        Dispute: {
          type: 'object',
          properties: {
            id:           { type: 'string', format: 'uuid' },
            disputeNumber: { type: 'string', example: 'DSP-003', description: 'Short human-readable reference for display' },
            bookingId:    { type: 'string', format: 'uuid' },
            bookingNumber: { type: 'string', example: 'BKG-202412-003', description: 'Short human-readable reference for display' },
            raisedBy:     { type: 'string', enum: ['client', 'broker'] },
            raisedByName: { type: 'string' },
            raisedByPhone: { type: 'string', nullable: true },
            issueType:    { type: 'string' },
            description:  { type: 'string' },
            status:       { type: 'string', enum: ['open', 'under_review', 'resolved'] },
            resolution:   { type: 'string', nullable: true },
            date:         { type: 'string', format: 'date-time' },
            clientName:   { type: 'string', nullable: true, description: 'Admin projection only — every party on the underlying booking, not just whoever raised the dispute' },
            clientPhone:  { type: 'string', nullable: true, description: 'Admin projection only — click-to-call on the admin dashboard' },
            brokerName:   { type: 'string', nullable: true, description: 'Admin projection only' },
            brokerPhone:  { type: 'string', nullable: true, description: 'Admin projection only — click-to-call on the admin dashboard' },
            driverName:   { type: 'string', nullable: true, description: 'Admin projection only' },
            driverPhone:  { type: 'string', nullable: true, description: 'Admin projection only — click-to-call on the admin dashboard' },
          },
        },

        // ── Admin analytics / settings ──────────────────────────────────────
        DashboardStats: {
          type: 'object',
          properties: {
            totalBookings:      { type: 'integer' },
            activeTrips:        { type: 'integer' },
            totalRevenue:       { type: 'number' },
            registeredTrucks:   { type: 'integer' },
            bookingsChange:     { type: 'number', example: 12.5 },
            activeTripsChange:  { type: 'number', example: -3.2 },
            revenueChange:      { type: 'number', example: 8.1 },
            trucksChange:       { type: 'number', example: 0 },
          },
        },

        UpdateSettingsRequest: {
          type: 'object',
          properties: {
            platform_name:      { type: 'string' },
            contact_email:      { type: 'string', format: 'email' },
            commission_rate:    { type: 'number', example: 10 },
            email_alerts:       { type: 'boolean' },
            sms_alerts:         { type: 'boolean' },
            push_notifications: { type: 'boolean' },
          },
        },

        // ── Chat ──────────────────────────────────────────────────────────────
        ChatThread: {
          type: 'object',
          description: "One per booking, created lazily on first access. Participants (client + assigned broker + assigned driver) are derived live from the booking, not stored here — a driver reassignment changes who can see the thread automatically. Real-time delivery/typing/read-receipts happen over socket.io (not documented here); see the 'join-thread', 'send-message', 'typing', and 'read' events.",
          properties: {
            id:            { type: 'string', format: 'uuid' },
            bookingId:     { type: 'string', format: 'uuid' },
            bookingNumber: { type: 'string', example: 'BKG-202412-003', nullable: true },
          },
        },

        ChatMessage: {
          type: 'object',
          properties: {
            id:         { type: 'string', format: 'uuid' },
            threadId:   { type: 'string', format: 'uuid' },
            senderId:   { type: 'string', format: 'uuid' },
            senderName: { type: 'string' },
            senderRole: { type: 'string', enum: ['client', 'broker', 'driver', 'admin'] },
            message:    { type: 'string', maxLength: 2000 },
            readAt:     { type: 'string', format: 'date-time', nullable: true },
            createdAt:  { type: 'string', format: 'date-time' },
          },
        },
      },
    },

    tags: [
      {
        name: 'Health',
        description: 'Server and database health check',
      },
      {
        name: 'Config',
        description: 'Public master-data lookups (vehicle types, material types, cities, distance estimates) that power booking-form dropdowns. No auth required.',
      },
      {
        name: 'Auth',
        description: 'Authentication for all roles (admin, broker, driver, client). One login, one register, OTP verification, password management, token refresh, and logout.',
      },
      {
        name: 'User Profile',
        description: 'Profile management for any authenticated user (all roles): view/update profile (name, photo, address, company name), change password.',
      },
      {
        name: 'Notifications',
        description: 'Bell-icon notifications for any authenticated user: list, mark one read, mark all read.',
      },
      {
        name: 'KYC',
        description: 'Broker/driver document verification: submit documents, check own status, and an admin review queue (approve/reject).',
      },
      {
        name: 'Admin Management',
        description: 'Admin-only endpoints: list, view, block/unblock, and delete users across all roles.',
      },
      {
        name: 'Bookings',
        description: 'Client booking lifecycle: create (system price or a client-proposed price), list (role-scoped), view, live-track, advance status through the delivery pipeline, and view incoming broker negotiation offers.',
      },
      {
        name: 'Pricing',
        description: 'Price quoting (intra/inter-city/part-load breakdowns) and the admin-managed pricing configuration.',
      },
      {
        name: 'Vehicles',
        description: 'Fleet management: trucks and driver profiles. Brokers manage their own fleet; admin can also register a truck/driver directly on behalf of a chosen broker (broker_id required in that case).',
      },
      {
        name: 'Broker',
        description: 'Broker-only profile settings: service city (for zoned job broadcast) and online/offline availability.',
      },
      {
        name: 'Jobs',
        description: "Broker job requests generated from bookings, plus the inDrive-style negotiation on top of them — brokers can accept/decline/counter, and the client can accept/reject/counter back via the linked booking offers (GET /api/bookings/{bookingId}/offers). Job requests never auto-expire; 'pending' vs 'countered' tracks whose turn it is to respond.",
      },
      {
        name: 'Trips',
        description: 'Active trip tracking for brokers/drivers: status, live location, proof of delivery, incident reporting (including the breakdown/mechanic-dispatch sub-workflow), and incident resolution.',
      },
      {
        name: 'Payments',
        description: 'Settlement records and broker/driver earnings analytics.',
      },
      {
        name: 'Disputes',
        description: 'Client/broker dispute reporting and admin resolution.',
      },
      {
        name: 'Admin Analytics',
        description: 'Admin dashboard stats, platform-wide analytics, and platform settings.',
      },
      {
        name: 'Chat',
        description: "Live per-booking chat between the client, assigned broker, and assigned driver. REST here is the source of truth/history (get-or-create thread, paginated message list, send, mark-read, unread count); real-time delivery is over socket.io — see 'join-thread'/'leave-thread', 'send-message', 'typing', and 'read' events (JWT auth via the socket handshake, same access token as the REST API). Admin can view any thread read-only.",
      },
    ],
  },
  apis: ['./src/routes/*.js'],
};

module.exports = swaggerJsdoc(options);

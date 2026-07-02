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
            last_login_at:     { type: 'string',  format: 'date-time', nullable: true },
            created_at:        { type: 'string',  format: 'date-time' },
            updated_at:        { type: 'string',  format: 'date-time' },
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
      },
    },

    tags: [
      {
        name: 'Health',
        description: 'Server and database health check',
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
        name: 'Admin Management',
        description: 'Admin-only endpoints: list, view, block/unblock, and delete users across all roles.',
      },
    ],
  },
  apis: ['./src/routes/*.js'],
};

module.exports = swaggerJsdoc(options);

const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'SSK Logistics — Auth & User Management API',
      version: '1.0.0',
      contact: {
        name: 'SSK Logistics Dev Team',
        email: 'dev@ssklogistics.in',
      },
    },
    servers: [
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
          description: 'Enter your JWT access token',
        },
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id:                  { type: 'string', format: 'uuid', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
            name:                { type: 'string', example: 'Rajesh Kumar' },
            email:               { type: 'string', format: 'email', example: 'rajesh@example.com' },
            phone:               { type: 'string', example: '9876543210' },
            role:                { type: 'string', enum: ['client', 'broker', 'driver', 'admin'], example: 'client' },
            status:              { type: 'string', enum: ['active', 'inactive', 'blocked', 'pending_verification'], example: 'active' },
            is_phone_verified:   { type: 'boolean', example: true },
            is_email_verified:   { type: 'boolean', example: false },
            profile_image:       { type: 'string', nullable: true, example: null },
            last_login_at:       { type: 'string', format: 'date-time', nullable: true },
            created_at:          { type: 'string', format: 'date-time' },
            updated_at:          { type: 'string', format: 'date-time' },
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
        SuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Operation successful' },
            data:    { type: 'object' },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Something went wrong' },
            errors:  { type: 'array', items: { type: 'object' }, nullable: true },
          },
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
      { name: 'Auth',         description: 'Authentication — register, login, OTP, token refresh, logout' },
      { name: 'User Profile', description: 'Authenticated user — get/update own profile, change password' },
      { name: 'Admin Users',  description: 'Admin-only — list, view, block/unblock, delete users' },
    ],
  },
  apis: ['./src/routes/*.js'],
};

module.exports = swaggerJsdoc(options);

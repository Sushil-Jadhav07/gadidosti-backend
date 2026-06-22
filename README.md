# SSK Logistics — Auth & User Management API

Node.js + Express + PostgreSQL backend for the SSK Logistics platform.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express.js |
| Database | PostgreSQL |
| ORM | Raw `pg` (no ORM) |
| Auth | JWT (access + refresh token rotation) |
| Validation | express-validator |
| Docs | Swagger UI (swagger-jsdoc) |
| Security | helmet, cors, express-rate-limit, bcryptjs |
| Logging | Winston + Morgan |

---

## Project Structure

```
ssk-auth/
├── src/
│   ├── config/
│   │   ├── db.js              # PostgreSQL pool
│   │   ├── migrate.js         # Run DB migrations
│   │   ├── seed.js            # Seed test users
│   │   └── swagger.js         # Swagger spec config
│   ├── controllers/
│   │   ├── auth.controller.js # Register, login, OTP, refresh, logout
│   │   └── user.controller.js # Profile, admin user management
│   ├── middleware/
│   │   ├── auth.middleware.js       # JWT verify + role check
│   │   ├── validate.middleware.js   # express-validator handler
│   │   └── errorHandler.middleware.js
│   ├── models/
│   │   ├── user.model.js
│   │   ├── otp.model.js
│   │   ├── refreshToken.model.js
│   │   └── auditLog.model.js
│   ├── routes/
│   │   ├── auth.routes.js     # /api/auth/*
│   │   ├── user.routes.js     # /api/user/* and /api/admin/users/*
│   │   └── health.routes.js   # /api/health
│   ├── utils/
│   │   ├── jwt.js             # Token generation/verification
│   │   ├── response.js        # Standardised response helpers
│   │   └── logger.js          # Winston logger
│   ├── validations/
│   │   └── auth.validation.js # express-validator rules
│   ├── app.js                 # Express app setup
│   └── server.js              # Entry point
├── .env.example
├── .gitignore
└── package.json
```

---

## Quick Start

### 1. Clone and install

```bash
cd ssk-auth
npm install
```

### 2. Set up environment

```bash
cp .env.example .env
# Edit .env with your PostgreSQL credentials and JWT secrets
```

### 3. Create PostgreSQL database

```sql
CREATE DATABASE ssk_logistics;
```

### 4. Run migrations

```bash
npm run migrate
```

### 5. Seed test users (optional)

```bash
npm run seed
```

Test credentials after seeding:
| Role | Phone | Password |
|---|---|---|
| Admin | 9000000001 | Admin@123456 |
| Client | 9000000002 | Admin@123456 |
| Broker | 9000000003 | Admin@123456 |
| Driver | 9000000004 | Admin@123456 |

### 6. Start server

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

---

## API Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | — | Register new user |
| POST | `/api/auth/login` | — | Login with phone + password |
| POST | `/api/auth/otp/send` | — | Send OTP to phone |
| POST | `/api/auth/otp/verify` | — | Verify OTP |
| POST | `/api/auth/refresh-token` | — | Refresh access token |
| POST | `/api/auth/logout` | ✅ | Logout |
| GET | `/api/user/profile` | ✅ | Get own profile |
| PUT | `/api/user/profile` | ✅ | Update own profile |
| PUT | `/api/user/change-password` | ✅ | Change password |
| GET | `/api/admin/users` | ✅ Admin | List all users |
| GET | `/api/admin/users/:id` | ✅ Admin | Get user by ID |
| PATCH | `/api/admin/users/:id/status` | ✅ Admin | Block/unblock user |
| DELETE | `/api/admin/users/:id` | ✅ Admin | Delete user |
| GET | `/api/health` | — | Health check |

---

## Swagger Docs

After starting the server, open:

```
http://localhost:5000/api-docs
```

Click **Authorize** and paste your Bearer token to test protected routes.

---

## Auth Flow

```
1. Register         POST /api/auth/register
2. Send OTP         POST /api/auth/otp/send   { phone, purpose: "registration" }
3. Verify OTP       POST /api/auth/otp/verify  { phone, otp, purpose: "registration" }
4. Login            POST /api/auth/login        → returns access_token + refresh_token
5. Use API          Authorization: Bearer <access_token>
6. Refresh          POST /api/auth/refresh-token  { refresh_token }
7. Logout           POST /api/auth/logout
```

---

## Security Features

- **Password hashing** — bcryptjs with 12 salt rounds
- **JWT rotation** — refresh tokens are rotated on every use
- **Rate limiting** — 100 req/15min global, 20 req/15min auth, 5 req/10min OTP
- **Input validation** — express-validator on all endpoints
- **Helmet** — security headers
- **Audit log** — every auth action is logged to `audit_logs` table
- **Soft delete** — users are never hard-deleted
- **Role guards** — admin-only routes protected by `authorize('admin')`

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | Server port | 5000 |
| `DB_HOST` | PostgreSQL host | localhost |
| `DB_PORT` | PostgreSQL port | 5432 |
| `DB_NAME` | Database name | ssk_logistics |
| `DB_USER` | Database user | postgres |
| `DB_PASSWORD` | Database password | — |
| `JWT_SECRET` | Access token secret | — |
| `JWT_EXPIRES_IN` | Access token expiry | 7d |
| `JWT_REFRESH_SECRET` | Refresh token secret | — |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token expiry | 30d |
| `OTP_EXPIRY_MINUTES` | OTP validity window | 10 |

---

## Next Steps (Future Modules)

- `POST /api/kyc/broker/submit` — KYC module
- `POST /api/bookings` — Bookings module
- `POST /api/pricing/estimate` — Pricing engine
- `POST /api/tracking/location` — Live tracking (WebSocket)
- `POST /api/payments/initiate` — Razorpay integration

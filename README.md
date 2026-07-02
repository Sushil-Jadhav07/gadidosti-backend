# SSK Logistics — Auth & User Management API

Node.js + Express + PostgreSQL backend for the SSK Logistics platform.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express.js |
| Database | PostgreSQL (raw `pg`, no ORM) |
| Auth | JWT (access + refresh token rotation), Google Sign-In |
| Validation | express-validator |
| Docs | Swagger UI (swagger-jsdoc + swagger-ui-express) |
| Security | helmet, cors, express-rate-limit, bcryptjs |
| Logging | Winston + Morgan |

---

## Project Structure

```
backend/
├── db/
│   ├── 01users.sql            # Core schema: users, otps, refresh_tokens, audit_logs
│   └── 02googleauth.sql       # Adds google_id / auth_provider columns to users
├── logs/
│   ├── combined.log           # Winston combined log
│   └── error.log              # Winston error log
├── src/
│   ├── config/
│   │   ├── db.js              # PostgreSQL pool
│   │   ├── migrate.js         # Run DB migrations (executes db/*.sql)
│   │   ├── seed.js            # Seed demo users
│   │   └── swagger.js         # Swagger spec config
│   ├── controllers/
│   │   ├── auth.controller.js         # Register, login, Google sign-in, OTP, refresh, logout, password reset
│   │   ├── user.controller.js         # Profile, admin user management
│   │   └── notification.controller.js # List / mark-read notifications
│   ├── middleware/
│   │   ├── auth.middleware.js       # JWT verify (authenticate) + role check (authorize)
│   │   ├── validate.middleware.js   # express-validator result handler
│   │   └── errorHandler.middleware.js
│   ├── models/
│   │   ├── user.model.js
│   │   ├── otp.model.js
│   │   ├── refreshToken.model.js
│   │   ├── auditLog.model.js
│   │   └── notification.model.js
│   ├── routes/
│   │   ├── auth.routes.js     # /api/auth/*
│   │   ├── user.routes.js     # /api/user/* and /api/admin/users/*
│   │   └── health.routes.js   # /api/health
│   ├── utils/
│   │   ├── jwt.js             # Token generation/verification
│   │   ├── response.js        # Standardised success/error response helpers
│   │   ├── logger.js          # Winston logger
│   │   └── googleClient.js    # Google OAuth2 client (ID token verification)
│   ├── validations/
│   │   └── auth.validation.js # express-validator rules
│   ├── app.js                 # Express app setup (middleware, routes, error handler)
│   └── server.js              # Entry point
├── .env.example
├── .gitignore
└── package.json
```

---

## Quick Start

### 1. Install dependencies

```bash
cd backend
npm install
```

### 2. Set up environment

```bash
cp .env.example .env
# Edit .env with your PostgreSQL credentials, JWT secrets, and Google client ID
```

### 3. Create the PostgreSQL database

```sql
CREATE DATABASE ssk_logistics;
```

### 4. Run migrations

```bash
npm run migrate
```

This executes the SQL files in `db/` in order — creates the `user_role`, `user_status`, and `otp_purpose` enums, the `users`, `otps`, `refresh_tokens`, and `audit_logs` tables, indexes, the `updated_at` trigger, and adds the Google Sign-In columns.

### 5. Seed demo users (optional)

```bash
npm run seed
```

Demo accounts (password for all is `Admin@123456`, login with **email**):

| Role | Email | Phone |
|---|---|---|
| Admin | admin@ssklogistics.in | 9000000001 |
| Client | client@ssklogistics.in | 9000000002 |
| Broker | broker@ssklogistics.in | 9000000003 |
| Driver | driver@ssklogistics.in | 9000000004 |

### 6. Start the server

```bash
# Development (auto-reload via nodemon)
npm run dev

# Production
npm start
```

Server starts on `http://localhost:5000` (or `PORT` from `.env`).

---

## API Endpoints

All routes are prefixed with `/api`.

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | — | Register as client, broker, or driver |
| POST | `/auth/admin/register` | ✅ Admin | Create a new admin account |
| POST | `/auth/login` | — | Login with email + password (all roles) |
| POST | `/auth/google` | — | Sign in / sign up with Google ID token |
| POST | `/auth/otp/send` | — | Send OTP to phone (`login` or `password_reset`) |
| POST | `/auth/otp/verify` | — | Verify OTP |
| POST | `/auth/forgot-password` | — | Request password-reset OTP |
| POST | `/auth/reset-password` | — | Reset password using OTP |
| POST | `/auth/refresh-token` | — | Rotate refresh token, issue new access token |
| POST | `/auth/logout` | ✅ | Revoke refresh token (or all devices) |
| GET | `/users/profile` | ✅ | Get own profile |
| PATCH | `/users/profile` | ✅ | Update own profile (name, email, photo, address, company name) |
| PATCH | `/users/change-password` | ✅ | Change password (requires current password) |
| GET | `/users/notifications` | ✅ | List own notifications, paginated |
| PATCH | `/users/notifications/:id/read` | ✅ | Mark one notification as read |
| PATCH | `/users/notifications/read-all` | ✅ | Mark all notifications as read |
| GET | `/admin/users` | ✅ Admin | List all users (paginated) |
| GET | `/admin/users/:id` | ✅ Admin | Get user by UUID |
| PATCH | `/admin/users/:id/status` | ✅ Admin | Set status: active / inactive / blocked |
| DELETE | `/admin/users/:id` | ✅ Admin | Soft-delete a user |
| GET | `/health` | — | Server + database health check |

Full request/response schemas, examples, and error codes are in Swagger (see below) or `src/routes/*.routes.js`.

---

## Swagger Docs

With the server running:

```
http://localhost:5000/api-docs         # Interactive Swagger UI
http://localhost:5000/api-docs.json    # Raw OpenAPI spec
```

Click **Authorize** and paste your Bearer access token to test protected routes.

---

## Auth Flows

**Email + password**
```
1. Register       POST /api/auth/register        { name, email, password, role }
2. Login           POST /api/auth/login            { email, password } → access_token + refresh_token
3. Use API         Authorization: Bearer <access_token>
4. Refresh         POST /api/auth/refresh-token    { refresh_token }
5. Logout          POST /api/auth/logout
```

**Google Sign-In**
```
1. Frontend gets a Google ID token (credential) via Google Sign-In
2. POST /api/auth/google   { id_token, role }
   - Existing Google account       → login
   - Email matches existing user   → account is linked, then login
   - No match                      → new account created with given role
```

**OTP / forgot password**
```
1. POST /api/auth/otp/send          { phone, purpose: "login" | "password_reset" }
2. POST /api/auth/otp/verify        { phone, otp, purpose }
   — or —
1. POST /api/auth/forgot-password   { phone }
2. POST /api/auth/reset-password    { phone, otp, new_password }
```

> Admin accounts cannot register via `/auth/register` or sign in via `/auth/google` — they must be created by an existing admin through `/auth/admin/register`.

---

## Database Schema

Defined in `db/01users.sql` (core) and `db/02googleauth.sql` (Google columns, also folded into `01users.sql`).

| Table | Purpose |
|---|---|
| `users` | All accounts (client, broker, driver, admin). `phone` is optional/unique, `email` is optional/unique, `google_id` for Google-linked accounts, `auth_provider` tracks `phone \| google \| both`, plus `address` and `company_name` profile fields. |
| `otps` | 6-digit OTP codes per phone + purpose, with expiry and attempt tracking. |
| `refresh_tokens` | Hashed (SHA-256) refresh tokens per device/session, supports rotation and revocation. |
| `audit_logs` | Append-only log of auth/admin actions (`USER_LOGIN`, `USER_BLOCKED`, `PASSWORD_CHANGED`, etc.). |
| `notifications` | Bell-icon notifications per user (`type`: booking \| payment \| system \| general), with `is_read` flag. |

ENUM types: `user_role` (`client \| broker \| driver \| admin`), `user_status` (`active \| inactive \| blocked \| pending_verification`), `otp_purpose` (`registration \| login \| password_reset \| phone_verify`).

---

## Security Features

- **Password hashing** — bcryptjs with 12 salt rounds
- **JWT rotation** — refresh tokens are rotated (and old ones revoked) on every use
- **Rate limiting** — 100 req/15min global, 20 req/15min auth, 5 req/10min OTP
- **Input validation** — express-validator on all endpoints
- **Helmet** — security headers (with `crossOriginOpenerPolicy` relaxed for the Google Sign-In popup)
- **Audit log** — auth and admin actions are recorded in `audit_logs`
- **Soft delete** — users are never hard-deleted (status set to `inactive`)
- **Role guards** — admin-only routes protected by `authorize('admin')`
- **JWT verification** — `authenticate` middleware re-fetches the user on every request and rejects blocked/inactive accounts

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | Server port | 5000 |
| `NODE_ENV` | Environment (`development` \| `production`) | development |
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
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 Client ID (Google Cloud Console) | — |
| `ALLOWED_ORIGINS` | Comma-separated CORS allow-list | `*` |
| `RATE_LIMIT_WINDOW_MS` | Global rate limit window (ms) | 900000 |
| `RATE_LIMIT_MAX` | Global rate limit max requests | 100 |

---

## NPM Scripts

| Script | Description |
|---|---|
| `npm start` | Start the server (production) |
| `npm run dev` | Start with nodemon (auto-reload) |
| `npm run migrate` | Run SQL migrations in `db/` |
| `npm run seed` | Seed demo users |

---

## Next Steps (Future Modules)

- `POST /api/kyc/broker/submit` — KYC module
- `POST /api/bookings` — Bookings module
- `POST /api/pricing/estimate` — Pricing engine
- `POST /api/tracking/location` — Live tracking (WebSocket)
- `POST /api/payments/initiate` — Razorpay integration

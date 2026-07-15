# SSK Logistics (GadiDosti) — Backend API

Node.js + Express + PostgreSQL backend for the SSK Logistics platform: client bookings, broker fleet management, driver trips, KYC verification, disputes, pricing, and the admin dashboard. Serves three frontends — the client app, the unified broker/driver app, and the admin dashboard.

This README covers setup and gives a one-line-per-endpoint map of the whole API. **Swagger (`/api-docs`) is the source of truth for full request/response schemas, validation rules, and examples** — this file intentionally doesn't duplicate that level of detail for every module.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express.js |
| Database | PostgreSQL (raw `pg`, no ORM) |
| Auth | JWT (access + refresh token rotation), Google Sign-In |
| Validation | express-validator |
| File uploads | multer (memory storage) + a pluggable `StorageProvider` (local disk or Postgres bytea) |
| Docs | Swagger UI (swagger-jsdoc + swagger-ui-express) |
| Security | helmet, cors, express-rate-limit, bcryptjs |
| Logging | Winston + Morgan |

---

## Project Structure

```
backend/
├── db/                         # Historical reference SQL, roughly one file per feature as it
│                                # shipped (01users.sql, 04kyc.sql, 06bookings.sql, ...). The
│                                # actual source of truth is src/config/migrate.js — a single
│                                # idempotent script (CREATE TABLE IF NOT EXISTS + defensive
│                                # ALTER statements) that folds every one of these in and runs
│                                # on every startup, not a sequential migration runner.
├── uploads/                     # Local-disk file storage when STORAGE_PROVIDER=fake (dev only)
├── logs/
│   ├── combined.log
│   └── error.log
├── src/
│   ├── config/
│   │   ├── db.js               # PostgreSQL pool
│   │   ├── migrate.js          # Full schema — runs automatically on every server start
│   │   ├── seed.js             # Seed demo accounts + sample bookings/trips/disputes/etc.
│   │   └── swagger.js          # Swagger spec (schemas + tag groups)
│   ├── controllers/            # One per resource — auth, user, notification, kyc, booking,
│   │                            # pricing, vehicle (trucks+drivers), broker, job, trip,
│   │                            # payment, dispute, admin, config
│   ├── middleware/
│   │   ├── auth.middleware.js       # JWT verify (authenticate) + role check (authorize)
│   │   ├── validate.middleware.js   # express-validator result handler
│   │   ├── upload.middleware.js     # multer, memory storage, 10MB limit
│   │   ├── idempotency.middleware.js
│   │   └── errorHandler.middleware.js
│   ├── models/                 # One per table/resource — see the schema list below
│   ├── providers/               # Swappable external-service interfaces, each with a "fake"
│   │   ├── payment/              # (working, no-external-credentials) default and a real
│   │   ├── sms/                  # implementation you drop in behind an env var:
│   │   ├── storage/              #   PAYMENT_PROVIDER, SMS_PROVIDER, STORAGE_PROVIDER,
│   │   └── location/             #   LOCATION_PROVIDER (all default to "fake")
│   ├── routes/                  # One per resource, mounted under /api — see endpoint map below
│   ├── utils/
│   │   ├── jwt.js               # Token generation/verification
│   │   ├── response.js          # Standardised success/error response helpers
│   │   ├── logger.js            # Winston logger
│   │   ├── fileUrl.js           # Absolute-URL helper for uploaded-file links
│   │   └── googleClient.js      # Google OAuth2 client (ID token verification)
│   ├── validations/              # express-validator rule sets, one file per resource
│   ├── app.js                    # Express app setup (middleware, routes, error handler)
│   └── server.js                 # Entry point — runs migrations, then starts listening
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
# Edit .env with your PostgreSQL credentials and JWT secrets at minimum
```

### 3. Create the PostgreSQL database

```sql
CREATE DATABASE ssk_logistics;
```

### 4. Run migrations

```bash
npm run migrate
```

Runs `src/config/migrate.js` — creates every table, enum, index, and trigger the API needs. Idempotent: safe to run repeatedly, and it also runs automatically on every `npm start`/`npm run dev`.

### 5. Seed demo data (optional)

```bash
npm run seed
```

Seeds demo accounts across all four roles, plus sample bookings/job requests/trips/disputes so the three frontends have something to show immediately. Demo accounts log in with **email**, password `Admin@123456`:

| Role | Email |
|---|---|
| Admin | admin@ssklogistics.in |
| Client | client@ssklogistics.in |
| Broker | broker@ssklogistics.in |
| Driver | driver@ssklogistics.in |

### 6. Start the server

```bash
npm run dev     # Development (nodemon, auto-reload)
npm start       # Production
```

Server starts on `http://localhost:5000` (or `PORT` from `.env`).

---

## Swagger Docs — full schemas, examples, error codes

```
http://localhost:5000/api-docs         # Interactive Swagger UI
http://localhost:5000/api-docs.json    # Raw OpenAPI spec
```

Click **Authorize** and paste a Bearer access token to try protected routes. Every endpoint below is documented there with its full request body, response shape, and possible error codes — this README only gives the one-line summary.

---

## API Endpoint Map

All routes are prefixed with `/api`. Auth column: `—` = public, otherwise the required role(s).

### Auth (`/auth/*`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | — | Register as client, broker, or driver |
| POST | `/auth/admin/register` | Admin | Create a new admin account |
| POST | `/auth/login` | — | Login with email + password (all roles) |
| POST | `/auth/google` | — | Sign in / sign up with Google ID token |
| POST | `/auth/otp/send` | — | Send OTP to phone (`login` or `password_reset`) |
| POST | `/auth/otp/verify` | — | Verify OTP |
| POST | `/auth/forgot-password` | — | Request password-reset OTP |
| POST | `/auth/reset-password` | — | Reset password using OTP |
| POST | `/auth/refresh-token` | — | Rotate refresh token, issue new access token |
| POST | `/auth/logout` | ✅ | Revoke refresh token (or all devices) |
| GET | `/auth/me` | ✅ | Get the current authenticated user |

### Users & Notifications (`/users/*`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/users/profile` | ✅ | Get own profile |
| PATCH | `/users/profile` | ✅ | Update own profile |
| PATCH | `/users/change-password` | ✅ | Change password (requires current password) |
| GET | `/users/notifications` | ✅ | List own notifications, paginated |
| PATCH | `/users/notifications/:id/read` | ✅ | Mark one notification as read |
| PATCH | `/users/notifications/read-all` | ✅ | Mark all notifications as read |

### KYC (`/kyc/*`, `/admin/kyc/*`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/kyc/broker` | Broker | Submit/resubmit broker KYC documents (`pan_number`, `aadhaar_number`, `gst_number`, `bank_account_number`, `business_registration_number`) |
| POST | `/kyc/driver` | Driver | Submit/resubmit driver KYC documents (`license_number`, `aadhaar_number`, `vehicle_registration_number`, `vehicle_insurance_number`) |
| POST | `/kyc/documents/upload` | Broker/Driver | Upload a document photo (multipart), merges its URL into the submission |
| GET | `/kyc/documents` | Broker/Driver | List own uploaded document files |
| GET | `/kyc/documents/file/:id` | Broker/Driver/Admin | Serve a file (when `STORAGE_PROVIDER=postgres`) |
| GET | `/kyc/status` | Broker/Driver | Get own KYC status + submission |
| GET | `/kyc/:userId` | Broker/Driver | Get own KYC by ID (404s for anyone else's) |
| GET | `/admin/kyc/pending` | Admin | List KYC submissions (defaults to the review queue) |
| GET | `/admin/kyc/:userId` | Admin | Get any user's KYC submission |
| GET | `/admin/kyc/:userId/documents` | Admin | List any user's uploaded document files |
| PATCH | `/admin/kyc/:userId/verify` | Admin | Approve KYC |
| PATCH | `/admin/kyc/:userId/reject` | Admin | Reject KYC with a reason |

### Bookings & Pricing (`/bookings/*`, `/pricing/*`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/bookings` | Client | Create a booking — broadcasts a job request to eligible brokers |
| GET | `/bookings` | ✅ | List bookings, role-scoped, paginated/filterable |
| GET | `/bookings/:id` | ✅ | Get a booking (includes `rating`, `podUrl`, pricing breakdown) |
| GET | `/bookings/:id/track` | ✅ | Live tracking snapshot — driver location, ETA, latest unresolved incident |
| PATCH | `/bookings/:id/status` | Admin | **Manual override only** — not part of the normal flow; `PATCH /trips/:id/status` drives real progression and keeps this in sync automatically |
| PATCH | `/bookings/:id/cancel` | Client/Admin | Cancel a booking |
| PATCH | `/bookings/:id/pay` | Client | Record payment |
| POST | `/bookings/:id/rate` | Client | Client Rating of a completed delivery (1–5 stars + optional review) |
| POST | `/bookings/quote`, `/pricing/estimate` | ✅ | Estimate price for a prospective booking |
| GET | `/admin/pricing` | ✅ | Get platform pricing config |
| PUT | `/admin/pricing` | Admin | Update pricing config |

### Vehicles — Trucks & Drivers (`/vehicles/*`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/vehicles/trucks` | Broker | Add a truck to the fleet |
| GET | `/vehicles/trucks` | Broker/Admin | List trucks |
| GET | `/vehicles/trucks/:id` | Broker/Admin | Get a truck |
| PATCH | `/vehicles/trucks/:id` | Broker/Admin | Update a truck |
| DELETE | `/vehicles/trucks/:id` | Broker/Admin | Remove a truck (blocked if it has booking history) |
| GET | `/vehicles/drivers/lookup` | Broker | Find an existing driver account by phone, to link |
| POST | `/vehicles/drivers` | Broker | Link an existing driver-role account to the broker's fleet |
| POST | `/vehicles/drivers/register` | Broker | Register a brand-new driver account and add them to the fleet in one step (returns a one-time temp password) |
| GET | `/vehicles/drivers` | Broker/Admin | List drivers |
| GET | `/vehicles/drivers/:id` | Broker/Admin | Get a driver |
| PATCH | `/vehicles/drivers/:id` | Broker/Admin | Edit a driver's license/Aadhaar/truck/status |
| DELETE | `/vehicles/drivers/:id` | Broker/Admin | Unlink a driver (blocked if they have booking history) |
| PATCH | `/vehicles/drivers/me/location` | Driver | Ping current location |

### Broker Profile (`/broker/*`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| PATCH | `/broker/service-city` | Broker | Set the city used to match incoming job requests |
| PATCH | `/broker/availability` | Broker | Toggle online/offline |

### Jobs (`/jobs/*`)

Job requests never expire — they stay `pending` until the broker accepts or declines (no cron sweep, no auto-`no_broker_available`; see `AnalyticsModel.dashboard`'s `stalePendingBookings` for operational visibility instead).

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/jobs/requests` | Broker | List the broker's job requests |
| PATCH | `/jobs/requests/:id/accept` | Broker | Accept a job request (first-to-accept wins; others auto-decline) |
| PATCH | `/jobs/requests/:id/decline` | Broker | Decline a job request |
| POST | `/jobs/:id/assign-driver` | Broker | Assign a driver + truck once a job request is accepted |

### Trips (`/trips/*`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/trips` | Broker/Driver/Admin | List trips, role-scoped |
| GET | `/trips/active` | Driver | The driver's current in-progress trip |
| GET | `/trips/upcoming` | Driver | The driver's next not-yet-started trip |
| GET | `/trips/:id` | Broker/Driver/Admin | Get a trip |
| PATCH | `/trips/:id/status` | Broker/Driver/Admin | Advance trip status — the transition into `completed` is atomic (`completeIfNotAlready`) and is the *only* place settlement + `total_trips` are created, exactly once per trip |
| POST | `/trips/:id/decline` | Driver | Decline a not-yet-started trip |
| PATCH | `/trips/:id/location` | Driver | Update live location |
| POST | `/trips/:id/report-issue` | Driver | Report an incident (accident/breakdown/traffic/medical/other) |
| GET | `/trips/:id/incidents` | ✅ | List incidents for one trip |
| PATCH | `/trips/:id/incidents/:incidentId/resolve` | Broker/Admin | Resolve an incident |
| POST | `/trips/:id/pod` | Driver | Upload proof-of-delivery photo (multipart) — only while `in_transit`/`delivered` |
| GET | `/trips/pod/file/:id` | ✅ | Serve a POD file (when `STORAGE_PROVIDER=postgres`) |

### Payments (`/payments/*`, `/analytics/broker`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/payments/settlements` | Broker/Driver/Admin | List settlements, role-scoped |
| GET | `/analytics/broker` | Broker/Driver | Earnings summary (this month vs last month) |

### Disputes (`/disputes/*`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/disputes` | Client/Broker | Raise a dispute on a booking |
| GET | `/disputes` | ✅ | List disputes, role-scoped (unscoped for admin) |
| GET | `/disputes/:id` | ✅ | Get a dispute (owner or admin only) |
| PATCH | `/disputes/:id/resolve` | Admin | Resolve a dispute |

### Admin (`/admin/*`, `/analytics/admin`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/admin/dashboard` | Admin | Summary stats — bookings/trips/revenue/trucks + `stalePendingBookings` and `openIncidents` counts |
| GET | `/admin/incidents` | Admin | List open trip incidents platform-wide, with booking/driver/broker context |
| GET | `/analytics/admin` | Admin | Chart-series data (GMV, revenue, top clients, fleet utilization, booking sparkline) |
| GET | `/admin/settings` | Admin | Get platform settings |
| PUT | `/admin/settings` | Admin | Update platform settings |
| GET | `/admin/users` | Admin | List all users |
| GET | `/admin/users/:id` | Admin | Get a user |
| PATCH | `/admin/users/:id/status` | Admin | Set status: active / inactive / blocked |
| DELETE | `/admin/users/:id` | Admin | Soft-delete a user |

### Config & misc

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/config/vehicle-types` | — | Truck type/category options for booking forms |
| GET | `/config/material-types` | — | Cargo material options |
| GET | `/config/cities` | — | Serviceable cities list |
| POST | `/config/distance` | — | Distance estimate between two points |
| GET | `/health` | — | Server + database health check |

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

> Admin accounts cannot register via `/auth/register` or sign in via `/auth/google` — they're created by an existing admin through `/auth/admin/register`.

---

## Database Schema

`src/config/migrate.js` is the actual source of truth (see Project Structure above); `db/*.sql` are kept as historical, roughly-one-per-feature reference. Core tables:

| Table | Purpose |
|---|---|
| `users` | All accounts (client/broker/driver/admin). `phone` unique+required, `email` unique+optional, Google-linked fields, `kyc_status`. |
| `otps`, `refresh_tokens`, `audit_logs`, `notifications` | Auth/session/audit/notification support — see the Auth README section above. |
| `kyc_submissions`, `kyc_files` | Freeform `documents` JSONB per broker/driver submission, plus uploaded document photos (bytea when `STORAGE_PROVIDER=postgres`). |
| `bookings`, `booking_timeline` | A client's shipment request through to delivery, plus its status-change history. Includes `rating` (Client Rating) and reads `pod_url` via a join to `trips`. |
| `job_requests` | One row per broker a booking is broadcast to. Never expire — see the Jobs section above. |
| `trucks`, `driver_profiles` | A broker's fleet. `driver_profiles.aadhaar` is a fallback; `kyc_submissions.documents.aadhaar_number` is canonical once KYC exists. |
| `trips`, `trip_timeline`, `trip_incidents`, `pod_files` | The operational side of an assigned booking — status progression, incident reports, and proof-of-delivery photos. |
| `settlements` | One row per completed trip (driver/broker payout), created exactly once via the atomic transition in `PATCH /trips/:id/status`. |
| `disputes` | Client/broker-raised issues on a booking, admin-resolved. |
| `pricing_config`, `admin_settings` | Platform-wide pricing rules and settings, admin-editable. |
| `idempotency_keys` | Backs the `idempotent()` middleware on a couple of retry-sensitive endpoints (`POST /bookings`, `PATCH /trips/:id/status`). |

---

## Security Features

- **Password hashing** — bcryptjs with 12 salt rounds
- **JWT rotation** — refresh tokens are rotated (and old ones revoked) on every use
- **Rate limiting** — global + tighter limits on auth and OTP endpoints
- **Input validation** — express-validator rules per endpoint (see `src/validations/`)
- **Helmet** — security headers (with `crossOriginOpenerPolicy` relaxed for the Google Sign-In popup)
- **Audit log** — auth, admin, and operational actions recorded in `audit_logs`
- **Soft delete** — users are never hard-deleted (status set to `inactive`)
- **Role guards** — `authorize(...roles)` middleware on every non-public route
- **Idempotency** — `POST /bookings` and `PATCH /trips/:id/status` accept an idempotency key to make retries safe
- **Atomic compare-and-swap** — used wherever a race would double-count something (job request acceptance, trip completion/settlement)

---

## Environment Variables

See `.env.example` for the full, commented list — highlights:

| Variable | Description | Default |
|---|---|---|
| `PORT` | Server port | 5000 |
| `NODE_ENV` | Environment (`development` \| `production`) | development |
| `API_BASE_URL` | Public base URL used to build absolute file-upload links | request's own origin |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | PostgreSQL connection | — |
| `JWT_SECRET` / `JWT_EXPIRES_IN` / `JWT_REFRESH_SECRET` / `JWT_REFRESH_EXPIRES_IN` | Token secrets/expiry | — / 7d / — / 30d |
| `OTP_EXPIRY_MINUTES` | OTP validity window | 10 |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 Client ID | — |
| `ALLOWED_ORIGINS` | Comma-separated CORS allow-list | `*` |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | Global rate limit | 900000 / 100 |
| `PAYMENT_PROVIDER` / `SMS_PROVIDER` / `STORAGE_PROVIDER` / `LOCATION_PROVIDER` | Provider selection — each defaults to `fake` (a working local implementation, no external credentials needed) | fake |

---

## NPM Scripts

| Script | Description |
|---|---|
| `npm start` | Start the server (production) |
| `npm run dev` | Start with nodemon (auto-reload) |
| `npm run migrate` | Run the full schema migration |
| `npm run seed` | Seed demo accounts + sample data |

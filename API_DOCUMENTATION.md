# SSK Logistics Backend — Complete API Reference

A logistics/trucking marketplace: clients book trucks, the booking is broadcast to brokers who counter-offer, the client picks a broker, the broker assigns a driver + truck, and a trip runs through pickup → delivery → settlement.

**Base path:** all routes are mounted under `/api`.
**Auth:** `Authorization: Bearer <access_token>` header. The `authenticate` middleware (`src/middleware/auth.middleware.js`) re-fetches the user row from the DB on every request (not just decoding the JWT) — a freshly blocked/inactive account is rejected with 403 even on a still-valid token; an expired/invalid token itself is 401. `authorize(...roles)` runs after `authenticate` and returns 403 if `req.user.role` (one of `client | broker | driver | admin`) isn't in the allowed list.
**Response envelope:** success → `{ success: true, message, data }`; error → `{ success: false, message, errors? }`.

## The core flow these APIs implement

1. Client `POST /api/bookings` — no broker/truck assigned yet.
2. Backend broadcasts the booking as a `job_request` row to every eligible broker (KYC-verified, active, online, zoned to the pickup city — falling back to *all* active brokers if none match that city).
3. Each broker can decline, counter (their own asking price), or wait; the client can counter or reject any individual broker's offer, and polls `GET /api/bookings/{id}/offers` to watch them update live.
4. Client calls `client-accept` on the offer they want — a compare-and-swap that locks in one broker, auto-declines every other broker's offer on the same booking, and confirms the booking.
5. The winning broker calls `POST /api/jobs/{id}/assign-driver` with a driver + truck they own — this creates the `trips` row, moves the booking to `assigned`, and notifies the driver.
6. The driver can decline (if not yet started) or progress the trip via `PATCH /api/trips/{id}/status` (`en_route_pickup → picked_up → in_transit → delivered → completed`), report incidents, upload proof-of-delivery photos, and collect COD payment.
7. Completion triggers a settlement record and increments the driver's trip count; the client can then rate the delivery.
8. Disputes and chat are cross-cutting: either party can raise a dispute on a booking, and a chat thread exists per booking for client/broker/driver to coordinate, with admin as a read-only observer.

## Table of contents

1. [Auth](#1-auth)
2. [Users / Profile / Notifications](#2-users--profile--notifications)
3. [KYC](#3-kyc)
4. [Vehicles / Trucks / Drivers](#4-vehicles--trucks--drivers)
5. [Bookings](#5-bookings)
6. [Jobs — broker job requests / offers](#6-jobs--broker-job-requests--offers)
7. [Trips](#7-trips)
8. [Broker](#8-broker)
9. [Disputes](#9-disputes)
10. [Chat](#10-chat)
11. [Admin](#11-admin)
12. [Config](#12-config)
13. [Pricing](#13-pricing)
14. [Payments](#14-payments)
15. [Health](#15-health)
16. [Cross-cutting notes & gotchas](#16-cross-cutting-notes--gotchas)

---

## 1. Auth

`src/routes/auth.routes.js` / `src/controllers/auth.controller.js`

Two rate limiters apply: `authLimiter` (20 req / 15 min) on login/register/Google sign-in; `otpLimiter` (5 req / 10 min at the Express layer — the controller *also* enforces its own **3-per-10-minutes** counter via `OtpModel.countRecent`, so OTP requests are throttled twice, the inner one biting first) on OTP send/verify and forgot/reset password.

### `POST /api/auth/register`
- **Auth:** Public.
- **Purpose:** Creates a client/broker/driver account. The account is **immediately active** — no phone/email verification required before first login.
- **Body:** `name` (required), `phone` (optional, 10-digit), `email` (optional but effectively required since login needs it), `password` (required, min 6 per swagger), `role` (enum `client|broker|driver`, default `client`). Note: `registerValidation` is an **empty array** — express-validator enforces nothing here; the swagger "required" list is aspirational, not actually validated at the HTTP layer.
- **Response 201:** `{ user }` (no tokens — caller must log in separately).
- **Side effects:** Duplicate check on phone/email (409); bcrypt hash (cost 12); audit log `USER_REGISTER`.
- **Gotchas:** Admin accounts cannot be created here (see `/admin/register`).

### `POST /api/auth/login`
- **Auth:** Public (rate-limited).
- **Purpose:** Unified login for all four roles; `role` in the response tells the frontend which portal UI to load.
- **Body:** `email` or `phone`, plus `password` — despite swagger showing only `email`+`password`, the controller branches on whichever identifier is present, so **phone+password login works too**, undocumented in swagger.
- **Response 200:** `{ user (password_hash stripped), tokens: { access_token, refresh_token, token_type: 'Bearer', expires_in } }`.
- **Side effects:** 403 if `status` is `blocked`/`inactive` (checked **before** password comparison, so blocked users always get "blocked," not "invalid credentials"). On success: new refresh-token record (hashed, tied to user-agent/IP), `last_login_at` updated, audit log `ADMIN_LOGIN`/`USER_LOGIN`.

### `POST /api/auth/admin/register`
- **Auth:** JWT + `authorize('admin')`.
- **Purpose:** Lets an existing admin mint another admin account (active+verified immediately).
- **Body (validated for real):** `name` (≤100 chars), `phone` (exactly 10 digits), `email` (valid email), `password` (≥8 chars) — the one auth route with actual express-validator rules.
- **Response 201:** `{ user }`. 409 if phone/email taken. Audit log `ADMIN_CREATED`.

### `POST /api/auth/google`
- **Auth:** Public (rate-limited).
- **Purpose:** Google ID-token sign-in/sign-up for client/broker/driver (never admin — explicit 403 if `role==='admin'`).
- **Body:** `id_token` (required), `role` (enum, default `client`, only used if a brand-new account is created).
- **Response 200/201:** `{ user, is_new_user, needs_phone, tokens }`. `is_new_user=true` + HTTP 201 when no matching account existed; `needs_phone=true` whenever `user.phone` is falsy.
- **Behavior:** Verifies the token (401 on failure); 403 if Google reports the email unverified. Resolution order: (1) match by `googleId` → login; (2) else email matches an existing phone-based account → links the Google identity onto it (audit `GOOGLE_ACCOUNT_LINKED`) → login; (3) else creates a new user (audit `GOOGLE_REGISTER`). Still checks blocked/inactive status before issuing tokens. Audit log `GOOGLE_LOGIN` on every successful issuance.

### `POST /api/auth/otp/send`
- **Auth:** Public (rate-limited).
- **Purpose:** Sends a 6-digit OTP by SMS for `login` or `password_reset`.
- **Body:** `phone` (required), `purpose` (enum, default `login`).
- **Response 200:** `{ phone, purpose, expires_in_minutes, dev_otp? }` — `dev_otp` only when `NODE_ENV !== 'production'`.
- **Side effects/gotchas:** Own 3-per-10-min counter (429) in addition to the middleware limiter. 404 if no user exists with that phone; 403 if blocked. Sends via the active `smsProvider`.

### `POST /api/auth/otp/verify`
- **Auth:** Public (rate-limited).
- **Purpose:** Verifies an OTP; if `purpose==='login'` also completes login and returns tokens, otherwise just marks the phone verified.
- **Body:** `phone`, `otp`, `purpose` (default `login`).
- **Response 200:** For `login`: full `{ user, tokens }`. Otherwise: `{ user }`.
- **Side effects:** Invalid/expired OTP → `OtpModel.incrementAttempt` + 400. On success: marks OTP used, `UserModel.verifyPhone` (404 if not found); `login` purpose creates a refresh token + audit `OTP_LOGIN`, else audit `PHONE_VERIFIED`.

### `POST /api/auth/forgot-password`
- **Auth:** Public (rate-limited).
- **Body:** `phone` (required).
- **Response 200:** `{ phone, expires_in_minutes, dev_otp? }`.
- **Gotcha:** 404 if no account; 403 if blocked; same 3-per-10-min counter. **The handler's own TODO comment admits it doesn't actually call the SMS provider yet** — it only logs the OTP via `logger.info`, unlike `/otp/send` which does send a real SMS. Worth fixing if this path is user-facing today.

### `POST /api/auth/reset-password`
- **Auth:** Public (rate-limited).
- **Body:** `phone`, `otp`, `new_password` (min 6 chars per swagger, not enforced by the — empty — validator array).
- **Response 200:** Plain success message.
- **Side effects:** 400 on invalid/expired OTP (increments attempt counter). On success: bcrypt hash (cost 12), and **revokes all existing refresh tokens for the user** — resetting password logs the user out everywhere. Audit log `PASSWORD_RESET`.

### `POST /api/auth/refresh-token`
- **Auth:** Public (the refresh token itself is the credential).
- **Body:** `refresh_token` (required).
- **Response 200:** `{ tokens: { access_token, refresh_token, token_type, expires_in } }`.
- **Behavior:** Full rotation — verifies JWT signature (401 if invalid/expired), looks up the **hashed** token server-side (401 if revoked/not found — refresh tokens are tracked, not just JWT-verified), 403 if the user is blocked, immediately revokes the old token, issues + stores a new pair. Reusing an old refresh token after rotation fails — replay protection built in.

### `POST /api/auth/logout`
- **Auth:** JWT required.
- **Body (optional):** `refresh_token`, `all_devices` (boolean, default false).
- **Behavior:** `all_devices: true` revokes every refresh token for the user (audit `LOGOUT_ALL_DEVICES`) and ignores any passed `refresh_token`. Otherwise revokes only the given token if supplied. Audit `USER_LOGOUT` either way.

### `GET /api/auth/me`
- **Auth:** JWT required.
- **Response 200:** `{ user }` — the fresh DB row `authenticate` already loaded, not just the JWT payload.

---

## 2. Users / Profile / Notifications

`src/routes/user.routes.js`, controllers `user.controller.js` + `notification.controller.js`

### `GET /api/users/profile`
- **Auth:** JWT. Response `{ user }`.

### `PATCH /api/users/profile`
- **Auth:** JWT.
- **Body (all optional):** `name`, `email`, `profile_image` (nullable), `address` (nullable), `company_name` (nullable — used by clients booking for a business, and brokers).
- **Side effects:** 409 if `email` belongs to a **different** user (re-submitting your own current email is fine). Audit log `PROFILE_UPDATED` records which field *names* were sent, not values.

### `PATCH /api/users/change-password`
- **Auth:** JWT.
- **Purpose:** Self-service password change while logged in (contrast with forgot/reset-password for locked-out users).
- **Body:** `current_password`, `new_password` (min 6 chars per swagger).
- **Behavior:** 400 if current password wrong, **and also 400 if new password equals current password**. Does **not** revoke other sessions/refresh tokens (unlike `/auth/reset-password`, which does) — a notable asymmetry. Audit log `PASSWORD_CHANGED`.

### `GET /api/users/notifications`
- **Auth:** JWT.
- **Query:** `page` (default 1), `limit` (default 20, cap 100).
- **Response:** `{ notifications: [...], total, unread_count, page, limit, total_pages }`, newest first.

### `PATCH /api/users/notifications/{id}/read`
- **Auth:** JWT. 404 if it doesn't exist or belongs to someone else.

### `PATCH /api/users/notifications/read-all`
- **Auth:** JWT. Response `{ updated: <count> }`.

### `GET /api/admin/users`
- **Auth:** JWT + `authorize('admin')`.
- **Query:** `role`, `status` (`active|inactive|blocked|pending_verification`), `kyc_status`, `search`, `page` (default 1), `limit` (default 10, cap 100).
- **Response:** `{ users: [...], total, page, limit, total_pages }`.

### `GET /api/admin/users/{id}`
- **Auth:** admin. `{ user }`, 404 if not found.

### `PATCH /api/admin/users/{id}/status`
- **Auth:** admin.
- **Body:** `status` (enum `active|inactive|blocked`).
- **Gotchas:** 400 if admin targets **their own** account; 403 if target is another `admin` (no admin-on-admin moderation via this route). Audit action name dynamically `USER_STATUS_CHANGED_TO_<STATUS>`.

### `DELETE /api/admin/users/{id}`
- **Auth:** admin.
- **Purpose:** "Delete" is actually a **soft delete** (status → inactive), not a hard row removal. Same self/admin-target guards as above. Audit `USER_DELETED`.

---

## 3. KYC

`src/routes/kyc.routes.js` / `src/controllers/kyc.controller.js`

`kyc_status` on the `users` row moves `pending → submitted → verified|rejected`, and gates trip/job earning features for brokers/drivers.

### `POST /api/kyc/broker`
- **Auth:** `authorize('broker')`.
- **Body:** `documents` object — `pan_number` (required, `ABCDE1234F` format), `aadhaar_number` (required, 12-digit), `gst_number` (optional, 15-char GSTIN), `bank_account_number` (optional, 9–18 digit numeric), `business_registration_number` (optional, 5–30 chars). Optional `pan_photo_url`/`aadhaar_photo_url` from the upload endpoint below.
- **Response:** `{ submission, kyc_status: 'submitted' }`.
- **Gotchas:** Shares a handler with the driver route; resubmission **overwrites** the previous submission wholesale (no history kept) and clears any prior rejection reason. Audit `KYC_SUBMITTED` logs document *key names* only, not values.

### `POST /api/kyc/driver`
- **Auth:** `authorize('driver')`.
- **Body:** `documents.license_number` (required, 5–20 chars), `documents.aadhaar_number` (required, 12-digit), `documents.vehicle_registration_number` (optional), `documents.vehicle_insurance_number` (optional). Same behavior/shape as the broker route.

### `POST /api/kyc/documents/upload`
- **Auth:** `authorize('broker', 'driver')`. Multipart (`file`, `document_key`).
- **Purpose:** Uploads a document image/PDF and immediately merges its URL into the caller's `kyc_submissions.documents` — **before** the broker/driver submit route is called, so a refresh doesn't lose an uploaded photo mid-flow.
- **Behavior:** `document_key` restricted per role (broker: `pan_photo_url`/`aadhaar_photo_url`; driver: `license_photo_url`/`aadhaar_photo_url`) — mismatch is 422. Re-uploading the same key **replaces** the file; under `STORAGE_PROVIDER=postgres` the old row is explicitly deleted (no orphan); under the default local/`fake` provider files are **ephemeral** (lost on redeploy) — dev-only.

### `GET /api/kyc/documents`
- **Auth:** broker/driver. Lists the caller's uploaded documents one row per type (vs. `/kyc/status`, which merges them into one object).

### `GET /api/kyc/documents/file/{id}`
- **Auth:** broker/driver/admin. Streams raw bytes for a Postgres-stored file. 403 if caller is neither the uploader nor an admin; 404 if missing.

### `GET /api/kyc/status`
- **Auth:** broker/driver. `{ kyc_status, submission }` for the caller.

### `GET /api/kyc/{userId}`
- **Auth:** broker/driver. Same data, addressed by ID — **404 (not 403)** if `userId` isn't the caller's own, deliberately not leaking whether an arbitrary ID exists.

### `GET /api/admin/kyc/pending`
- **Auth:** admin.
- **Query:** `kyc_status`, `role` (`broker|driver`), `search`, `page`, `limit`.
- **Gotcha:** Omitting `kyc_status` defaults to everyone who has **ever submitted** (`submitted`/`verified`/`rejected`) — pass `kyc_status=submitted` explicitly to get just the actionable review queue.

### `GET /api/admin/kyc/{userId}` / `GET /api/admin/kyc/{userId}/documents`
- **Auth:** admin. Detail + per-document listing for the review screen. 404 if user not found.

### `PATCH /api/admin/kyc/{userId}/verify`
- **Auth:** admin.
- **Behavior:** 404 user not found, 400 if role isn't broker/driver, **400 if already verified** (idempotency guard). Notifies the user ("full access to the platform"). Audit `KYC_VERIFIED`.
- **Gotcha:** Doesn't strictly require the prior state to have been `submitted` — only "not already verified" — so a `pending` (never-submitted) user could technically be verified too, a minor discrepancy vs. the swagger doc.

### `PATCH /api/admin/kyc/{userId}/reject`
- **Auth:** admin. **Body:** `reason` (swagger says required; validator array is empty so not actually enforced). Same guards as verify. Notification embeds the reason. Audit `KYC_REJECTED`.

---

## 4. Vehicles / Trucks / Drivers

`src/routes/vehicle.routes.js` / `src/controllers/vehicle.controller.js`

Ownership model: a **broker** caller always operates on their own fleet (`resolveBrokerId` forces `brokerId = req.user.id`, ignoring any `broker_id` in the body); an **admin** caller must explicitly pass `broker_id` (422 if missing, 404 if it doesn't resolve to a broker-role user).

### `POST /api/vehicles/trucks`
- **Auth:** `authorize('broker', 'admin')`.
- **Body:** `registration` (required, Indian plate regex e.g. `MH-12-AB-1234`), `type` (required), `category` (required, enum `small|medium|large|part`), `capacity` (required), `driver_id` (optional), `make`/`year`/`insurance_expiry` (optional), `broker_id` (admin-only, required then).
- **Response 201:** `{ truck: { id, brokerId, driverId, driver, registration, type, category, capacity, make, year, insuranceExpiry, status, lastTrip, createdAt, updatedAt } }`.
- **Gotcha:** 409 if a truck with that registration already exists. Audit `TRUCK_CREATED`.

### `GET /api/vehicles/trucks` / `GET /api/vehicles/trucks/{id}`
- **Auth:** broker/admin. Broker sees only their own fleet (list scoped, single-item 403 "Not your truck" for another broker's); admin sees/accesses all.
- **Query (list):** `status` (`available|on_trip|maintenance`), `page`, `limit` (cap 100).

### `PATCH /api/vehicles/trucks/{id}`
- **Body (all optional):** `driver_id`, `type`, `category`, `capacity`, `make`, `year`, `insurance_expiry`, `status`. Same ownership guard. Audit `TRUCK_UPDATED`.

### `DELETE /api/vehicles/trucks/{id}`
- **Gotcha:** **400** if the truck has ever been referenced by a booking (documented workaround: set `status=maintenance` instead, to preserve history). Audit `TRUCK_DELETED`.

### `GET /api/vehicles/drivers/lookup`
- **Auth:** broker/admin.
- **Purpose:** Look up a driver-role user by phone before linking, so the "Add Driver" flow doesn't need the raw user ID.
- **Query:** `phone` (required, normalized to last 10 digits — 422 if that isn't exactly 10 digits).
- **Gotchas:** 404 if no driver-role account has that phone; **409 if that driver already has a linked profile** (already belongs to a broker).

### `POST /api/vehicles/drivers`
- **Auth:** broker/admin.
- **Purpose:** Links an **existing** driver-role user account (found via lookup) to a fleet.
- **Body:** `user_id` (required), `license_no`, `license_expiry`, `aadhaar` (optional), `truck_id` (optional), `avatar` (optional), `broker_id` (admin-only, required).
- **Gotchas:** 404 if `user_id` doesn't exist; 400 if role isn't `driver`; 409 if a profile already exists. Notifies the driver they were added. Audit `DRIVER_PROFILE_CREATED`.

### `POST /api/vehicles/drivers/register`
- **Auth:** broker/admin.
- **Purpose:** The more common onboarding path — driver has **no** account yet; creates both the `users` row (role `driver`) and `driver_profiles` row in one step.
- **Body:** `name`, `phone` (10-digit), `email`, `license_no`, `license_expiry`, `aadhaar` (optional), `truck_id` (optional), `broker_id` (admin-only, required).
- **Response 201:** `{ driver, tempPassword }`.
- **Gotchas:** 409 if phone/email already registered (message steers toward "Link Existing Driver" instead). Generates a random temp password (`crypto.randomBytes(9).toString('base64url')`), hashes it, and returns it **once in plaintext** — broker/admin relays it out-of-band; login afterward is email+password, driver should change it via `PATCH /api/users/change-password`. Notifies the driver to log in with the temp password. Audit `DRIVER_REGISTERED`.

### `GET /api/vehicles/drivers`
- **Auth:** broker/admin.
- **Query:** `status` (`available|on_trip|offline`), `page`, `limit` (cap 100), `near_lat`/`near_lng` (optional pair — ranks by distance instead of `created_at` when both given), `truck_type` (narrows a geo search, only meaningful with near_lat/lng).
- **Response:** `{ drivers: [...], total, page, limit }`; `distanceKm` populated only during a near-search.

### `PATCH /api/vehicles/drivers/me/location`
- **Auth:** `authorize('driver')`.
- **Purpose:** Pinged periodically by the driver's own app while online, even before any trip starts.
- **Body:** `lat` (-90..90), `lng` (-180..180). 404 if caller has no driver profile.

### `POST /api/vehicles/drivers/me/payment-qr`
- **Auth:** `authorize('driver')`. Multipart `file`.
- **Purpose:** Upload/replace the driver's personal UPI QR, reused across every trip's payment step.
- **Gotcha:** 422 if no file; 404 if no driver profile. Re-uploading **replaces** the URL, but (unlike KYC docs) the old file row is **not** cleaned up under `STORAGE_PROVIDER=postgres` — accepted tradeoff for a low-frequency upload. Audit `DRIVER_PAYMENT_QR_UPLOADED`.

### `GET /api/vehicles/drivers/{id}` / `PATCH /api/vehicles/drivers/{id}` / `DELETE /api/vehicles/drivers/{id}`
- Same ownership guard pattern (403 "Not your driver" for another broker's). `PATCH` body: `license_no`, `license_expiry`, `aadhaar`, `truck_id`, `avatar`, `status` (`available|on_trip|offline`). `DELETE` unlinks the driver from the fleet (deletes only the profile row — the underlying user account is untouched, so they could re-register elsewhere) and is blocked with 400 if the driver has ever been referenced by a booking, same as truck deletion.

---

## 5. Bookings

`src/routes/booking.routes.js` / `src/controllers/booking.controller.js`

### `POST /api/bookings`
- **Auth:** `authorize('client')`, wrapped in `idempotent('POST /bookings')`.
- **Purpose:** Entry point of the whole flow — creates a booking with no broker/truck attached yet, then immediately broadcasts it to eligible brokers.
- **Body:** `pickup_location*`, `pickup_lat`, `pickup_lng`, `drop_location*`, `drop_lat`, `drop_lng`, `truck_type`, `truck_category` (enum `small|medium|large|part`), `weight`, `weight_unit` (default `tons`), `quantity`, `material`, `transport_type` (enum `intra|inter`, default `intra`), `scheduled_date`, `distance` (if provided, pricing auto-computed via `PricingModel.estimate`), `amount` (overrides the auto-computed total if given), `payment_status` (default `pending`), `notes`. `createBookingValidation` is an **empty array** — none of this is enforced by express-validator at the route layer.
- **Headers:** Optional `Idempotency-Key` — a repeat with the same key+user+endpoint replays the original saved JSON response instead of creating a duplicate booking.
- **Response 201:** `{ booking }` — full projected shape: `id, bookingNumber, clientId, brokerId, driverId, truckId, status, pickup, pickupLat, pickupLng, drop, dropLat, dropLng, truckType, truckCategory, weight, weightUnit, quantity, material, notes, transportType, date, amount, paymentStatus, driver:{name,phone}, truckReg, broker, timeline:[...], currentStep, pricing, distance, platformFee, podUrl, rating, createdAt, updatedAt` (admin additionally gets `client, clientPhone, clientEmail, driverPhone, brokerPhone`).
- **Side effects:** Adds a `pending` timeline step. Looks up eligible brokers via `BrokerProfileModel.findEligibleBrokers({city: pickup_location})` — a **plain string-equality match** against the freeform address text (no geocoding); if zero brokers are zoned to that city, falls back to broadcasting to *all* active brokers (logs a warning) so a booking never silently gets zero offers. Creates a `job_requests` row per eligible broker (seeded `offer_history = [{by:'client', amount, note:null, at:now}]`) and sends each a "New Job Request" notification. Audit `BOOKING_CREATED`.

### `GET /api/bookings`
- **Auth:** any authenticated role (scoped: client → own, broker/driver → assigned, admin → all).
- **Query:** `status`, `page` (default 1), `limit` (default 10, cap 100), plus an undocumented `sort` (default `desc`).
- **Response:** `{ bookings: [...], total, page, limit, total_pages }`.

### `POST /api/bookings/quote`
- Alias of `POST /api/pricing/estimate` (same handler, different path — see §13).

### `GET /api/bookings/:id`
- **Auth:** any role; `assertCanView` — admin any, client own, broker/driver own assignment, else 403.
- **Params:** `id` — accepts the booking UUID **or** its human-readable `booking_number` (e.g. `BKG-202412-001`).

### `GET /api/bookings/:id/track`
- **Auth:** any role that can view the booking.
- **Purpose:** Lightweight polling endpoint (every 5–10s) for a live driver-location dot plus ETA.
- **Response:** `{ status, driverLat, driverLng, lastLocationAt, distanceRemainingKm, etaMinutes, incident }` — all location/ETA fields `null` if no driver assigned/reported yet. ETA is haversine straight-line distance at a flat 40 km/h assumption — **not** a real routing engine. `incident` is the trip's latest unresolved incident, including live `mechanicStatus` if it's a breakdown.

### `GET /api/bookings/:id/offers`
- **Auth:** `authorize('client', 'admin')`; client must own the booking.
- **Purpose:** Poll-friendly view of every broker's negotiation state on one booking (meant to be polled every few seconds while `status==='pending'`).
- **Response:** `{ bookingId, bookingStatus, offers: [{ id, brokerId, brokerName, brokerPhone, amount, status (pending|countered|accepted|declined), offerHistory:[{by, amount, note, at}], createdAt }] }`.

### `PATCH /api/bookings/:id/status`
- **Auth:** admin only.
- **Purpose:** Manual override/escape hatch — **not** used by any normal flow (`PATCH /api/trips/:id/status` drives real progression). Exists to fix a booking stuck out of sync with reality.
- **Body:** `status*` (any normal status **except `completed`**, which is rejected — that must go through the trips endpoint), `driver_id`, `truck_id` (optional).
- **Behavior:** Mirrors the same status + timeline step onto the linked trip too, "so the two can never disagree." Audit `BOOKING_STATUS_UPDATED`; notifies the client.

### `PATCH /api/bookings/:id/cancel`
- **Auth:** `authorize('client', 'admin')`; client must own it.
- **Allowed only** while status is `pending`, `confirmed`, or `assigned` — else 409.
- **Side effects:** `status: cancelled`, `payment_status: refunded` (no real refund gateway call); appends a `cancelled` timeline entry; frees the truck/driver if assigned; declines any still-open job requests; force-updates the linked trip to `cancelled` directly; notifies the assigned broker. Audit `BOOKING_CANCELLED`.

### `PATCH /api/bookings/:id/pay`
- **Auth:** `authorize('client')`, own booking only.
- **Purpose:** Settle a "Pay Later" booking — only valid while `payment_status==='pending'` and not cancelled.
- **Behavior:** Calls a real `paymentProvider` abstraction (`createOrder` → `verifyPayment`); 402 if verification fails. On success: `payment_status: 'paid'`. Audit `BOOKING_PAID`.

### `POST /api/bookings/:id/rate`
- **Auth:** `authorize('client')`, own booking only.
- **Purpose:** The **only** rating mechanism in the system (brokers/drivers are never rated). One-time only — 409 "Booking already rated" on repeat.
- **Allowed only** while status is `delivered` or `completed`.
- **Body:** `stars*` (1–5 int), `review` (optional, max 1000 chars).
- **Response:** `{ rating: { stars, review, createdAt } }` — stored as a JSON blob on the booking row, no separate ratings table.

---

## 6. Jobs — broker job requests / offers

`src/routes/job.routes.js` / `src/controllers/job.controller.js`

Operates on the `job_requests` table, one row per (booking, broker) pair created at broadcast time. Status lifecycle: `pending → countered ↔ pending (renegotiation loop) → accepted | declined`. Every mutation is a **compare-and-swap SQL UPDATE with a `WHERE status IN (...)` guard**, not read-then-write, so concurrent/duplicate calls can't double-apply.

### `GET /api/jobs/requests`
- **Auth:** `authorize('broker')`.
- **Purpose:** Broker's inbox. Job requests **never expire** — they sit `pending` indefinitely until the client accepts one (auto-declining the rest) or this broker declines.
- **Response:** `{ requests: [...], total, page, limit, total_pages }` — each: `id, bookingId, bookingNumber, clientName, clientPhone, brokerName, brokerPhone, pickup, drop, distance, truckType, weight, amount, status, offerHistory, timestamp ("N min/hr/day(s) ago")`.

### `POST /api/jobs/:id/assign-driver`
- **Auth:** `authorize('broker')`.
- **Purpose:** The step that actually starts a trip. Only valid once the job request is `accepted` (which only happens via the client's `client-accept` — brokers cannot accept their own request; there's no broker-side "accept" route).
- **Body:** `driverId`, `truckId` (both effectively required — the controller 404s without a match, though the empty validator array doesn't enforce "required" at the HTTP layer).
- **Checks:** job request must belong to this broker (403); must be `status==='accepted'` (409 otherwise); `driverId` must be this broker's own driver profile (404); `truckId` must be this broker's own truck (404) and `available` **unless** it's the same truck already on this booking (409 "Truck is not available" otherwise).
- **Two branches:**
  - **Reassignment** (a `trips` row already exists for this booking — `booking_id` is UNIQUE on trips, so only one trip per booking ever): frees the previous driver/truck if replaced; booking `status`/`current_step` are **left unchanged** (a swap shouldn't regress an in-transit shipment's tracker); adds a `driver_reassigned` timeline step (position 99); notification title "Trip Reassigned to You"; audit `JOB_DRIVER_REASSIGNED`.
  - **First assignment:** booking → `status: 'assigned'`; adds `assigned` timeline step (position 2); truck/driver → `on_trip`; creates the `trips` row (`earnings = amount - platformFee` if both present, else `amount`); inserts three initial `trip_timeline` rows (`Pickup`, `In Transit`, `Delivered`, all `done:false`); notification "New Trip Assigned"; audit `JOB_DRIVER_ASSIGNED`.
- **Response:** `{ booking: { id, status, brokerId, driverId, truckId, pickup, drop, timeline, currentStep } }` — a slimmer projection than elsewhere.

### `PATCH /api/jobs/requests/:id/decline`
- **Auth:** broker, own request only. Only valid from `pending` → `declined` (400 if already actioned). Audit `JOB_REQUEST_DECLINED`.

### `PATCH /api/jobs/requests/:id/counter`
- **Auth:** broker, own request only. Only valid from `pending`.
- **Body:** `amount*` (float ≥ 1), `note` (optional, max 500 chars).
- **Behavior:** Compare-and-swap → `status: 'countered'`, appends to `offer_history`; 400 if the swap misses. Notifies the client "New Counter-Offer." Audit `JOB_REQUEST_COUNTERED`.

### `PATCH /api/jobs/requests/{id}/client-accept`
- **Auth:** `authorize('client')`, own request only.
- **Purpose:** The pivotal action that confirms a booking with one broker. Valid from `pending` (accepting the broker's still-open original ask) or `countered` (accepting their last counter).
- **Behavior (two-step compare-and-swap for race safety):**
  1. Job request `status IN ('pending','countered') → 'accepted'`; miss → 400 "Offer is already actioned."
  2. Booking `status IN ('pending') → 'confirmed'` (guarding no other broker's offer already won it); miss → the just-claimed job request is **rolled back to declined** and returns **409** "This booking is no longer available" — this is exactly how two concurrent client-accepts on sibling offers can't both win.
  3. If the claimed amount differs from the booking's current amount, updates it to match; appends `confirmed` timeline step; **auto-declines every other still-open request on the booking**; notifies the winning broker "Offer Accepted." Audit `JOB_REQUEST_CLIENT_ACCEPTED`.

### `PATCH /api/jobs/requests/{id}/client-reject`
- **Auth:** client, own request only. Only valid from `countered` → `declined`; other brokers' offers untouched. Notifies the broker "Offer Declined." Audit `JOB_REQUEST_CLIENT_REJECTED`.

### `PATCH /api/jobs/requests/{id}/client-counter`
- **Auth:** client, own request only.
- **Purpose:** Client proposes a new price to one specific broker — proactively (from `pending`) or in reply (from `countered`).
- **Body:** `amount*` (≥1), `note` (optional, max 500).
- **Behavior:** Compare-and-swap, sets `amount`, appends to history, **status stays `pending`** (the broker now owes a response). Notifies broker "Client Countered Your Offer." Audit `JOB_REQUEST_CLIENT_COUNTERED`.

---

## 7. Trips

`src/routes/trip.routes.js` / `src/controllers/trip.controller.js`

Trips are created only via `POST /api/jobs/{id}/assign-driver`. Status progression: `confirmed → en_route_pickup → picked_up → in_transit → delivered → completed` (or `cancelled`). Booking status is mirrored on every trip-status update.

### `GET /api/trips`
- **Auth:** `authorize('broker', 'driver', 'admin')`. Broker/driver → own only, admin → all.
- **Query:** `status`, `page` (default 1), `limit` (default 10, cap 100).

### `GET /api/trips/active` / `GET /api/trips/upcoming`
- **Auth:** `authorize('driver')`.
- `/active`: the driver's currently in-progress trip; `{ trip: null }` if none.
- `/upcoming`: the driver's next `confirmed`-but-not-started trip, explicitly excluding whatever `/active` returns so the two never overlap; `{ trip: null }` if none.
- **Response shape (`projectTrip` — the richest projection in the API):** `id, bookingId, bookingNumber, status, broker, brokerPhone, driverId, driverName, driverPhone, clientName, clientPhone, truckId, truckReg, pickup:{location,address,contactPerson,contactPhone,time,lat,lng}, drop:{same}, distance, estimatedTime, cargo:{material,weight,quantity,specialInstructions,value}, earnings, startedAt, currentLocation:{lat,lng}, podUrl, podPhotos:[...], paymentStatus, amountToCollect, driverQrUrl, timeline:[{step,done,time}], createdAt, updatedAt`.

### `GET /api/trips/:id`
- **Auth:** broker/driver/admin; `assertCanView` (admin any, broker/driver own). 403/404 as appropriate.

### `PATCH /api/trips/:id/status`
- **Auth:** broker/driver/admin, wrapped in `idempotent('PATCH /trips/:id/status')`.
- **Purpose:** The main day-to-day status-advance endpoint; keeps the parent booking's status/timeline in sync automatically.
- **Body:** `status*` (enum `confirmed|en_route_pickup|picked_up|in_transit|delivered|completed|cancelled`).
- **Critical completion guard:** the driver flow issues *two* separate status calls that both matter (`in_transit → delivered`, then after POD upload, `delivered → completed`), but settlement/trip-count must fire **exactly once**. For `status==='completed'`, `TripModel.completeIfNotAlready` does an atomic compare-and-swap; if it misses (already completed), the handler short-circuits with 200 "Trip already completed" and **skips** timeline/booking-sync/settlement entirely — duplicate or racing calls are safe.
- **On a genuinely new completion:** increments the driver's `total_trips`; creates a `SettlementModel` row (`amount: booking.amount||0, platformFee: booking.platform_fee||0`); notifies the driver "Trip Completed... Settlement is pending processing." Audit `TRIP_STATUS_UPDATED` in every branch.

### `POST /api/trips/:id/decline`
- **Auth:** driver, own trip only.
- **Purpose:** Lets a driver back out — only valid while `status==='confirmed'` (before "Start Trip to Pickup"); 409 once started ("Report an incident instead" from `en_route_pickup` onward).
- **Behavior:** Frees driver/truck; resets the booking to `confirmed` with `driver_id`/`truck_id` nulled (so the broker can reassign); adds `driver_declined` timeline step; **deletes the trip row entirely**; notifies the broker "Driver Declined Trip... assign another driver." Audit `TRIP_DECLINED`.

### `PATCH /api/trips/:id/location`
- **Auth:** JWT — no `authorize()` role restriction at the route level. The controller only blocks a **driver** whose ID doesn't match the trip (403); other roles aren't blocked by role at all (a narrow gap, though no known frontend calls it as non-driver).
- **Body:** `lat*`, `lng*`. No notification, no audit log — a high-frequency write path.

### `POST /api/trips/:id/report-issue`
- **Auth:** driver, own trip only. Only valid while the trip is `confirmed|en_route_pickup|picked_up|in_transit` (409 otherwise).
- **Body:** `reason*` (enum `accident|breakdown|traffic_block|medical|other`), `notes` (optional).
- **Behavior:** Creates a `trip_incidents` row; if `reason==='breakdown'`, also auto-creates a linked `mechanic_requests` row so dispatch can be tracked separately. Notifies the broker (title differs for breakdown) and the client ("Delivery Update"). Audit `TRIP_INCIDENT_REPORTED`.
- **Response 201:** `{ incident: { id, tripId, driverId, reason, notes, status, reportedAt, resolvedAt, resolution, mechanicRequest: {...} | null } }`.

### `GET /api/trips/:id/incidents`
- **Auth:** JWT (no role restriction). `assertCanViewIncidents` deliberately widens access beyond `assertCanView` to also include the **client** who owns the booking (`trip.client_id === user.id`) — incidents should be visible to the client even though the full trip record (earnings, phone numbers) is not.

### `PATCH /api/trips/:id/incidents/:incidentId/resolve`
- **Auth:** `authorize('broker', 'admin')`, broker must own the trip.
- **Body:** `resolution*` (non-empty). 409 if already resolved. **Also syncs any linked mechanic request to `resolved`** if it wasn't already, so this generic path can't leave the mechanic sub-workflow stuck open. Notifies the driver. Audit `TRIP_INCIDENT_RESOLVED`.

### `PATCH /api/trips/:id/incidents/:incidentId/mechanic`
- **Auth:** `authorize('broker', 'admin')`, broker must own the trip.
- **Purpose:** Dedicated mechanic-dispatch sub-workflow for `breakdown` incidents — 400 if the incident isn't a breakdown or has no linked mechanic request.
- **Body:** `status` (enum `requested|mechanic_assigned|in_progress|resolved`), `mechanicName`, `mechanicPhone`, `notes` (broker's dispatch notes, distinct from the driver's original incident notes).
- **Behavior:** If `status==='resolved'` and the incident wasn't already, **also resolves the underlying incident**. Status-specific driver notification (no notification for `requested`). Audit `MECHANIC_REQUEST_UPDATED`.

### `POST /api/trips/:id/pod`
- **Auth:** driver, own trip only. Multipart `files` (array), up to `MAX_PHOTOS_PER_TRIP` (6) **total per trip across all calls combined**, not per call.
- **Allowed only** while status is `in_transit` or `delivered` (409 otherwise) — POD is captured as part of "Mark Delivered," before advancing to `completed`.
- **Behavior:** 422 if no files, or if `existingCount + files.length > 6`. Each file → active `StorageProvider` under `folder: pod/{tripId}` → its own `trip_pod_photos` row. `trips.pod_url` (legacy single-column field) is set **only once**, from whichever photo is the trip's first-ever upload — later uploads never overwrite it. Audit `TRIP_POD_UPLOADED` with photo count.
- **Response:** `{ podPhotos: [...] }` — **every** photo for the trip so far, not just this call's.

### `PATCH /api/trips/:id/collect-payment`
- **Auth:** driver, own trip only.
- **Purpose:** Records how a COD booking was actually settled at delivery.
- **Allowed only** while `payment_status==='pending'` (409 "already recorded" otherwise — one-shot, no silent overwrite on retry).
- **Body:** `mode*` (enum `upi|cash`).
- **Behavior:** `payment_status: 'paid', payment_mode: mode, paid_at: now`. Notifies client ("Payment Received... via UPI/cash") and broker ("Payment Collected"). Audit `TRIP_PAYMENT_COLLECTED`.

### `GET /api/trips/pod/file/:id`
- **Auth:** JWT (no role restriction), `assertCanViewIncidents` gate on the owning trip. Serves raw bytes when `STORAGE_PROVIDER=postgres` — mirrors the KYC file-serving route.

---

## 8. Broker

`src/routes/broker.routes.js`

Two tiny profile toggles that feed directly into the booking-broadcast eligibility logic (`BrokerProfileModel.findEligibleBrokers`).

### `PATCH /api/broker/service-city`
- **Auth:** `authorize('broker')`.
- **Body:** `service_city*` (non-empty string, e.g. `"Mumbai"`).
- **Purpose:** Narrows which new bookings get broadcast to this broker (matched by string equality against the booking's pickup location, with the all-active-brokers fallback described in §5 if nobody matches).
- **Response:** `{ profile: { serviceCity, isOnline } }` — the projection always returns just these two fields, `isOnline` defaults `true` if missing.

### `PATCH /api/broker/availability`
- **Auth:** `authorize('broker')`.
- **Body:** `is_online*` (boolean). While offline, excluded from new booking broadcasts entirely.

---

## 9. Disputes

`src/routes/dispute.routes.js` / `src/controllers/dispute.controller.js`

### `POST /api/disputes`
- **Auth:** `authorize('client', 'broker')` (drivers cannot raise disputes).
- **Body:** `booking_id*` (non-empty string, not checked as UUID format), `issue_type*` (enum: `damaged_goods, payment_delay, cancellation_fee, route_dispute, late_delivery, fuel_surcharge, wrong_items, weight_discrepancy`), `description*` (max 2000 chars).
- **Behavior:** 404 if booking missing. Raiser role determines the required booking-field match: broker → `broker_id===user.id`; anything else (client) → `client_id===user.id` (403 otherwise). Audit `DISPUTE_RAISED`.
- **Response 201:** `{ dispute: { id, disputeNumber, bookingId, bookingNumber, raisedBy, raisedByName, raisedByPhone, issueType, description, status, resolution, date, updatedAt } }`.

### `GET /api/disputes`
- **Auth:** any role. Admin sees all (with filters); client/broker see only their own (scoped by `raised_by_user_id`).
- **Query:** `status` (`open|under_review|resolved`), `issue_type`, `page`, `limit` (cap 100).
- **Gotcha:** Admin's projection includes contact fields for **every party on the underlying booking** (client/broker/driver name+phone), not just whoever raised it, so support can call anyone relevant without a separate booking lookup.

### `GET /api/disputes/:id`
- **Auth:** any role; non-admin must be the one who raised it (403 otherwise).
- **Gotcha:** Since the list endpoint also scopes strictly to `raised_by_user_id`, **the counter-party (e.g. the broker, if the client raised it) has no route-level way to view a dispute raised against them** except through an admin — worth flagging as a UX gap.

### `PATCH /api/disputes/:id/resolve`
- **Auth:** admin only.
- **Body:** `resolution*` (non-empty, max 2000). 400 if already resolved. Notifies whoever raised it. Audit `DISPUTE_RESOLVED`.

---

## 10. Chat

`src/routes/chat.routes.js`

Threads are one-per-booking, participants derived **live** from the booking row (`client_id`, `broker_id`, `driver_id`) rather than a static membership table — if a booking's driver is reassigned, the new driver instantly becomes a valid participant with no extra setup. Real-time delivery is via Socket.IO (`realtime/socket.js`, `realtime/chatService.js`); REST is the source of truth for history, and both the REST send endpoint and the socket `send-message` event share the exact same write path (`chatService.postMessage`) — a message can never diverge in content depending on which path sent it.

### `GET /api/chat/bookings/:bookingId/thread`
- **Auth:** JWT.
- **Purpose:** Get-or-lazily-create the thread for a booking — the entry point every frontend calls before it has a `threadId`.
- **Behavior:** 404 if booking doesn't exist; 403 if caller isn't a participant (client, assigned broker, assigned driver; admin can always view but is read-only).
- **Response:** `{ thread: { id, bookingId, bookingNumber }, canSend: boolean }` — `canSend` is `false` for admin or anyone not yet an actual participant (e.g. before a broker/driver is assigned).

### `GET /api/chat/threads/:threadId/messages`
- **Auth:** JWT, `canView` gate (403 if not a participant).
- **Query:** `page` (default 1), `limit` (default 30, cap 100). Oldest-first within a page.

### `POST /api/chat/threads/:threadId/messages`
- **Auth:** JWT, `canSend` gate (403 for admin — read-only — or non-participants).
- **Body:** `message*` (max 2000 chars).
- **Behavior:** Writes via `chatService.postMessage`, then explicitly emits `new-message` to the Socket.IO room `thread:{threadId}` in addition to being retrievable via REST history.

### `PATCH /api/chat/threads/:threadId/read`
- **Auth:** JWT, `canView` gate (view access is enough to mark-read, unlike sending).
- **Behavior:** Flips every unread message to read; if any were actually marked, emits a `read-receipt` socket event to the thread's room.
- **Response:** `{ markedCount: number }` (can be 0).

### `GET /api/chat/unread-count`
- **Auth:** JWT. `{ unreadCount: number }` — total across every thread the caller participates in; powers a header badge, analogous to the notifications unread-count.

---

## 11. Admin

`src/routes/admin.routes.js` / `src/controllers/admin.controller.js`

### `GET /api/admin/dashboard`
- **Auth:** admin.
- **Response:** `{ totalBookings, activeTrips, totalRevenue, registeredTrucks, *Change (%) for each, openIncidents }` — all-time counts; every `*Change` compares the last 30 days of new records against the prior 30-day window. `openIncidents` is platform-wide unresolved `trip_incidents`.

### `GET /api/admin/incidents`
- **Auth:** admin.
- **Purpose:** Platform-wide list of open/unresolved trip incidents — the discovery surface for admins who don't already know a specific trip ID (contrast with the per-trip `GET /api/trips/:id/incidents`).
- **Query:** `page` (default 1), `limit` (default 20).
- **Response:** each incident includes phone numbers specifically to support click-to-call in the admin UI, plus a nested `mechanicRequest` (only when `reason==='breakdown'`). Action paths are the same `PATCH /api/trips/:id/incidents/:incidentId/resolve|mechanic` routes documented in §7.

### `GET /api/analytics/admin`
- **Auth:** admin. `{ gmvOverMonths, revenueOverMonths, topClients, fleetUtilization, bookingConversionSparkline }` (last 12 days), all fetched in parallel.

### `GET /api/admin/settings` / `PUT /api/admin/settings`
- **Auth:** admin.
- **Fields:** `platformName/platform_name`, `contactEmail/contact_email`, `commissionRate/commission_rate`, `emailAlerts/email_alerts`, `smsAlerts/sms_alerts`, `pushNotifications/push_notifications`, `updatedAt`.
- **Gotchas:** `updateSettingsValidation` is an empty array — nothing enforced by express-validator, whatever partial object is sent goes straight to the model. 404 on GET/PUT if the singleton row is missing (PUT is update-only, not upsert). Audit `ADMIN_SETTINGS_UPDATED`.

---

## 12. Config

`src/routes/config.routes.js` / `src/controllers/config.controller.js`

All four routes are **fully public — no authentication at all**. They power booking-form dropdowns for the client app.

### `GET /api/config/vehicle-types`
- **Purpose:** Lists the 4 fixed truck categories (`small`, `medium`, `large`, `part`), hardcoded name/capacity text, but `basePrice` is **read live** from `pricing_config.intraCity.<id>.baseFare` on every request — admin edits via `PUT /api/admin/pricing` are reflected immediately, no caching.
- `part` always has `basePrice: null` (billed by capacity-used %, see `/api/pricing/estimate`) and carries static `featured: true, savePercent: 40` marketing hints.

### `GET /api/config/material-types`
- Hardcoded list: `Electronics, FMCG, Construction, Furniture, Pharma Products, Textiles, Auto Parts, Other`. No DB lookup.

### `GET /api/config/cities`
- Hardcoded list of 15 Indian cities (Mumbai, Pune, Delhi, Bengaluru, Chennai, Hyderabad, Jaipur, Ahmedabad, Surat, Nashik, Nagpur, Kolhapur, Indore, Goa, Aurangabad).

### `POST /api/config/distance`
- **Body:** `pickup*`, `drop*` (strings).
- **Behavior:** Backed by the active `LocationProvider` (env `LOCATION_PROVIDER`; default `fake` provider is a static city-pair lookup table — **no real Google Maps integration** unless a different provider is configured). 404 for any city pair not present in the table (no estimation/guessing).
- **Response:** `{ distance (km), durationMin, durationInTrafficMin }` — designed to feed straight into `POST /api/pricing/estimate` as `duration_min`/`duration_in_traffic_min` to drive the traffic-surge multiplier.

---

## 13. Pricing

`src/routes/pricing.routes.js` / `src/controllers/pricing.controller.js`

### `GET /api/admin/pricing`
- **Auth:** JWT — **any authenticated role**, no `authorize()` at all, despite the `/admin/*` path.
- **Response:** the raw `pricing_config` JSON: `intraCity.{small,medium,large}` each with `baseFare, perKmRate, platformFee, waitingCharge, demandMultiplier`; `interCity` with `baseRatePerKm, fuelSurcharge, tollHandling (fixed|actual), tollFixedAmount, platformFee`; `partTruck.platformFee`. 404 if no config row exists.

### `PUT /api/admin/pricing`
- **Auth:** admin only.
- **Body:** the entire nested config object (not a partial patch) — `updatePricingConfigValidation` is an empty array, no field-level enforcement.
- **Gotcha:** Appears to be a **full replace, not a merge** — omitting a nested key could wipe it out depending on how the model persists the object; worth confirming before building a "partial settings" admin UI. Audit `PRICING_CONFIG_UPDATED`. Changes immediately affect `GET /api/config/vehicle-types`' live `basePrice` and the pricing-estimate endpoints.

### `POST /api/pricing/estimate` (also mounted as `POST /api/bookings/quote`)
- **Auth:** JWT.
- **Body:** `truck_category*` (enum), `transport_type` (default `intra`), `distance*`, `capacity_used_pct` (only meaningful for `truck_category=part`), `duration_min`/`duration_in_traffic_min` (optional pair enabling the traffic-surge multiplier, sourced from `GET /api/config/distance`). Validation array is empty here too.
- **Behavior:** Role-based response shaping — for `transport_type='inter'` and any **non-admin** caller, the `fuel` and `toll` breakdown fields are stripped from the response; admins and all `intra` responses get the full breakdown.
- **Response:** `{ pricing: <breakdown, shape varies by transport_type/truck_category> }`.

---

## 14. Payments

`src/routes/payment.routes.js` / `src/controllers/payment.controller.js`

### `GET /api/payments/settlements`
- **Auth:** `authorize('broker', 'driver', 'admin')`. Broker/driver see only their own; admin sees all.
- **Query:** `page` (default 1), `limit` (default 10, cap 100).
- **Response:** each row: `id, bookingId, bookingNumber, brokerId, driverId, route, truck, driver, amount, platformFee, net, netEarnings, status (paid|pending), settledAt, date`. `net`/`netEarnings` are duplicate aliases of the same underlying value — likely kept for frontend backward-compatibility with two field names.

### `GET /api/analytics/broker`
- **Auth:** `authorize('broker', 'driver')` — not admin (admin has its own `/analytics/admin`).
- **Response:** `{ thisMonth, lastMonth, tripHistory: [...] }` — `tripHistory` is a hardcoded 50 most-recent settlements, not paginated/query-controlled.

---

## 15. Health

`src/routes/health.routes.js` (inline handler, no separate controller)

### `GET /api/health`
- **Auth:** Public.
- **Purpose:** Liveness/readiness probe verifying both the process and DB connectivity (`SELECT 1`).
- **Response — always HTTP 200, even when the DB is down:** `{ success: true, status: 'healthy'|'degraded', environment, timestamp, database: 'connected'|'disconnected', uptime (seconds) }`.
- **Gotcha:** The health signal is entirely in the JSON body (`status`/`database` fields), never in the HTTP status code — an external monitor expecting a non-200 on DB failure needs to inspect the body instead.

---

## 16. Cross-cutting notes & gotchas

**Validation reality check.** A large number of `*.validation.js` files export an **empty array** for routes whose swagger blocks describe rich required-field schemas — meaning express-validator enforces *nothing* at the route layer for those endpoints; the swagger doc describes intended/contractual shape, not actually-enforced shape. Affected routes include: `register`, `login`, `otp/send`, `otp/verify`, `forgot-password`, `reset-password`, `refresh-token`, `PATCH /users/profile`, `change-password`, `google` sign-in, `PATCH /admin/users/:id/status`, `reject` KYC, `PUT /admin/settings`, `POST /bookings`, `POST /pricing/estimate`, `PUT /admin/pricing`, `assign-driver`, `PATCH /trips/:id/status`, `PATCH /trips/:id/location`. Whatever "required" means for these bodies today is enforced only by the controller/model layer (often not at all beyond a DB constraint or an `undefined` field silently flowing through).

**Compare-and-swap everywhere two actors could race.** `JobRequestModel.brokerCounter` / `clientCounter` / `clientAcceptIfCountered` / `clientRejectIfCountered` (all guard on `WHERE status IN (...)`), `BookingModel.advanceStatusIfCurrent` (guards the current booking status before confirming a broker), and `TripModel.completeIfNotAlready` (guards trip completion so settlement can never double-fire) — this is a deliberate, consistent pattern rather than incidental.

**Idempotency-Key header** is honored on exactly two endpoints — `POST /api/bookings` and `PATCH /api/trips/:id/status` — both wrapped in `idempotent(endpoint)` middleware, which stores/replays the *entire* JSON response keyed by `(key, user_id, endpoint)`.

**Payments.** Booking-level pay/refund (`PATCH /api/bookings/:id/pay`) does call a real, pluggable `paymentProvider` abstraction (`createOrder`/`verifyPayment`) — worth confirming what's actually configured for `getPaymentProvider()` in this environment (could be a mock/stub).

**Broker-city matching is naive.** New-booking broadcast to brokers matches `pickup_location` freeform text against a broker's `service_city` by plain string equality — no geocoding — falling back to broadcasting to *all* active brokers if nothing matches. This is called out directly in the booking-creation controller's own comments as a known simplification pending a real `LocationProvider`.

**Known asymmetries/gaps worth a second look:**
- `PATCH /users/change-password` does **not** revoke other active sessions (unlike `POST /auth/reset-password`, which revokes everything) — inconsistent security posture between the two "change my password" paths.
- `POST /auth/forgot-password` doesn't actually call the SMS provider yet (only logs), while `POST /auth/otp/send` does — likely an unfinished implementation.
- `PATCH /api/trips/:id/location` has no route-level `authorize()` — only a driver-mismatch check inside the controller — so other authenticated roles aren't blocked by role, only a driver hitting someone else's trip is.
- Dispute visibility: the party a dispute is raised *against* has no route to view it except via admin — both the list and single-dispute routes scope strictly to `raised_by_user_id`.
- `driver_profiles` deletion and driver decline both leave the underlying `users` account fully intact — only the fleet link is severed, so re-registration/re-linking elsewhere is possible.

**Audit logging** (`AuditLogModel.log`) is pervasive across every mutating admin/auth/KYC/vehicle/booking/job/trip/dispute action — always capturing `userId` (actor), `action`, `entity`, `entityId`, optional `meta`, and `ipAddress`.

**File references:** routes in `src/routes/*.js`; controllers in `src/controllers/*.js`; validations in `src/validations/*.js`; models in `src/models/*.js`; shared swagger schemas in `src/config/swagger.js`; auth/idempotency middleware in `src/middleware/*.middleware.js` — all under `C:\Asynk clients\SSK logistic\backend`.

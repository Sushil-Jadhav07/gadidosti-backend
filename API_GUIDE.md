# SSK Logistics (GadiDosti) — Full API Wiring Guide

This is the deep-dive companion to `README.md`'s one-line endpoint map. Every endpoint below is explained in plain language — what it's for, who's allowed to call it, what you send, what you get back, and anything surprising about how it behaves. If you just need a quick lookup, use the README or Swagger (`/api-docs`); if you want to actually understand how a feature is wired end-to-end, read this.

**How to read each entry:**
- **Who can call it** — which role(s) need to be logged in, or `Public` if no login is needed.
- **In plain English** — what this endpoint is actually for, as if explaining it to someone non-technical.
- **You send** — the request body/query/path fields.
- **You get back** — the important fields in the response.
- **Good to know** — business rules, gotchas, or "this is why it behaves that way" notes.

Every response (success or error) is wrapped the same way:
```json
{ "success": true, "message": "Human-readable summary", "data": { ... } }
{ "success": false, "message": "What went wrong", "errors": [ ... ] }
```

---

## 0. Integration Quick Start (read this first if you're building the app)

### Base URLs
| Environment | URL |
|---|---|
| Production | `https://apigadidosti.asynk.in` |
| Local dev (backend running on your machine) | `http://localhost:5000` |

Every path in this doc is relative to one of these — e.g. "`POST /auth/login`" means `POST https://apigadidosti.asynk.in/api/auth/login`. Note the `/api` prefix on every single route.

### Authentication header
Every endpoint marked `Public` in this doc needs no header. Everything else needs:
```
Authorization: Bearer <access_token>
```
Get `access_token` from `POST /api/auth/login` (or register → login, or Google sign-in). It expires in ~7 days — when a request comes back `401`, call `POST /api/auth/refresh-token` with your stored `refresh_token` to get a new pair, then retry. If the refresh call *also* fails, the session is truly dead — send the user back to the login screen. Also send `Content-Type: application/json` on every request with a JSON body.

### ⚠️ Important: field naming is NOT consistent across the API — read this before writing your models

This genuinely differs by resource, verified directly against the backend code (not a guess), and it will bite you if you assume one convention everywhere:

| Resource | Casing in the JSON response | Example |
|---|---|---|
| `user` (register/login/me/profile responses) | **snake_case** — raw DB columns, unmodified | `is_phone_verified`, `profile_image`, `company_name`, `kyc_status`, `created_at` |
| KYC `submission` object | **snake_case** | `user_id`, `rejection_reason`, `reviewed_at`, `submitted_at` |
| `notification` objects | **snake_case** | `is_read`, `user_id`, `created_at` |
| `booking` | **camelCase** — explicitly remapped by the backend | `bookingNumber`, `truckType`, `paymentStatus`, `podUrl`, `createdAt` |
| `trip` | **camelCase** | `driverId`, `pickupAddress`, `currentLocation`, `podUrl` |
| `truck` / `driver` (fleet objects) | **camelCase** | `insuranceExpiry`, `licenseNo`, `truckReg`, `kycStatus` |
| `dispute` / `settlement` / `incident` / job `request` | **camelCase** | `disputeNumber`, `issueType`, `platformFee`, `reportedAt` |

**Practical takeaway:** don't write one global JSON-to-Dart mapping strategy assuming `camelCase` (or `snake_case`) everywhere — check the actual example payload for each resource below. If you're using a code-gen tool (`json_serializable`, `freezed`), you'll need per-field `@JsonKey(name: '...')` annotations on the `User`/`Notification`/`KycSubmission` models specifically, since those three are the snake_case outliers.

**All request bodies you send, on the other hand, are always snake_case** (`pickup_location`, `truck_category`, `duration_in_traffic_min`, etc.) — that part is consistent in both directions, it's only the *responses* that vary by resource.

### File uploads (KYC documents, Proof of Delivery)
These two endpoints (`POST /kyc/documents/upload`, `POST /trips/:id/pod`) are `multipart/form-data`, not JSON:
- Do **not** set `Content-Type` yourself — let your HTTP client set the multipart boundary automatically (in Dio: use `FormData`, don't manually set headers).
- The file goes in a form field literally named **`file`**.
- `POST /kyc/documents/upload` also needs a `document_key` form field alongside the file (e.g. `pan_photo_url`) — see section 4.
- Max file size is 10MB; anything larger is rejected before it reaches the controller.

Example with Dio:
```dart
final formData = FormData.fromMap({
  'document_key': 'pan_photo_url',
  'file': await MultipartFile.fromFile(filePath, filename: 'pan.jpg'),
});
final response = await dio.post('/api/kyc/documents/upload',
  data: formData,
  options: Options(headers: {'Authorization': 'Bearer $accessToken'}),
);
```

### HTTP status codes actually used
| Code | Meaning here |
|---|---|
| `200` | Success (GET, or an action that doesn't create something new) |
| `201` | Success, something new was created (register, create booking, etc.) |
| `400` | Bad request — business-rule rejection (e.g. wrong OTP, already resolved) |
| `401` | Not logged in / bad or expired token — try refreshing, then re-login |
| `403` | Logged in, but not allowed to do this (wrong role, not your resource) |
| `404` | Doesn't exist |
| `409` | Conflict — e.g. phone/email already registered, already rated |
| `422` | Validation failed — check the `errors` array in the response for which field(s) |
| `429` | Rate limited — you're calling too fast (mainly OTP endpoints), back off |
| `501` | Not implemented (you shouldn't hit any of these — flag it if you do) |

### The general request/response shape, concretely

**Register:**
```
POST /api/auth/register
{ "name": "Ramesh Kumar", "phone": "9876543210", "email": "ramesh@example.com", "password": "Test@1234", "role": "client" }
```
```json
{ "success": true, "message": "Registration successful. You can now log in.",
  "data": { "user": { "id": "uuid-here", "name": "Ramesh Kumar", "phone": "9876543210", "email": "ramesh@example.com", "role": "client", "status": "pending_verification", "is_phone_verified": false, "is_email_verified": false, "created_at": "2026-07-24T10:00:00.000Z" } } }
```

**Login:**
```
POST /api/auth/login
{ "email": "ramesh@example.com", "password": "Test@1234" }
```
```json
{ "success": true, "message": "Login successful",
  "data": {
    "user": { "id": "uuid-here", "name": "Ramesh Kumar", "role": "client", "kyc_status": "pending", "..." : "..." },
    "tokens": { "access_token": "eyJhbGci...", "refresh_token": "eyJhbGci...", "token_type": "Bearer", "expires_in": "7d" }
  } }
```

**A validation error looks like this (422):**
```json
{ "success": false, "message": "Validation failed",
  "errors": [ { "type": "field", "msg": "Phone number must be 10 digits", "path": "phone", "location": "body" } ] }
```

---

## Table of Contents

0. [Integration Quick Start](#0-integration-quick-start-read-this-first-if-youre-building-the-app)
1. [How auth works, in plain English](#1-how-auth-works-in-plain-english)
2. [Auth](#2-auth--apiauth)
3. [User Profile & Notifications](#3-user-profile--notifications--apiusers)
4. [KYC (identity verification)](#4-kyc-identity-verification--apikyc-apiadminkyc)
5. [Bookings & Pricing](#5-bookings--pricing--apibookings-apipricing)
6. [Vehicles — Trucks & Drivers](#6-vehicles--trucks--drivers--apivehicles)
7. [Broker Profile](#7-broker-profile--apibroker)
8. [Jobs (offer/accept flow)](#8-jobs-offeraccept-flow--apijobs)
9. [Trips](#9-trips--apitrips)
10. [Payments & Settlements](#10-payments--settlements--apipayments-apianalyticsbroker)
11. [Disputes](#11-disputes--apidisputes)
12. [Admin](#12-admin--apiadmin-apianalyticsadmin)
13. [Config (public lookups)](#13-config-public-lookups--apiconfig)
14. [The big picture: how a booking actually flows](#14-the-big-picture-how-a-booking-actually-flows)
15. [Enums Reference](#15-enums-reference-for-building-dropdowns--status-badges)

---

## 1. How auth works, in plain English

Every account (client, broker, driver, admin) lives in one `users` table with a `role` column. There's no separate login system per role — it's all the same `/api/auth/login`.

**The short version:** you log in once, get two tokens back — an `access_token` (short-lived, ~7 days, sent on every request) and a `refresh_token` (long-lived, ~30 days, only used to get a new access token when the old one expires). Every protected endpoint checks the access token via `Authorization: Bearer <token>`.

**Two ways to log in:**
- **Email/phone + password** — the traditional way. Admin accounts can *only* use this.
- **Google Sign-In** — client/broker/driver only, not admin. First time someone signs in with Google, an account is auto-created (or linked to an existing email-matched account) — no separate "register with Google" step needed.

**Phone OTP** exists as a secondary path (`/otp/send` + `/otp/verify`), mainly for password reset and phone-only login without a password.

**Why two tokens instead of one?** If someone steals your access token, it expires in days, not months. The refresh token lets you silently get a new access token without forcing a fresh login every week, but it's revoked (and a new one issued) every single time it's used — so a stolen refresh token stops working the moment the real user's app refreshes next, and password resets nuke every refresh token at once (logs out every device).

---

## 2. Auth — `/api/auth/*`

### `POST /api/auth/register`
**Who can call it:** Public
**In plain English:** Sign up as a client, broker, or driver. Admin accounts can't be created this way — see `/auth/admin/register` below.
**You send:** `name`, `phone` (10-digit), `password`, optionally `email`, `role` (defaults to `client`).
```
POST /api/auth/register
{ "name": "Ramesh Kumar", "phone": "9876543210", "email": "ramesh@example.com", "password": "Test@1234", "role": "client" }
```
```json
{ "success": true, "message": "Registration successful. You can now log in.",
  "data": { "user": { "id": "uuid-here", "name": "Ramesh Kumar", "phone": "9876543210", "email": "ramesh@example.com", "role": "client", "status": "pending_verification", "created_at": "2026-08-01T10:00:00.000Z" } } }
```
**You get back:** the created `user` object (no password, obviously).
**Good to know:** Phone number must be unique across the whole platform regardless of role — you can't have a client and a broker account on the same phone number. This just creates the account; it does not log you in — call `/auth/login` next.

### `POST /api/auth/login`
**Who can call it:** Public
**In plain English:** The one login endpoint for every role. Send either `email` or `phone` plus your `password`.
**You send:** `email` **or** `phone`, `password`.
```
POST /api/auth/login
{ "email": "ramesh@example.com", "password": "Test@1234" }
```
```json
{ "success": true, "message": "Login successful",
  "data": {
    "user": { "id": "uuid-here", "name": "Ramesh Kumar", "phone": "9876543210", "email": "ramesh@example.com", "role": "client", "status": "active", "kyc_status": "pending", "created_at": "2026-08-01T10:00:00.000Z" },
    "tokens": { "access_token": "eyJhbGci...", "refresh_token": "eyJhbGci...", "token_type": "Bearer", "expires_in": "7d" }
  } }
```
**You get back:** `user` (your profile) + `tokens` (`access_token`, `refresh_token`, `expires_in`).
**Good to know:** Blocked or inactive accounts are rejected here with a clear message, not a generic "invalid credentials" — so a blocked broker knows *why* they can't get in.

### `POST /api/auth/admin/register`
**Who can call it:** Admin
**In plain English:** The only way a new admin account gets created (besides the seed script) — an existing admin creates the next one. There's a UI for this in the admin dashboard's Settings → Team tab.
**You send:** `name`, `phone`, `email` (required for admins specifically), `password` (min 8 chars).
```
POST /api/auth/admin/register
Authorization: Bearer <admin-access-token>
{ "name": "Priya Admin", "phone": "9000000099", "email": "priya.admin@ssklogistics.in", "password": "SecurePass@1" }
```
```json
{ "success": true, "message": "Admin account created successfully",
  "data": { "user": { "id": "uuid-here", "name": "Priya Admin", "phone": "9000000099", "email": "priya.admin@ssklogistics.in", "role": "admin", "status": "active", "is_phone_verified": true, "is_email_verified": true } } }
```
**You get back:** the new admin `user` object.
**Good to know:** New admins are active and verified immediately — no OTP step, unlike a normal signup.

### `POST /api/auth/google`
**Who can call it:** Public
**In plain English:** "Sign in with Google" button — works for both first-time sign-up and returning login in one call.
**You send:** `id_token` (the Google ID token from the frontend's Google Sign-In widget), `role` (client/broker/driver — ignored if the account already exists).
```
POST /api/auth/google
{ "id_token": "<the-google-id-token>", "role": "client" }
```
```json
{ "success": true, "message": "Account created via Google",
  "data": {
    "user": { "id": "uuid-here", "name": "Ramesh Kumar", "email": "ramesh@gmail.com", "role": "client", "status": "active" },
    "is_new_user": true, "needs_phone": true,
    "tokens": { "access_token": "eyJhbGci...", "refresh_token": "eyJhbGci...", "token_type": "Bearer", "expires_in": "7d" }
  } }
```
**You get back:** `user`, `tokens`, plus `is_new_user` (true if this just created an account) and `needs_phone` (true if the account has no phone number yet — Google doesn't provide one).
**Good to know:** If your Google email matches an existing phone-registered account, it *links* to that account instead of creating a duplicate — you end up with one account usable both ways. Admin role is explicitly blocked here.

### `POST /api/auth/otp/send`
**Who can call it:** Public
**In plain English:** Sends a 6-digit code to a phone number, for either logging in without a password or resetting one.
**You send:** `phone`, `purpose` (`login` or `password_reset`).
```
POST /api/auth/otp/send
{ "phone": "9876543210", "purpose": "login" }
```
```json
{ "success": true, "message": "OTP sent to 9876543210. Valid for 10 minutes.",
  "data": { "phone": "9876543210", "purpose": "login", "expires_in_minutes": 10, "dev_otp": "482913" } }
```
**You get back:** confirmation + `expires_in_minutes`. In non-production environments, the actual OTP code is included in the response as `dev_otp` (so you can test without a real SMS provider — `dev_otp` will **not** be present in the production response, don't rely on it existing).
**Good to know:** Capped at 3 requests per phone per 10 minutes to stop OTP-spam abuse. No real SMS provider is wired up by default (`SmsProvider` interface defaults to a fake one that just logs it).

### `POST /api/auth/otp/verify`
**Who can call it:** Public
**In plain English:** Submit the code you got from `/otp/send`. If `purpose` was `login`, this logs you in and hands back tokens just like `/auth/login`. If it was for phone verification, it just marks your phone verified.
**You send:** `phone`, `otp`, `purpose`.
```
POST /api/auth/otp/verify
{ "phone": "9876543210", "otp": "482913", "purpose": "login" }
```
```json
{ "success": true, "message": "OTP verified. Login successful.",
  "data": {
    "user": { "id": "uuid-here", "name": "Ramesh Kumar", "phone": "9876543210", "role": "client" },
    "tokens": { "access_token": "eyJhbGci...", "refresh_token": "eyJhbGci...", "token_type": "Bearer", "expires_in": "7d" }
  } }
```
**You get back:** `user` (+ `tokens` if purpose was `login`).

### `POST /api/auth/forgot-password` → `POST /api/auth/reset-password`
**Who can call it:** Public
**In plain English:** The "forgot my password" flow. First endpoint sends an OTP to your phone; second endpoint takes that OTP plus a new password and actually changes it.
**You send:** forgot-password: `phone`. reset-password: `phone`, `otp`, `new_password`.
```
POST /api/auth/forgot-password
{ "phone": "9876543210" }
```
```json
{ "success": true, "message": "OTP sent to 9876543210. Valid for 10 minutes.", "data": { "phone": "9876543210", "expires_in_minutes": 10 } }
```
```
POST /api/auth/reset-password
{ "phone": "9876543210", "otp": "482913", "new_password": "NewPass@123" }
```
```json
{ "success": true, "message": "Password reset successful. Please login with your new password." }
```
**Good to know:** Resetting your password logs you out of every device — all refresh tokens for that account are revoked, on the theory that if you forgot your password, someone else might have gotten in.

### `POST /api/auth/refresh-token`
**Who can call it:** Public (but requires a valid refresh token)
**In plain English:** When your access token expires, use this to get a new one without making the user log in again.
**You send:** `refresh_token`.
```
POST /api/auth/refresh-token
{ "refresh_token": "eyJhbGci..." }
```
```json
{ "success": true, "message": "Tokens refreshed",
  "data": { "tokens": { "access_token": "eyJhbGci...(new)", "refresh_token": "eyJhbGci...(new)", "token_type": "Bearer", "expires_in": "7d" } } }
```
**You get back:** a brand-new pair of tokens.
**Good to know:** The refresh token you sent is immediately invalidated (single-use) — this is "rotation," and it means if a stolen refresh token gets used by an attacker before the real user, the real user's next refresh attempt will fail and reveal something's wrong.

### `POST /api/auth/logout`
**Who can call it:** Any logged-in user
**In plain English:** Log out — either this one device (default) or every device at once.
**You send:** `refresh_token` (to revoke just that session), or `all_devices: true`.
```
POST /api/auth/logout
{ "refresh_token": "eyJhbGci..." }
```
```json
{ "success": true, "message": "Logged out successfully" }
```

### `GET /api/auth/me`
**Who can call it:** Any logged-in user
**In plain English:** "Who am I?" — returns your own profile based on the token you sent. Used by frontends on page load to restore a session.
```json
{ "success": true, "message": "Current user fetched",
  "data": { "user": { "id": "uuid-here", "name": "Ramesh Kumar", "phone": "9876543210", "role": "client", "status": "active" } } }
```

---

## 3. User Profile & Notifications — `/api/users/*`

### `GET /api/users/profile`
**Who can call it:** Any logged-in user
**In plain English:** View your own profile.
```json
{ "success": true, "message": "Profile fetched",
  "data": { "user": { "id": "uuid-here", "name": "Ramesh Kumar", "email": "ramesh@example.com", "phone": "9876543210", "role": "client", "status": "active", "profile_image": null, "address": null, "company_name": null, "kyc_status": "pending", "created_at": "2026-08-01T10:00:00.000Z" } } }
```

### `PATCH /api/users/profile`
**Who can call it:** Any logged-in user
**In plain English:** Edit your own profile — name, email, profile photo, address, company name. Phone number is not editable here (it's your account identity).
**You send:** any of `name`, `email`, `profile_image`, `address`, `company_name` (only the fields you include get changed).
```
PATCH /api/users/profile
{ "name": "Ramesh Kumar", "address": "12 MG Road, Pune", "company_name": "Kumar Transport" }
```
```json
{ "success": true, "message": "Profile updated successfully",
  "data": { "user": { "id": "uuid-here", "name": "Ramesh Kumar", "address": "12 MG Road, Pune", "company_name": "Kumar Transport", "..." : "...rest of user fields, snake_case" } } }
```
**Good to know:** Changing your email checks it's not already used by someone else first.

### `PATCH /api/users/change-password`
**Who can call it:** Any logged-in user
**In plain English:** Change your password while logged in (you know your current one, unlike the forgot-password flow).
**You send:** `current_password`, `new_password`.
```
PATCH /api/users/change-password
{ "current_password": "OldPass@123", "new_password": "NewPass@456" }
```
```json
{ "success": true, "message": "Password changed successfully" }
```
**Good to know:** Rejects if the new password is identical to the current one.

### `GET /api/users/notifications`
**Who can call it:** Any logged-in user
**In plain English:** The bell-icon notification feed everyone has — bookings confirmed, KYC approved, disputes resolved, etc.
**You send (query):** `page`, `limit` (both optional).
```json
{ "success": true, "message": "Notifications fetched",
  "data": {
    "notifications": [
      { "id": "uuid-here", "title": "Booking Confirmed", "message": "Your booking has been accepted by a broker.", "type": "booking", "is_read": false, "meta": { "booking_id": "uuid-here" }, "created_at": "2026-08-01T11:00:00.000Z" }
    ],
    "total": 12, "unread_count": 3, "page": 1, "limit": 20, "total_pages": 1
  } }
```
**Good to know:** Notifications are created internally by other actions throughout the API (e.g. accepting a job request notifies the client) — there's no endpoint to create your own. Note this is one of the **snake_case** resources (`is_read`, `created_at`).

### `PATCH /api/users/notifications/:id/read`
**Who can call it:** Any logged-in user
**In plain English:** Mark one notification as read.
```json
{ "success": true, "message": "Notification marked as read", "data": { "notification": { "id": "uuid-here", "is_read": true } } }
```

### `PATCH /api/users/notifications/read-all`
**Who can call it:** Any logged-in user
**In plain English:** Mark every one of your notifications as read at once.
```json
{ "success": true, "message": "All notifications marked as read", "data": { "updated": 3 } }
```

### `GET /api/admin/users`
**Who can call it:** Admin
**In plain English:** List/search everyone on the platform.
**You send (query):** `role`, `status`, `kyc_status`, `search`, `page`, `limit` — all optional filters.
```json
{ "success": true, "message": "Users fetched",
  "data": { "users": [ { "id": "uuid-here", "name": "Ramesh Kumar", "role": "driver", "status": "active", "kyc_status": "verified" } ], "total": 22, "page": 1, "limit": 10, "total_pages": 3 } }
```

### `GET /api/admin/users/:id`
**Who can call it:** Admin
**In plain English:** View one account's full detail.
```json
{ "success": true, "message": "User fetched", "data": { "user": { "id": "uuid-here", "name": "Ramesh Kumar", "role": "driver", "status": "active" } } }
```

### `PATCH /api/admin/users/:id/status`
**Who can call it:** Admin
**In plain English:** Change someone's status.
**You send:** `status` (`active`, `inactive`, or `blocked`).
```
PATCH /api/admin/users/<user-id>/status
{ "status": "blocked" }
```
```json
{ "success": true, "message": "User status updated to blocked", "data": { "user": { "id": "uuid-here", "status": "blocked" } } }
```

### `DELETE /api/admin/users/:id`
**Who can call it:** Admin
**In plain English:** Soft-delete an account.
```json
{ "success": true, "message": "User deleted successfully" }
```
**Good to know:** An admin can't touch their own account through any of these three (can't block/delete yourself) and can't touch *another* admin's account either — admin accounts can only be managed by direct database access, which is a deliberate safety rail. "Delete" is a soft delete — the row isn't actually removed, just marked inactive, so booking/audit history referencing that user stays intact.

---

## 4. KYC (identity verification) — `/api/kyc/*`, `/api/admin/kyc/*`

**What KYC is, in plain English:** Before a broker or driver can actually get real work on the platform, they submit identity/business documents for an admin to review and approve. Until verified, their account still exists but is gated out of trip/job features (`KycGate` in the frontend blocks access until `kyc_status` is `verified`).

**The canonical fields** (same names used everywhere — submission, validation, profile display, admin review):
- **Broker:** `pan_number`, `aadhaar_number`, `gst_number`, `bank_account_number`, `business_registration_number`
- **Driver:** `license_number`, `aadhaar_number`, `vehicle_registration_number`, `vehicle_insurance_number`

### `POST /api/kyc/broker` / `POST /api/kyc/driver`
**Who can call it:** Broker / Driver respectively
**In plain English:** Submit (or resubmit, e.g. after a rejection) your identity documents for review. Sets your `kyc_status` to `submitted`.
**You send:** `{ documents: { pan_number: "...", aadhaar_number: "...", ... } }` — a flat object of the fields above, plus optionally `pan_photo_url`/`aadhaar_photo_url`/`license_photo_url` (get these from the upload endpoint first).
```
POST /api/kyc/broker
{
  "documents": {
    "pan_number": "ABCDE1234F",
    "aadhaar_number": "1234-5678-9012",
    "gst_number": "27ABCDE1234F1Z5",
    "bank_account_number": "1234567890123",
    "business_registration_number": "U12345MH2020PTC123456",
    "pan_photo_url": "https://apigadidosti.asynk.in/api/kyc/documents/file/<id-from-upload>",
    "aadhaar_photo_url": "https://apigadidosti.asynk.in/api/kyc/documents/file/<id-from-upload>"
  }
}
```
**Good to know:** PAN, Aadhaar, and GST are format-checked server-side (e.g. PAN must look like `ABCDE1234F`) — required fields (PAN+Aadhaar for brokers, license+Aadhaar for drivers) can't be submitted blank. Resubmitting overwrites the whole previous submission and clears any rejection reason.

Driver version is the same shape, different keys:
```
POST /api/kyc/driver
{
  "documents": {
    "license_number": "MH-2020123456789",
    "aadhaar_number": "1234-5678-9012",
    "vehicle_registration_number": "MH-12-CD-5678",
    "vehicle_insurance_number": "INS-2024-567890",
    "license_photo_url": "https://apigadidosti.asynk.in/api/kyc/documents/file/<id>",
    "aadhaar_photo_url": "https://apigadidosti.asynk.in/api/kyc/documents/file/<id>"
  }
}
```
```json
{ "success": true, "message": "KYC documents submitted for review",
  "data": { "submission": { "id": "uuid-here", "user_id": "uuid-here", "documents": { "license_number": "MH-2020123456789", "...": "..." }, "submitted_at": "2026-08-01T12:00:00.000Z" }, "kyc_status": "submitted" } }
```
(Note: `submission` is a **snake_case** resource — `user_id`, `submitted_at`, `rejection_reason`.)

### `POST /api/kyc/documents/upload`
**Who can call it:** Broker / Driver
**In plain English:** Upload an actual photo of a document (multipart file). Returns a URL you then include in the `documents` object above under the matching key (`pan_photo_url`, etc.).
**You send:** multipart form with fields `file` (the image) and `document_key` (e.g. `pan_photo_url`, `aadhaar_photo_url`, `license_photo_url` — see section 0 for the Dio example).
```json
{ "success": true, "message": "Document uploaded",
  "data": { "document": { "id": "uuid-here", "user_id": "uuid-here", "document_type": "pan_photo_url", "url": "https://apigadidosti.asynk.in/api/kyc/documents/file/uuid-here" } } }
```
**Good to know:** The file's URL is saved immediately, even before you click final "Submit" — so if you upload a photo and refresh the page before submitting, the photo isn't lost. Re-uploading under the same key replaces the old file rather than accumulating duplicates.

### `GET /api/kyc/documents`
**Who can call it:** Broker/Driver
**In plain English:** List your own uploaded files.
```json
{ "success": true, "message": "KYC documents fetched",
  "data": { "documents": [ { "id": "uuid-here", "document_type": "pan_photo_url", "filename": "pan.jpg", "mime_type": "image/jpeg", "size_bytes": 204800, "uploaded_at": "2026-08-01T11:30:00.000Z", "url": "https://apigadidosti.asynk.in/api/kyc/documents/file/uuid-here" } ] } }
```

### `GET /api/kyc/documents/file/:id`
**Who can call it:** Broker/Driver (own file) / Admin
**In plain English:** Fetch the actual image bytes of one uploaded file by ID (used when files are stored in the database rather than local disk — see `STORAGE_PROVIDER`). This is **not** a JSON response — it's the raw image with the correct `Content-Type` header, meant to be loaded directly into an `Image.network(url, headers: {...})` widget (remember it needs the `Authorization` header too, same as any other protected endpoint).

### `GET /api/kyc/status`
**Who can call it:** Broker/Driver
**In plain English:** Check your own current KYC status and submitted data.
```json
{ "success": true, "message": "KYC status fetched",
  "data": { "kyc_status": "submitted", "submission": { "id": "uuid-here", "documents": { "pan_number": "ABCDE1234F" }, "rejection_reason": null, "submitted_at": "2026-08-01T12:00:00.000Z" } } }
```

### `GET /api/kyc/:userId`
**Who can call it:** Broker/Driver (own record only — 404s if it's not your own ID)
**In plain English:** Same as `/kyc/status` but by explicit ID — mainly used internally, just use `/kyc/status` for "my own" lookups.

### `GET /api/admin/kyc/pending`
**Who can call it:** Admin
**In plain English:** The review queue — every broker/driver KYC submission waiting on a decision (defaults to `submitted` status, i.e. "needs review right now").
**You send (query):** `kyc_status`, `role`, `search`, `page`, `limit` — all optional filters.
```json
{ "success": true, "message": "KYC submissions fetched",
  "data": { "submissions": [ { "user_id": "uuid-here", "name": "Ramesh Kumar", "documents": { "pan_number": "ABCDE1234F" }, "kyc_status": "submitted", "submitted_at": "2026-08-01T12:00:00.000Z" } ], "total": 4, "page": 1, "limit": 10 } }
```

### `GET /api/admin/kyc/:userId`
**Who can call it:** Admin
**In plain English:** Open one specific person's full KYC submission to review it.
```json
{ "success": true, "message": "KYC submission fetched",
  "data": { "kyc_status": "submitted", "submission": { "id": "uuid-here", "documents": { "pan_number": "ABCDE1234F", "aadhaar_number": "1234-5678-9012" } } } }
```

### `GET /api/admin/kyc/:userId/documents`
**Who can call it:** Admin
**In plain English:** List that person's uploaded document photos specifically (separate from the `documents` JSON blob above — these are the actual files).
```json
{ "success": true, "message": "KYC documents fetched", "data": { "documents": [ { "id": "uuid-here", "document_type": "pan_photo_url", "url": "https://apigadidosti.asynk.in/api/kyc/documents/file/uuid-here" } ] } }
```

### `PATCH /api/admin/kyc/:userId/verify`
**Who can call it:** Admin
**In plain English:** Approve — unlocks the account's full platform access.
```json
{ "success": true, "message": "KYC verified", "data": { "submission": { "id": "uuid-here" }, "kyc_status": "verified" } }
```

### `PATCH /api/admin/kyc/:userId/reject`
**Who can call it:** Admin
**In plain English:** Reject with a reason, which the broker/driver sees and can then fix and resubmit.
**You send:** `reason`.
```
PATCH /api/admin/kyc/<user-id>/reject
{ "reason": "Aadhaar number does not match uploaded name" }
```
```json
{ "success": true, "message": "KYC rejected", "data": { "submission": { "id": "uuid-here", "rejection_reason": "Aadhaar number does not match uploaded name" }, "kyc_status": "rejected" } }
```
**Good to know:** Both are blocked if the target isn't a broker/driver, or is already verified (can't re-verify something already verified).

---

## 5. Bookings & Pricing — `/api/bookings/*`, `/api/pricing/*`

**What a booking is, in plain English:** A client's request to move cargo from A to B. It starts with no broker/driver/truck assigned — it's broadcast to every eligible broker as a "job request," and whoever accepts first gets it, then assigns one of their own drivers+trucks. From there it's driven forward mostly by the *trip* (see section 9), not this booking object directly.

### `POST /api/bookings`
**Who can call it:** Client
**In plain English:** Create a new booking — this is "I want a truck" from the client's perspective.
**You send:** pickup/drop location (+ optional lat/lng), `truck_type`, `truck_category` (small/medium/large/part), `weight`, `quantity`, `material`, `transport_type` (intra/inter city), `scheduled_date`, and optionally `distance` (if provided, price is auto-calculated), `amount` (overrides the calculated price if you want to propose your own), `payment_status` (paid/pending), and — for the traffic-aware pricing feature — `duration_min`/`duration_in_traffic_min` from a prior `/config/distance` call.
```
POST /api/bookings
{
  "pickup_location": "Pune, Maharashtra",
  "pickup_lat": 18.5204, "pickup_lng": 73.8567,
  "drop_location": "Mumbai, Maharashtra",
  "drop_lat": 19.0760, "drop_lng": 72.8777,
  "truck_type": "Medium Truck", "truck_category": "medium",
  "weight": 2.5, "weight_unit": "tons", "quantity": 10, "material": "Electronics",
  "transport_type": "intra", "scheduled_date": "2026-08-01T09:00:00.000Z",
  "distance": 150, "duration_min": 180, "duration_in_traffic_min": 210,
  "payment_status": "pending"
}
```
```json
{ "success": true, "message": "Booking created",
  "data": { "booking": {
    "id": "uuid-here", "bookingNumber": "BKG-202608-012", "status": "pending",
    "pickup": "Pune, Maharashtra", "drop": "Mumbai, Maharashtra",
    "amount": 6982.5, "paymentStatus": "pending", "timeline": ["pending"], "currentStep": 0,
    "rating": null, "podUrl": null
  } } }
```
**You get back:** the created `booking` (camelCase — see the field-casing table in section 0).
**Good to know:** This is where the broadcast happens — every KYC-verified, active broker whose `service_city` matches the pickup location gets notified with a job request (falls back to *every* active broker if none are zoned for that city, so a booking never silently gets zero offers). Supports an `Idempotency-Key` header — retry the exact same request with the same key and you get the original booking back instead of creating a duplicate (protects against double-taps on a slow network).

### `GET /api/bookings`
**Who can call it:** Any logged-in user (results are scoped to what you're allowed to see — a client sees their own, a broker sees ones they're assigned to, admin sees all)
**In plain English:** List your bookings.
**You send (query):** `status`, `sort` (`asc`/`desc`), `page`, `limit` — all optional.
```json
{ "success": true, "message": "Bookings fetched",
  "data": { "bookings": [ { "id": "uuid-here", "bookingNumber": "BKG-202608-012", "pickup": "Pune, Maharashtra", "drop": "Mumbai, Maharashtra", "status": "in_transit", "amount": 6982.5, "paymentStatus": "pending", "rating": null, "podUrl": null } ], "total": 8, "page": 1, "limit": 10, "total_pages": 1 } }
```

### `GET /api/bookings/:id`
**Who can call it:** Any logged-in user with access to that booking
**In plain English:** Look at one booking in detail.
```json
{ "success": true, "message": "Booking fetched",
  "data": { "booking": {
    "id": "uuid-here", "bookingNumber": "BKG-202608-012", "status": "delivered",
    "pickup": "Pune, Maharashtra", "drop": "Mumbai, Maharashtra", "truckType": "Medium Truck",
    "driver": { "name": "Suresh Patil", "phone": "9000000007" }, "truckReg": "MH-12-AB-1234",
    "timeline": ["pending", "confirmed", "assigned", "en_route_pickup", "picked_up", "in_transit", "delivered"],
    "currentStep": 6, "amount": 6982.5, "paymentStatus": "paid",
    "rating": null, "podUrl": "https://apigadidosti.asynk.in/api/trips/pod/file/uuid-here"
  } } }
```
**Good to know:** `:id` accepts either the raw ID or the human-readable `booking_number` (e.g. `BKG-202412-001`) — either works. The response includes `rating` (the client's post-delivery rating, if any) and `podUrl` (the proof-of-delivery photo, if uploaded) even though those actually live on the linked *trip*, not the booking itself — they're joined in for convenience.

### `GET /api/bookings/:id/track`
**Who can call it:** Any logged-in user with access to that booking
**In plain English:** The live-tracking screen's data source — driver's current location, ETA, and (if something's gone wrong) the latest unresolved incident on the trip, all in one call. Meant to be polled every 5-10 seconds by the frontend, not pushed via WebSocket.
```json
{ "success": true, "message": "Tracking info fetched",
  "data": { "status": "in_transit", "driverLocation": { "lat": 18.6, "lng": 73.9 }, "etaMinutes": 45, "openIncident": null } }
```

### `PATCH /api/bookings/:id/status`
**Who can call it:** Admin **only**
**In plain English:** A manual override to force a booking's status, for fixing something stuck or wrong. This is **not** part of the normal flow — normal progression happens through the trip endpoint below, which keeps the booking in sync automatically. No frontend calls this under normal use — a Flutter driver/broker/client app should never call this one.
**You send:** `status` (one of `pending`, `confirmed`, `assigned`, `en_route_pickup`, `picked_up`, `in_transit`, `delivered`, `cancelled`, `no_broker_available` — **not** `completed`), optionally `driver_id`, `truck_id`.
```json
{ "success": true, "message": "Booking status updated", "data": { "booking": { "id": "uuid-here", "status": "cancelled" } } }
```
**Good to know:** `completed` is deliberately not an allowed value here — completing a trip has to go through `PATCH /api/trips/:id/status` so the settlement/payout logic (see section 9) can't be sidestepped. Using this also updates the linked trip's status to match, so the two can never disagree.

### `PATCH /api/bookings/:id/cancel`
**Who can call it:** Client (their own booking) / Admin
**In plain English:** Cancel a booking.
```json
{ "success": true, "message": "Booking cancelled", "data": { "booking": { "id": "uuid-here", "status": "cancelled" } } }
```

### `PATCH /api/bookings/:id/pay`
**Who can call it:** Client
**In plain English:** Mark a booking as paid. There's no real payment gateway wired up (`PaymentProvider` defaults to a fake one) — this just records the client's choice for "Pay Now" vs "Pay Later."
```json
{ "success": true, "message": "Payment recorded", "data": { "booking": { "id": "uuid-here", "paymentStatus": "paid" } } }
```

### `POST /api/bookings/:id/rate` — "Client Rating"
**Who can call it:** Client (their own booking)
**In plain English:** Once a delivery is done, the client can leave a 1-5 star rating and an optional written review. This is specifically the *client* rating the *delivery* — nobody currently rates brokers or drivers on this platform.
**You send:** `stars` (1-5, required), `review` (optional text, up to 1000 characters).
```
POST /api/bookings/<booking-id>/rate
{ "stars": 5, "review": "Great service, on-time delivery!" }
```
```json
{ "success": true, "message": "Booking rated",
  "data": { "rating": { "stars": 5, "review": "Great service, on-time delivery!", "createdAt": "2026-08-01T18:00:00.000Z" } } }
```
**Good to know:** Only allowed once the booking is `delivered` or `completed`, and only once ever — a second attempt is rejected (409). The rating shows up in every booking response afterward via the `rating` field.

### `POST /api/bookings/quote` and `POST /api/pricing/estimate`
**Who can call it:** Any logged-in user
**In plain English:** Two names for the exact same thing — "how much would this cost?" without actually creating a booking. This is what powers the live price estimate shown while filling out the booking form.
**You send:** `truck_category`, `transport_type`, `distance`, optionally `capacity_used_pct` (part-load only), and `duration_min`/`duration_in_traffic_min` (to factor in current traffic — see below).
**You get back:** a price breakdown whose exact shape depends on the truck category/transport type:
  - **Part-load:** `totalTruckCost`, `capacityUsedPct`, `platformFee`, `total`
  - **Intra-city:** `baseFare`, `distanceFare`, `subtotal`, `platformFee`, `total`
  - **Inter-city:** everyone gets `distanceFare`/`subtotal`; admin additionally sees the `fuel`/`toll` split that makes it up.
  - All three shapes also include `trafficMultiplier` (1.0 = no surge) and `trafficSurcharge` (the rupee amount added) whenever traffic duration data was supplied.
```
POST /api/pricing/estimate
{ "truck_category": "medium", "transport_type": "intra", "distance": 150, "duration_min": 180, "duration_in_traffic_min": 210 }
```
```json
{ "success": true, "message": "Pricing estimate calculated",
  "data": { "pricing": {
    "baseFare": 800, "distance": 150, "distanceFare": 5250, "subtotal": 6050,
    "trafficMultiplier": 1.15, "trafficSurcharge": 907.5,
    "platformFee": 695.75, "total": 7653.25
  } } }
```
**Good to know — traffic-aware pricing:** if you pass `duration_min` (traffic-free ETA) and `duration_in_traffic_min` (live-traffic ETA), a surge multiplier gets layered on top of the normal rate: up to 10% longer than usual → no surge; 10-30% longer → 1.15x; 30-60% longer → 1.3x; over 60% longer → capped at 1.5x. This is computed fresh on every quote, not stored as an admin-configurable rate — the base rates in Pricing Management are untouched by this.

---

## 6. Vehicles — Trucks & Drivers — `/api/vehicles/*`

**In plain English:** This is the broker's fleet management — the trucks they own and the drivers who work for them.

### `POST /api/vehicles/trucks`
**Who can call it:** Broker
**In plain English:** Add a truck to your fleet.
**You send:** `registration` (required, real Indian plate format like `MH-12-AB-1234`), `type`, `category` (small/medium/large/part, required), `capacity` (required), plus optional `make`, `year`, `insurance_expiry`, `driver_id`.
```
POST /api/vehicles/trucks
{ "registration": "MH-12-AB-1234", "type": "Medium Truck", "category": "medium", "capacity": "5 Tons", "make": "Tata 407", "year": 2022, "insurance_expiry": "2027-03-01" }
```
```json
{ "success": true, "message": "Truck added",
  "data": { "truck": { "id": "uuid-here", "registration": "MH-12-AB-1234", "type": "Medium Truck", "category": "medium", "capacity": "5 Tons", "status": "available", "driverId": null } } }
```
**Good to know:** Registration numbers are unique platform-wide — trying to add one that already exists (even under a different broker) is rejected (409).

### `GET /api/vehicles/trucks`
**Who can call it:** Broker (own fleet) / Admin (everything)
**In plain English:** List trucks.
**You send (query):** `status`, `page`, `limit` — optional.
```json
{ "success": true, "message": "Trucks fetched", "data": { "trucks": [ { "id": "uuid-here", "registration": "MH-12-AB-1234", "category": "medium", "status": "on_trip", "driver": "Suresh Patil" } ], "total": 5, "page": 1, "limit": 10 } }
```

### `GET /api/vehicles/trucks/:id`
**Who can call it:** Broker (own) / Admin
**In plain English:** View one truck.
```json
{ "success": true, "message": "Truck fetched", "data": { "truck": { "id": "uuid-here", "registration": "MH-12-AB-1234", "category": "medium", "status": "available" } } }
```

### `PATCH /api/vehicles/trucks/:id`
**Who can call it:** Broker (own) / Admin
**In plain English:** Edit a truck.
**You send:** any of `driver_id`, `type`, `category`, `capacity`, `make`, `year`, `insurance_expiry`, `status` (`available`/`on_trip`/`maintenance`).
```json
{ "success": true, "message": "Truck updated", "data": { "truck": { "id": "uuid-here", "status": "maintenance" } } }
```

### `DELETE /api/vehicles/trucks/:id`
**Who can call it:** Broker (own) / Admin
**In plain English:** Remove a truck.
```json
{ "success": true, "message": "Truck deleted" }
```
**Good to know:** A truck that's ever been used on a booking can't be deleted (400 — would break historical records) — you can only change its status instead (e.g. to `maintenance`).

### `GET /api/vehicles/drivers/lookup`
**Who can call it:** Broker
**In plain English:** "Is there already a driver account for this phone number?" — the first step of linking an *existing* driver to your fleet, before you know their account exists.
**You send (query):** `phone`.
```
GET /api/vehicles/drivers/lookup?phone=9876543210
```
```json
{ "success": true, "message": "Driver found", "data": { "driver": { "id": "uuid-here", "name": "Ramesh Kumar", "phone": "9876543210", "kycStatus": "pending" } } }
```
**Good to know:** Fails (404) if that phone isn't registered as a driver-role account yet, or (409) if that driver is already linked to some other broker.

### `POST /api/vehicles/drivers`
**Who can call it:** Broker
**In plain English:** Link an existing driver's account (found via the lookup above) to your fleet.
**You send:** `user_id` (the existing driver account's ID), plus optional `license_no`, `license_expiry`, `aadhaar`, `truck_id`.
```
POST /api/vehicles/drivers
{ "user_id": "uuid-of-existing-driver-account", "license_no": "MH-2020123456789", "truck_id": "uuid-of-truck" }
```
```json
{ "success": true, "message": "Driver profile created",
  "data": { "driver": { "id": "uuid-here", "name": "Ramesh Kumar", "phone": "9876543210", "licenseNo": "MH-2020123456789", "status": "available" } } }
```

### `POST /api/vehicles/drivers/register`
**Who can call it:** Broker
**In plain English:** The other, more common real-world path — most drivers don't have their own account yet, so this creates a brand-new driver account *and* links it to your fleet in one step.
**You send:** `name`, `phone`, `email` (all required — login here is email+password, so a driver without an email can't log in), plus optional `license_no`, `license_expiry`, `aadhaar`, `truck_id`.
```json
{ "success": true, "message": "Driver registered and added to your fleet",
  "data": {
    "driver": { "id": "uuid-here", "name": "Ramesh Kumar", "phone": "9876543210", "status": "available", "kycStatus": "pending" },
    "tempPassword": "aB3xY9zQ"
  } }
```
**You get back:** the new `driver` profile, plus a one-time `tempPassword` — a randomly generated password you're expected to relay to the driver so they can log in and change it. **This is the only time the password is ever returned — it's not recoverable later**, so show/send it to the driver immediately.
**Good to know:** Fails if the phone or email is already registered to anyone.

### `GET /api/vehicles/drivers`
**Who can call it:** Broker (own drivers) / Admin (everyone)
**In plain English:** List drivers.
**You send (query):** `status`, `page`, `limit`, and optionally `near_lat`/`near_lng` (+`truck_type`) to rank by distance from a point instead of newest-first — used when a broker is picking the nearest available driver to assign.
```json
{ "success": true, "message": "Drivers fetched",
  "data": { "drivers": [ { "id": "uuid-here", "name": "Suresh Patil", "phone": "9000000007", "licenseNo": "MH-2020123456789", "truckReg": "MH-12-AB-1234", "status": "available", "kycStatus": "verified", "distanceKm": 3.2 } ], "total": 6, "page": 1, "limit": 10 } }
```

### `GET /api/vehicles/drivers/:id`
**Who can call it:** Broker (own) / Admin
**In plain English:** View one driver.
```json
{ "success": true, "message": "Driver fetched", "data": { "driver": { "id": "uuid-here", "name": "Suresh Patil", "status": "on_trip" } } }
```

### `PATCH /api/vehicles/drivers/:id`
**Who can call it:** Broker (own) / Admin
**In plain English:** Edit a driver's license/Aadhaar/truck assignment/status.
**You send:** any of `license_no`, `license_expiry`, `aadhaar`, `truck_id`, `status` (`available`/`on_trip`/`offline`).
```
PATCH /api/vehicles/drivers/<driver-id>
{ "status": "offline" }
```
```json
{ "success": true, "message": "Driver updated", "data": { "driver": { "id": "uuid-here", "status": "offline" } } }
```

### `DELETE /api/vehicles/drivers/:id`
**Who can call it:** Broker (own) / Admin
**In plain English:** Unlink a driver from your fleet.
```json
{ "success": true, "message": "Driver removed" }
```
**Good to know:** "Delete" here only removes the *link* between the driver and this broker (`driver_profiles` row) — the driver's underlying user account is untouched, so they could be re-added later or picked up by another broker. Blocked (400) if the driver has booking history, same reasoning as trucks.

### `PATCH /api/vehicles/drivers/me/location`
**Who can call it:** Driver
**In plain English:** The driver app pings this periodically (even before a trip starts) to keep their live location up to date, which is what powers the nearest-driver search above and the client's live tracking screen.
**You send:** `lat`, `lng`.
```
PATCH /api/vehicles/drivers/me/location
{ "lat": 18.5204, "lng": 73.8567 }
```
```json
{ "success": true, "message": "Location updated", "data": { "location": { "lat": 18.5204, "lng": 73.8567, "lastLocationAt": "2026-08-01T14:00:00.000Z" } } }
```

---

## 7. Broker Profile — `/api/broker/*`

### `PATCH /api/broker/service-city`
**Who can call it:** Broker
**In plain English:** Set which city you're zoned for — this is what determines which new bookings get broadcast to you (see the booking-creation logic in section 5).
**You send:** `service_city`.
```
PATCH /api/broker/service-city
{ "service_city": "Pune" }
```
```json
{ "success": true, "message": "Service city updated", "data": { "profile": { "serviceCity": "Pune", "isOnline": true } } }
```

### `PATCH /api/broker/availability`
**Who can call it:** Broker
**In plain English:** Toggle yourself online/offline — an "I'm not accepting new jobs right now" switch.
**You send:** `is_online` (boolean).
```
PATCH /api/broker/availability
{ "is_online": false }
```
```json
{ "success": true, "message": "Availability updated", "data": { "profile": { "serviceCity": "Pune", "isOnline": false } } }
```

---

## 8. Jobs (negotiation flow) — `/api/jobs/*`

**In plain English:** When a booking is created, every eligible broker gets one "job request" row each — think of it as their personal copy of "here's a job, want it?" Job requests **never expire** — they sit as `pending` until something changes. A broker can only counter or decline; brokers **cannot** unilaterally accept a job request. The **client** is the sole party who confirms a broker — they compare offers via `GET /api/bookings/:bookingId/offers` and confirm one via `PATCH /api/jobs/requests/:id/client-accept` (or negotiate first via `.../client-counter`), which auto-declines every other broker's pending/countered offer on that booking. (There used to be a 30-minute auto-expiry with a background sweep; that's been removed. If you're wondering "what happens if nobody ever responds" — the admin dashboard surfaces a `stalePendingBookings` count for bookings sitting unconfirmed for 2+ hours, so it's visible, but nothing happens to the booking automatically.)

### `GET /api/jobs/requests`
**Who can call it:** Broker
**In plain English:** Your inbox of job requests — the bookings you've been offered.
**You send (query):** `page`, `limit` — optional.
```json
{ "success": true, "message": "Job requests fetched",
  "data": { "requests": [ { "id": "uuid-here", "bookingId": "uuid-here", "bookingNumber": "BKG-202608-012", "clientName": "Priya Sharma", "pickup": "Pune", "drop": "Mumbai", "distance": 150, "truckType": "Medium Truck", "amount": 6982.5, "status": "pending", "timestamp": "5 min ago" } ], "total": 2, "page": 1, "limit": 10 } }
```

### `PATCH /api/jobs/requests/:id/decline`
**Who can call it:** Broker
**In plain English:** Pass on a job you were offered.
```json
{ "success": true, "message": "Job request declined", "data": { "request": { "id": "uuid-here", "status": "declined" } } }
```

### `POST /api/jobs/:id/assign-driver`
**Who can call it:** Broker
**In plain English:** Once you've accepted a job, pick which of your drivers (and which truck) actually does it. This is the step that creates the real `trip` record.
**You send:** `driverId`, `truckId`.
```
POST /api/jobs/<job-request-id>/assign-driver
{ "driverId": "uuid-of-driver", "truckId": "uuid-of-truck" }
```
```json
{ "success": true, "message": "Driver assigned",
  "data": { "booking": { "id": "uuid-here", "status": "assigned", "driverId": "uuid-of-driver", "truckId": "uuid-of-truck", "timeline": ["pending", "confirmed", "assigned"], "currentStep": 2 } } }
```
**Good to know:** Can also be used to *reassign* a different driver mid-trip (e.g. after an incident) instead of only the first assignment — the existing trip's driver gets swapped rather than creating a second trip, and the booking's progress isn't reset backward when this happens.

---

## 9. Trips — `/api/trips/*`

**In plain English:** Once a broker assigns a driver+truck, the day-to-day "what's actually happening with this shipment right now" lives on the *trip*, not the booking. Trip status is what drives the client's tracking screen, and completing a trip is what triggers the driver getting paid.

**Trip status progression:** `confirmed → en_route_pickup → picked_up → in_transit → delivered → completed` (or `cancelled` at various points).

### `GET /api/trips`
**Who can call it:** Broker/Driver/Admin (scoped to your own trips unless admin)
**In plain English:** List trips.
**You send (query):** `status`, `page`, `limit` — optional.
```json
{ "success": true, "message": "Trips fetched",
  "data": { "trips": [ { "id": "uuid-here", "bookingId": "uuid-here", "bookingNumber": "BKG-202608-012", "status": "in_transit", "driverName": "Suresh Patil", "pickup": { "address": "Pune" }, "drop": { "address": "Mumbai" } } ], "total": 3, "page": 1, "limit": 10 } }
```

### `GET /api/trips/:id`
**Who can call it:** Broker/Driver/Admin
**In plain English:** View one trip in full detail.
```json
{ "success": true, "message": "Trip fetched",
  "data": { "trip": {
    "id": "uuid-here", "bookingId": "uuid-here", "status": "in_transit",
    "driverId": "uuid-here", "driverName": "Suresh Patil", "driverPhone": "9000000007",
    "pickup": { "address": "Pune, Maharashtra", "lat": 18.5204, "lng": 73.8567 },
    "drop": { "address": "Mumbai, Maharashtra", "lat": 19.0760, "lng": 72.8777 },
    "distance": 150, "earnings": 6282.5, "currentLocation": { "lat": 18.6, "lng": 73.9 },
    "podUrl": null, "timeline": [ { "step": "in_transit", "done": true, "time": "2026-08-01T13:00:00.000Z" } ]
  } } }
```

### `GET /api/trips/active`
**Who can call it:** Driver
**In plain English:** "What am I doing right now" for the driver app's home screen — the currently in-progress trip, or `null` if there isn't one.
```json
{ "success": true, "message": "Active trip fetched", "data": { "trip": null } }
```

### `GET /api/trips/upcoming`
**Who can call it:** Driver
**In plain English:** "What's next" — the next assigned-but-not-yet-started trip.
```json
{ "success": true, "message": "Upcoming trip fetched", "data": { "trip": { "id": "uuid-here", "status": "confirmed", "pickup": { "address": "Pune" } } } }
```

### `PATCH /api/trips/:id/status`
**Who can call it:** Broker/Driver/Admin
**In plain English:** Move a trip forward through its stages — this is what the driver app's big status button calls every time (e.g. "I've Reached Pickup," "Mark as Delivered").
**You send:** `status` (the new stage).
```
PATCH /api/trips/<trip-id>/status
{ "status": "delivered" }
```
```json
{ "success": true, "message": "Trip status updated",
  "data": { "trip": { "id": "uuid-here", "status": "delivered", "podUrl": null, "timeline": [ { "step": "delivered", "done": true, "time": "2026-08-01T14:30:00.000Z" } ] } } }
```
**Good to know — this is the important one:** the transition **into `completed`** is the one and only place a settlement (payout row) gets created and the driver's trip count goes up — and it's guarded so this can only ever happen **once per trip**, even if the same "mark completed" request somehow gets sent twice (a real bug that used to double-pay drivers before this was fixed). `delivered` alone does *not* trigger payout — only `completed`, which happens after proof of delivery is uploaded. This endpoint also mirrors the same status onto the parent booking automatically, so the two never drift apart.

### `POST /api/trips/:id/decline`
**Who can call it:** Driver
**In plain English:** A driver can back out of a trip that's been assigned to them but hasn't started yet (still `confirmed`). Once it's actually underway, this is no longer available — use "report an issue" instead, since cargo may already be in the truck.
```json
{ "success": true, "message": "Trip declined" }
```

### `PATCH /api/trips/:id/location`
**Who can call it:** Driver
**In plain English:** Live GPS ping while a trip is in progress — feeds the client's tracking map.
**You send:** `lat`, `lng`.
```
PATCH /api/trips/<trip-id>/location
{ "lat": 18.6, "lng": 73.9 }
```
```json
{ "success": true, "message": "Location updated", "data": { "currentLocation": { "lat": 18.6, "lng": 73.9 } } }
```

### `POST /api/trips/:id/report-issue`
**Who can call it:** Driver
**In plain English:** "Something went wrong" button — accident, breakdown, traffic block, medical emergency, or other. Both the broker and the client get notified immediately.
**You send:** `reason` (`accident`/`breakdown`/`traffic_block`/`medical`/`other`), `notes` (free text).
```
POST /api/trips/<trip-id>/report-issue
{ "reason": "breakdown", "notes": "Flat tire near Lonavala, arranging a replacement truck." }
```
```json
{ "success": true, "message": "Incident reported. Broker and client have been notified.",
  "data": { "incident": { "id": "uuid-here", "tripId": "uuid-here", "reason": "breakdown", "notes": "Flat tire near Lonavala, arranging a replacement truck.", "status": "reported", "reportedAt": "2026-08-01T13:15:00.000Z" } } }
```

### `GET /api/trips/:id/incidents`
**Who can call it:** Anyone with access to that trip, including the client (even though the client can't see the full trip record otherwise — incidents are visible to a wider audience since they affect the client's delivery too)
**In plain English:** See every incident reported on this specific trip.
```json
{ "success": true, "message": "Incidents fetched", "data": { "incidents": [ { "id": "uuid-here", "reason": "breakdown", "status": "reported", "reportedAt": "2026-08-01T13:15:00.000Z" } ] } }
```

### `PATCH /api/trips/:id/incidents/:incidentId/resolve`
**Who can call it:** Broker/Admin
**In plain English:** Mark a reported incident as handled, with a note on how it was resolved. The reporting driver gets notified.
**You send:** `resolution`.
```
PATCH /api/trips/<trip-id>/incidents/<incident-id>/resolve
{ "resolution": "Replacement truck dispatched, cargo transferred, back on route." }
```
```json
{ "success": true, "message": "Incident resolved",
  "data": { "incident": { "id": "uuid-here", "status": "resolved", "resolution": "Replacement truck dispatched, cargo transferred, back on route.", "resolvedAt": "2026-08-01T14:00:00.000Z" } } }
```

### `POST /api/trips/:id/pod`
**Who can call it:** Driver
**In plain English:** Upload the proof-of-delivery photo — the picture the driver takes once cargo is handed off. This is a required step before the trip can actually move to `completed` in the intended flow.
**You send:** multipart form with a `file` field (the photo) — no other fields needed.
```json
{ "success": true, "message": "Proof of delivery uploaded", "data": { "podUrl": "https://apigadidosti.asynk.in/api/trips/pod/file/uuid-here" } }
```
**Good to know:** Only works while the trip is `in_transit` or `delivered` — you can't upload POD for a trip that hasn't started or is already done. The resulting photo URL is visible to the client, broker, and admin, all via the booking's `podUrl` field.

### `GET /api/trips/pod/file/:id`
**Who can call it:** Anyone with access to that trip
**In plain English:** Actually fetch the POD image bytes (relevant when files are stored in the database rather than on disk). Like the KYC file endpoint, this returns raw image bytes, not JSON — load it with the `Authorization` header attached.

---

## 10. Payments & Settlements — `/api/payments/*`, `/api/analytics/broker`

**In plain English:** A "settlement" is the payout record created when a trip completes — how much the driver/broker actually gets paid after the platform's cut. There's one settlement row per completed trip, created automatically (see the trip-completion note above) — nobody creates these manually via the API.

### `GET /api/payments/settlements`
**Who can call it:** Broker/Driver/Admin
**In plain English:** Your payout history — every settlement you're party to.
**You send (query):** `page`, `limit` — optional.
```json
{ "success": true, "message": "Settlements fetched",
  "data": { "settlements": [ { "id": "uuid-here", "bookingNumber": "BKG-202608-012", "route": "Pune -> Mumbai", "truck": "MH-12-AB-1234", "driver": "Suresh Patil", "amount": 6982.5, "platformFee": 698.25, "net": 6284.25, "netEarnings": 6284.25, "status": "paid", "settledAt": "2026-08-01T20:00:00.000Z" } ], "total": 15, "page": 1, "limit": 10 } }
```

### `GET /api/analytics/broker`
**Who can call it:** Broker/Driver
**In plain English:** The earnings screen — how much you made this month vs. last month, plus your full trip/payout history in one call.
```json
{ "success": true, "message": "Earnings analytics fetched",
  "data": { "thisMonth": 45280.5, "lastMonth": 38900.0, "tripHistory": [ { "id": "uuid-here", "bookingNumber": "BKG-202608-012", "netEarnings": 6284.25, "status": "paid" } ] } }
```

---

## 11. Disputes — `/api/disputes/*`

**In plain English:** If something went wrong with a booking after the fact — damaged goods, a late delivery, a billing disagreement — the client or broker can formally raise it, and admin resolves it. This is different from a trip *incident* (section 9): incidents are real-time operational problems a *driver* reports mid-trip; disputes are after-the-fact complaints a *client or broker* raises about how a booking went.

### `POST /api/disputes`
**Who can call it:** Client / Broker
**In plain English:** Raise a formal complaint about one of your bookings.
**You send:** `booking_id`, `issue_type` (one of: `damaged_goods`, `payment_delay`, `cancellation_fee`, `route_dispute`, `late_delivery`, `fuel_surcharge`, `wrong_items`, `weight_discrepancy`), `description`.
```json
{ "booking_id": "uuid-here", "issue_type": "damaged_goods", "description": "Two boxes arrived crushed on one corner." }
```
```json
{ "success": true, "message": "Dispute raised",
  "data": { "dispute": { "id": "uuid-here", "disputeNumber": "DSP-003", "bookingId": "uuid-here", "issueType": "damaged_goods", "status": "open", "date": "2026-08-01T15:00:00.000Z" } } }
```
**Good to know:** You can only raise a dispute on a booking you're actually party to (your own booking as a client, or one you brokered).

### `GET /api/disputes`
**Who can call it:** Any logged-in user (scoped to your own disputes; admin sees everyone's, and can filter)
**In plain English:** List disputes.
**You send (query):** `status`, `issue_type`, `page`, `limit` — optional.
```json
{ "success": true, "message": "Disputes fetched",
  "data": { "disputes": [ { "id": "uuid-here", "disputeNumber": "DSP-003", "bookingNumber": "BKG-202608-012", "raisedBy": "client", "raisedByName": "Priya Sharma", "issueType": "damaged_goods", "status": "open", "date": "2026-08-01T15:00:00.000Z" } ], "total": 2, "page": 1, "limit": 10 } }
```

### `GET /api/disputes/:id`
**Who can call it:** Owner of the dispute / Admin
**In plain English:** View one dispute in detail.
```json
{ "success": true, "message": "Dispute fetched", "data": { "dispute": { "id": "uuid-here", "disputeNumber": "DSP-003", "issueType": "damaged_goods", "description": "Two boxes arrived crushed on one corner.", "status": "open", "resolution": null } } }
```

### `PATCH /api/disputes/:id/resolve`
**Who can call it:** Admin
**In plain English:** Close out a dispute with a resolution note. The person who raised it gets notified.
**You send:** `resolution`.
```
PATCH /api/disputes/<dispute-id>/resolve
{ "resolution": "Partial refund of ₹500 issued for damaged items." }
```
```json
{ "success": true, "message": "Dispute resolved", "data": { "dispute": { "id": "uuid-here", "status": "resolved", "resolution": "Partial refund of ₹500 issued for damaged items." } } }
```

---

## 12. Admin — `/api/admin/*`, `/api/analytics/admin`

### `GET /api/admin/dashboard`
**Who can call it:** Admin
**In plain English:** The numbers on the admin dashboard's home screen — total bookings, active trips, total revenue, registered trucks (each with a % change vs. the prior 30 days), plus two operational-health counts: `stalePendingBookings` (bookings nobody's accepted in 2+ hours) and `openIncidents` (unresolved trip incidents platform-wide).
```json
{ "success": true, "message": "Dashboard stats fetched",
  "data": { "totalBookings": 142, "activeTrips": 6, "totalRevenue": 284500.5, "registeredTrucks": 18,
    "bookingsChange": 12.5, "activeTripsChange": -4.0, "revenueChange": 18.2, "trucksChange": 5.0,
    "stalePendingBookings": 1, "openIncidents": 2 } }
```

### `GET /api/admin/incidents`
**Who can call it:** Admin
**In plain English:** Every open (unresolved) trip incident across the *entire* platform, with the booking/driver/broker context attached — so admin can find and act on problems without needing to already know which trip to look at. (The per-trip version in section 9 requires knowing a trip ID already; this one doesn't.)
**You send (query):** `page`, `limit` — optional.
```json
{ "success": true, "message": "Open incidents fetched",
  "data": { "incidents": [ { "id": "uuid-here", "tripId": "uuid-here", "bookingNumber": "BKG-202608-012", "driverName": "Suresh Patil", "brokerName": "Test Broker", "reason": "breakdown", "notes": "Flat tire near Lonavala", "status": "reported", "reportedAt": "2026-08-01T13:15:00.000Z" } ], "total": 2, "page": 1, "limit": 20 } }
```

### `GET /api/analytics/admin`
**Who can call it:** Admin
**In plain English:** The charts on the admin analytics page — revenue/GMV over the last 12 months, top-spending clients, how utilized each broker's fleet is, and a 12-day booking-volume sparkline.
```json
{ "success": true, "message": "Admin analytics fetched",
  "data": {
    "gmvOverMonths": [ { "month": "2026-07", "gmv": 84500 } ],
    "revenueOverMonths": [ { "month": "2026-07", "revenue": 8450 } ],
    "topClients": [ { "name": "Priya Sharma", "spend": 12500 } ],
    "fleetUtilization": [ { "broker": "Test Broker", "utilization": 66.7 } ],
    "bookingConversionSparkline": [3, 5, 2, 8, 6, 4, 7, 9, 3, 5, 6, 4]
  } }
```

### `GET /api/admin/settings`
**Who can call it:** Admin
**In plain English:** View platform-wide settings.
```json
{ "success": true, "message": "Settings fetched",
  "data": { "platformName": "SSK Logistics", "contactEmail": "support@ssklogistics.in", "commissionRate": 10, "emailAlerts": true, "smsAlerts": true, "pushNotifications": true } }
```

### `PUT /api/admin/settings`
**Who can call it:** Admin
**In plain English:** Update platform-wide settings — name, contact email, commission rate, alert preferences.
```
PUT /api/admin/settings
{ "platform_name": "SSK Logistics", "contact_email": "support@ssklogistics.in", "commission_rate": 12, "email_alerts": true, "sms_alerts": true, "push_notifications": false }
```
```json
{ "success": true, "message": "Settings updated", "data": { "platformName": "SSK Logistics", "commissionRate": 12, "pushNotifications": false } }
```

---

## 13. Config (public lookups) — `/api/config/*`

**In plain English:** Small reference-data endpoints that power dropdowns on the booking form. No login required for any of these.

### `GET /api/config/vehicle-types`
Truck categories available for booking, each with its live admin-configured base price attached (so the frontend never hardcodes a price).
```json
{ "success": true, "message": "Vehicle types fetched",
  "data": { "vehicleTypes": [
    { "id": "small", "name": "Tata Ace / Pickup", "capacity": "Up to 1 Ton", "basePrice": 500 },
    { "id": "medium", "name": "Medium Truck", "capacity": "Up to 5 Tons", "basePrice": 800 },
    { "id": "large", "name": "Large Truck", "capacity": "Up to 20 Tons", "basePrice": 1200 },
    { "id": "part", "name": "Part Truck", "capacity": "Share capacity with others", "featured": true, "savePercent": 40, "basePrice": null }
  ] } }
```

### `GET /api/config/material-types`
The list of cargo material options (Electronics, FMCG, Construction, etc.) shown in the booking form.
```json
{ "success": true, "message": "Material types fetched", "data": { "materialTypes": ["Electronics", "FMCG", "Construction", "Furniture", "Pharma Products", "Textiles", "Auto Parts", "Other"] } }
```

### `GET /api/config/cities`
Supported pickup/drop cities.
```json
{ "success": true, "message": "Cities fetched", "data": { "cities": ["Mumbai", "Pune", "Delhi", "Bengaluru", "Chennai", "Hyderabad", "Jaipur", "Ahmedabad", "Surat", "Nashik", "Nagpur", "Kolhapur", "Indore", "Goa", "Aurangabad"] } }
```

### `POST /api/config/distance`
**In plain English:** Given a pickup and drop city, estimate the distance and travel time between them — this is the first call the booking form makes before asking `/pricing/estimate` for an actual price.
**You send:** `pickup`, `drop`.
```
POST /api/config/distance
{ "pickup": "Pune", "drop": "Mumbai" }
```
```json
{ "success": true, "message": "Distance fetched", "data": { "distance": 150, "durationMin": 180, "durationInTrafficMin": 210 } }
```
**You get back:** `distance` (km), `durationMin` (traffic-free ETA), `durationInTrafficMin` (live-traffic ETA) — the last two feed directly into the traffic-aware pricing multiplier described in section 5.
**Good to know:** Returns a 404 for any city pair it can't resolve, rather than guessing — the frontend should surface that as "please check the spelling" rather than showing a wrong price.

---

## 14. The big picture: how a booking actually flows

Putting it all together, here's a real booking's life cycle across every module above:

1. **Client** fills out the booking form → frontend calls `POST /config/distance` → `POST /pricing/estimate` (live price preview, now traffic-aware) → `POST /bookings` (creates it for real).
2. Every eligible **broker** gets a `job_request` (section 8) — no expiry, sits pending until someone acts.
3. Brokers can only counter (`PATCH /jobs/requests/:id/counter`) or decline; the **client** compares offers via `GET /bookings/:bookingId/offers` and confirms one via `PATCH /jobs/requests/:id/client-accept` — every other broker's offer on that booking auto-declines the moment the client picks one.
4. That broker calls `POST /jobs/:id/assign-driver` → this creates the actual **trip** record.
5. The **driver** works the trip forward via repeated `PATCH /trips/:id/status` calls (matching the driver app's status button), pinging `PATCH /trips/:id/location` along the way, and the **client** watches it live via `GET /bookings/:id/track`.
6. If something goes wrong mid-trip, the driver calls `POST /trips/:id/report-issue`; the broker/admin resolves it via the incidents endpoints.
7. Before completing, the driver uploads `POST /trips/:id/pod`.
8. The final `PATCH /trips/:id/status` to `completed` is the one moment a **settlement** (payout) is created — exactly once, atomically guarded.
9. The **client** can now `POST /bookings/:id/rate` (Client Rating) and, if something went wrong, `POST /disputes` to formally raise it.
10. Throughout all of this, **admin** watches the dashboard (`GET /admin/dashboard`) for stuck bookings and open incidents, and steps in via the KYC, dispute-resolution, or (rarely) the manual booking-status-override endpoints when needed.

---

## 15. Enums Reference (for building dropdowns / status badges)

Every fixed-value field in the API, in one place — verified directly against the database schema, not the frontend labels (which sometimes display a friendlier string for the same underlying value — noted where that happens).

| Field | Values |
|---|---|
| `role` (user) | `client`, `broker`, `driver`, `admin` |
| `status` (user) | `active`, `inactive`, `blocked`, `pending_verification` |
| `kyc_status` | `pending`, `submitted`, `verified`, `rejected` |
| `otp` `purpose` | `registration`, `login`, `password_reset`, `phone_verify` |
| `payment_status` (booking) | `paid`, `pending`, `refunded` |
| `truck_category` / `truckCategory` | `small`, `medium`, `large`, `part` |
| `status` (truck) | `available`, `on_trip`, `maintenance` |
| `status` (driver) | `available`, `on_trip`, `offline` |
| `transport_type` | `intra`, `inter` |
| booking/trip `status` (progression order) | `pending` → `confirmed` → `assigned` → `en_route_pickup` → `picked_up` → `in_transit` → `delivered` → `completed`, or `cancelled` at various points, or `no_broker_available` (admin-only manual flag, never set automatically) |
| job `status` | `pending`, `accepted`, `declined` |
| trip incident `reason` | `accident`, `breakdown`, `traffic_block`, `medical`, `other` |
| trip incident `status` | `reported`, `acknowledged`, `resolved` |
| dispute `issue_type` | `damaged_goods`, `payment_delay`, `cancellation_fee`, `route_dispute`, `late_delivery`, `fuel_surcharge`, `wrong_items`, `weight_discrepancy` |
| dispute `status` | `open`, `under_review`, `resolved` |
| notification `type` | `booking`, `payment`, `kyc`, `incident`, `dispute`, `general` (free-text category, not a strict DB enum — treat unknown values gracefully) |

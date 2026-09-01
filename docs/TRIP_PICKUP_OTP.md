# Trip Pickup OTP

A 4-digit code the client sees on their tracking screen and reads out to the driver in person at
pickup. The driver has to enter it correctly before the trip can move to "Picked Up". No OTP for
login, no OTP for drop-off — only this one step, and it never expires on its own; it's only ever
consumed by a correct pickup confirmation.

---

## 1. Data model

`db/36trip_pickup_otp.sql` (mirrored in `src/config/migrate.js`):

```sql
ALTER TABLE trips ADD COLUMN IF NOT EXISTS pickup_otp_code TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS pickup_otp_verified_at TIMESTAMPTZ;
```

- `pickup_otp_code` — a random 4-digit string (`1000`-`9999`), generated once in
  `TripModel.create` (`src/models/trip.model.js`) and stored for the life of the trip. This is
  the **only** place a trip is created — both the direct client→driver pick and the
  broker-assign path (`finalizeDriverRequest`) go through it, so every trip gets a code.
- `pickup_otp_verified_at` — `NULL` until the driver enters the code correctly; set once, never
  cleared. `TripModel.updateStatus` sets it via
  `CASE WHEN pickup_otp_verified_at IS NULL AND $1::text = 'picked_up' THEN NOW() ELSE pickup_otp_verified_at END`
  alongside the existing status update.
- No expiry column, no expiry logic anywhere — by design. The code is valid from trip creation
  until it's used.
- Trips created before this migration have `pickup_otp_code = NULL`. The gate below explicitly
  skips enforcement in that case so old/in-flight trips don't get drivers locked out.

Run `npm run migrate` (or redeploy, which chains it via `npm start`) for this to take effect on
the real database — it hasn't run yet.

---

## 2. The gate — `PATCH /api/trips/:id/status`

`src/controllers/trip.controller.js`'s `updateTripStatus` now reads a `pickup_otp` field off the
body, and — right after the existing GPS-proximity check (`PICKUP_PROXIMITY_KM = 0.8`, same
`req.user.role === 'driver'` scoping, broker/admin can still override) — enforces it:

```js
if (req.user.role === 'driver' && status === 'picked_up') {
  if (!trip.pickup_otp_code) {
    // pre-existing trips with no code — skip, don't lock drivers out
  } else if (!pickup_otp || String(pickup_otp).trim() !== trip.pickup_otp_code) {
    return errorResponse(res, 409, 'Ask the customer for their pickup code and enter it to confirm pickup.');
  }
}
```

Only drivers are gated (matches the existing proximity check's scoping) — broker/admin overrides
bypass it the same way they already bypass the GPS check.

**Request**:
```
PATCH /api/trips/:id/status
{ "status": "picked_up", "pickup_otp": "4821" }
```

**409** on a missing/wrong code, same shape as any other `errorResponse` — the message above is
meant to be shown to the driver directly.

---

## 3. Where the client sees the code

The code and its verified state are exposed **client-role-only** (drivers/brokers never see it in
these responses — they only get the 409 telling them to ask for it) in two places that both read
off `trips.pickup_otp_code` / `trips.pickup_otp_verified_at` (joined into
`booking.model.js`'s shared `SELECT_WITH_JOINS` as `trip_pickup_otp_code` /
`trip_pickup_otp_verified_at`):

- `booking.controller.js`'s `projectBooking(row, timeline, role)` — used by `getBooking` and
  others:
  ```js
  if (role === 'client') {
    base.pickupOtp = row.trip_pickup_otp_code || null;
    base.pickupOtpVerified = !!row.trip_pickup_otp_verified_at;
  }
  ```
- `booking.controller.js`'s `trackBooking` — its own separate response object (not built through
  `projectBooking`), used by the polling tracking screen:
  ```js
  ...(req.user.role === 'client' ? { pickupOtp: trip?.pickup_otp_code || null, pickupOtpVerified: !!trip?.pickup_otp_verified_at } : {})
  ```

Both emit the same two camelCase keys: `pickupOtp` (string or `null` — `null` once verified is
irrelevant since verification doesn't clear the code, but also `null` for pre-migration trips
with no code at all) and `pickupOtpVerified` (boolean).

---

## 4. Web implementation

**Client** (`gadidosti-client/src/pages/TrackShipment.jsx`) — the tracking poll captures both
fields off `trackBooking`'s response and renders one of two states right under the incident
banner: while `pickupOtp` is set and not yet verified, a highlighted card showing the 4-digit
code large or centered ("Share this with your driver when they arrive to confirm pickup"); once
`pickupOtpVerified` flips true, a small green "Pickup verified with your code" confirmation
instead.

**Driver** (`gadidosti-broker-driver/src/pages/driver/MyTrip.jsx`) — `handleStatusChange`
intercepts `nextStatus === "picked_up"` exactly the way it already intercepted `"delivered"`:
instead of PATCHing immediately, it opens a `Modal` with a 4-digit numeric input
(`showPickupOtpPrompt` state). Confirming calls `handleConfirmPickupOtp`, which PATCHes
`{ status: "picked_up", pickup_otp: pickupOtpInput.trim() }` and shows the 409 message inline on
failure (`pickupOtpError`) without closing the modal.

---

## 5. Flutter (`SSK_Cargo`) — what's needed, grounded in the real code

Checked against the actual source, not guessed. The driver-side screen doing this work is
`lib/features/driver/.../driver_delivery_details_screen.dart` — it's the Flutter equivalent of
`MyTrip.jsx`, and it already has precedent for exactly this pattern: `'delivered'` is handled by
a dedicated interception (`_confirmingArrival` state, around line 670-680) instead of going
through the generic status-advance call. Pickup currently is **not** special-cased the same way
— it needs to be, to match.

**1. `lib/core/network/api_client.dart` — `updateTripStatus` (line 1383-1399)**

Currently:
```dart
Future<Map<String, dynamic>> updateTripStatus({
  required String accessToken,
  required String tripId,
  required String status,
}) async {
  ...
  return _request(
    () => _dio.patch<Map<String, dynamic>>(
      '/api/trips/$tripId/status',
      data: {'status': status},
      options: Options(headers: {'Authorization': 'Bearer $accessToken'}),
    ),
  );
}
```
Needs an optional `pickupOtp` parameter, included in the body only when present — same shape as
how `heading` was added to `updateDriverLocation`/`updateTripLocation` earlier:
```dart
Future<Map<String, dynamic>> updateTripStatus({
  required String accessToken,
  required String tripId,
  required String status,
  String? pickupOtp,
}) async {
  ...
  return _request(
    () => _dio.patch<Map<String, dynamic>>(
      '/api/trips/$tripId/status',
      data: {
        'status': status,
        if (pickupOtp != null) 'pickup_otp': pickupOtp,
      },
      options: Options(headers: {'Authorization': 'Bearer $accessToken'}),
    ),
  );
}
```
A 409 here comes back as a normal `DioException`/error response with the message text from
section 2 above — surface it the same way other status-change failures already are on this
screen.

**2. `driver_delivery_details_screen.dart` — the pickup interception**

- The generic advance-status handler (~line 250-259) calls `updateTripStatus(..., status:
  nextStatus)` for every transition, `en_route_pickup → picked_up` included. This needs to branch
  the same way the `'delivered'` handler already does: when `nextStatus == 'picked_up'`, don't
  call `updateTripStatus` immediately — show a 4-digit code entry (a dialog or bottom sheet is
  fine, matching whatever `_confirmingArrival`'s delivered-confirmation UI already looks like) and
  only call `updateTripStatus(..., status: 'picked_up', pickupOtp: enteredCode)` once the driver
  submits it.
- The button-label switch (~line 357-368) already says `"I've Reached Pickup"` for
  `en_route_pickup` — no change needed there, that's the button that should now open the code
  entry instead of firing the request directly.
- The success-message switch (~line 372-380) already has `'picked_up': 'Pickup marked. Start
  delivery next.'` — fine as-is, shown after a successful OTP-gated call same as before.
- On a 409, keep the entry UI open and show the backend's message inline (mirrors what the web
  driver app does with `pickupOtpError`) rather than dismissing and forcing the driver to tap
  "I've Reached Pickup" again.

**3. Client-side display — `lib/features/client/data/client_booking_models.dart`'s
`ClientBooking`**

`ClientBooking.fromJson` (line 169-246) doesn't have typed fields for this yet, but every
`ClientBooking` already keeps the full original response on `raw: json` (line 261) — so
`booking.raw['pickupOtp']` / `booking.raw['pickupOtpVerified']` are already reachable today with
zero model changes, once the backend response includes them (it does, for the client role — see
section 3 above). Cleaner long-term is adding two real typed fields the same way the rest of the
class does it:
```dart
pickupOtp: _readString(json, const ['pickupOtp']).isEmpty ? null : _readString(json, const ['pickupOtp']),
pickupOtpVerified: json['pickupOtpVerified'] == true,
```
plus the matching `final String? pickupOtp;` / `final bool pickupOtpVerified;` fields.

Where to render it: `tracking_details_screen.dart` is the client's live-tracking screen (uses
`ClientBooking.fromJson(bookingJson)` at line 96) and is the direct equivalent of
`TrackShipment.jsx` — same place, same condition (`pickupOtp` present, not yet verified → show
the code prominently; verified → small confirmation instead), matching what section 4 describes
for web. `client_delivery_screen.dart` (also uses `ClientBooking`) is the other place a client
might be looking at trip progress and is worth the same treatment for consistency, lower priority
than the live-tracking screen.

---

## 6. Quick checklist

| Item | Status |
|---|---|
| Migration (`db/36trip_pickup_otp.sql`) | Written, **not yet run** on the real DB |
| Code generation on trip create | Done (`TripModel.create`) |
| Verified-at stamped on pickup | Done (`TripModel.updateStatus`) |
| Driver-side 409 gate | Done (`trip.controller.js`) |
| Client-only exposure (`getBooking` + `trackBooking`) | Done |
| Web client display (`TrackShipment.jsx`) | Done |
| Web driver entry modal (`MyTrip.jsx`) | Done |
| Flutter driver (`api_client.dart` + `driver_delivery_details_screen.dart`) | Not started — see §5 |
| Flutter client display (`tracking_details_screen.dart`, `client_delivery_screen.dart`) | Not started — see §5 |

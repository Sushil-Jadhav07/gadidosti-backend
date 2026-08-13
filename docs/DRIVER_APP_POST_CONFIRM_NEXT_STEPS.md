# After Mutual Confirmation — What the Driver App Should Call Next

Direct follow-up to a Flutter dev's own write-up of the negotiation → trip handoff flow. Their
understanding was correct on every point but one — this doc confirms what's right, fixes the one
real mismatch, and answers the actual open question: once `trip.status` is `"confirmed"`, what
gets called next.

---

## 1. Confirmed correct

- **`booking.status === "assigned"`** means the mutual-confirmation finalize step has completed
  — both sides accepted, a trip now exists. Correct.
- **`GET /api/trips/active`** returns the freshly-created trip with **`trip.status ===
  "confirmed"`** — not `"assigned"`. `booking.status` and `trip.status` are two separate enum
  columns on two separate tables that happen to both exist for the same booking at the same
  time — don't compare one against the other's values. Correct as described.
- That response includes `data.trip.id`, `data.trip.bookingId`, `data.trip.bookingNumber`,
  `data.trip.status`. Correct.

The full driver flow as described — `PATCH /driver-requests/:id/accept` (or `/counter`) → poll
`GET /driver-requests/:id` / `GET /bookings/:bookingId` / `GET /trips/active` → once a `tripId`
resolves, `GET /trips/:tripId` for full detail — matches how this backend actually behaves.

---

## 2. One real mismatch — trip fields are flat, booking fields are nested

The booking response (`GET /api/bookings/:bookingId`) shapes driver/truck info as a **nested
object**:
```json
{ "driver": { "name": "Harsh Nikharge", "phone": "7894282335" }, "truckReg": "MH-02-AB-4566" }
```

The **trip** response (`GET /api/trips/active`, `GET /api/trips/:tripId`) shapes the same
information as **flat top-level fields** instead:
```json
{
  "driverId": "...", "driverName": "Harsh Nikharge", "driverPhone": "7894282335",
  "truckId": "...", "truckReg": "MH-02-AB-4566"
}
```
**There is no `data.trip.driver` object.** If the app's trip model expects `trip.driver.name`
(mirroring the booking model it already built), that'll silently come back `null`/throw — it
needs `trip.driverName` instead.

Also: **the trip response has no `truckType`/`truckCategory` fields at all** — those only exist
on the `driver_requests` payload from the negotiation step. If the UI needs to show truck type
on the trip screen, carry it forward from that earlier response rather than expecting it here.

---

## 3. The actual question — what to call once `trip.status === "confirmed"`

```
PATCH /api/trips/{tripId}/status
{ "status": "en_route_pickup" }
```

This is the driver tapping "Start Trip to Pickup." The same endpoint drives every remaining step
of the trip, one call per transition:

```
confirmed → en_route_pickup → picked_up → in_transit → delivered → completed
```

Each is:
```
PATCH /api/trips/{tripId}/status   { "status": "<next value>" }
```

**Two of these are gated and will 409 if skipped:**

- **`picked_up`** and **`delivered`** require the driver to be within **0.8km** of the
  pickup/drop point. This is checked against `trip.currentLocation` (`current_lat`/`current_lng`
  on the trip row) — which is **not** populated automatically. The app must be sending:
  ```
  PATCH /api/trips/{tripId}/location
  { "lat": ..., "lng": ... }
  ```
  periodically while the trip is active (e.g. on a location-change/timer basis), or `picked_up`/
  `delivered` will fail with "you're too far away" even when the driver is genuinely there. This
  is a separate call from the driver's general device-location ping
  (`PATCH /api/vehicles/drivers/me/location`) — both should be sent; they feed different things
  (this one feeds the proximity gate and the client's live tracking; the other feeds the admin
  fleet map and driver availability).
- **`in_transit`** and **`delivered`** are additionally blocked (409) if the trip has extra
  loading/unloading stops (`trip.stops`, only present on bookings that used the "add stop"
  feature) still marked pending — those get checked off separately via
  `PATCH /api/trips/{tripId}/stops/{index}/complete`, most trips have none of these and this
  never applies.

**The final two steps aren't pure status flips:**
- Before `delivered`, upload proof of delivery: `POST /api/trips/{tripId}/pod` (multipart,
  `files` field, up to 6 photos).
- Before `completed`, if `trip.paymentStatus === "pending"` (not already paid in-app), collect
  payment: `PATCH /api/trips/{tripId}/collect-payment { "mode": "upi" | "cash" }`. If the client
  already paid through the app, this step is skipped — `paymentStatus` will already be `"paid"`.
- `completed` is what actually pays out (creates the settlement) and frees the driver/truck back
  to available. It's idempotent — safe to retry.

For the complete reference — every field on the trip object, the stop-checklist details, and a
full worked example strung end to end — see `docs/DRIVER_TRIP_FLOW_GUIDE.md` §5 and §7.

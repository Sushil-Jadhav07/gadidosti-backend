# E-Way Bill: optional at booking, required at pickup — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. Written without access to the current `SSK_Cargo` source (same
situation as the other guides in this folder) — no file/line references, just the backend
contract and what the web apps already do with it.

## What changed

`eway_bill_number` used to be mandatory on `POST /api/bookings` (client, at booking creation) —
every booking needed one up front, no exceptions. That's gone: a client often doesn't have the
number yet that far ahead of pickup. It's now optional there — still collected and stored on the
booking if the client already has it, just never blocks booking creation if they don't.

The requirement moved to the **driver**, at **pickup**, and only applies if the client never
supplied one.

### Booking creation — `POST /api/bookings`

`eway_bill_number` is now a plain optional field. No `EWAY_BILL_REQUIRED` error from this endpoint
anymore. If `SSK_Cargo`'s client-side booking form currently blocks submission on this field being
empty, that gate should come out — same as `gadidosti-client`'s change (kept the input box, just
removed the "required" badge and the step-progression block).

### Pickup confirmation — `PATCH /api/trips/{id}/status` with `status: "picked_up"`

Check the trip object's `ewayBillNumber` field (present on every trip read — `GET /api/trips`,
`GET /api/trips/active`, `GET /api/trips/{id}`, and this same PATCH's own response) before showing
the pickup confirmation screen:

- **`ewayBillNumber` already set** (client supplied one at booking): nothing changes, pickup works
  exactly as before — just `{ "status": "picked_up", "pickup_otp": "1234" }`.
- **`ewayBillNumber` is `null`**: the driver must now also supply one in the same request:
  ```json
  { "status": "picked_up", "pickup_otp": "1234", "eway_bill_number": "123456789012" }
  ```
  Omitting it when it's still missing gets a `409`:
  ```json
  { "success": false, "message": "E-Way Bill number is required to confirm pickup.", "errors": { "code": "EWAY_BILL_REQUIRED" } }
  ```

`gadidosti-broker-driver`'s Confirm Pickup screen shows a second input field (E-Way Bill No.)
alongside the pickup-code field, **only when `trip.ewayBillNumber` is null** — build the
equivalent conditional field in `SSK_Cargo`'s pickup confirmation flow rather than always showing
it, since most bookings will already have one by the time this ships (anyone who entered it at
booking time shouldn't be asked again).

## Nothing else to build

If `SSK_Cargo` doesn't collect or gate on `eway_bill_number` at all today, there's nothing to
remove at booking creation — just add the conditional field at pickup confirmation per above.

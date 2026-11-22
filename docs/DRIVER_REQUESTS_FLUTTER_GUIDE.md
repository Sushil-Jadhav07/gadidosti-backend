# Driver Requests (accept/decline/counter) — Recent Changes — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. Written without access to the current `SSK_Cargo` source (same
situation as the other guides in this folder), so there are no file/line references here — only
the backend contract and how the two web apps (`gadidosti-client`, `gadidosti-broker-driver`)
already implement it, as parity notes for what the Flutter app should replicate. This guide covers
what **changed recently** in this system — read it even if `SSK_Cargo` already has a driver-request
screen built, since two of the three changes below are bug fixes that silently broke things that
looked like they were working.

## The baseline (if this is new to you)

A `driver_requests` row is one driver being offered one booking at one price. Either side can
**accept**, **decline**, or **counter** a new price — back and forth, no round limit — until
someone accepts the other's current offer, which finalizes the trip. Three different things can
create one of these rows:
1. **Direct client-pick / "Find Truck" broadcast** — fully negotiable, both sides can counter.
2. **Broker-assign** — a broker already agreed a price with the client (via `job_requests`) and is
   just offering a specific driver the job. Not negotiable.
3. **Admin-assign** (new — see below) — admin picked a driver directly, no broker involved at all.
   Also not negotiable.

## 1. New: admin can assign a driver directly, and it's never negotiable

`POST /api/admin/bookings/{id}/assign-driver` (admin/staff only) creates a `driver_requests` row
the exact same way a broker's assignment does, except admin can pick **any driver anywhere in the
system** — no fleet-ownership check, no distance restriction. The row this creates behaves
identically to a broker-assigned one:

- The driver can **only accept or decline** — attempting to counter returns a `409`:
  `"This booking was assigned directly by admin — accept or decline, no counter-offers."` (or the
  broker-assign wording, depending on origin — check the field below to know which).
- Accepting (`PATCH /api/driver-requests/{id}/accept`) finalizes the trip **immediately** — no
  separate client confirmation step, unlike the negotiable origin.

**How to tell which kind of row you've got** — every `driver_requests` payload (`GET
/api/driver-requests`, `GET /api/driver-requests/{id}`, and every socket push) now includes:
```json
{
  "jobRequestId": "...",        // set only for broker-assign origin
  "isAdminAssigned": true,       // set only for admin-assign origin
  "noNegotiation": true          // true for EITHER origin above — use this one field
}
```
Use `noNegotiation` to decide whether to show a Counter button at all — don't re-derive it from
`jobRequestId`/`isAdminAssigned` yourself, since that's exactly the mistake that existed in both
web apps until this pass (each had its own ad-hoc `isBrokerAssigned` check that only looked at
`jobRequestId`, so it silently missed admin-assigned rows and showed Counter when it shouldn't
have). If `SSK_Cargo` already has its own `isBrokerAssigned`-style flag, replace it with
`noNegotiation` rather than adding a second condition next to it.

If you want to show *why* it's locked (optional, both web apps do this as a small badge/caption):
`isAdminAssigned ? "Assigned directly by admin" : "Already agreed with the broker"`.

## 2. Bug fix: declining a still-`pending` offer used to fail every time

If `SSK_Cargo` has a client-side "Find Truck" screen (multiple drivers notified at once, each
shown as its own negotiable card) with a Decline button — check whether it calls
`PATCH /api/driver-requests/{id}/client-reject` **before the driver has responded at all** (status
still `pending`, not yet `countered`). Until this fix, that call always failed with a `400`:
`"Request is not awaiting your response"` — the endpoint only ever accepted `status='countered'`,
even though the client-side UI for this exact scenario has always shown a Decline button
regardless of status. It now also accepts `pending`, so declining a driver who hasn't responded
yet works correctly. No request-shape change — same endpoint, same body (empty) — this is purely a
backend acceptance-condition fix. If `SSK_Cargo` has its own client-reject call and was working
around this (e.g. hiding Decline until `countered`, or swallowing/retrying the error), that
workaround can be removed now.

## 3. "Find Truck" default search radius: 15km → 50km

`search_radius_km` on `POST /api/bookings` (when `search_mode: "truck"` or `"part_load"`) still
takes any value the client explicitly sends — unaffected. What changed is the server-side default
used **only when that field is omitted**: 15 → 50. If `SSK_Cargo` has its own hardcoded default for
a "Find Truck" style radius slider/picker, update it to match so a client who doesn't touch the
slider gets the same default behavior as the web apps.

## Endpoint reference (unchanged shapes, for completeness)

| Endpoint | Who | What |
|---|---|---|
| `GET /api/driver-requests` | driver, broker | Inbox — driver sees requests addressed to them; broker sees ones their driver timed out on |
| `GET /api/driver-requests/booking/:bookingId` | client | Look up the (single-target) request for one of their bookings |
| `GET /api/driver-requests/:id` | any party to it | One request's full detail |
| `PATCH /api/driver-requests/:id/accept` | driver, broker | Accept at the current price — `noNegotiation` rows finalize immediately; others may need the client's separate `client-accept` first |
| `PATCH /api/driver-requests/:id/decline` | driver, broker | Decline — ends it for this driver |
| `PATCH /api/driver-requests/:id/counter` | driver, broker | Propose a new price — `409` if `noNegotiation` |
| `PATCH /api/driver-requests/:id/client-accept` | client | Client's side of the same mutual-confirmation dance |
| `PATCH /api/driver-requests/:id/client-reject` | client | Decline — now valid from `pending` too (see §2) |
| `PATCH /api/driver-requests/:id/client-counter` | client | Client proposes a new price — `409` if `noNegotiation` |

All of these take no body except `counter`/`client-counter`, which take `{ "amount": number, "note"?: string }`.

## What to check/build in `SSK_Cargo`

1. If there's any driver-request negotiation UI at all, find wherever it decides to show/hide a
   Counter button and switch it to read `noNegotiation` from the payload, not a locally-derived
   flag.
2. If there's a client-side Decline button on a still-`pending` (not yet responded to) offer,
   remove any workaround for the old 400 — it now just works.
3. If there's a hardcoded "Find Truck" radius default, bump it to 50 to match.
4. Nothing to build from scratch here unless `SSK_Cargo` doesn't have driver-request negotiation at
   all yet — this guide is about keeping an existing implementation in sync, not introducing the
   feature.

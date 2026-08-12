# Mutual-Confirmation Negotiation — Both Sides Must Accept

Covers a behavior change to both negotiation subsystems — `driver_requests` (direct client↔driver
pick) and `job_requests` (broker-broadcast client↔broker) — from every role's point of view
(client, driver, broker). If you're integrating any of the three apps against this API, read the
section for your role; the state diagram below applies to both subsystems identically, just with
different endpoint names.

**What changed:** previously, whichever side accepted first — the driver/broker's own accept, or
the client's accept — immediately and unilaterally finalized the booking. Now it's a two-phase
handshake: the first side to accept only commits *their own* side; the booking/trip is only
actually finalized once the *other* side also explicitly accepts. Past that first commit, there's
no more negotiating — only Accept or Decline.

This supersedes the "whose turn" table and worked examples in `NEGOTIATION_API_GUIDE.md` §4/§8,
which described the old single-sided behavior.

---

## 1. The state diagram (applies to both subsystems)

```
pending ──counter──> countered ──counter──> pending  (back and forth, either side)
   │                     │
   │  accept              │  accept
   ▼                     ▼
awaiting_confirmation (pending_confirmation_by = whoever just committed)
   │                                              │
   │ the OTHER side accepts                       │ the OTHER side declines
   ▼                                              ▼
accepted (booking/trip finalized)              declined (dead — start over)
```

- **`pending_confirmation_by`** (new field, `"client"` or `"respondent"`/`"broker"` depending on
  subsystem) tells you which side already committed — i.e. whose turn it now is. It's only
  meaningful while `status === "awaiting_confirmation"`; `null` otherwise.
- **No more countering once `awaiting_confirmation`** — the price is locked at whatever it was
  when the first side accepted. The only actions left are Accept (finalize) or Decline (kill it).
- **Either side can be first.** A driver/broker accepting the client's current asking price, or a
  client accepting the driver/broker's current counter, both use the same accept endpoint and
  land in the same `awaiting_confirmation` state — whoever calls their accept endpoint *second*
  is the one whose call actually finalizes things.
- **The accept endpoint is dual-purpose** — the same endpoint, called twice (once by each side,
  in either order), is what drives the whole handshake. You don't call a different endpoint for
  "commit" vs "confirm."

---

## 2. `driver_requests` (direct client-pick) — endpoint reference

| Endpoint | Caller | From status | Result |
|---|---|---|---|
| `PATCH /api/driver-requests/{id}/accept` | driver (or broker once timed out) | `pending` | First commit → `awaiting_confirmation`, `pendingConfirmationBy: "respondent"` |
| `PATCH /api/driver-requests/{id}/accept` | driver (or broker) | `awaiting_confirmation` + `pendingConfirmationBy: "client"` | **Finalizes** → `accepted`, trip created |
| `PATCH /api/driver-requests/{id}/client-accept` | client | `pending` / `countered` | First commit → `awaiting_confirmation`, `pendingConfirmationBy: "client"` |
| `PATCH /api/driver-requests/{id}/client-accept` | client | `awaiting_confirmation` + `pendingConfirmationBy: "respondent"` | **Finalizes** → `accepted`, trip created |
| `PATCH /api/driver-requests/{id}/decline` | driver/broker | `pending`, or `awaiting_confirmation` + `pendingConfirmationBy: "client"` | → `declined` |
| `PATCH /api/driver-requests/{id}/client-reject` | client | `countered`, or `awaiting_confirmation` + `pendingConfirmationBy: "respondent"` | → `declined` |
| `PATCH /api/driver-requests/{id}/counter` | driver/broker | `pending` only | → `countered` (unchanged; blocked once `awaiting_confirmation`) |
| `PATCH /api/driver-requests/{id}/client-counter` | client | `pending` / `countered` only | → `pending` (unchanged; blocked once `awaiting_confirmation`) |

**Request/response shapes are unchanged** — same body (none, for accept/decline), same response
envelope `{ request: {...} }`. What's new is the `request.status` you may get back
(`"awaiting_confirmation"`) and the new `request.pendingConfirmationBy` field. Two response
messages to distinguish in your UI logic: **`"Accepted — waiting for the client to confirm"`** /
**`"Accepted — waiting for the driver to confirm"`** (first commit, nothing finalized) vs.
**`"Accepted — booking confirmed"`** / **`"Booking confirmed"`** (second commit, actually done —
same messages as before this change, so existing string-matching, if you were doing that, still
works for the finalized case).

**Errors** are unchanged in shape: `400` "not awaiting your response" (now also covers trying to
act when it's genuinely the other side's turn in `awaiting_confirmation`), `409` "booking no
longer available" (the other negotiation path won the booking in the meantime — same race
handling as before, just a wider exposure window now that first-commit and confirm can be
minutes apart in real time instead of back-to-back).

**Socket**: `driver-request-updated` (unchanged event name/room — `user:{yourId}`) fires on every
transition including the new `awaiting_confirmation` one. Payload is the full `driver_requests`
shape plus the new `pendingConfirmationBy` field — same handling as before, just check that field
when `status === "awaiting_confirmation"`.

---

## 3. `job_requests` (broker-broadcast) — endpoint reference

The broker previously had **no accept action at all** (only decline/counter) — this is the one
genuinely new endpoint in this change.

| Endpoint | Caller | From status | Result |
|---|---|---|---|
| `PATCH /api/jobs/requests/{id}/accept` **(new)** | broker | `pending` | First commit → `awaiting_confirmation`, `pendingConfirmationBy: "broker"` |
| `PATCH /api/jobs/requests/{id}/accept` **(new)** | broker | `awaiting_confirmation` + `pendingConfirmationBy: "client"` | **Finalizes** → booking `confirmed` |
| `PATCH /api/jobs/requests/{id}/client-accept` | client | `pending` / `countered` | First commit → `awaiting_confirmation`, `pendingConfirmationBy: "client"` |
| `PATCH /api/jobs/requests/{id}/client-accept` | client | `awaiting_confirmation` + `pendingConfirmationBy: "broker"` | **Finalizes** → booking `confirmed` |
| `PATCH /api/jobs/requests/{id}/decline` | broker | `pending`, or `awaiting_confirmation` + `pendingConfirmationBy: "client"` | → `declined` |
| `PATCH /api/jobs/requests/{id}/client-reject` | client | `countered`, or `awaiting_confirmation` + `pendingConfirmationBy: "broker"` | → `declined` |
| `PATCH /api/jobs/requests/{id}/counter` | broker | `pending` only | → `countered` (unchanged) |
| `PATCH /api/jobs/requests/{id}/client-counter` | client | `pending` / `countered` only | → `pending` (unchanged) |

**New endpoint — `PATCH /api/jobs/requests/{id}/accept`** (broker-only, no body):
```json
// 200, first commit (not finalized yet):
{ "success": true, "message": "Accepted — waiting for the client to confirm",
  "data": { "request": { "...": "...", "status": "awaiting_confirmation", "pendingConfirmationBy": "broker" } } }

// 200, finalizing confirmation:
{ "success": true, "message": "Booking confirmed",
  "data": { "booking": { "id": "...", "status": "confirmed", "brokerId": "...", "amount": 4500 } } }
```
**The response shape itself tells you which case happened** — a `request` key means not yet
finalized, a `booking` key means it is. This is the same distinguishing pattern
`clientAcceptOffer` already used before this change (it always returned `{ booking }` on
success); now you additionally need to handle the `{ request }` shape.
**Errors:** `403` not your job request · `400` not awaiting your response, or already actioned ·
`409` booking no longer available (the direct-pick path won it first — same as before).

`clientAcceptOffer` (existing endpoint) gets the identical dual-purpose treatment — same
`{ request }` vs `{ booking }` response distinction applies there too now.

**Socket — new** (`job_requests` had zero real-time push before this change; it was 100%
polling). Event **`job-request-updated`**, room `user:{yourId}` (same auto-join as every other
socket event in this system), fired on every mutating action (decline/counter/client-accept/
client-reject/client-counter/the new accept) to both the client and the broker. Payload:
```json
{
  "id": "uuid", "bookingId": "uuid", "bookingNumber": "BKG-202608-001",
  "clientName": "...", "clientPhone": "...", "brokerName": "...", "brokerPhone": "...",
  "pickup": "...", "drop": "...", "distance": 12.4, "truckType": "Medium Truck",
  "weight": "5 tons", "amount": 4500,
  "status": "awaiting_confirmation", "pendingConfirmationBy": "broker",
  "offerHistory": [ { "by": "client", "amount": 4500, "note": null, "at": "2026-08-12T10:00:00Z" } ],
  "timestamp": "2 min ago"
}
```
Match on `id`, swap it into your local list the same way you'd handle `driver-request-updated` —
no re-fetch needed. If you weren't listening to any socket for this subsystem before, you should
start now: without it, "your turn to confirm" only arrives on the next poll tick (this repo's
reference broker app polls every 8s as a fallback — keep polling running regardless, sockets can
drop).

---

## 4. Client role — what to build

Two screens matter: the negotiation screen itself (direct-pick or broker-broadcast), and the
booking-detail page's embedded negotiation panel (a client might navigate away and back).

- While `status` is `pending`/`countered`: unchanged — show the normal Accept/Counter/(Reject)
  controls.
- The moment `status` becomes `awaiting_confirmation`:
  - `pendingConfirmationBy === "respondent"` (driver_requests) / `"broker"` (job_requests) — the
    **other side already committed**, it's your turn. Show only **Confirm** and **Decline** — no
    Counter. Confirm = your existing accept call (`client-accept`); Decline = your existing
    reject call (`client-reject`). Both endpoints already accept this state, no new call needed.
  - `pendingConfirmationBy === "client"` — **you already committed**, waiting on them. Show a
    waiting state (no buttons) — reuse whatever "offer sent, waiting for a real reply" visual you
    already have for the negotiate flow (this repo's reference client reuses its existing
    Clock-icon "sent" panel for this).
- The reference web client (`gadidosti-client`) implements exactly this in
  `src/pages/RequestDriver.jsx`, `src/pages/ChooseBroker.jsx`, and the embedded panels in
  `src/pages/BookingDetail.jsx` — mirror those if building a native app.
- **Don't assume your own accept call finalized anything** — always branch on the response shape
  (`request` vs `booking` for job_requests; `request.status` for driver_requests) rather than
  showing a "Booking Confirmed!" screen unconditionally after a successful accept call.

---

## 5. Driver role — what to build

- Your accept button (`PATCH /driver-requests/{id}/accept`) now might not finalize anything — if
  the response comes back with `status: "awaiting_confirmation"`, show a **waiting** badge
  ("waiting for the client to confirm") instead of treating it as done.
- When you receive a `driver-request-updated` push (or poll result) showing
  `status: "awaiting_confirmation"` and `pendingConfirmationBy === "client"` — the **client**
  already committed and it's **your** turn. Show **Accept**/**Decline** only (no Counter) —
  same endpoints, `accept`/`decline`, both already widened to accept this state.
- `status === "accepted"` is still the one true "trip exists" terminal state — unchanged.
- Reference implementation: `gadidosti-broker-driver/src/components/DriverRequestCard.jsx`
  (shared by the driver's own request inbox and the broker's driver-requests inbox).

---

## 6. Broker role — what to build

Two different screens, two different things changed:

- **Job requests inbox** (client offers you're responding to) — you previously had **no accept
  action at all**. Add one: **Accept** button calling the new
  `PATCH /jobs/requests/{id}/accept`, shown alongside your existing Counter/Decline while
  `status === "pending"`. When `status === "awaiting_confirmation"`:
  - `pendingConfirmationBy === "client"` → your turn, show **Confirm**/**Decline** (reuse the
    same `accept`/`decline` endpoints — `accept` here is the finalizing call in this state).
  - `pendingConfirmationBy === "broker"` → you already committed, show a waiting badge.
  - You should also now listen for the new `job-request-updated` socket event on this screen
    (previously this screen was polling-only) — see §3 above.
- **Driver requests inbox** (after you've assigned one of your own drivers to a won job) — same
  treatment as the driver role in §5, since this is the same `driver_requests` subsystem, just
  viewed from the broker's side once a driver has timed out and it's your turn to respond on
  their behalf.
- Reference implementation: `gadidosti-broker-driver/src/pages/broker/JobRequests.jsx` (job
  requests inbox, new Accept button + socket listener) and the same `DriverRequestCard.jsx` as
  the driver role for the driver-requests side.

---

## 7. Worked examples

### `driver_requests` — driver commits first

```
1. [driver app] PATCH /api/driver-requests/dr1/accept
   -> 200 { message: "Accepted — waiting for the client to confirm",
            request: { status: "awaiting_confirmation", pendingConfirmationBy: "respondent" } }
   Nothing finalized. Driver app shows a waiting badge.

2. [client app, socket "driver-request-updated" arrives with the same payload]
   Client app shows: "This driver accepted — Confirm / Decline" (no Counter).

3. [client app] PATCH /api/driver-requests/dr1/client-accept
   -> 200 { message: "Booking confirmed",
            request: { status: "accepted" } }
   Trip now exists. Both apps move to their normal "confirmed" screens.
```

### `job_requests` — client commits first

```
1. [client app] PATCH /api/jobs/requests/jr1/client-accept
   -> 200 { message: "Accepted — waiting for the broker to confirm",
            data: { request: { status: "awaiting_confirmation", pendingConfirmationBy: "client" } } }
   Booking NOT confirmed yet. Client app shows a waiting state.

2. [broker app, socket "job-request-updated" arrives with the same payload]
   Broker app shows: "The client accepted — Confirm / Decline" (no Counter) on this card.

3. [broker app] PATCH /api/jobs/requests/jr1/accept
   -> 200 { message: "Booking confirmed",
            data: { booking: { id: "bk1", status: "confirmed", amount: 4500 } } }
   Booking now confirmed. Broker can now call POST /api/jobs/{jobId}/assign-driver (unchanged —
   still gated on job_requests.status === 'accepted', which is now true).
```

---

## 8. Known limitations (deliberate, out of scope for this change)

- **No timeout on the `awaiting_confirmation` step itself.** If one side commits and the other
  never responds, the request just sits there indefinitely — nothing is locked (no truck/driver
  reserved, no booking status changed) until true finalization, so this is inert rather than
  stuck, but there's no reminder/expiry mechanic yet. A future improvement, not built here.
- **The side that committed first can't un-commit.** Once you've accepted and are waiting on the
  other side, there's no "cancel my acceptance" action — you can only wait for them to confirm or
  decline. If you need to back out, decline any way already available to you outside this flow
  (e.g. the client's booking-cancellation flow, if the booking hasn't moved past a cancellable
  status).

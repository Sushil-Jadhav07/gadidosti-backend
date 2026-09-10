# Broker Address, Booking Cancel, and Decline-Visibility Fixes

Summary of three related bugs found and fixed this session, why each one happened, and exactly
what changed. All three were found by tracing real code paths, not guessed — every file/line
below is the actual fix.

---

## 1. Broker "Address" section not saving (city, in particular)

**Symptom:** a broker edits their City/Address in the Broker Portal's Profile page, clicks Save,
and the value doesn't stick — reverts on reload.

**Root cause:** the "Address" section had two fields (Address, and City/State/Pincode) under
one Save button, but that button only ever called the service-city endpoint —
`src/pages/broker/Profile.jsx`'s old `handleSaveExtra`:
```js
const handleSaveExtra = () => {
  addToast("Saved locally — address details aren't stored on the server yet.", "warning");
};
```
It didn't call any API at all. Separately, **City specifically** compounds this: nothing on the
frontend had ever called the backend's `PATCH /api/broker/service-city` endpoint (it existed,
just unused), so no broker in the system has ever had a `service_city` saved — which is exactly
why the client's new "Search for Broker" picker (`GET /api/bookings/eligible-brokers`) came back
empty for intra-city bookings: it filters by `service_city`, and there was nothing to match.

**Fix:**
- `gadidosti-backend`: added `GET /api/broker/profile` (new — nothing previously let the broker
  read their own `service_city`/`is_online` back) and fixed
  `BrokerProfileModel.listEligibleForClient` to fall back to every eligible broker if the
  city-scoped query returns zero rows (`src/models/brokerProfile.model.js`) — the same safety
  net `findEligibleBrokers` already had for the older broadcast path.
- `gadidosti-broker-driver`: `Profile.jsx`'s `handleSaveExtra` now actually persists both fields
  together — `PATCH /api/users/profile` (address) and `PATCH /api/broker/service-city` (city) —
  and the page loads the current value back in via the new `GET /api/broker/profile` on mount.

---

## 2. Cancelling a booking left open requests stale

**Symptom:** a client cancels a booking while it still has open, unactioned offers out (drivers
in a "Find Truck" radius broadcast, or brokers in a broadcast) — those drivers/brokers never
learn the booking is gone; their card in the app just sits there, unchanged.

**Root cause:** `cancelBooking` (`src/controllers/booking.controller.js`) always called
`JobRequestModel.declineAllForBooking(id)` / `DriverRequestModel.declineAllForBooking(id)` to
bulk-decline every open offer — a plain SQL `UPDATE ... SET status = 'declined'` with no
notification and no live push to whoever's request just died. The database was always correct;
nothing ever told the affected driver/broker about it.

**Fix:** both model methods now `RETURNING *` the rows they actually declined
(`src/models/driverRequest.model.js`, `src/models/jobRequest.model.js`). `cancelBooking` uses
that to send each affected driver/broker a "Booking Cancelled" notification and push a live
socket update (`emitDriverRequestUpdate` / `emitJobRequestUpdate`) so their card updates
immediately instead of waiting for their next poll or a manual reload.

---

## 3. "Declined" not showing after another driver/broker won the race

**Symptom:** with "Find Truck" now broadcasting to many drivers at once, whichever ones lose the
race don't see their card flip to "Declined" — it just sits at its old status (pending/countered/
awaiting confirmation) until they happen to reload the page. Same thing for a broker who loses
out to a different broker's accepted offer.

**Root cause:** the exact same silent-bulk-decline pattern as #2, but on the *winning* path
instead of cancellation — `finalizeDriverRequest` (`src/controllers/driverRequest.controller.js`)
and `finalizeJobRequest` (`src/controllers/job.controller.js`) both call
`declineOthersForBooking` the moment one request wins, to clean up every sibling. Before this
fix, that cleanup was silent for the exact same reason as #2: no `RETURNING`, no notification, no
push. This mattered far less before "Find Truck" could fan a single booking out to many drivers
at once — at most one sibling ever existed, and it was rare. Now it's the common case.

**Fix:** same `RETURNING *` change as #2, reused here — both finalize functions now notify and
live-push every sibling that gets declined when someone else wins the booking
("Booking No Longer Available").

---

## Also fixed while investigating: the "new request" popup itself

Separately (not a decline bug, but found while working in this same area): the driver/broker
app's "you have a new request" popup was wired to Firebase push notifications, which only fire
if the browser has been granted notification permission — unreliable, and the actual reason the
popup wasn't appearing at all for some users regardless of which page they were on.

**Fix:** two new dedicated socket events, `driver-request-created` and `job-request-created`,
fired the instant a new `driver_requests`/`job_requests` row is created
(`src/controllers/booking.controller.js`'s `broadcastBooking`/`requestTruckForBooking`,
`src/controllers/driverRequest.controller.js`, `src/controllers/job.controller.js`) — separate
from the existing `*-updated` events used for later accept/decline/counter changes, so a listener
can tell "this is brand new, show the popup" apart from "this changed, patch my existing list."
The frontend (`gadidosti-broker-driver`) now listens for these directly instead of depending on
push permission, with a matching new popup for brokers (`NewJobRequestPopup`) alongside the
existing driver one.

---

## Verification

- Backend: `node --check` on every touched file, `require('./src/app.js')` to confirm no
  circular-require breakage from the new cross-controller imports (`emitJobRequestUpdate` etc.).
- `gadidosti-broker-driver`: `npm run build` passes.
- Not exercised against a live database/browser in this session — flag for manual verification:
  cancel a booking with multiple open offers and confirm every affected driver/broker gets
  notified live; have two drivers accept the same "Find Truck" broadcast and confirm the loser's
  card flips to "Declined" without a reload; confirm the new-request popup appears without
  notification permission granted.

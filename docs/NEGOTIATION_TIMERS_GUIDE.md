# Negotiation Timers — The 2-Minute Driver Window (and What Happens After)

A dedicated, self-contained doc for whoever is building the driver/broker/client apps against
the `driver_requests` negotiation system. Covers exactly how the two response-window timers
work server-side, and — since this trips people up — exactly how (and how little) the reference
apps currently show this in their UI, plus a concrete recipe for building a real live countdown
if you want one for a native app.

This is about `driver_requests` only (direct client↔driver negotiation, and the driver-side leg
of broker-broadcast bookings once a broker assigns someone). `job_requests` (client↔broker price
negotiation, before a driver is involved) has **no timers at all** — no cron sweep exists for
it, brokers can take as long as they like to respond. Don't confuse the two.

---

## 1. The two stages, precisely

```
Request created (or client just countered)
   │
   │  driver's turn — 2 minutes
   ▼
[2 min elapses with no driver response] ──> driverTimedOut: true, broker notified
   │                                              │
   │  driver responds in time                     │  broker's turn — 5 MORE minutes
   ▼                                              ▼
(normal negotiation continues)          [5 min elapses with no broker response either]
                                                   │
                                                   ▼
                                         request -> declined (request "expires" in effect,
                                         but the actual status value is "declined" — there
                                         is no separate "expired" status for driver_requests)
```

**Total worst case from creation to auto-decline: ~7 minutes, not 5.** The 5-minute broker
window starts counting from when the driver's 2-minute window ran out, not from request
creation — these two windows are sequential, not the same countdown. (`job_requests`' status
enum does have an `expired` value defined in the database, but no code path in the current
backend ever sets it — it's dead, don't build against it.)

Both stages restart the clock on any negotiation activity: if the client counters
(`client-counter`), the driver's 2-minute window opens fresh from that moment, even if a broker
had already started responding on the driver's behalf. If a driver is still within their own
window (not yet timed out), the broker literally cannot act — the API will 403/400 them.

---

## 2. Server-side mechanics (what actually enforces this)

Enforced by a **cron job, not a live process** — `src/cron/driverRequestTimeoutSweep.js`, two
functions, both run every minute (`cron.schedule('* * * * *', ...)`):

- **`sweep()`** — finds every `driver_requests` row where `status = 'pending'`,
  `driver_timeout_at IS NULL`, and `updated_at <= NOW() - 2 minutes`. For each: sets
  `driver_timeout_at = NOW()`, creates a "Driver Not Responding" notification for the broker,
  and pushes a `driver-request-updated` socket event to the broker with the fresh row (now
  carrying `driverTimedOut: true`).
- **`brokerSweep()`** — finds every row where `status = 'pending'`, `driver_timeout_at IS NOT
  NULL`, and `driver_timeout_at <= NOW() - 5 minutes`. For each: declines the request
  (`status -> 'declined'`), creates a notification for whoever needs to know (the broker if this
  came from a broker-assign origin — "Assignment Not Confirmed" — otherwise the client —
  "Request Expired, please search for another truck"), and pushes `driver-request-updated`.

**Practical consequence: there's up to ~60 seconds of lag between "2 minutes have actually
elapsed" and the API/socket actually reflecting `driverTimedOut: true`**, since the sweep only
runs once a minute, not continuously. Don't build client logic that assumes the flip happens at
exactly the 120.000-second mark — it'll be somewhere between 120s and 180s in the worst case.

**The server's own guards are what actually matter** — every accept/decline/counter endpoint
independently checks `driver_timeout_at`/`status` before allowing the action (see
`NEGOTIATION_API_GUIDE.md` §4 and `MUTUAL_CONFIRMATION_FLOW.md`), returning `400`/`403` if it's
not actually your turn. **Any timer you build client-side is cosmetic — never trust it as the
source of truth for whether a button should still work.** Always let the server's error response
be what actually blocks a stale action; a client-side countdown just makes the wait feel better.

---

## 3. What the reference apps currently do (as of this doc) — no live countdown exists

This surprises people who expect a ticking "1:47 remaining" clock somewhere. **None of the three
reference apps have one.** Here's exactly what each one shows instead:

### Client app (`gadidosti-client`)
Pure text-label swap, driven by the `driverTimedOut` boolean, identical logic duplicated in two
places (`RequestDriver.jsx` and `BookingDetail.jsx`'s embedded `DriverRequestPanel`):
```js
request.driverTimedOut
  ? "No response yet — their broker has been notified"
  : "Waiting for the driver to respond"
```
No countdown, no number of minutes shown at all. Action buttons (Confirm/Propose a Different
Price) stay fully enabled the whole time regardless of `driverTimedOut` — nothing is disabled
client-side; if the client tries something no longer valid, the server 400s and the usual error
handling (§ in `NEGOTIATION_API_GUIDE.md`) takes over.

### Driver app (`gadidosti-broker-driver`, driver's own request list)
States the window as **static instructional copy**, not a countdown:
```jsx
<p className="text-sm text-slate-500 mt-1">Respond within 2 minutes — after that your broker can act on your behalf.</p>
```
Once `driverTimedOut` flips true, this app does more than relabel — it **hard-locks the UI**:
```js
const locked = isDriver && req.status === "Requested" && req.driverTimedOut;
const canAct = req.status === "Requested" && !locked;
```
Accept/Counter/Decline buttons disappear entirely, replaced by:
```jsx
<div className="... flex items-center justify-center gap-2">
  <Lock size={13} /> You didn't respond in time — your broker has taken over this request.
</div>
```

### Broker app (`gadidosti-broker-driver`, broker's driver-requests inbox)
The broker's list is pre-filtered server-side to already-timed-out requests only (`GET
/api/driver-requests` as a broker only returns rows where `driverTimedOut` is already true — see
`NEGOTIATION_API_GUIDE.md` §4), so this screen never shows a countdown either — by the time a
request appears here at all, stage 1 is already over. Static copy: "Requests your drivers didn't
respond to within 2 minutes — you can now respond on their behalf," plus a small per-card note:
"Driver timed out — you're responding on their behalf."

### Polling vs. socket, and what that means for lag
All negotiation screens poll as a fallback but treat the `driver-request-updated` socket event
(see `NEGOTIATION_API_GUIDE.md` §5) as the primary live-update mechanism. Poll intervals: client
`RequestDriver.jsx` 15s, client `BookingDetail.jsx` panel 6s, driver/broker inbox screens 30s.
Combined with the cron's own ~60s sweep lag, the realistic worst-case delay between "2 minutes
truly elapsed" and a user actually seeing `driverTimedOut: true` reflected is **up to ~90
seconds** if the socket connection happens to be down and you're relying on the slowest poll.
With the socket connected (the normal case), it's just the cron's ~60s lag.

---

## 4. If you want a real live countdown (recommended for a native app)

Nothing stops you from building one — the reference apps just didn't. Here's the correct
approach, keeping the server as the sole source of truth:

**Anchor the countdown on `updatedAt`, not `createdAt`.** `updatedAt` resets every time the row
changes — request creation, a counter-offer in either direction, and (via the DB trigger) the
cron's own `driver_timeout_at` write. This means `updatedAt` is exactly the right anchor for
*both* stages, not just the first:

```js
function getCountdownTarget(request) {
  if (request.status !== "pending") return null; // nothing to count down for
  const anchor = new Date(request.updatedAt).getTime();
  const windowMs = request.driverTimedOut ? 5 * 60 * 1000 : 2 * 60 * 1000;
  return anchor + windowMs;
}
```

**Tick locally, don't re-fetch every second** — compute remaining time from the target on a
1-second `setInterval`, clamp at zero, and stop ticking once `status` changes (from the socket
push or poll) rather than trying to predict server-side transitions:

```js
function useCountdown(request) {
  const [remainingMs, setRemainingMs] = useState(null);

  useEffect(() => {
    const target = getCountdownTarget(request);
    if (!target) { setRemainingMs(null); return; }

    const tick = () => setRemainingMs(Math.max(0, target - Date.now()));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [request.updatedAt, request.status, request.driverTimedOut]);

  return remainingMs; // null = no active window; 0 = expired, waiting on server to catch up
}
```

**When it hits zero, don't assume the transition already happened** — the server's cron can lag
up to ~60s behind the true deadline (§2). Show something like "Any moment now..." instead of
immediately flipping your UI to the timed-out state; let the actual `driver-request-updated`
socket event (or next poll) be what triggers the real state change. Treating your own countdown
hitting zero as authoritative is exactly the "don't trust the client timer" mistake called out in
§2 — it'll occasionally show "broker's turn" for up to a minute before the server agrees.

**Format for display**: standard `mm:ss`, e.g.
```js
const format = (ms) => {
  const totalSeconds = Math.ceil(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};
```

**Don't build a countdown for `job_requests`** — as noted in §1, that subsystem has no timers at
all server-side; there's nothing to count down to.

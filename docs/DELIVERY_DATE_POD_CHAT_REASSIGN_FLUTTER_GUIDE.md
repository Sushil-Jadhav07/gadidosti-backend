# Delivery Date, POD Video, Broker-Driver Chat, Reassignment — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. Four backend changes just shipped. One of them (#2, proof of
delivery) needs real attention soon — it changes a rule your existing screen doesn't know about
yet. The rest are additive/optional.

---

## 1. Estimated delivery date — informational, nothing breaks

`POST /api/bookings/quote` and every booking object (`GET /api/bookings/:id` etc.) now include
`estimatedDeliveryDate` (ISO string) and, on bookings, `estimatedDeliveryDays` (int) — a coarse,
day-granularity estimate shown before booking confirmation. Nothing required; add it to your
booking-review screen if you want feature parity with the web client, which now shows it there
and on the booking detail screen.

---

## 2. Proof of delivery — a real rule change, worth fixing soon

**Checked `driver_delivery_photo_upload_screen.dart`**: it already exists, uses `image_picker`'s
`pickImage` (photos only, no video), and — as far as this pass could tell — has **no
minimum-count check before letting the driver submit/continue**.

**What changed on the backend**: `PATCH /api/trips/:id/status` with `{status: 'completed'}` now
returns a **409** ("At least 2 proof-of-delivery photos/videos are required...") if fewer than 2
POD items have been uploaded for that trip. This is now enforced **server-side**, unconditionally
— if your current screen lets a driver upload just 1 photo and continue, the *next* screen's
"mark trip complete" call will start failing with this 409 where it didn't before.

**What to fix**: add a client-side check requiring at least 2 uploads before enabling
whatever button leads to marking the trip `completed` (mirrors what the web driver app's
equivalent screen now does) — better to catch it there than surface a raw 409 after the fact.

**Optional, if you want video too**: `POST /api/trips/:id/pod` now also accepts video files
(`video/*` mimetype, up to 50MB each, still max 6 items total per trip). The response now
returns `podMedia: [{url, type}]` (`type` is `"image"` or `"video"`) alongside the existing
`podPhotos` (still just bare URLs, kept for back-compat). If you want to add video capture,
`image_picker` also has `pickVideo` — same package, no new dependency needed.

---

## 3. Broker <-> driver direct chat — new, optional

A broker can now message one of their own drivers directly, with no booking involved at all —
and vice versa. Checked `app_socket_service.dart` and the existing chat-related screens in this
app; if `SSK_Cargo` already has a booking-scoped chat screen, the exact same message-list/send/
socket-event calls work unchanged here, just pointed at a different thread id:

```
GET /api/chat/drivers/:driverId/thread   (broker calls this, picking one of their own drivers)
GET /api/chat/broker/thread              (driver calls this, no params — resolves their own broker)
```
Both return `{ thread: { id, ... } }`. From there, `GET/POST /api/chat/threads/:threadId/messages`,
`PATCH /api/chat/threads/:threadId/read`, and the `join-thread`/`send-message`/`new-message`
socket events are identical to the booking-scoped flow you may already have built.

`GET /api/chat/threads` (a unified thread-list, if you use it for an inbox screen) now also
includes these direct threads mixed in, each with `isDirect: true` and `bookingId`/
`bookingNumber`/`pickup`/`drop` all `null` — if you render a thread list anywhere, guard against
null booking fields so it doesn't show "null -> null" for these.

---

## 4. Driver reassignment — mostly backend-only, one new read endpoint

A broker reassigning a driver mid-trip (`POST /api/jobs/:id/assign-driver`'s reassignment branch,
if you already call this) now:
- Accepts an optional `reason: string` in the body.
- Returns a **409** if the trip has already reached `delivered`/`completed`/`cancelled` (it used
  to allow reassignment at any status — now blocked once the trip is effectively over).
- Notifies the *outgoing* driver too now (previously only the incoming one was told).

New, optional: `GET /api/bookings/:id/reassignment-history` → `{ history: [{ fromDriverName,
toDriverName, reason, reassignedByName, createdAt }, ...] }` — empty array for the vast majority
of bookings that were never reassigned. Add a small section to a booking-detail screen if you
want feature parity with the web client, which now shows this (only when non-empty).

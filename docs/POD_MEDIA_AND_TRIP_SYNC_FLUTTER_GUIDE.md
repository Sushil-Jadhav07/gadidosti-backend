# POD Media, Cancel/Decline Sync, Express & Job-Request Fixes — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. Checked against the actual `SSK_Cargo/lib` code — most of this
batch of backend/web fixes needs **no** Flutter work; the one real item is proof-of-delivery.

## 1. Proof of delivery — new `podMedia` on the booking (optional Flutter work)

**Backend change:** `GET /api/bookings/:id` (and every other endpoint using the booking
projection) now returns `podMedia` alongside the old `podUrl`:

```json
"podUrl": "https://.../first-photo.jpg",
"podMedia": [
  { "url": "https://.../a.jpg", "type": "image" },
  { "url": "https://.../b.jpg", "type": "image" },
  { "url": "https://.../c.mp4", "type": "video" }
]
```

`podUrl` is only ever the **first** file the driver uploaded (kept for old callers). The driver
can upload up to 6 photos/videos per trip — before this change the booking response never
exposed the rest, which is why the web client/admin/broker screens only showed one image.
`podMedia` is `[]` (never null) when nothing was uploaded.

**What Flutter does today:**
- Client side: `client_flow_widgets.dart` (~line 1121) parses only `podUrl`, and nothing in
  `features/client` actually renders it — so there is no POD viewing on the client app at all
  right now. This is a missing feature, not a regression.
- Driver side: `driver_delivery_photo_upload_screen.dart` (~line 75) reads `trip['podPhotos']`
  (bare URLs). That still works, but it can't tell a video from a photo — `GET /api/trips/:id`
  also returns `podMedia` (`{url, type}`), which is the better field to read.

**If you add it:** parse `podMedia` (fall back to `[{url: podUrl, type: 'image'}]` when it's
empty but `podUrl` is set — older trips), show a thumbnail grid, tap to open a full-screen
pager (photos + video player). Depending on `STORAGE_PROVIDER`, files can sit behind
`authenticate`, so load them with an `Authorization: Bearer <token>` header (the web apps fetch
them as blobs for the same reason) rather than a bare `Image.network(url)`.

## 2. Client cancel / driver decline — no Flutter change needed

Backend now pushes a live `trip-status-updated` socket event when a client cancels a booking
with a trip already assigned (to the driver and broker), and when a driver declines a trip
before starting it (to the client and broker). **`app_socket_service.dart` doesn't listen to
that event** (it handles `truck-location`, `driver-request-updated`, `job-request-updated`,
`booking-payment-updated` only), so nothing changes for Flutter. Be aware the payload is
deliberately minimal — `{ id, bookingId, status }`, not a full trip — if you ever add a
listener, treat it as a "refetch" signal, don't read fields off it.

Also new: when a driver declines an assigned trip, the **client now gets a notification**
("Driver Unavailable — we're finding you another one", `type: 'booking'`). Flutter will show it
through whatever it already does for the notification list/push. The booking's status stays
`confirmed` with no driver (it is *not* set to `cancelled` — a broker can still reassign it).
The Flutter app has no call to `POST /api/trips/:id/decline` (only the request-level
`/driver-requests/:id/decline` and `/jobs/requests/:id/decline`), so the driver side is
unaffected. The client cancel call (`PATCH /api/bookings/:id/cancel`) has an unchanged contract.

## 3. Express Delivery — no Flutter change needed

The Flutter app has no Express Delivery UI or `is_express` field, so nothing to do. For
reference if it's added later: the backend silently ignores `is_express: true` for the `part`
(Part Load) truck category and for inter-city bookings, returning a quote with
`isExpress: false`. Check that flag on the quote response and tell the user why, instead of
leaving the toggle on with no surcharge (the web client had exactly this silent failure).

## 4. Backend-only / web-only — nothing to do

- `GET /api/chat/bookings/:id/thread` 500 (`ON CONFLICT` vs. the partial unique index) and the
  `GET /api/chat/threads` `UNION ... ORDER BY` error: server-side fixes, same responses.
- Broker "Job Requests" list no longer re-shows requests whose driver already accepted
  (`GET /api/jobs/requests`): broker web app only; Flutter doesn't use this screen.

# Driver Session Scoping/Staleness & POD Upload Size Fix

Two unrelated fixes, both backend + web this pass. Grounded against the actual `SSK_Cargo`
source for what (if anything) the Flutter apps need — short version: the session fix needs
nothing from Flutter at all, the upload fix has a small optional hardening worth doing there.

---

## 1. Single-active-session — driver only now, with a 1-minute staleness window

**What was wrong:** `SINGLE_SESSION_ROLES` (`auth.controller.js`) covered both `driver` and
`broker`. Brokers routinely switch between a laptop and a phone with no fleet-sharing reason to
ever be blocked the way a driver-per-truck account is — every broker login from a second device
was hitting `409 "This account is already logged in on another device"` with no way out short of
logging out the other device or contacting support. Separately, even for drivers, an abandoned
session (app closed, phone died, no signal — no clean logout) could block every future login for
up to 30 days, since nothing about the old session ever expired on its own.

**Fix:**
- `SINGLE_SESSION_ROLES` is now `['driver']` only. Broker logins are entirely unaffected by this
  block from now on, on any client.
- New `users.last_active_at` column (`db/37user_last_active.sql`), touched on every authenticated
  **driver** request by `auth.middleware.js`'s `authenticate` (fire-and-forget, doesn't add
  latency to the request it rides on). `rejectIfActiveSession` now only actually blocks a new
  login if the existing session made a request within the last `STALE_SESSION_MS` (60s) — past
  that, the old session is treated as abandoned and a fresh login goes through normally, no
  waiting out the refresh token's full life.
- Logout was already unconditional on both ends — backend `logout()` has no trip-status check,
  and the driver app's `logout()` (`useAuth.jsx`) always clears the local session regardless of
  trip state. A driver on an active trip could already log out before this change; nothing needed
  fixing there.

**Flutter — nothing to change.** Both halves of this fix live entirely in
`auth.controller.js`/`auth.middleware.js`, which every client (web, and `SSK_Cargo`'s driver app)
already goes through identically for `POST /api/auth/login` and every authenticated request. The
scoping-to-driver-only fix and the 1-minute staleness window both apply automatically, with zero
Flutter code changes required.

**Flutter — a pre-existing, unrelated gap worth flagging while in this area.** Checked: there is
no `login-attempt-alert` listener anywhere in `SSK_Cargo` (`grep 'login-attempt-alert' lib/` →
zero hits), unlike the web driver/broker app's `SessionGuard.jsx`, which shows a real-time "someone
just tried to log in to your account from another device" modal. Not something this pass touched
or broke — just noting it's not there if it's ever wanted: same shape as `SessionGuard.jsx`,
listening on the same authenticated socket connection `app_socket_service.dart` already
maintains, for the `login-attempt-alert` event, driver role only (the event is only ever emitted
for drivers now that brokers are out of `SINGLE_SESSION_ROLES`).

---

## 2. POD photo upload — "request entity too large"

**What was wrong:** `DeliveryCompletionFlow.jsx`'s Upload-Proof-of-Delivery step (`UploadPhotosStep`)
took photos straight from `<input type="file" accept="image/*" capture="environment" multiple>`
with zero client-side processing and appended them to `FormData` as-is. A phone camera photo
routinely runs 5-15MB; picking several for one submission (up to 6) produced multipart bodies
large enough to trip a size limit somewhere in the stack (the backend's own multer
`fileSize: 10MB` per-file cap in `upload.middleware.js`, or an infra layer in front of it) — the
literal error text ("request entity too large") matches Express's own body-size-limit message.

**Fix:** new `src/lib/imageCompression.js` (`gadidosti-broker-driver`) — canvas-based resize to a
1600px max dimension + JPEG re-encode at 0.75 quality (falls back to the original file if
compression would somehow make it bigger, e.g. an already-tiny/optimized source image). Wired
into `handleSubmitPhotos` right before building the `FormData`, so every photo is compressed
before it ever leaves the device. A full 6-photo batch now typically totals well under 2MB
combined, comfortably inside every size limit in play.

**Flutter — already partially covered, one gap left.**
`driver_delivery_photo_upload_screen.dart` (the Flutter equivalent of this same step) calls
`_picker.pickImage(source: source, imageQuality: 85)` — `image_picker`'s own JPEG re-encode at
85% quality, so it's not hitting this at full severity today. But there's no `maxWidth`/
`maxHeight` passed alongside `imageQuality`, so a high-megapixel phone camera (108MP+ sensors are
common now) can still produce a multi-MB file even at 85% quality — just re-compressed, not
resized. Matching the web fix's actual safety margin means adding the same dimension cap here:

```dart
final picked = await _picker.pickImage(
  source: source,
  imageQuality: 85,
  maxWidth: 1600,
  maxHeight: 1600,
);
```
(`image_picker` letterboxes to fit within `maxWidth`/`maxHeight` while preserving aspect ratio,
same effect as the web fix's canvas resize.) Low priority relative to §1 — this is hardening an
existing partial mitigation, not fixing a live bug the way the web side was.

---

## 3. Quick checklist

| Item | Backend | Web | Flutter |
|---|---|---|---|
| Session block scoped to driver only | Done | N/A (backend-only fix) | N/A — same backend, automatic |
| 1-minute staleness window | Done (`last_active_at`, needs `db/37user_last_active.sql` run) | N/A | N/A — same backend, automatic |
| `login-attempt-alert` real-time modal | Already existed | Already existed (`SessionGuard.jsx`) | Not built — optional, see §1 |
| POD photo compression | N/A | Done (`imageCompression.js`) | Partial — has `imageQuality: 85`, missing `maxWidth`/`maxHeight` (see §2) |

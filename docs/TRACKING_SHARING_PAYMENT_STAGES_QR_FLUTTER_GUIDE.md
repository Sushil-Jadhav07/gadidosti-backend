# Tracking Sharing, Payment Stages, and Company QR — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. Three backend changes just shipped. As with the earlier guides,
checked against the actual `SSK_Cargo` source where relevant — citations below are real.

---

## 1. Live tracking sharing — the big one, needs real mobile-side setup

**What shipped on the backend**: a client (or anyone who can already view a booking) can
generate a public, no-login-required tracking link:
```
POST /api/bookings/:id/track/share-link   (authenticated)
→ { token, shareUrl }   // shareUrl is already a full URL, e.g. https://gadidostclient.asynk.in/t/<token>

GET /api/track/:token   (PUBLIC — no Authorization header at all)
→ { bookingNumber, pickup, drop, status, driverName, truckReg,
    driverLat, driverLng, driverHeading, lastLocationAt, isTerminal,
    deliveredAt, distanceRemainingKm, etaMinutes, incident }
```
The web client (`gadidosti-client`) now has a "Share" button that opens the OS share sheet with
this link, and a public web page at `/t/:token` that renders it — no login needed there either.

**Checked `SSK_Cargo` for existing deep-link infrastructure — there is none at all**:
- `android/app/src/main/AndroidManifest.xml` has only the default `MAIN`/`LAUNCHER`
  intent-filter. No custom scheme, no App Links (`autoVerify` + `https` data block).
- `ios/Runner/Info.plist`'s `CFBundleURLTypes` only has the Google Sign-In OAuth callback
  scheme — nothing for the app itself.
- `pubspec.yaml` has no `app_links`, `uni_links`, or `firebase_dynamic_links` dependency.

**What this means**: when someone opens a shared tracking link on a phone today, there is
nothing for the OS to hand off to — it just opens the web page. That's an acceptable, working
fallback (the web page works standalone, no app required), but if you want "opens straight in
the app when it's installed," this needs building from scratch:

1. **Pick one approach**: Android App Links / iOS Universal Links (the modern way — a real
   `https://` URL that the OS hands to your app IF installed, and falls through to the browser
   otherwise, no custom scheme needed) is strongly preferred over a custom URI scheme
   (`gadidost://...`) — no "app not found" dead end if it's not installed, and no separate
   store-redirect logic needed at all, since the same `https://gadidostclient.asynk.in/t/:token`
   URL just always works, app-or-no-app.
2. **Add a Flutter package** for this — `app_links` (actively maintained) is the common choice.
3. **Android**: add an `intent-filter` with `android:autoVerify="true"` for
   `https://gadidostclient.asynk.in/t/.*` in `AndroidManifest.xml`, and host a
   `.well-known/assetlinks.json` at that domain (ask whoever manages `gadidostclient.asynk.in`'s
   web deployment — this is a static file, not a backend endpoint) proving your app package
   owns it.
4. **iOS**: add the `com.apple.developer.associated-domains` entitlement
   (`applinks:gadidostclient.asynk.in`) and host `.well-known/apple-app-site-association` the
   same way.
5. **Handle the incoming link** in the app: parse the token out of the URL path, then call the
   exact same public `GET /api/track/:token` the web page uses — build a lightweight,
   unauthenticated tracking screen (no login prompt) that shows it, since whoever opens a shared
   link may not have an account at all. This is a genuinely new screen, not a reuse of the
   existing authenticated tracking flow.

**Not needed yet**: any Play Store / App Store redirect logic — there's no store listing URL
anywhere yet (the app isn't published). The web page currently just shows its own tracking view
as the fallback with no store link. Once the app is published, that's a small addition on the
web side (store URLs plugged into an already-built fallback) — nothing Flutter-side changes for
that part.

---

## 2. Payment stages — Advance / To Pay / To Be Billed

**What changed**: the old flat "20% advance above ₹5000" rule is gone, replaced by an
admin-configurable tiered rule (three tiers by booking amount — the exact numbers can change any
time in the admin dashboard, never hardcode them). "Pay Later" is being relabeled "To Pay"
everywhere (same mechanism — nothing collected now, full amount COD at delivery), and there's a
brand-new third stage, "To Be Billed" (nothing collected now OR at delivery — settled out of
band later).

**New/changed endpoints**:
```
GET /api/bookings/:id/advance-amount
→ { advanceAmount: number }
```
Call this before showing an "Advance" button/amount — don't compute the tiers client-side, they
can change from the admin dashboard at any time.

```
PATCH /api/bookings/:id/mark-to-be-billed   (empty body)
→ { booking: <full re-projected booking> }
```
New. No gateway/payment involved — this just records the client's choice. 409 if a payment
choice was already recorded, or the booking is cancelled.

**Unchanged**: `POST .../payment/order` and `POST .../payment/verify` (from the earlier Razorpay
guide) still work exactly the same for `pay_type: 'full'` and `pay_type: 'advance'` — the only
change is that `'advance'` is now *always* offered (every tier defines some advance value; there
used to be a ₹5000 floor below which it wasn't offered at all — that's gone) and the amount comes
from the new endpoint above instead of a flat 20%.

**What to build**: if/when you build a real payment-method picker in Flutter (per the earlier
Razorpay guide, `SSK_Cargo` currently has no real checkout UI at all, just bare `payBooking()`
calls that now 409), give it four buttons instead of the old two: **Pay Now** (full, unchanged),
**Advance** (fetch the amount from the new endpoint first), **To Pay** (label for the existing
pay-later/COD path), **To Be Billed** (call the new endpoint, no gateway).

---

## 3. Company QR — informational, and a bigger pre-existing gap worth knowing about

**What shipped**: trips now carry a platform-wide `companyUpiId`/`companyUpiName` (admin-set)
alongside the existing per-driver `driverUpiId`. On the web driver app, the driver can now toggle
between showing their own personal UPI QR or the Company one at collection time — their own
choice, per collection.

**Checked `SSK_Cargo`'s driver payment screen** (`driver_payment_screen.dart`) — it only has a
plain "UPI" *label* as one of several payment-mode buttons (line ~346), same as cash/card — there
is **no actual QR-code generation anywhere in the Flutter app today**, for either the driver's
own UPI or a company one. This predates today's change — the web driver app only gained real
UPI-QR generation earlier this session (a driver-entered `upi_id` + the `qrcode` npm package
building a `upi://pay?...` intent from `driverUpiId` + `amountToCollect`). Flutter never had this
at all.

If you want parity: the trip object already carries everything you'd need —
`driverUpiId`/`companyUpiId`/`companyUpiName`/`amountToCollect` are all on it already (same
`GET /api/trips/:id` etc. Flutter already calls). Building the actual QR would mean adding a QR
package (e.g. `qr_flutter`) and constructing the same `upi://pay?pa=<upiId>&pn=<payeeName>&am=<amountToCollect>&cu=INR&tn=<note>`
intent string the web app builds — not a gateway integration, just a plain UPI deep-link encoded
as a QR image. Out of scope for what was asked this round, but flagging it since it's the same
underlying data already flowing through the app.

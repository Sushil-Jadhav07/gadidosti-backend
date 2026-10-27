# Client Verification, Wallet, Geofencing & Service Charge — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. Covers five backend changes, all live in production:

1. **Client verification** — every client must now verify PAN + Aadhaar (via DigiLocker) + GST
   before they can do almost anything in the app. New, client-role-only.
2. **Driver/broker GST** — GST joined the existing PAN/Aadhaar/(Driving License) DigiLocker KYC
   flow in `DIGILOCKER_KYC_FLUTTER_GUIDE.md`. Small, additive change to that existing flow.
3. **Client wallet** — recharge a balance via Razorpay, pay for a booking straight from it.
4. **Geofencing** — bookings can now be rejected if pickup/drop fall outside an admin-whitelisted
   set of pincodes. The app needs to capture a pincode at pickup/drop and handle two new error
   codes.
5. **Service charge** — the old flat platform-fee percentage became a tiered rule (7%/5% by order
   amount). Nothing to build — it's the same `platformFee` field in the pricing breakdown, just
   computed differently server-side.

Driver/broker commission and the earnings wallet are covered separately in
`COMMISSION_AND_EARNINGS_WALLET_FLUTTER_GUIDE.md`.

Base URL for every endpoint below: `https://apigadidosti.asynk.in`. Every response is
`{ success, message, data }` unless noted.

---

## 1. Client verification (PAN + Aadhaar + GST)

### The idea in one paragraph

Exactly the same mechanism driver/broker KYC already uses (`kyc_submissions`, `DigiLocker`,
`verification_results`) — just a third role now wired into it. One DigiLocker session covers
**Aadhaar + PAN** together; **GST has no DigiLocker document**, so it's always a manual GSTIN
lookup. There is **no "Submit" button and no document-number form** for a client, unlike
driver/broker — the backend auto-finalizes the moment all three checks are individually verified.
Nothing for an admin to review either way; a client's KYC is either fully automated-verified or
still missing a check, never "pending manual review."

| Check | How | Fallback |
|---|---|---|
| Aadhaar | DigiLocker session | manual review (no OTP fallback, same as driver/broker) |
| PAN | DigiLocker session (same one as Aadhaar) | number entry → `POST /api/kyc/verify/pan` |
| GST | *(no DigiLocker document)* | number entry → `POST /api/kyc/verify/gst`, always required |

### The flow

```
┌─ Aadhaar + PAN ─────────────────────────────────────────────────┐
[Verify with DigiLocker] ──POST /verify/digilocker/start──▶ { url, verificationId }
        │
        ▼  open `url` (WebView or external browser + app link)
  user signs in to DigiLocker, allows access
        │
        ▼  DigiLocker sends them to redirect_url?verification_id=…
   back in the app ──GET /verify/digilocker/status──▶ pending | failed | done
        │
        ▼  done → aadhaar verified/missing, pan verified/missing
  PAN missing → number-entry fallback (POST /verify/pan)
  Aadhaar missing → nothing to do here, stays unverified
└───────────────────────────────────────────────────────────────┘
┌─ GST ───────────────────────────────────────────────────────────┐
[Enter GSTIN] ──POST /verify/gst──▶ { status: "verified" | "failed" }
└───────────────────────────────────────────────────────────────┘
        │
        ▼  (no explicit submit — happens automatically)
  Once all three are "verified": the backend flips kyc_status → "verified" by itself.
  Poll/re-fetch GET /kyc/status after every successful check to notice this.
```

### Endpoints (role: `client`, `Authorization: Bearer <access_token>`)

These are the **same KYC endpoints driver/broker already use** — now also accept `client`:

#### Start DigiLocker — `POST /api/kyc/verify/digilocker/start`
```json
// request
{ "redirect_url": "https://apigadidosti.asynk.in/verify" }
// response data
{ "url": "…digilocker consent link…", "verificationId": "dg_…_173…", "documents": ["aadhaar", "pan"] }
```
Same rules as the driver/broker guide: `redirect_url` must be **https** or `422`; link valid ~10
minutes.

#### DigiLocker status — `GET /api/kyc/verify/digilocker/status?verification_id=<verificationId>`
Same `pending` / `failed` / `done` shape as the driver/broker guide. For a client, `documents`
only ever has `aadhaar` and `pan` keys (no `drivingLicense`):
```json
{
  "status": "done",
  "documents": {
    "aadhaar": { "status": "verified", "details": { "name": "…", "dob": "…", "number": "…" } },
    "pan":     { "status": "missing",  "details": { "message": "Not found in your DigiLocker" } }
  }
}
```

#### PAN fallback (only if DigiLocker returned PAN as `missing`) — `POST /api/kyc/verify/pan`
```json
{ "pan": "ABCDE1234F", "name": "Harsh N" }
// → { "status": "verified" | "failed", "details": { "registeredName": "…", "message": "…" } }
```

#### GST — always manual — `POST /api/kyc/verify/gst`
```json
{ "gstin": "27ABCDE1234F1Z5" }
// → { "status": "verified" | "failed", "details": { "legalName": "…", "gstinStatus": "…", "message": "…" } }
```
`gstin` must match `^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$` (15 characters) or you get a `422`
before it even reaches Cashfree.

`success: true` with `data.status: "failed"` is a **normal outcome**, not an error — the GSTIN/PAN
is correctly formatted but doesn't exist or doesn't match. Show `data.details.message`.

#### Reading state — `GET /api/kyc/status`
```json
{
  "kyc_status": "pending" | "submitted" | "verified" | "rejected",
  "submission": {
    "verification_results": {
      "pan":     { "status": "verified", "details": {...} },
      "aadhaar": { "status": "verified", "details": {...} },
      "gst":     { "status": "failed",   "details": { "message": "GST verification did not pass" } }
    }
  }
}
```
Call this on screen load to pre-fill each row's status, and again after every verify
attempt/DigiLocker resolution — **`kyc_status` flips to `"verified"` automatically** the instant
all three are verified; there's no separate call to trigger that.

### App-wide lock — this is the part that's different from driver/broker

Driver/broker KYC only gates **job acceptance** (see the other guide) — everything else in the
app stays reachable regardless of KYC status. **Client verification is much stricter: lock the
entire app.** The web app (`gadidosti-client`) now only lets an unverified client reach:

- Dashboard/Home
- Profile
- Chat
- the Verification screen itself (obviously — they need to reach it to verify)

**Everything else** — Book a Truck, My Bookings, booking detail, Track Shipment, Wallet, Saved
Addresses, Payment Methods, Monthly Hiring, Notifications — redirects straight to the
Verification screen until `kyc_status === "verified"`. Build the Flutter equivalent: check
`kyc_status` once per session (cache it, refresh after verification actions, don't
re-fetch on every navigation), and block navigation to every screen except the four listed above
until it reads `"verified"`.

The **real** lock is server-side regardless: `POST /api/bookings` returns
`403 { code: "KYC_VERIFICATION_REQUIRED" }` if a client without verified KYC somehow reaches the
booking-create call anyway. Treat the app-wide screen lock as UX, and this 403 as the fallback —
same relationship as the GST-popup-before-booking pattern already used elsewhere.

### Sandbox test data (test environment only)

PAN/driving-license test fixtures are in `DIGILOCKER_KYC_FLUTTER_GUIDE.md`. For GST specifically
(sandbox only — these fail in production, and a real GSTIN fails in sandbox):

| GSTIN | Result |
|---|---|
| `29AAICP2912R1ZR`, `27ABCFGH5678D1Z`, `36JKLPQR9012E2Y`, `45XYZLMN2345G3W`, `12PQRST6789A4BC`, `39ABCDE0987F6GH`, `23UVWXYZ5678H5D`, `05BBICP2912R1ZR` | verified |
| `29AAIZP2912R1ZR`, `05BBICA2912R1ZR` | invalid (failure path) |

Source: [Cashfree VRS sandbox test data](https://www.cashfree.com/docs/api-reference/vrs/data-to-test-integration).

---

## 2. Driver/broker: GST joined the existing DigiLocker KYC flow

Everything in `DIGILOCKER_KYC_FLUTTER_GUIDE.md` is still accurate — this is additive on top of
it, not a replacement.

- `REQUIRED_CHECKS_BY_ROLE` now includes `gst` for both `driver` and `broker` (alongside the
  existing pan/aadhaar/driving-license). A submission only auto-verifies once GST is checked too.
- **No DigiLocker document for GST** — it's always `POST /api/kyc/verify/gst` (same shape as
  section 1 above), never part of the DigiLocker session.
- Add a GST row to the existing KYC screens (`driver_kyc_registration_screen.dart`,
  `broker_kyc_registration_screen.dart`): a GSTIN text field + verify button, same pattern as the
  existing PAN fallback row.
- **Already-verified accounts were reset.** Every driver/broker that was `kyc_status: "verified"`
  before this shipped got pushed back to `"submitted"` (into the manual review queue) — they'll
  disappear from truck search / be unable to accept jobs until they add + verify GST and get
  re-approved. If the app shows a "why am I suddenly under review again" state, that's expected,
  not a bug — show the normal `"submitted"` / "KYC Under Review" copy the app already has.

---

## 3. Client wallet

A rechargeable balance, usable as an alternative to Pay Now/Advance at booking payment time.
Recharging goes through the **same real Razorpay gateway** described in
`RAZORPAY_FLUTTER_INTEGRATION_GUIDE.md` — reuse that integration, just against different
endpoints and with no `bookingId` involved.

### Endpoints (role: `client`)

#### Balance — `GET /api/wallet`
```json
{ "balance": 1250.00 }
```

#### Transaction history — `GET /api/wallet/transactions?page=1&limit=20`
```json
{
  "transactions": [
    { "id": "…", "type": "recharge", "amount": 1000, "balance_after": 1250, "created_at": "…" },
    { "id": "…", "type": "booking_payment", "amount": 500, "balance_after": 250, "reference_booking_id": "…", "created_at": "…" }
  ],
  "total": 2, "page": 1, "limit": 20, "total_pages": 1
}
```
`type` is `"recharge"` (credit), `"booking_payment"` (debit), or `"refund"` (credit).

#### Recharge — create order — `POST /api/wallet/recharge/order`
```json
{ "amount": 500 }   // minimum ₹100
// → { "order": { "orderId", "amount", "currency", "status", "keyId", "provider": "razorpay" | "fake" } }
```
Same `keyId`/`provider` shape as a booking payment order — open the real Razorpay SDK exactly as
in `RAZORPAY_FLUTTER_INTEGRATION_GUIDE.md` section 2, just with this order instead.

#### Recharge — verify — `POST /api/wallet/recharge/verify`
```json
{ "order_id": "<orderId>", "razorpay_payment_id": "…", "razorpay_signature": "…" }
// → { "balance": 1500.00 }
```
Only this call actually credits the balance — same "never trust the SDK's own success alone"
rule as booking payments. The amount credited is whatever `recharge/order` was opened for
server-side; nothing you send here can change it.

#### Pay a booking from wallet — `POST /api/bookings/:id/pay/wallet`
```json
{ "pay_type": "full" | "advance" }
// → 200 { "booking": {...}, "wallet_balance": 750.00 }
// → 402 "Insufficient wallet balance"
```
No gateway round-trip — an instant internal debit. Add this as a third button alongside the
existing Pay Now / Pay Advance on the driver-confirmed payment screen (same screen
`RAZORPAY_FLUTTER_INTEGRATION_GUIDE.md` describes), fetching `GET /api/wallet` first to show/
disable it based on balance vs. amount due.

### What to build in `SSK_Cargo`

1. New Wallet screen: balance card, "Recharge" button → amount picker → the same Razorpay
   checkout flow as booking payments, against `recharge/order` / `recharge/verify`. Transaction
   list below it.
2. Add a nav entry for it (the web app put it in the main sidebar, not buried in Profile).
3. On the existing payment-method screen for a confirmed booking, add "Pay from Wallet" fetching
   `GET /api/wallet` for the balance, calling `pay/wallet` directly (no SDK involved).

---

## 4. Geofencing (pincode whitelist)

An admin can whitelist specific pincodes; once at least one is configured, **both the pickup and
drop pincode must be on that list** or booking creation is rejected. If the admin hasn't added
any yet, there's no restriction (fail-open) — this can't be detected from the client side, the
booking call is just the source of truth.

### Checked in two places — check it early, not just at final Confirm

The same check runs on **both** of these (one shared server-side helper, so they can never
disagree):

| Endpoint | When | Why |
|---|---|---|
| `POST /api/bookings/validate-location` | Right after the user picks pickup/drop, before the rest of the wizard (role: `client`) | Immediate feedback — don't make them fill out load details, truck type, etc. just to get blocked at the very end |
| `POST /api/bookings` | Final booking creation | The real lock — `validate-location` is earlier UX, not a substitute for this, since nothing stops a caller skipping straight to this one |

**Build the equivalent in `SSK_Cargo`**: call `validate-location` (or re-call it) the moment both
pickup and drop are picked / whenever either changes, same as you'd already be doing for the
existing intra/inter-city "both in the same city" check it also does — this just adds the same
error codes as a second possible outcome from the same call.

### Request body — both endpoints

Two new optional fields:
```json
{ "pickup_pincode": "452001", "drop_pincode": "411001", ... }
```
Capture these from whatever address-picker API you use (Google Places' `addressComponents` has a
`postal_code` type component) at pickup/drop selection time, the same as you already capture
lat/lng. If the user picks a whole city rather than a specific address, there is no single
pincode for it — leave the field out rather than guessing one.

**Reverse-geocoded / tap-the-map / Plus Code results need care.** A point picked by tapping the
map (rather than searching an address) often reverse-geocodes to a Google **Plus Code** (e.g.
`2RJW+Q6F, VSNL Colony, …`) as its best/first result, and Plus-Code results don't always carry a
`postal_code` component the way a named street address does. If you only read `results[0]`,
you can end up with no pincode even for a perfectly real point inside a serviceable area — which
then correctly (if confusingly) triggers `PINCODE_REQUIRED` below. Prefer a full address search
over tap-to-pin where possible; if you do support tap-to-pin, consider scanning a couple of the
reverse-geocode results for one with a `postal_code` component instead of trusting only the
first.

### New error codes

```json
// 422, when a geofence whitelist is active and one/both pincodes are missing
{ "success": false, "message": "A precise pickup and drop location (with a resolvable pincode) is required.", "errors": { "code": "PINCODE_REQUIRED" } }

// 422, when a geofence whitelist is active and one/both pincodes aren't on it
{ "success": false, "message": "We do not currently service the pickup pincode.", "errors": { "code": "PINCODE_NOT_SERVICEABLE" } }
```
Show `message` as-is — it already says which end failed. No popup/redirect needed like the KYC
gate; this is just a normal validation error (toast/snackbar), since there's no "go verify
something" action for the user to take. **Don't** let a generic "pickup/drop must be in the same
city" fallback message swallow this one — check `errors.code` first and only fall back to the
city-mismatch guess when it's neither of the two codes above.

---

## 5. Service charge — nothing to build

The admin-configurable platform fee used to be a flat percentage per truck-size bucket; it's now
one tiered rule (≤₹10,000 → 7%, above → 5%), admin-editable. This is entirely server-side — the
pricing breakdown's `platformFee` field (in `POST /api/bookings/quote` and the booking object
itself) is the same field, same shape, just computed with the new rule. **No app changes needed**
unless you want to display the new threshold/rates somewhere informational — if so, they aren't
exposed via any client-facing config endpoint today; ask before building anything here.

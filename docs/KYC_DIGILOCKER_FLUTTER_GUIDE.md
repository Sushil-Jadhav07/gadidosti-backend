# KYC Verification (DigiLocker + manual fallbacks) — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. Written without access to the current `SSK_Cargo` source (same
situation as the Firebase Phone Auth guide), so there are no file/line references here — only the
backend contract and how the two web apps (`gadidosti-client`, `gadidosti-broker-driver`) already
implement the same flow, as parity notes for what the Flutter app should replicate.

## The idea in one paragraph

KYC has two layers. **DigiLocker** is the primary path — one consent session (a government
document-sharing service) returns Aadhaar + PAN for everyone, plus Driving License for drivers,
with zero typing or photographing. Whatever DigiLocker can't supply (the user doesn't have that
document linked there) falls back to **manual per-document verification** — enter the number,
call a dedicated endpoint, done. For **driver and broker** accounts, there's a separate, final
**submit** call (`POST /api/kyc/driver` or `/api/kyc/broker`) that decides whether `kyc_status`
becomes `verified` immediately or `submitted` for manual review — see "Auto-verify" below for
exactly when each happens. For **client** accounts there is no submit call at all — the backend
auto-finalizes the instant the required checks pass.

## Who needs what — and the Aadhaar+PAN **or** GST choice

**Driver always needs all three** — Aadhaar + PAN + Driving License. No GST concept for an
individual driver; don't show a GST field for this role at all.

**Broker and client get a choice — either path is enough, not both:**
- **Aadhaar + PAN** together (via DigiLocker, or the manual fallbacks in section 2), **or**
- **GST** alone (`POST /api/kyc/verify/gst`)

Present this as two tabs/screens the user picks between — exactly what both web apps
(`gadidosti-client`'s `Verification.jsx`, `gadidosti-broker-driver`'s `Onboarding.jsx`) do: a
segmented "Aadhaar + PAN" / "GST" toggle, only one side's fields shown at a time. Don't force
someone who picked GST to also fill in Aadhaar/PAN, and vice versa — the backend's validation
(see section 5) doesn't require it either.

| Role | Required | Final step |
|---|---|---|
| **driver** | Aadhaar + PAN + Driving License (+ vehicle reg/insurance numbers, no verification call for those) | `POST /api/kyc/driver` |
| **broker** | (Aadhaar + PAN) **or** GST (+ bank account, business registration numbers always, no verification call for those) | `POST /api/kyc/broker` |
| **client** | (Aadhaar + PAN) **or** GST | None — auto-finalizes the moment either path verifies |

## Auto-verify — when a submission skips admin review entirely

`isKycSatisfied` (backend) decides this, and it's exactly the table above: driver needs all
three `verified`; broker/client need (Aadhaar **and** PAN) `verified`, **or** GST `verified`
alone. The moment that's true:
- **driver/broker**: the next `POST /api/kyc/driver`/`/broker` call returns
  `kyc_status: "verified"` immediately instead of `"submitted"` — no admin wait, no 24-48 hour
  review.
- **client**: happens automatically server-side right after whichever verify-* call completed
  the satisfied path — nothing for the app to trigger, just poll `GET /api/kyc/status` (section 3)
  to see it flip to `verified`.

This only works if every check in the chosen path actually goes through a real verify call —
**don't build a path where a field is just typed and stored with no verify-* call behind it**
(that was a real bug fixed on the web apps: broker's GST number used to be a plain text field
with no "Verify GST" button, and driver/broker's Aadhaar fallback used to be "type a number,
upload a photo, wait 24-48 hours for a human" instead of the OTP flow in section 2 — both meant
auto-verify was unreachable in practice even when everything else was fine).

## 1. DigiLocker — the primary path for Aadhaar/PAN/(Driving License)

```
POST /api/kyc/verify/digilocker/start
Auth: Bearer <access_token>
Body: { "redirect_url": "https://..." }
```
Response:
```json
{ "success": true, "data": {
  "url": "<DigiLocker consent URL — open this>",
  "verificationId": "dg_<userId>_<timestamp>",
  "documents": ["aadhaar", "pan"]            // or + "drivingLicense" for drivers
} }
```

**`redirect_url` is validated server-side as `https://` only** — a bare custom URI scheme like
`ssklogistics://callback` is rejected with a 422 before DigiLocker is ever contacted. This is the
one thing in this whole guide that actually changes how you build the mobile flow:

- Open the returned `url` in an in-app browser (Android: Custom Tabs; iOS:
  `SFSafariViewController`/`ASWebAuthenticationSession`), not an external browser tab, so the user
  comes straight back into the app.
- `redirect_url` needs to be a real **Android App Link / iOS Universal Link** — an `https://` URL
  on a domain you control, configured (via `assetlinks.json` / `apple-app-site-association`) to
  open `SSK_Cargo` directly instead of a browser page. This is a one-time setup separate from this
  API; confirm with whoever owns the domain/hosting whether those association files already exist.
- DigiLocker redirects the user back to `redirect_url` with `?verification_id=...` appended once
  they finish (or abandon) the consent flow there — catch that in your Universal Link handler and
  extract `verification_id` from it.

```
GET /api/kyc/verify/digilocker/status?verification_id=<id>
Auth: Bearer <access_token>
```
Response:
```json
{ "success": true, "data": {
  "status": "pending" | "failed" | "done",
  "message": "...",            // set on failed/pending
  "documents": {
    "aadhaar": { "status": "verified" | "missing", "details": { ... } },
    "pan": { "status": "verified" | "missing", "details": { ... } }
  }
} }
```
- `pending` — user hasn't finished in DigiLocker yet (or the provider is still processing). Poll
  again after a short delay — the web apps retry 4 times, 3 seconds apart, then stop and show a
  manual "Check status" button rather than polling forever.
- `failed` — session expired or consent denied. Show `message`, let the user restart from step 1.
- `done` — each requested document is either `verified` (stored server-side already, nothing more
  to do for it) or `missing` (not in the user's DigiLocker at all) — missing documents need the
  manual fallback below.
- A 403 here means the `verification_id` doesn't belong to the calling user (each one is prefixed
  with the starting user's id server-side) — shouldn't happen in practice unless it's been tampered
  with or reused across accounts.

## 2. Manual fallbacks — only for whatever DigiLocker came back `missing` on

**PAN** (driver, broker, client):
```
POST /api/kyc/verify/pan
Body: { "pan": "ABCDE1234F", "name": "Rakesh Kumar" }   // name optional
```

**GST** (broker, client — not driver; this is the alternative to Aadhaar+PAN, not an extra
requirement on top of it):
```
POST /api/kyc/verify/gst
Body: { "gstin": "27ABCDE1234F1Z5" }
```

**Driving License** (driver only):
```
POST /api/kyc/verify/driving-license
Body: { "dl_number": "MH1220190012345", "dob": "1994-08-05" }
```

**Aadhaar** (driver, broker, client) — two-step OTP flow instead of a single call, since Aadhaar
has no simple number+name lookup:
```
POST /api/kyc/verify/aadhaar/send-otp
Body: { "aadhaar_number": "234567890123" }
→ { "data": { "refId": "..." } }

POST /api/kyc/verify/aadhaar/verify-otp
Body: { "ref_id": "<refId from above>", "otp": "123456" }
```

Every one of these returns `{ "data": { "status": "verified" | "failed", ... } }`. None of them
require `redirect_url` or any browser hand-off — they're plain JSON calls, straightforward for
Flutter.

## 3. Checking overall status

```
GET /api/kyc/status
Auth: Bearer <access_token>
```
Returns `{ "data": { "kyc_status": "pending" | "submitted" | "verified" | "rejected",
"submission": { ... } } }` — `submission.verification_results` holds every check done so far
(whichever mix of DigiLocker and manual), keyed the same way regardless of which path verified
each document. Call this on screen load to prefill/resume (same pattern as both web apps) and
again after DigiLocker returns or any manual check succeeds, to pick up the latest state.

## 4. Uploading a document photo (optional, driver/broker only)

```
POST /api/kyc/documents/upload   (multipart/form-data)
Fields: file=<binary>, document_key=<one of the keys below>
```
- **driver**: `license_photo_url`, `aadhaar_photo_url`
- **broker**: `pan_photo_url`, `aadhaar_photo_url`

Returns `{ "data": { "document": { "url": "https://.../api/kyc/documents/file/<id>" } } }` — the
URL to pass into the final submit call's matching key, below. A wrong `document_key` for your role
returns 422. This step is optional — clients never call it at all (no submit step to attach it to).

## 5. Final submit — driver/broker only, clients never call this

Clients are done the moment all three verify-* calls above succeed — nothing else to call.
Drivers and brokers still need one more call to actually move `kyc_status` from `pending`/
`rejected` to `submitted` for manual review:

```
POST /api/kyc/driver
Body: { "documents": {
  "license_number": "MH-2020123456789",
  "license_photo_url": "https://.../api/kyc/documents/file/<id>",   // optional
  "aadhaar_number": "XXXX-XXXX-1234",
  "aadhaar_photo_url": "https://.../api/kyc/documents/file/<id>",   // optional
  "vehicle_registration_number": "MH-12-CD-5678",
  "vehicle_insurance_number": "INS-2024-567890"
} }
```
```
POST /api/kyc/broker
Body: { "documents": {
  "pan_number": "...", "aadhaar_number": "...",   // required together UNLESS gst_number is given
  "gst_number": "...",                            // required UNLESS pan_number + aadhaar_number are both given
  "bank_account_number": "...", "business_registration_number": "...",   // always required, either path
  "pan_photo_url": "...", "aadhaar_photo_url": "..."   // both optional, only relevant on the identity path
} }
```
Broker's validation enforces the same either/or as everything else in this guide: it accepts the
submission if `(pan_number && aadhaar_number)` **or** `gst_number` is present — each side counts
as satisfied if it was typed here, **or** already verified via a verify-* call (so DigiLocker-only
users never have to re-type a number they never typed in the first place). 422 if neither side is
satisfied. A broker on the GST tab should simply never populate `pan_number`/`aadhaar_number` in
this call at all — leaving them out is correct, not an oversight to work around.

These numbers are typed/confirmed by the user, independent of whether DigiLocker or a manual
check already verified the same document — the verify-* calls are evidence for the reviewer, not
a replacement for actually submitting the application. Resubmitting (e.g. after a rejection)
overwrites the previous submission and clears the rejection reason. 422 on this call means a
required key is missing; 403 means the account's role doesn't match the endpoint (driver-only /
broker-only).

## What to build in `SSK_Cargo`

1. On the KYC screen's load, call `GET /api/kyc/status` to resume wherever the user left off.
2. **Driver**: no tabs, single screen — Aadhaar + PAN via DigiLocker, Driving License always
   manual (section 2). **Broker/client**: a segmented "Aadhaar + PAN" / "GST" toggle at the top;
   only the active tab's fields render.
3. "Aadhaar + PAN" tab/screen: "Verify with DigiLocker" button → section 1, with the Universal
   Link / Custom Tabs setup flagged to whoever owns app signing/domain config early, since it's
   not just an API integration detail. For any document that comes back `missing`, show that
   document's manual fallback — **Aadhaar's fallback is the OTP flow in section 2, not a
   photo-upload-for-review form**; that distinction matters because only the OTP path can
   actually reach auto-verify (see "Auto-verify" above).
4. "GST" tab (broker/client): just the GSTIN field + a real "Verify GST" button calling
   `POST /api/kyc/verify/gst` — not a plain text field that only gets stored and never verified.
5. (driver/broker only) A photo upload step per required document (section 4, optional), then
   the final submit call (section 5) once the chosen path's required numbers are filled in.
6. (client only) Nothing to submit — just keep polling `GET /api/kyc/status` until
   `kyc_status: "verified"`, same as the web client app does.
7. Map error cases per endpoint to readable messages — a 503 from any verify-* call means the
   underlying provider (Cashfree, or whichever replaces it) is unavailable/misconfigured, not a
   bad document; show "verification temporarily unavailable, try again shortly" rather than
   blaming the user's input.
  
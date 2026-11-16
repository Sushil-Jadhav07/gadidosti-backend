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
call a dedicated endpoint, done. Everything above is just *assistive*: it stores a result a
reviewer can see, nothing auto-approves on its own. For **driver and broker** accounts, there's a
separate, final **submit** call (`POST /api/kyc/driver` or `/api/kyc/broker`) that actually sets
`kyc_status` to `submitted` for manual review — the verify-* calls alone don't do this. For
**client** accounts there is no submit call at all — once all three of their required checks
(Aadhaar, PAN, GST) come back verified, the backend auto-finalizes their KYC by itself.

## Who needs what

| Role | Documents required | Final step |
|---|---|---|
| **driver** | Aadhaar, PAN, Driving License (+ vehicle reg/insurance numbers, no verification call for those) | `POST /api/kyc/driver` |
| **broker** | Aadhaar, PAN (+ GST, bank account, business registration numbers, no verification call for those) | `POST /api/kyc/broker` |
| **client** | Aadhaar, PAN, GST | None — auto-finalizes once all three verify as `verified` |

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

**GST** (broker, client — not driver):
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
  "pan_number": "...", "aadhaar_number": "...", "gst_number": "...",
  "bank_account_number": "...", "business_registration_number": "...",
  "pan_photo_url": "...", "aadhaar_photo_url": "..."   // both optional
} }
```
These numbers are typed/confirmed by the user, independent of whether DigiLocker or a manual
check already verified the same document — the verify-* calls are evidence for the reviewer, not
a replacement for actually submitting the application. Resubmitting (e.g. after a rejection)
overwrites the previous submission and clears the rejection reason. 422 on this call means a
required key is missing; 403 means the account's role doesn't match the endpoint (driver-only /
broker-only).

## What to build in `SSK_Cargo`

1. On the KYC screen's load, call `GET /api/kyc/status` to resume wherever the user left off.
2. A "Verify with DigiLocker" button → step 1 above, with the Universal Link / Custom Tabs setup
   this needs flagged to whoever owns app signing/domain config early, since it's not just an API
   integration detail.
3. For any document that comes back `missing`, show that document's manual fallback form (step 2).
4. (driver/broker only) A photo upload step per required document (step 4), then the final submit
   call (step 5) once all required numbers are filled in.
5. (client only) Nothing to submit — just keep polling `GET /api/kyc/status` until
   `kyc_status: "verified"`, same as the web client app does.
6. Map error cases per endpoint to readable messages — a 503 from any verify-* call means the
   underlying provider (Cashfree, or whichever replaces it) is unavailable/misconfigured, not a
   bad document; show "verification temporarily unavailable, try again shortly" rather than
   blaming the user's input.

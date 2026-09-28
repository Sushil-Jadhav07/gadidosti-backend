# Cashfree Automated KYC — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. Checked against the actual `SSK_Cargo/lib` code. The good news:
this app already has a full, working, manually-reviewed KYC wizard for both roles — the new work
is adding a synchronous "verify now" step to it, not building KYC from scratch. The bad news:
zero job-acceptance gating exists today, `kyc_status` isn't part of the user model, and there's
no OTP UI anywhere in the app to reuse for the new Aadhaar step.

## UPDATE — verification now goes through DigiLocker (one sign-in for every document)

Cashfree hasn't enabled *Offline Aadhaar* (the OTP flow described under "Four new endpoints"
below) on this account — `send-otp` fails with "Offline Aadhaar Verification is not enabled for
this account". **Don't build the Aadhaar OTP screen, and you don't need a screen per document.**
The web app now does all of it with a single DigiLocker sign-in, which *is* enabled: a driver's
session covers Aadhaar + PAN + Driving License, a broker's covers Aadhaar + PAN. The per-number
PAN / Driving License endpoints below remain, but only as the fallback for a document the user
doesn't have in DigiLocker. It's a redirect flow:

1. `POST /api/kyc/verify/digilocker/start` — body `{ "redirect_url": "https://…" }` (must be
   https). Returns `{ url, verificationId, documents }`. Open `url` (link is valid ~10 minutes).
2. The user signs in to DigiLocker with their Aadhaar / Aadhaar-linked mobile and allows access.
   DigiLocker then sends them to `redirect_url` with `verification_id` appended.
3. `GET /api/kyc/verify/digilocker/status?verification_id=…` returns `data.status`:
   - `"pending"` — they haven't finished yet; poll every few seconds (nothing is stored).
   - `"failed"` — session expired or access denied (`data.message`); start again.
   - `"done"` — `data.documents.{aadhaar,pan,drivingLicense}`, each `status: "verified"` or
     `"missing"`. A **missing** one isn't in the user's DigiLocker: show the number-entry fallback
     for just that document (PAN → `/verify/pan`, licence → `/verify/driving-license`); Aadhaar has
     no fallback, so it goes to manual review.

Each `verified` document is stored under `verification_results` (`aadhaar` / `pan` /
`drivingLicense`) exactly where the manual checks put theirs, so the auto-approve on
`POST /api/kyc/driver|broker` works unchanged. `POST /api/kyc/driver|broker` also no longer
requires `aadhaar_number` / `pan_number` / `license_number` for a document that's already
verified — a user who verified everything through DigiLocker submits without typing any of them.
A `verification_id` only works for the user who started it (another user's id returns 403).

For a mobile app, `redirect_url` has to be something the app can catch on return: an https
universal/app link that opens the app, or open `url` in a WebView and watch for navigation to
`redirect_url`. Keep whatever the user typed in memory across the trip — the web app stashes it in
`sessionStorage` because a redirect reloads the page.

## What changed on the backend

### 1. Four new endpoints — PAN, Driving License, and 2-step Aadhaar OTP

All under `/api/kyc/verify/*`, `authenticate`-gated (driver or broker), callable any time before
the final KYC submit — not gated behind having submitted anything yet.

**`POST /api/kyc/verify/pan`**
```json
// request
{ "pan": "ABCDE1234F", "name": "Optional Registered Name" }
// response (data)
{
  "status": "verified" | "failed",
  "details": { "pan": "ABCDE1234F", "registeredName": "...", "nameMatch": "...", "nameMatchScore": null, "message": "..." },
  "raw": { /* Cashfree's raw response, for debugging only */ }
}
```

**`POST /api/kyc/verify/driving-license`**
```json
// request
{ "dl_number": "MH1220190012345", "dob": "1994-08-05" }
// response (data)
{
  "status": "verified" | "failed",
  "details": { "dlNumber": "...", "dob": "...", "holderName": "...", "status": "..." },
  "raw": { ... }
}
```

**`POST /api/kyc/verify/aadhaar/send-otp`**
```json
// request
{ "aadhaar_number": "234567890123" }   // 12 digits, no dashes
// response (data)
{ "refId": "86954784", "status": "otp_sent" }
```
Sends an SMS OTP to the mobile number linked to that Aadhaar. `refId` must be passed to the next
call. **Cashfree rate-limits repeat requests for the same Aadhaar** — the backend caches the
`refId` from the last successful send and transparently reuses it on a rate-limited retry (3-minute
window), so most of the time this just keeps working. If there's truly no cached `refId` to fall
back to, it returns a 503 with a clear message like *"An OTP was already sent recently — please
wait a few minutes before requesting a new one."* — see the error-handling section below.

**`POST /api/kyc/verify/aadhaar/verify-otp`**
```json
// request
{ "ref_id": "86954784", "otp": "793766" }
// response (data)
{
  "status": "verified" | "failed",
  "details": { "name": "...", "dob": "...", "gender": "...", "address": "...", "message": "..." },
  "raw": { ... }
}
```
`success: true` with `data.status: "failed"` and `details.message: "OTP entered is invalid"` is
the normal, expected shape for a wrong/expired OTP — that's not an exception, don't treat it as
one. Check `data.status`, not the HTTP-level `success` flag, to know whether it actually passed.

Every result from these 4 endpoints (except send-otp) is persisted server-side into
`kyc_submissions.verification_results` under key `pan` / `drivingLicense` / `aadhaar` — this
happens automatically, the app doesn't need to do anything extra to "save" a result. Calling
`GET /api/kyc/status` returns this under `data.submission.verification_results`, so a screen that
reopens mid-flow can pre-fill already-passed checks instead of re-asking.

### 2. `POST /api/kyc/driver` / `POST /api/kyc/broker` now auto-verify

Same endpoints, same request shape as before (`{ "documents": {...} }`) — but the response now
does more:

```json
{
  "success": true,
  "message": "KYC verified automatically",     // or "KYC documents submitted for review"
  "data": {
    "submission": { "...": "...", "verification_results": {...}, "auto_verified": true },
    "kyc_status": "verified"                    // or "submitted"
  }
}
```

The moment PAN + Aadhaar (+ Driving License, for drivers) all show `status: "verified"` in
`verification_results` at submit time, `kyc_status` flips straight to `"verified"` — **no admin
or broker review needed at all.** If any of those checks failed, was skipped, or errored, it falls
back to the old `"submitted"` status (the existing manual-review queue admins/brokers already use
— that flow is unchanged and still works exactly as before, it's just no longer the default path).

`kyc_status` values are unchanged: `"pending" | "submitted" | "verified" | "rejected"`. Nothing
new was added there — `auto_verified` is a separate boolean on the submission, not a new status.

### 3. Driver KYC now also collects PAN + date of birth

Needed for the DL check (Cashfree matches DL number against DOB) and the PAN check. Both are
**optional** at the validation layer (so nothing breaks for an existing submission that lacks
them), but functionally required if you want a driver to ever auto-verify:

- `documents.pan_number` — must match `^[A-Z]{5}[0-9]{4}[A-Z]$` if present (same regex the broker
  form already validates against).
- `documents.date_of_birth` — ISO date (`YYYY-MM-DD`) if present.
- `documents.pan_photo_url` — new allowed `document_key` for driver uploads (was broker-only
  before). Upload it the same way `license_photo_url`/`aadhaar_photo_url` already work.

Broker's `documents.pan_number` was already required — no change there.

### 4. Errors now say something useful

The 4 verify endpoints used to fall through to Express's default handler, which masks every
error down to a bare `"Internal server error"` in production. They now catch their own failures
and return a real, safe message with a `503`:

```json
{ "success": false, "message": "Verification service is temporarily unavailable — please try again in a few minutes." }
```

Show `message` directly to the user (via a snackbar/inline error, matching this app's existing
`_WarningCard`/red-snackbar conventions) instead of a generic "something went wrong" string — it's
now actually worth reading.

### 5. Dashboard access is no longer blocked by KYC — only job acceptance is

This is a **policy change on the web apps**, not a backend contract change, but it matters for
how you build the Flutter side too: a driver/broker with `kyc_status` = `pending`, `submitted`, or
`rejected` can log in and use the dashboard normally. KYC only gates the moment they try to
**accept a job**. Keep reading — this actually lines up with where Flutter already is today, see
below.

## What already exists in this app (reuse, don't rebuild)

Both are real, functioning, already-wired-to-the-backend 4-step wizards:
- `lib/features/driver/presentation/screens/driver_kyc_registration_screen.dart`
- `lib/features/broker/presentation/screens/broker_kyc_registration_screen.dart`

Steps: `details` → `documents` → `review` → `submitted`. The `submitted` step already polls
`getKycStatus`/`getKycStatusForUser` every 10s and renders Pending/Verified/Rejected states.

Already in `lib/core/network/api_client.dart` and safe to keep using as-is:
- `submitDriverKyc(accessToken, documents)` / `submitBrokerKyc(...)` → `POST /api/kyc/driver` / `/broker`
- `getKycStatus(accessToken)` → `GET /api/kyc/status`
- `getKycStatusForUser(accessToken, userId)` → `GET /api/kyc/{userId}` (used by the broker screen
  to check a driver's KYC — unaffected by anything here)
- The multipart upload pattern (`FormData.fromMap` + `MultipartFile.fromFileSync`, `document_key`
  field) both screens already use inline for `/api/kyc/documents/upload` — same pattern, no change
  needed, just add a `pan_photo_url` upload slot to the driver screen's `documents` step.

UI conventions to match (both KYC screens already follow these — copy them, don't invent new
ones): the `_PremiumTextField` widget with live valid/invalid trailing icon; the bottom
`FilledButton` that swaps to a white `CircularProgressIndicator` (`strokeWidth: 2.5`) and disables
itself while submitting; `_WarningCard` (amber, `0xFFFFF7E8`/`0xFFF2D9A8`) for form-level notices;
red/green `ScaffoldMessenger` snackbars for errors/success. Colors are hardcoded per-screen rather
than pulled from `Theme.of(context)` throughout this app — match that, don't refactor it.

## What's missing — the actual work

### 1. `kyc_status` isn't on the user/session model at all

`SskUser` (`lib/features/auth/data/auth_models.dart`) has no `kycStatus` field — every screen
that needs it fetches `/api/kyc/status` on demand and keeps its own local `setState`. That's fine
for a status-display screen, but a job-acceptance gate needs somewhere central to read it from
without every screen re-fetching.

Recommended: add a small Riverpod provider (e.g. `kycStatusProvider`) that fetches once after
login and is refreshed after any successful verify/submit call — not a change to `SskUser` itself
(keep that model matching exactly what `/api/auth/login` actually returns, which still doesn't
include KYC). The two profile screens' existing `_loadKycStatus`/`_syncKycStateForSession` pattern
(with the `WidgetsBinding.instance.addPostFrameCallback` guard against setState-during-build) is
the right model to generalize into this provider.

### 2. No OTP/PIN-entry UI exists anywhere in this app

A grep for `otp` across all of `lib/` returns nothing — login is email+password or Google only.
The Aadhaar step needs a 6-digit OTP entry UI built from scratch (a package like `pin_code_fields`,
or a manual row of boxed `TextField`s — either is fine, there's no existing convention to match
here since none exists). Model its loading/error/button states on the KYC screens' existing bottom
bar for visual consistency with the rest of the wizard.

**Add a 30-second cooldown on the Send/Resend OTP button.** Cashfree can issue a fresh OTP+refId
on every call; tapping Resend before the previous SMS even arrives risks the phone showing a code
tied to a different `refId` than what the screen ends up holding, and Cashfree then rejects a
correct-looking OTP as invalid. A simple disable-for-30s timer on that button (same idea as the
countdown on a typical "resend code" flow) avoids this — the backend's own web onboarding wizard
just added the identical cooldown for the same reason.

### 3. Nothing gates job acceptance on KYC — needs to be added

This is genuinely new, not a Flutter-vs-web gap to fix — the **web app also just added this same
gate** (previously it didn't exist there either). `app_router.dart` has no `redirect:` callback at
all, so there's no route-level mechanism to hook into. The accept-handlers themselves have zero
KYC awareness today:
- `lib/features/driver/presentation/screens/driver_rider_screen.dart`
- `lib/features/driver/presentation/screens/driver_order_accepted_screen.dart`
- `lib/features/broker/presentation/screens/broker_driver_requests_screen.dart`
- `lib/features/broker/presentation/screens/broker_request_detail_screen.dart`

Add an inline check in each of these (using the `kycStatusProvider` from #1) before the actual
accept action fires: if `kyc_status != "verified"`, show a blocking card/dialog instead — *"Complete
your KYC to accept this job"* with a button pushing to `/driver/kyc-registration` or
`/broker/kyc-registration` — mirroring the web app's `KycGate` component's copy for the 3 states:

| `kyc_status` | Title | Body |
|---|---|---|
| `pending` | Complete Your KYC First | You need to verify your PAN, Aadhaar, and license details before you can accept jobs on the platform. Most checks clear instantly. |
| `submitted` | KYC Under Review | Your documents are being reviewed by our team. You'll be able to accept jobs once verified — usually within 24-48 hours. |
| `rejected` | KYC Rejected | Your last submission was rejected. Please review the reason and resubmit your documents to continue. |

**Do not** add any gating to the dashboard/home tab, profile, or any other non-accept screen —
that's the one thing this app is already doing correctly (no gating anywhere), and it should stay
that way everywhere except these 4 accept-flows, matching the web policy exactly.

### 4. Wire the 4 new verify endpoints + extend the driver `details` step

- Add `verifyPan`, `verifyDrivingLicense`, `sendAadhaarOtp`, `verifyAadhaarOtp` to
  `api_client.dart`, same shape as the existing `submitDriverKyc` method (POST + `accessToken` +
  body, unwrapped through the existing `_request()`/`ApiException` handling).
- Driver screen's `details` step: add PAN Number + Date of Birth fields (`_PremiumTextField`,
  same regex/format validation style already used for the other fields), plus small "Verify PAN" /
  "Verify License" buttons next to each that call the new endpoints and show a
  verified/failed/checking badge — the broker screen already has a PAN field, just needs the same
  "Verify PAN" button added next to it.
- Add the new Aadhaar OTP UI (send → wait → enter code → verify) as part of (or right after) the
  existing Aadhaar field, using the badge/cooldown pattern from #2.
- `documents` step (driver only): add the `pan_photo_url` upload slot alongside the existing two.
- Submit handler: after `submitDriverKyc`/`submitBrokerKyc` returns, check `data.kyc_status`. If
  `"verified"`, skip straight to a success state (something like *"You're verified — full access
  unlocked"*) instead of the existing `submitted`-step polling UI; if `"submitted"`, the existing
  polling/status-display step needs no changes at all.

## Not required, but worth doing while you're in this code

- Both KYC screens duplicate the multipart-upload call inline instead of using
  `uploadBrokerKycDocument` in `api_client.dart` (which, despite its name, is already generic
  enough for both roles). Not broken, just worth consolidating if you're touching this file anyway.
- `getBrokerKycStatus` in `api_client.dart` is an exact duplicate of `getKycStatus` (same endpoint)
  — harmless, but no reason to keep both once you're adding new methods nearby.

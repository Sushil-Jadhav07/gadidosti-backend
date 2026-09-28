# DigiLocker KYC Verification — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. This is the current, complete description of driver/broker KYC
verification. It replaces the Aadhaar-OTP material in `CASHFREE_KYC_FLUTTER_GUIDE.md` — **do not
build an OTP screen**: Cashfree hasn't enabled that product on our account (`send-otp` fails with
"Offline Aadhaar Verification is not enabled for this account"). The rest of that older guide (what
already exists in `SSK_Cargo/lib`, UI conventions, the job-acceptance gate) is still accurate.

## The idea in one paragraph

The user signs in to **DigiLocker** (the government's document service) once, allows access, and
we get their Aadhaar, PAN and — for drivers — Driving License straight from the government
records. Nothing to type, nothing to photograph. Every document that comes back is stored as
verified; when all the required ones are verified, the KYC submission **auto-approves** with no
admin involved. A document the user doesn't have in DigiLocker falls back to "enter the number and
we check it" (PAN, licence) or to manual review (Aadhaar).

| Role | Documents in the DigiLocker session |
|---|---|
| driver | Aadhaar + PAN + Driving License |
| broker | Aadhaar + PAN |

## The flow

```
[Verify with DigiLocker] ──POST /verify/digilocker/start──▶ { url, verificationId }
        │
        ▼  open `url` (browser / WebView / app link)
  user signs in to DigiLocker, allows access
        │
        ▼  DigiLocker sends them to redirect_url?verification_id=…
   back in the app ──GET /verify/digilocker/status──▶ pending | failed | done
        │
        ▼  done → per-document verified / missing
  missing PAN / licence → number-entry fallback   ·   then POST /kyc/driver|broker to finish
```

## Endpoints

All require a logged-in **driver or broker** (`Authorization: Bearer <access_token>`). Base URL:
`https://apigadidosti.asynk.in`. Every response is `{ success, message, data }`.

### 1. Start — `POST /api/kyc/verify/digilocker/start`

```json
// request
{ "redirect_url": "https://apigadidosti.asynk.in/onboarding" }
// response data
{
  "url": "https://…digilocker consent link…",
  "verificationId": "dg_ca214ca76c57466180f5778542d61e79_1790582752690",
  "documents": ["aadhaar", "pan", "drivingLicense"]
}
```

- `redirect_url` **must be https**, otherwise `422` with *"redirect_url must be a valid https URL"*.
- The link is valid about **10 minutes**. Keep `verificationId` — you need it to read the result.
- `documents` is what this session covers (broker: `["aadhaar","pan"]`).

### 2. Status — `GET /api/kyc/verify/digilocker/status?verification_id=<verificationId>`

`data.status` is one of:

| `status` | Meaning | What to do |
|---|---|---|
| `"pending"` | User hasn't finished in DigiLocker yet, or Cashfree is still processing | Poll every ~3 s (the web app stops after 4 tries and shows a "Check status" button). Nothing is stored. |
| `"failed"` | Session expired or the user denied access — `data.message` explains | Show the message, let them start again |
| `"done"` | Resolved | Read `data.documents` |

```json
// status: "done"
{
  "status": "done",
  "message": null,
  "documents": {
    "aadhaar":        { "status": "verified", "details": { "name": "…", "dob": "…", "gender": "…", "number": "…", "message": null } },
    "pan":            { "status": "verified", "details": { "name": "…", "dob": "…", "gender": "…", "number": "…", "message": null } },
    "drivingLicense": { "status": "missing",  "details": { "message": "Not found in your DigiLocker" } }
  }
}
```

- `verified` — fetched from DigiLocker after the user authenticated there. **Already saved on the
  server**; you don't need to send it back.
- `missing` — not in the user's DigiLocker (or not allowed). Show the number-entry fallback for
  **that document only** (below). Deliberately not saved, so a later fallback check can still fill it.
- A `verification_id` only works for the user who started it — anyone else gets `403`
  *"This DigiLocker verification does not belong to you"*.

### 3. Fallback checks — only for a `missing` document

**PAN** — `POST /api/kyc/verify/pan`
```json
// request                                   // response data
{ "pan": "ABCDE1234F", "name": "Harsh N" }   { "status": "verified" | "failed",
                                               "details": { "pan": "…", "registeredName": "…", "message": "…" } }
```

**Driving license** — `POST /api/kyc/verify/driving-license`
```json
{ "dl_number": "KA0120198900984", "dob": "1994-08-05" }   // dob = YYYY-MM-DD
// → { "status": "verified" | "failed", "details": { "dlNumber": "…", "holderName": "…", "message": "…" } }
```

`success: true` with `data.status: "failed"` is a **normal outcome** ("no match"), not an error —
check `data.status`, and show `data.details.message` if present. Both results are saved
automatically.

**Aadhaar has no fallback** (the OTP endpoints exist but won't work on this account). If Aadhaar
comes back `missing`, let the user type the Aadhaar number and submit — it goes to manual review.

### 4. Finish — `POST /api/kyc/driver` or `POST /api/kyc/broker`

```json
{ "documents": { "vehicle_registration_number": "MH12AB1234", "vehicle_insurance_number": "…" } }
```

```json
// response data
{ "submission": { …, "auto_verified": true }, "kyc_status": "verified" }   // or "submitted"
```

- `kyc_status: "verified"` — every required document was verified, so the account is approved
  **immediately**. Show a success state and let them into the job screens.
- `kyc_status: "submitted"` — something wasn't verified; it's queued for manual review
  (usually 24–48 h). Show "under review".
- **Typed numbers are only required for documents that aren't verified yet.** A user who verified
  everything through DigiLocker can submit with none of `aadhaar_number` / `pan_number` /
  `license_number`. If a document is unverified and its number is missing you get `422`, e.g.
  *"Driving license number is required"*.
- Optional fields: driver — `vehicle_registration_number`, `vehicle_insurance_number`; broker —
  `gst_number`, `bank_account_number`, `business_registration_number`. Send them if the user filled
  them; they aren't verified by anything.
- Document photos (`POST /api/kyc/documents/upload`, multipart, `document_key` =
  `aadhaar_photo_url` / `pan_photo_url` / `license_photo_url`) are only useful for the manual-review
  fallback. The normal DigiLocker path doesn't need any.

### 5. Reading state later — `GET /api/kyc/status`

`data.kyc_status` is `"pending" | "submitted" | "verified" | "rejected"` (unchanged).
`data.submission.verification_results` holds each document's result under `aadhaar` / `pan` /
`drivingLicense` (`{ status: "verified" | "failed", details }`) — use it to pre-fill an already
verified row when the screen reopens instead of asking again.

## Access rules (same as the web app)

- **Dashboard access is never blocked by KYC.** A driver/broker with `pending`, `submitted` or
  `rejected` KYC can log in and use the home tab, profile, etc.
- **Accepting a job is gated.** Until `kyc_status == "verified"`, show a "Complete your KYC"
  block instead of the accept action. Suggested copy: *pending* — "Complete Your KYC First";
  *submitted* — "KYC Under Review (usually 24–48 hours)"; *rejected* — "KYC Rejected — please
  review the reason and resubmit". Details and the four screens that need this check are in
  `CASHFREE_KYC_FLUTTER_GUIDE.md` ("Nothing gates job acceptance on KYC").

## Errors — show the real message

On failure the API returns a specific `message` — show it as-is (snackbar / inline), don't replace
it with a generic string.

- **Validation (`422`)**: the top-level `message` is just "Validation failed"; the useful text is in
  `errors[].msg`. Join them (the web app uses `"; "`) and show that.
- **Verification failures (`503`)**: either a real reason ("Please use test data…", "OTP entered is
  invalid") or, for outages / credential problems, the generic *"Verification service is
  temporarily unavailable — please try again in a few minutes."* — safe to show either.

## Mobile: getting the user back into the app

`redirect_url` must be https and is where DigiLocker sends the user afterwards, with
`?verification_id=…` appended. Two workable options:

1. **WebView** — open `url` in a WebView and watch navigation; when it reaches your `redirect_url`,
   read `verification_id` from it, close the WebView, and call the status endpoint. Simplest, and
   `verificationId` from step 1 is already in memory so you don't even need to parse it.
2. **External browser + app link** — use an https universal/app link as `redirect_url` so the OS
   reopens the app; read `verification_id` from the incoming link.

Either way, **keep whatever the user typed** (fallback numbers, vehicle details) in memory across
the trip — the web app stashes them in `sessionStorage` because a redirect reloads the page.

## Sandbox test data (test environment only)

The test environment only accepts Cashfree's fixture values — a real PAN / licence number comes
back "Please use test data in the test environment. Refer to: …". In production real numbers work.

| Check | Use | Result |
|---|---|---|
| PAN | `ABCPV1234D`, `XYZPP4321W`, `AZJPG7110R` | verified |
| PAN | `DEFPV0126D`, `TUVPP5678W` | invalid (failure path) |
| Driving license | `KA0120198900984` + DOB `1994-08-05` | verified |
| Driving license | `KA2320238908787` + DOB `1987-09-04` | invalid |

DigiLocker itself opens Cashfree's test consent page in the test environment. Source:
[Cashfree VRS sandbox test data](https://www.cashfree.com/docs/api-reference/vrs/data-to-test-integration).

## What to build in `SSK_Cargo`

The existing screens are `driver_kyc_registration_screen.dart` and
`broker_kyc_registration_screen.dart` (4-step wizards ending in a polled "submitted" step).

1. `api_client.dart`: add `startDigilocker`, `getDigilockerStatus`, `verifyPan`,
   `verifyDrivingLicense` (same shape as the existing `submitDriverKyc`).
2. Replace the details/documents steps with one verification screen: a "Verify with DigiLocker"
   button, and a status row per document (Aadhaar, PAN, and licence for drivers) showing
   verified / missing / not yet checked.
3. Show the number-entry fallback only for a `missing` PAN or licence (Aadhaar: number field →
   manual review).
4. Optional vehicle/business fields on the same screen, then **Finish** → `POST /api/kyc/…`.
   `kyc_status: "verified"` → success state; `"submitted"` → the existing polling/"under review"
   step needs no changes.
5. Add the job-acceptance gate (see the older guide) — that's the one place KYC must block.

No OTP widget is needed anywhere.

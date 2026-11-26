# KYC Auto-Finalize for Driver/Broker & Pickup/Delivery Location Fix — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. Written without access to the current `SSK_Cargo` source (same
situation as the other guides in this folder) — no file/line references, just the backend
contract and what the web apps already do with it. Covers two bug fixes since the last guide —
read both even if nothing here seems to apply, since one of them is a "silently stopped working"
bug, not a new feature.

## 1. KYC now auto-finalizes for driver/broker too, not just client

**The bug:** a real production account completed PAN, Aadhaar, and Driving License verification
through DigiLocker — every individual check came back `"status": "verified"` — but the account's
overall `kyc_status` stayed stuck at `"submitted"` indefinitely. The auto-finalize check (the
thing that flips `kyc_status` to `"verified"` the moment every required check passes, with no
extra action needed) only ever ran for `role: "client"`. Driver and broker were only ever
finalized by an explicit `POST /api/kyc/driver` or `POST /api/kyc/broker` **Submit** tap — which
is easy to skip once every check already shows a green checkmark, especially after completing
everything in one DigiLocker session with no separate "Submit" step in between.

**The fix:** auto-finalize now runs for every role, after every individual verify call —
`POST /api/kyc/verify/pan`, `POST /api/kyc/verify/gst`, `POST /api/kyc/verify/aadhaar/verify-otp`,
and `GET /api/kyc/verify/digilocker/status`. Nothing about the request/response shape of any of
these changed — this is purely server-side: `kyc_status` on the user now flips to `"verified"`
immediately once the role's required checks are satisfied, same moment you'd see each check's
`verification_results` entry turn to `"verified"`.

**What to check in `SSK_Cargo`:** if the driver/broker onboarding flow waits for an explicit
Submit action (or polls `GET /api/kyc/status` expecting it to only ever change right after that
tap) before showing "KYC verified" to the user, that assumption no longer holds — it can now
happen the instant the last required check completes, with no Submit tap at all. If there's a
"Your KYC documents are under review" banner or similar that's driven off a **cached** value (the
user object from login, not re-fetched), make sure something re-reads `GET /api/kyc/status` (or
re-logs in) after a verify completes, or that banner can keep showing a stale "pending" even
though the account is actually verified now — this was a real bug found in the web broker/driver
app's own KYC banner (it read a one-time snapshot instead of live state) and is an easy mistake
to repeat independently.

Required checks per role are unchanged: driver needs Aadhaar + PAN + Driving License all
verified; broker/client need (Aadhaar + PAN) verified together, **or** GST alone.

## 2. Pickup/delivery confirmation: push a fresh location fix first

**The bug:** `PATCH /api/trips/{id}/status` (confirming `picked_up` or `delivered`) checks the
trip's last-reported location (kept fresh by a background location stream) against the
pickup/drop point, and rejects with:
```json
{ "success": false, "message": "Your current location is not available yet — enable location sharing and try again." }
```
This fired even for a driver genuinely standing at the pickup point, when a trip had only just
started (the background stream's first fix, or the "which trip is active" check, hadn't caught
up yet) or the device's location provider was slow.

**The fix (web driver app):** right before calling the pickup-OTP confirm or delivery-arrival
confirm, request one fresh, awaited GPS fix and `PATCH` it straight onto the trip's own location
(`PATCH /api/trips/{id}/location`, same endpoint the background stream already uses) — *then*
send the status-change request. This is a client-side pattern, not a new backend endpoint; the
proximity check itself didn't change.

**What to check in `SSK_Cargo`:** if the driver app's pickup/delivery confirmation screens rely
solely on a background location stream (not an explicit fresh fix taken at the moment of
confirmation), they have the same exposure. Add the same one-shot "get current location, push it
to this trip, then confirm" step immediately before each of those two confirm actions — cheap
(one extra location read + PATCH), and removes an entire class of "it says I'm not here even
though I am" failures that are confusing for drivers to self-diagnose, since nothing about the
UI tells them the real cause is a stale/missing background fix rather than actually being out of
range.

## Nothing else to build

Both of these are "make an existing flow more reliable" fixes, not new features — if `SSK_Cargo`
doesn't have driver/broker KYC or pickup/delivery confirmation at all yet, there's nothing here to
add ahead of that work.

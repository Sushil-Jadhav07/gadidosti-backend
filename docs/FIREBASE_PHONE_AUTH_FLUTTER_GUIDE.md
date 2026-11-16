# Phone + OTP (Firebase Phone Auth) — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. Written without access to the current `SSK_Cargo` source (same
situation as `FCM_PUSH_NOTIFICATIONS_FLUTTER_GUIDE.md`), so there are no file/line references here
— only the backend contract and how the two web apps (`gadidosti-client`,
`gadidosti-broker-driver`) already implement the same flows, as parity notes for what the Flutter
app should replicate.

This covers **two** separate things that both use the same Firebase Phone Auth mechanics:
1. **Login** via phone + OTP — an optional second way in, alongside email+password/Google.
2. **Registration-time phone verification** — now **mandatory** for every new client, broker, and
   driver account (not optional, not skippable). A brand-new signup is rejected by the backend if
   it doesn't include a verified phone's Firebase ID token.

## The idea in one paragraph

Firebase's own Phone Auth SDK sends and verifies the OTP **entirely on-device**, never touching
this backend at all for that part. Once Firebase confirms the number, the app gets a Firebase ID
token. **For login**, that token is sent to a dedicated endpoint which checks it and returns a
normal session — the exact same `access_token`/`refresh_token` shape every other login method
already returns; nothing about session storage, `GET /api/auth/me`, token refresh, or logout
changes. **For registration**, that same token is sent *inside* the existing register request
(`id_token` field) — the backend verifies it matches the phone number being registered before
creating the account at all.

## What's needed in Firebase Console first (someone with console access, not app code)

- **Phone** sign-in provider must be enabled (Authentication → Sign-in method).
- For Android specifically: the app's **SHA-1 fingerprint** (`cd android && ./gradlew
  signingReport` — both debug and release variants) must be added under Project Settings → Your
  apps → the Android app. If the release build uses Google Play App Signing, the fingerprint
  needs to come from **Play Console → Setup → App integrity**, not the local keystore — those
  differ once Play re-signs the app.
- The Firebase project needs to be on the **Blaze (pay-as-you-go)** plan for *real* phone numbers
  to receive an SMS at all — the free Spark plan doesn't support Phone Auth. **"Phone numbers for
  testing"** (Authentication → Sign-in method → Phone → that section) is the workaround during
  development: add a test number there with a fixed code (e.g. `123456`) and it verifies instantly
  with no real SMS sent and no billing required — use this for all dev/QA testing before Blaze is
  confirmed active.

None of this is something the Flutter code can detect or work around — if phone auth isn't
behaving, check these three first.

## The on-device OTP flow (shared by both login and registration)

1. User enters their phone number (plain 10-digit, no country code shown in the UI — same
   convention as the rest of this app's phone fields).
2. App calls Firebase's `verifyPhoneNumber`, passing `+91` + the 10-digit number.
3. **Android gets a bonus here the web apps don't**: `verificationCompleted` can fire
   automatically via SMS auto-retrieval/instant verification, skipping manual code entry
   entirely. Handle that callback — don't assume the user will always type a code.
4. If it's not auto-verified, `codeSent` fires with a `verificationId` — show a 6-digit code
   entry screen.
5. On submit, build a credential from `verificationId` + the entered code, sign in with it, and
   get the resulting Firebase user's ID token.
6. POST that token to the backend (below) and store the returned session exactly like every
   other login method.

```dart
await FirebaseAuth.instance.verifyPhoneNumber(
  phoneNumber: '+91$phone', // phone = plain 10-digit, no country code
  verificationCompleted: (PhoneAuthCredential credential) async {
    // Android auto-retrieval / instant verification — may fire with zero user input.
    final userCredential = await FirebaseAuth.instance.signInWithCredential(credential);
    final idToken = await userCredential.user!.getIdToken();
    // -> POST to the backend, see below
  },
  verificationFailed: (FirebaseAuthException e) {
    // e.code: 'invalid-phone-number', 'too-many-requests', etc. — map to a readable message,
    // same as the web apps' firebaseOtpErrorMessage() helper.
  },
  codeSent: (String verificationId, int? resendToken) {
    // Show the 6-digit code entry screen; keep verificationId for the next step.
  },
  codeAutoRetrievalTimeout: (String verificationId) {},
);

// On the user submitting a code manually:
final credential = PhoneAuthProvider.credential(verificationId: verificationId, smsCode: code);
final userCredential = await FirebaseAuth.instance.signInWithCredential(credential);
final idToken = await userCredential.user!.getIdToken();
```

## Login endpoint — already live, no changes needed on this side

```
POST /api/auth/firebase-login
Body: { "id_token": "<Firebase ID token from the step above>" }
```

Response is the exact same `AuthResponse` shape as `/api/auth/login` and `/api/auth/google`:
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": { "id": "...", "name": "...", "phone": "...", "role": "client", ... },
    "tokens": { "access_token": "...", "refresh_token": "...", "token_type": "Bearer", "expires_in": "7d" }
  }
}
```

**Login-only** — same as the web apps' behavior, this does **not** create a new account. If no
user exists with the verified phone number, it 404s:
```json
{ "success": false, "message": "No account found with this phone number" }
```
Show that as-is, or route to your registration flow — same pattern as any other "account not
found" case elsewhere in the app.

Other error cases:
- `401` — Firebase ID token invalid/expired, or has no verified phone number on it (shouldn't
  happen in practice if the Dart-side flow above completed successfully)
- `403` — account blocked or inactive (`message` is specific, show it directly)
- `409` — driver-only single-active-session block (`"This account is already logged in on
  another device..."` — same message/behavior as every other driver login method; brokers and
  clients never hit this)

After a successful response, **check the `user.role`** matches what this part of the app expects
(client app only accepts `role: "client"`, driver/broker screens only accept their own role) —
same client-side check the web apps do; the backend itself is role-agnostic for this endpoint.

## Registration — now mandatory, already live, no backend changes needed

Every new account (client, broker, and driver — **not** admin/staff, which is created by an
admin without OTP by design) must prove phone ownership via the same on-device flow above
*before* the account is created. There is no separate "verify" endpoint for this — the resulting
Firebase ID token is just one more field (`id_token`) on the existing register call(s):

```
POST /api/auth/register
Body: { "name", "email", "phone", "password", "role", "id_token": "<Firebase ID token>" }

POST /api/auth/register/driver   (self-registration: owner-operator + their own truck, one call)
Body: { "name", "email", "phone", "password", "confirm_password",
        "registration", "category", "capacity", ..., "id_token": "<Firebase ID token>" }
```

The backend decodes `id_token`, reads its `phone_number` claim, strips the `+91`, and requires it
to **exactly match** the `phone` field in the same request — this stops someone from verifying
their own number and then registering a different one. Error responses, all via the normal
`{ "success": false, "message": "...", "data": { "code": "..." } }` shape:

| HTTP | `data.code` | Meaning | When it happens |
|---|---|---|---|
| 422 | `PHONE_VERIFICATION_REQUIRED` | `id_token` missing entirely | App tried to submit without completing OTP first — a client-side bug, not a user-facing case if the UI gates submission correctly |
| 401 | `PHONE_VERIFICATION_INVALID` | Token invalid/expired | User sat on the registration form too long after verifying (Firebase ID tokens expire); re-run the OTP flow and retry |
| 422 | `PHONE_VERIFICATION_MISMATCH` | Verified phone ≠ submitted phone | Phone field was edited after verifying — same fix as the web apps: re-verify whenever the number changes |

**Required UI behavior in `SSK_Cargo`'s registration screen(s)** — same as the two web apps:
- The phone field must be verified (OTP flow above completed, ID token obtained) before the
  "Create Account"/submit button is enabled at all.
- If the user edits the phone number *after* verifying it, immediately drop back to the
  unverified state (clear the stored ID token, require Send OTP again) — the token only proves
  ownership of the number that was verified, not whatever's currently typed.
- On submit, include the stored `id_token` alongside the rest of the form fields in the register
  call above.

## What to build in `SSK_Cargo`

1. A phone-number entry UI + 6-digit code entry step, wired to `verifyPhoneNumber` as shown
   above — reused in **both** places it's needed:
   - Login: as a tab/toggle alongside the existing password login, not a full replacement.
   - Registration: as a required step before the account form can submit (see above) — every
     new client/broker/driver signup needs this, no exceptions.
2. Handle Android's `verificationCompleted` auto-path, not just manual code entry.
3. Login: POST the resulting ID token to `POST /api/auth/firebase-login`, store the session the
   same way every other login method already does.
   Registration: include the resulting ID token as `id_token` in the existing
   `POST /api/auth/register` / `POST /api/auth/register/driver` call.
4. Map Firebase's error codes to readable messages (`invalid-phone-number`,
   `too-many-requests`, `invalid-verification-code`, `code-expired` are the common ones), and
   also handle the three `PHONE_VERIFICATION_*` backend error codes above for registration.

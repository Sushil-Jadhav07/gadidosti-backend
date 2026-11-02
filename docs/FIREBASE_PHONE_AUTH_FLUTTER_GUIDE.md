# Phone + OTP Login (Firebase Phone Auth) — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. Written without access to the current `SSK_Cargo` source (same
situation as `FCM_PUSH_NOTIFICATIONS_FLUTTER_GUIDE.md`), so there are no file/line references here
— only the backend contract and how the two web apps (`gadidosti-client`,
`gadidosti-broker-driver`) already implement the same login method, as parity notes for what the
Flutter app should replicate.

## The idea in one paragraph

Phone + OTP login now exists as a **second way in**, alongside whatever email+password /
Google Sign-In the app already has — not a replacement for them. Firebase's own Phone Auth SDK
sends and verifies the OTP **entirely on-device**, never touching this backend at all for that
part. Once Firebase confirms the number, the app gets a Firebase ID token and sends *that* to a
new backend endpoint, which checks it and returns a normal session — the exact same
`access_token`/`refresh_token` shape every other login method already returns. Nothing about
session storage, `GET /api/auth/me`, token refresh, or logout changes.

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

## The flow

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

## Backend endpoint — already live, no changes needed on this side

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

## What to build in `SSK_Cargo`

1. A phone-number entry screen + 6-digit code entry screen, wired to `verifyPhoneNumber` as
   shown above — likely as a tab/toggle alongside the existing password login, not a full
   replacement.
2. Handle Android's `verificationCompleted` auto-path, not just manual code entry.
3. POST the resulting ID token to `POST /api/auth/firebase-login`, store the session the same
   way every other login method already does.
4. Map Firebase's error codes to readable messages (`invalid-phone-number`,
   `too-many-requests`, `invalid-verification-code`, `code-expired` are the common ones).
5. Nothing to build for registration — this endpoint is login-only; a brand-new phone number
   still needs to go through whatever registration flow the app already has.

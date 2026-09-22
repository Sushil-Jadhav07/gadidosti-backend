# Session Expiry / Force-Logout Handling — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. This one is real, needed Flutter work — checked against the
actual `SSK_Cargo/lib` code, and it has the identical gap the web driver app just had fixed.

## What changed on the backend

`auth.middleware.js`'s `authenticate` (runs on every authenticated request, for every client —
web and this app alike) now also checks a `sessions_valid_after` timestamp on the user. It's
stamped to `NOW()` by:

- `POST /api/admin/users/:id/force-logout` (admin resetting anyone)
- `POST /api/vehicles/drivers/:id/force-logout` (broker resetting their own driver, or admin)

If the current access token was issued before that timestamp, the request is rejected with
`401` and `"Your session was reset — please log in again."`, regardless of the token's own
~7-day expiry. This is on top of the pre-existing, ordinary case: an access token that's simply
expired naturally also comes back `401` (`"Access token expired"`).

## The gap this app currently has

`core/network/api_client.dart`'s `_request` wrapper (~line 1629) already captures
`statusCode` onto every thrown `ApiException` — so the information is there — but nothing
anywhere in the app actually checks for `401`. I grepped the whole codebase for it and found no
match. Right now, a dead session (reset by an admin/broker, or just naturally expired) surfaces
to the driver as whatever generic error message the current screen happens to show
("Failed to load trip", "Something went wrong", etc.), and the app never logs them out — every
subsequent request keeps failing the same way, silently, with no path back to a working state
short of manually finding a logout button.

This is the exact bug just fixed on the web driver app (`gadidosti-broker-driver`), for the same
underlying reason: nothing was watching the response status.

## What to build

**1. Detect it in one place**, not per-screen. Dio supports this cleanly via an interceptor,
added to the `dioProvider` in `core/network/api_client.dart`:

```dart
dio.interceptors.add(InterceptorsWrapper(
  onError: (error, handler) {
    if (error.response?.statusCode == 401) {
      // notify whatever holds the session — see below
    }
    handler.next(error); // still let the existing per-call catch/ApiException flow run
  },
));
```

Alternatively, do the check inside `_request`'s existing `on DioException catch (error)` block
(~line 1640), since `error.response?.statusCode` is already available right there — whichever
fits the existing structure better; either way, do it in this one shared place, not in each
screen's own catch block.

**2. Clear the session and route to login.** `AuthController`
(`features/auth/presentation/controllers/auth_controller.dart`, exposed via
`authControllerProvider`) already has a `logout()` method (~line 108) that does the local
cleanup — call that, then navigate to whichever login route matches the current role (the app
already has three: `/login`, `/broker/login`, `/gps/login` — see `app_router.dart` and
`change_password_screen.dart`'s `_loginRouteForRole` for the existing role→route mapping to
reuse here).

**3. Show why.** The web fix passes the server's own message through
("Your session was reset — please log in again." / "Access token expired") and displays it on
the login screen the user lands on. Worth doing the same here — pass the message along when
navigating, and show it once (a banner or snackbar) on whichever login screen opens.

**4. Guard against firing more than once.** Several requests can fail around the same moment
(a screen's parallel initial fetches) — the web fix uses a simple boolean ref so only the first
401 triggers the logout-and-navigate; the rest are no-ops. Worth the same guard here so a screen
with multiple in-flight calls doesn't try to navigate away several times in a row.

## Separately worth knowing (not part of this fix)

There's no proactive token-refresh flow in this app either — I found no refresh-token renewal
call anywhere in `api_client.dart` (only a `refresh_token` parameter passed to the *logout*
call). That means every driver session eventually hits this same 401-then-logout path once the
access token's own ~7-day expiry arrives, force-logout or not. Building the interceptor above
fixes how that moment is handled; it doesn't prevent it from happening. A real silent-refresh
flow (catch the `401`, try `/api/auth/refresh-token` once, retry the original request, only
fall through to logout if that also fails) would be the next step up, but is more than this
particular fix calls for — flagging it in case it's wanted as a follow-up.

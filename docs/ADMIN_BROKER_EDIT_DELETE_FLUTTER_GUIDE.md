# Admin/Broker Edit & Delete — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. Short guide — this feature has almost no Flutter-side surface,
and this explains exactly why.

## What changed

Added edit/delete management UI for:

- **Admin Dashboard** (`gadidosti-admin-dashboard`, web-only): Drivers, Trucks, Clients, Brokers
  can now all be edited and deleted from the admin's own screens.
- **Broker panel** (`gadidosti-broker-driver`'s broker pages, web-only): Drivers and Trucks
  already had this — untouched by this change.

One new backend endpoint was added to support it:

```
PATCH /api/admin/users/:id      (admin-only)
Body: { name?, email?, address?, company_name? }
```

Lets an admin correct a client's or broker's profile on their behalf. Reuses the exact same
`UserModel.updateProfile` the existing self-service `PATCH /api/users/profile` already calls,
so both paths write through the same columns and stay in sync automatically.

## Why there's nothing to build here

Every one of these screens (admin dashboard, broker panel) is a **separate web app** —
`SSK_Cargo` is the client/driver-facing mobile app and doesn't have an admin or broker-fleet-
management surface at all. None of this is reachable from, or relevant to, the Flutter app's
own screens.

The one place this *could* touch `SSK_Cargo`: if an admin edits a client's or driver's name/
email/address from the dashboard, and that same person is logged into `SSK_Cargo`, their
profile screen will show the updated values automatically — it's the exact same `users` row,
read through the same `GET /api/users/profile` the app already calls. **No client-side change
needed.** The only thing to be aware of: those fields won't reflect the edit until the app's
next profile fetch (e.g. next app open, or wherever it already re-fetches profile today) — not
pushed live via socket, same as any other profile field.

Driver/truck deletion (admin or broker doing it) does **not** send a push notification or
socket event to the deleted driver's own `SSK_Cargo` session today. If that driver is
mid-session, their next authenticated request will simply start failing (401/404 depending on
what changed) rather than getting a graceful in-app message — worth flagging if you want a
"your account was removed" experience added later, but out of scope for this change.

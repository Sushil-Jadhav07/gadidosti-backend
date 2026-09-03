# Chat System — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. The backend just shipped a substantial chat upgrade — a
scripted quick-reply bot that greets the client first, an escalation flow that pulls in the
driver/broker, a hard lock once the trip's delivered, and a proper "list every thread" endpoint.
The reference web apps (`gadidosti-client`, `gadidosti-broker-driver`, `gadidosti-admin-dashboard`)
all already have this built — this doc is what's true for `SSK_Cargo` specifically, checked
against its actual source, not assumed.

**Headline finding**: the client side already has a real, working chat feature
(`tracking_details_screen.dart`'s `_ClientBookingChatSheet` — REST history + a live socket
connection with typing/read-receipts, sending via the `send-message` socket event). It **degrades
gracefully** against everything new on the backend — nothing is broken, nothing crashes. But it's
blind to all of it: no bot styling, no quick-reply buttons, no lock awareness. And there is
**no chat at all** on the driver side (only a decorative "chat bubble" icon on an unrelated
incident-type option — confirmed via `grep 'chat' lib/` across the driver screens, one match,
not a chat feature) — driver/broker chat needs to be built from scratch, same as it just was on
`gadidosti-broker-driver`.

---

## 1. What already works, unchanged

`api_client.dart` (lines 405-459) already has `getUnreadChatCount`, `getChatThread`,
`getChatMessages`, `markChatThreadRead` — all still valid, response shapes unchanged. Sending is
socket-only today (`_sendMessage`, line 2106, emits `send-message` with an ack callback) — there's
no REST send wrapper in `api_client.dart`, which is fine, the backend's REST
`POST /api/chat/threads/:threadId/messages` was always just a fallback.

`_connectSocket` (line 2005) already listens for `new-message`/`typing`/`read-receipt` exactly as
before — these events are unchanged in shape, so live delivery, typing indicators, and read
receipts all keep working with zero changes needed.

## 2. What degrades gracefully (works, but not well) — checked line by line

- **Bot messages render as a normal person bubble.** The message-list `itemBuilder` (line ~2232)
  only ever reads `senderId`/`senderName` off each message — it never looks at `senderRole`, so a
  bot message just shows up as "SSK Assistant" in a plain gray bubble, same as any other-party
  message. No crash, just no visual distinction.
- **`meta.quickReplies` is silently ignored.** Nothing in this file reads a `meta` field at all —
  the bot's pill-button options are just dropped. The client can still respond by **typing free
  text**, though — the backend auto-escalates on any free-text send while a thread's still in
  `'bot'` stage (can't parse arbitrary text with a scripted bot, so it treats it exactly like
  tapping "Talk to my driver/broker"), and that reply flows back over the *already-connected*
  `new-message` socket listener like any other message. So the flow still functions end-to-end —
  it's just all free-text, no tappable menu.
- **A locked (post-delivery) thread fails to send with a generic error.** `_sendMessage`'s ack
  handler (line 2121) shows a fixed `'Message could not be sent.'` snackbar on any non-success
  ack, instead of the backend's actual message
  (`"This trip is complete — the chat has closed."`, sent as `ack['message']` on the socket path
  — see `chatBroadcast`/`socket.js` on the backend). Nothing breaks, but the client doesn't know
  *why* it failed, and the input stays enabled and re-triggerable indefinitely.
- **`_chatThreadFromResponse` (line 3356) already returns the whole thread object generically** —
  meaning `stage`/`isLocked` are already sitting in the parsed response today, just never read.
  Wiring the improvements below is mostly "start reading fields that are already there," not a
  new API integration.

## 3. Recommended client-side improvements (in `tracking_details_screen.dart`)

Not urgent (nothing's broken), but matches what the web client just got and closes the gap:

1. Keep `stage`/`isLocked` from `_chatThreadFromResponse`'s result in this screen's state
   (currently only `_threadId` is kept, around where `_loadChat` — line 1950 — processes the
   thread response).
2. In the `itemBuilder`, branch on `senderRole == 'bot'` for a distinct bubble style (different
   background color + a small assistant icon + "SSK Assistant" label, same idea as the web
   client's indigo bot bubbles).
3. Render `meta.quickReplies` (a list of `{id, label}`) from the **latest** message as tappable
   chips above the input, whenever `stage == 'bot'` and not locked. Add a
   `POST /api/chat/threads/:threadId/bot-action` wrapper to `api_client.dart` (mirrors
   `getChatThread`'s shape exactly, just a POST with `{'actionId': id}` in the body) and call it
   on tap. The response messages arrive back over the socket the same way a bot reply already
   does today — no need to manually append them.
4. When `isLocked`, hide the input entirely and show a static
   `"This trip is complete — the chat has closed."` row instead (mirrors web) — and in
   `_sendMessage`'s failure branch, surface `ack['message']` instead of the hardcoded string, so
   the real reason (locked, or anything else) actually reaches the user.

## 4. Driver + broker chat — build from scratch

Nothing exists today. Build it mirroring `gadidosti-broker-driver`'s just-built driver/broker
chat: a chat-list screen (fetches every thread the driver/broker is on) + a per-thread chat
screen reusing the same message-list/send logic `_ClientBookingChatSheet` already has (bot
bubbles included, for rendering PAST bot-stage history — driver/broker never trigger bot-action,
only free-text send). Needs, in `api_client.dart`:

```dart
Future<Map<String, dynamic>> getChatThreads({required String accessToken}) async {
  return _request(
    () => _dio.get<Map<String, dynamic>>(
      '/api/chat/threads',
      options: Options(headers: {'Authorization': 'Bearer $accessToken'}),
    ),
  );
}
```
→ `{ success, data: { threads: [ { threadId, bookingId, bookingNumber, bookingStatus, isLocked,
stage, pickup, drop, clientId, clientName, brokerId, brokerName, driverId, driverName,
lastMessage, lastMessageAt, lastSenderId, lastSenderRole, unreadCount } ] } }` — for a driver or
broker, "the other party" to show is `clientName`.

Also worth listening for the two new socket events (same connection, same auth):
- `chat-message` — pushed to this user's own always-joined `user:{userId}` room (no explicit
  join needed) whenever a message lands in any of their threads outside bot stage. Good for an
  app-wide "new message" toast/badge regardless of which screen is open.
- `chat-escalated` — pushed specifically to the booking's driver/broker the moment a client's
  thread flips from bot → human (`{threadId, bookingId, bookingNumber, byName}`). This is the
  important one for this side: "New chat request from {byName} — Booking #{bookingNumber}."

## 5. Full API reference (unchanged endpoints omitted, see §1)

**GET `/api/chat/bookings/:bookingId/thread`** (response shape changed)
→ `{ success, data: { thread: { id, bookingId, bookingNumber, stage: 'bot'|'human', isLocked }, canSend } }`

**GET `/api/chat/threads`** (NEW — see §4 for the shape)

**GET `/api/chat/threads/:threadId/messages?page&limit`** (unchanged shape) — `messages[].meta`
is now sometimes `{ quickReplies: [{id, label}] }` (bot messages only), `senderRole` can now be
`'bot'` in addition to `'client'|'broker'|'driver'|'admin'`.

**POST `/api/chat/threads/:threadId/messages`** `{ message }` — REST fallback, same as the
existing socket `send-message` path but over HTTP. 403 `"This trip is complete — the chat has
closed."` when locked.

**POST `/api/chat/threads/:threadId/bot-action`** `{ actionId }` (NEW, client-only) → posts the
tapped option as the client's own message, then the bot's scripted reply (may carry the next
step's `meta.quickReplies`), escalating to `'human'` and notifying the driver/broker if that
response calls for it. 400 unknown `actionId`, 409 if already escalated, 403 if locked or not the
client.

**Socket `send-message`** ack now also carries `botMessage` (the bot's auto-escalation reply, or
`null`) alongside the existing `{success, message}`.

**Lock rule**: a thread is locked the moment the booking's status is `delivered` or `completed` —
enforced server-side regardless of client; UI should just reflect it, not rely on it.

## 6. Priority checklist

| Item | Urgency |
|---|---|
| Bot-bubble styling on client | Low — cosmetic, nothing broken |
| Quick-reply pills + bot-action wiring on client | Medium — free-text fallback already works end-to-end |
| Surface the real lock error message on client | Low — generic message still communicates failure |
| Locked-state banner + disabled input on client | Medium — send currently just silently keeps failing |
| `GET /api/chat/threads` wrapper in `api_client.dart` | **High** — nothing driver/broker-side can be built without it |
| Driver chat list + chat screen | **High** — doesn't exist at all today |
| Broker chat list + chat screen | **High** — doesn't exist at all today |
| `chat-escalated` toast for driver/broker | Medium — meaningful UX gap once chat exists, but chat existing at all comes first |

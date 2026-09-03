// Shared chat business logic — used by both chat.controller.js (REST) and socket.js
// (real-time events) so the two write paths (POST /messages and the 'send-message' socket
// event) can never drift apart. REST is the source of truth/history; sockets are the
// real-time delivery layer on top of the exact same write.
//
// Socket emission lives in the CALLERS (chat.controller.js, socket.js), not here — chatService
// is required by socket.js, so requiring socket.js back here (for getIO) would be circular.
// broadcastMessage below takes an `io` instance as a parameter instead, and every caller already
// has one (chat.controller.js imports getIO directly; socket.js's handlers close over `io`).
const BookingModel = require('../models/booking.model');
const ChatThreadModel = require('../models/chatThread.model');
const NotificationModel = require('../models/notification.model');
const ChatMessageModel = require('../models/chatMessage.model');
const { BOT_SENDER_ID, GREETING, MENU_ROOT, RESPONSES, OPTION_LABELS } = require('./chatBot');

// Thread participants = the booking's client + assigned broker + assigned driver — pulled
// live from bookings.client_id/broker_id/driver_id, not stored on the thread itself, so a
// driver reassignment mid-trip automatically changes who can see the chat.
const isParticipant = (booking, userId) => (
  booking.client_id === userId || booking.broker_id === userId || booking.driver_id === userId
);

// The trip is over — no more messages, from anyone (participants and admin alike). Checked
// against the booking's own status, which advances in lockstep with the underlying trip's.
const LOCKED_BOOKING_STATUSES = ['delivered', 'completed'];
const isLocked = (booking) => LOCKED_BOOKING_STATUSES.includes(booking.status);

// Admin can always view (read-only history is still visible after locking, for
// support/dispute purposes) — only actual participants can send, and only while unlocked.
const canView = (booking, user) => user.role === 'admin' || isParticipant(booking, user.id);
const canSend = (booking, user) => {
  if (isLocked(booking)) return false;
  return user.role === 'admin' || isParticipant(booking, user.id);
};

// The standard "everyone else on this booking" list — used both for DB notifications
// (postMessage below) and for the socket toast fan-out (chatBroadcast.js), so the two can't
// disagree on who's a recipient.
const recipientIds = (booking, excludeUserId) => (
  [booking.client_id, booking.broker_id, booking.driver_id].filter((id) => id && id !== excludeUserId)
);

const projectMessage = (row) => ({
  id: row.id,
  threadId: row.thread_id,
  senderId: row.sender_id,
  senderName: row.sender_name,
  senderRole: row.sender_role,
  message: row.message,
  meta: row.meta || null,
  readAt: row.read_at,
  createdAt: row.created_at,
});

// Shapes one row of ChatThreadModel.listForUser into what every dashboard's chat-list screen
// renders — same fields regardless of caller's role; the frontend picks which of
// client/broker/driver is "the other party" based on its own role (admin sees all three).
const projectThreadListItem = (row) => ({
  threadId: row.thread_id,
  bookingId: row.booking_id,
  bookingNumber: row.booking_number,
  bookingStatus: row.booking_status,
  isLocked: LOCKED_BOOKING_STATUSES.includes(row.booking_status),
  stage: row.stage,
  pickup: row.pickup_location,
  drop: row.drop_location,
  clientId: row.client_id,
  clientName: row.client_name,
  brokerId: row.broker_id,
  brokerName: row.broker_name,
  driverId: row.driver_id,
  driverName: row.driver_name,
  lastMessage: row.last_message,
  lastMessageAt: row.last_message_at,
  lastSenderId: row.last_sender_id,
  lastSenderRole: row.last_sender_role,
  unreadCount: row.unread_count,
});

// Resolves (and lazily creates) the thread for a booking, after checking the caller can view
// it. Seeds the bot's greeting + root menu as the thread's very first message, exactly once
// (see ChatThreadModel.findOrCreateByBooking's `created` flag) — every later open just sees it
// as ordinary history, no special-casing needed on read.
const getThreadForBooking = async (bookingId, user) => {
  const booking = await BookingModel.findById(bookingId);
  if (!booking) return { error: 'not_found' };
  if (!canView(booking, user)) return { error: 'forbidden' };

  const { thread, created } = await ChatThreadModel.findOrCreateByBooking(booking.id);
  if (created) {
    await ChatMessageModel.create({
      threadId: thread.id,
      senderId: BOT_SENDER_ID,
      message: GREETING,
      meta: { quickReplies: MENU_ROOT },
    });
  }
  return { thread, booking };
};

// Loads a thread + its booking from just a threadId — used by every call that only has the
// thread id in hand (message list/send/read REST routes, every socket event).
const getThreadWithBooking = async (threadId) => {
  const thread = await ChatThreadModel.findById(threadId);
  if (!thread) return { error: 'not_found' };
  const booking = await BookingModel.findById(thread.booking_id);
  if (!booking) return { error: 'not_found' };
  return { thread, booking };
};

// Writes one message. Notifications only fire once the thread's escalated to 'human' — during
// the 'bot' stage the client is the only one looking at the thread (that's how they're tapping
// quick-reply buttons in the first place), and the driver/broker haven't been pulled in yet, so
// notifying them about the client's back-and-forth with the bot would be noise.
const postMessage = async ({ threadId, booking, sender, message, stage, meta }) => {
  const row = await ChatMessageModel.create({ threadId, senderId: sender.id, message, meta });
  const projected = projectMessage({ ...row, sender_name: sender.name, sender_role: sender.role });

  if (stage !== 'bot') {
    const recipients = recipientIds(booking, sender.id);
    await Promise.all(recipients.map((userId) => NotificationModel.create({
      userId,
      title: `New message from ${sender.name}`,
      message: message.length > 120 ? `${message.slice(0, 120)}...` : message,
      type: 'chat',
      meta: { booking_id: booking.id, thread_id: threadId },
    })));
  }

  return projected;
};

// Bot-authored message (a reply, or the "connecting you..." line on escalation) — same write
// path as postMessage, just always sent as the bot and never notifies anyone (the client is
// looking at the thread live; nobody else is a party to it yet).
const postBotMessage = async ({ threadId, text, quickReplies }) => {
  const row = await ChatMessageModel.create({
    threadId,
    senderId: BOT_SENDER_ID,
    message: text,
    meta: quickReplies ? { quickReplies } : null,
  });
  return projectMessage({ ...row, sender_name: 'SSK Assistant', sender_role: 'bot' });
};

// Flips a thread to 'human' and notifies the assigned driver/broker — exactly once
// (ChatThreadModel.setStage no-ops past the first call, so a race/double-fire here is safe).
// Shared by handleBotAction's escalate:true responses and maybeAutoEscalate below.
const escalateAndNotify = async ({ thread, booking, sender }) => {
  const updated = await ChatThreadModel.setStage(thread.id, 'human');
  if (!updated) return false;
  const recipients = [booking.broker_id, booking.driver_id].filter(Boolean);
  await Promise.all(recipients.map((userId) => NotificationModel.create({
    userId,
    title: 'Client wants to chat',
    message: `${sender.name} started a conversation on booking ${booking.booking_number || booking.id}.`,
    type: 'chat',
    meta: { booking_id: booking.id, thread_id: thread.id },
  })));
  return true;
};

// A client sends free text instead of tapping a quick-reply while still in the 'bot' stage —
// the scripted bot has no NLP to make sense of arbitrary text, so instead of ignoring it, this
// treats it exactly like tapping "Talk to my driver/broker": escalate immediately and have the
// bot say so. Called by the send-message paths (REST + socket) right after postMessage,
// whenever thread.stage was still 'bot' at send time and the sender is the client. Returns the
// bot's "connecting you" message, or null if another request already escalated this thread
// first (race between two rapid sends).
const maybeAutoEscalate = async ({ thread, booking, sender }) => {
  const escalated = await escalateAndNotify({ thread, booking, sender });
  if (!escalated) return null;
  return postBotMessage({ threadId: thread.id, text: "Got it — connecting you with your driver/broker now." });
};

// Drives one step of the scripted bot menu: posts the client's tapped option as their own chat
// message (so it reads as a normal sent bubble, matching how a real quick-reply UI behaves),
// then the bot's scripted response, escalating the thread to 'human' and notifying the
// assigned driver/broker if that response calls for it. Returns every message posted (1 or 2)
// plus whether this call was the one that escalated, so the caller (chat.controller.js) knows
// whether to also broadcast an escalation event.
const handleBotAction = async ({ thread, booking, sender, actionId }) => {
  const response = RESPONSES[actionId];
  if (!response) return { error: 'invalid_action' };

  const messages = [];
  const label = OPTION_LABELS[actionId] || actionId;

  messages.push(await postMessage({ threadId: thread.id, booking, sender, message: label, stage: thread.stage }));
  messages.push(await postBotMessage({ threadId: thread.id, text: response.reply, quickReplies: response.quickReplies }));

  const escalated = response.escalate ? await escalateAndNotify({ thread, booking, sender }) : false;

  return { messages, escalated };
};

module.exports = {
  canView, canSend, isParticipant, isLocked, recipientIds,
  getThreadForBooking, getThreadWithBooking, postMessage, postBotMessage, handleBotAction,
  maybeAutoEscalate, projectMessage, projectThreadListItem,
};

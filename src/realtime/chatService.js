// Shared chat business logic — used by both chat.controller.js (REST) and socket.js
// (real-time events) so the two write paths (POST /messages and the 'send-message' socket
// event) can never drift apart. REST is the source of truth/history; sockets are the
// real-time delivery layer on top of the exact same write.
const BookingModel = require('../models/booking.model');
const ChatThreadModel = require('../models/chatThread.model');
const NotificationModel = require('../models/notification.model');
const ChatMessageModel = require('../models/chatMessage.model');

// Thread participants = the booking's client + assigned broker + assigned driver — pulled
// live from bookings.client_id/broker_id/driver_id, not stored on the thread itself, so a
// driver reassignment mid-trip automatically changes who can see the chat.
const isParticipant = (booking, userId) => (
  booking.client_id === userId || booking.broker_id === userId || booking.driver_id === userId
);

// Admin can always view (read-only, for support/dispute purposes) — only actual participants
// can send.
const canView = (booking, user) => user.role === 'admin' || isParticipant(booking, user.id);
const canSend = (booking, user) => isParticipant(booking, user.id);

const projectMessage = (row) => ({
  id: row.id,
  threadId: row.thread_id,
  senderId: row.sender_id,
  senderName: row.sender_name,
  senderRole: row.sender_role,
  message: row.message,
  readAt: row.read_at,
  createdAt: row.created_at,
});

// Resolves (and lazily creates) the thread for a booking, after checking the caller can view it.
const getThreadForBooking = async (bookingId, user) => {
  const booking = await BookingModel.findById(bookingId);
  if (!booking) return { error: 'not_found' };
  if (!canView(booking, user)) return { error: 'forbidden' };

  const thread = await ChatThreadModel.findOrCreateByBooking(booking.id);
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

const postMessage = async ({ threadId, booking, sender, message }) => {
  const row = await ChatMessageModel.create({ threadId, senderId: sender.id, message });
  const projected = projectMessage({ ...row, sender_name: sender.name, sender_role: sender.role });

  // Every other participant gets a notification, same as any other cross-user event in this
  // app — so a message shows up in the existing notification bell even if the recipient
  // isn't looking at the chat (or isn't connected to the socket) right now.
  const recipients = [booking.client_id, booking.broker_id, booking.driver_id]
    .filter((id) => id && id !== sender.id);
  await Promise.all(recipients.map((userId) => NotificationModel.create({
    userId,
    title: `New message from ${sender.name}`,
    message: message.length > 120 ? `${message.slice(0, 120)}...` : message,
    type: 'chat',
    meta: { booking_id: booking.id, thread_id: threadId },
  })));

  return projected;
};

module.exports = {
  canView, canSend, isParticipant,
  getThreadForBooking, getThreadWithBooking, postMessage, projectMessage,
};

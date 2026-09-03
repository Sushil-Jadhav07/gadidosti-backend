// Shared "push this chat message to everyone who should see it right now" helper — used by
// both chat.controller.js (REST) and socket.js (the 'send-message'/bot-action live paths) so
// the two can't drift. Takes `io` as a parameter rather than requiring socket.js's getIO
// directly — socket.js requires chatService.js (which this sits alongside), so requiring
// socket.js back from here would be circular.
//
// Two channels: the thread room (anyone with that specific ChatWindow open right now, joined
// via the 'join-thread' socket event) always gets the message live; each recipient's own
// `user:{id}` room gets a lighter cross-app 'chat-message' event for toast/badge purposes —
// every app already listens on that room for other pushes (trip-status-updated,
// login-attempt-alert, etc.), so a chat toast just piggybacks on it as one more event name.
const broadcastMessage = (io, { threadId, booking, projected, notifyUserIds = [] }) => {
  if (!io) return;
  io.to(`thread:${threadId}`).emit('new-message', projected);
  notifyUserIds
    .filter((id) => id && id !== projected.senderId)
    .forEach((userId) => {
      io.to(`user:${userId}`).emit('chat-message', {
        ...projected,
        bookingId: booking.id,
        bookingNumber: booking.booking_number,
      });
    });
};

// Fired once, the moment a thread flips from 'bot' to 'human' — lets the driver/broker app show
// a toast ("Client wants to chat") and refresh its chat list immediately instead of waiting on
// the notification bell.
const broadcastEscalation = (io, { threadId, booking, byName }) => {
  if (!io) return;
  [booking.broker_id, booking.driver_id].filter(Boolean).forEach((userId) => {
    io.to(`user:${userId}`).emit('chat-escalated', {
      threadId, bookingId: booking.id, bookingNumber: booking.booking_number, byName,
    });
  });
};

module.exports = { broadcastMessage, broadcastEscalation };

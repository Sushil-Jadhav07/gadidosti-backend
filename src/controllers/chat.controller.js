const ChatMessageModel = require('../models/chatMessage.model');
const chatService = require('../realtime/chatService');
const { getIO } = require('../realtime/socket');
const { successResponse, errorResponse } = require('../utils/response');

// ─── GET /api/chat/bookings/:bookingId/thread ─────────────────────────────────
// Get-or-create the thread for a booking — the entry point every frontend calls before it
// has a threadId to work with.
const getThreadForBooking = async (req, res, next) => {
  try {
    const { thread, booking, error } = await chatService.getThreadForBooking(req.params.bookingId, req.user);
    if (error === 'not_found') return errorResponse(res, 404, 'Booking not found');
    if (error === 'forbidden') return errorResponse(res, 403, "You do not have access to this booking's chat");

    return successResponse(res, 200, 'Thread fetched', {
      thread: { id: thread.id, bookingId: booking.id, bookingNumber: booking.booking_number },
      canSend: chatService.canSend(booking, req.user),
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/chat/threads/:threadId/messages ─────────────────────────────────
const listMessages = async (req, res, next) => {
  try {
    const { thread, booking, error } = await chatService.getThreadWithBooking(req.params.threadId);
    if (error) return errorResponse(res, 404, 'Thread not found');
    if (!chatService.canView(booking, req.user)) return errorResponse(res, 403, 'You do not have access to this chat');

    const { page = 1, limit = 30 } = req.query;
    const result = await ChatMessageModel.findByThread(thread.id, { page: parseInt(page), limit: Math.min(parseInt(limit), 100) });

    return successResponse(res, 200, 'Messages fetched', { ...result, messages: result.messages.map(chatService.projectMessage) });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/chat/threads/:threadId/messages ────────────────────────────────
// REST fallback alongside the socket 'send-message' event — same underlying
// chatService.postMessage write, so it can't diverge from what the socket path does. Also
// broadcasts onto the socket room so anyone connected live still sees it appear immediately.
const sendMessage = async (req, res, next) => {
  try {
    const { thread, booking, error } = await chatService.getThreadWithBooking(req.params.threadId);
    if (error) return errorResponse(res, 404, 'Thread not found');
    if (!chatService.canSend(booking, req.user)) return errorResponse(res, 403, 'You are not a participant in this chat');

    const { message } = req.body;
    const projected = await chatService.postMessage({ threadId: thread.id, booking, sender: req.user, message });

    getIO()?.to(`thread:${thread.id}`).emit('new-message', projected);

    return successResponse(res, 201, 'Message sent', { message: projected });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/chat/threads/:threadId/read ───────────────────────────────────
const markThreadRead = async (req, res, next) => {
  try {
    const { thread, booking, error } = await chatService.getThreadWithBooking(req.params.threadId);
    if (error) return errorResponse(res, 404, 'Thread not found');
    if (!chatService.canView(booking, req.user)) return errorResponse(res, 403, 'You do not have access to this chat');

    const markedCount = await ChatMessageModel.markThreadRead(thread.id, req.user.id);
    if (markedCount) getIO()?.to(`thread:${thread.id}`).emit('read-receipt', { threadId: thread.id, userId: req.user.id });

    return successResponse(res, 200, 'Thread marked read', { markedCount });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/chat/unread-count ────────────────────────────────────────────────
// Powers the chat badge in each app's header/navbar, same idea as GET /api/users/notifications'
// unread_count.
const getUnreadCount = async (req, res, next) => {
  try {
    const unreadCount = await ChatMessageModel.countUnreadForUser(req.user.id);
    return successResponse(res, 200, 'Unread count fetched', { unreadCount });
  } catch (err) {
    next(err);
  }
};

module.exports = { getThreadForBooking, listMessages, sendMessage, markThreadRead, getUnreadCount };

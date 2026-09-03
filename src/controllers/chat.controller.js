const ChatMessageModel = require('../models/chatMessage.model');
const ChatThreadModel = require('../models/chatThread.model');
const chatService = require('../realtime/chatService');
const { broadcastMessage, broadcastEscalation } = require('../realtime/chatBroadcast');
const { getIO } = require('../realtime/socket');
const { successResponse, errorResponse } = require('../utils/response');

const LOCKED_MESSAGE = 'This trip is complete — the chat has closed.';

// ─── GET /api/chat/bookings/:bookingId/thread ─────────────────────────────────
// Get-or-create the thread for a booking — the entry point every frontend calls before it
// has a threadId to work with.
const getThreadForBooking = async (req, res, next) => {
  try {
    const { thread, booking, error } = await chatService.getThreadForBooking(req.params.bookingId, req.user);
    if (error === 'not_found') return errorResponse(res, 404, 'Booking not found');
    if (error === 'forbidden') return errorResponse(res, 403, "You do not have access to this booking's chat");

    return successResponse(res, 200, 'Thread fetched', {
      thread: {
        id: thread.id,
        bookingId: booking.id,
        bookingNumber: booking.booking_number,
        stage: thread.stage,
        isLocked: chatService.isLocked(booking),
      },
      canSend: chatService.canSend(booking, req.user),
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/chat/threads ─────────────────────────────────────────────────────
// Every thread the caller participates in (client/broker/driver) — or every thread that
// exists, for admin. Powers the chat-list screen in every dashboard.
const listThreads = async (req, res, next) => {
  try {
    const rows = await ChatThreadModel.listForUser(req.user);
    return successResponse(res, 200, 'Threads fetched', { threads: rows.map(chatService.projectThreadListItem) });
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
    if (chatService.isLocked(booking)) return errorResponse(res, 403, LOCKED_MESSAGE);
    if (!chatService.canSend(booking, req.user)) return errorResponse(res, 403, 'You are not a participant in this chat');

    const { message } = req.body;
    const projected = await chatService.postMessage({ threadId: thread.id, booking, sender: req.user, message, stage: thread.stage });

    const io = getIO();
    broadcastMessage(io, {
      threadId: thread.id,
      booking,
      projected,
      notifyUserIds: thread.stage === 'bot' ? [] : chatService.recipientIds(booking, req.user.id),
    });

    // The client typed free text instead of using the quick-reply menu while still in the
    // 'bot' stage — the scripted bot can't parse arbitrary text, so this connects them to a
    // human the same way tapping "Talk to my driver/broker" would.
    let botMessage = null;
    if (thread.stage === 'bot' && req.user.role === 'client') {
      botMessage = await chatService.maybeAutoEscalate({ thread, booking, sender: req.user });
      if (botMessage) {
        broadcastMessage(io, { threadId: thread.id, booking, projected: botMessage });
        broadcastEscalation(io, { threadId: thread.id, booking, byName: req.user.name });
      }
    }

    return successResponse(res, 201, 'Message sent', { message: projected, botMessage });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/chat/threads/:threadId/bot-action ──────────────────────────────
// Client taps one of the bot's quick-reply buttons — client-only (the scripted bot is a
// client-facing feature; a driver/broker/admin sending free text goes through sendMessage as
// normal, since by the time they're in the thread it's already escalated to 'human').
const sendBotAction = async (req, res, next) => {
  try {
    const { thread, booking, error } = await chatService.getThreadWithBooking(req.params.threadId);
    if (error) return errorResponse(res, 404, 'Thread not found');
    if (req.user.role !== 'client') return errorResponse(res, 403, 'Only the client can use the assistant menu');
    if (!chatService.isParticipant(booking, req.user.id)) return errorResponse(res, 403, 'You are not a participant in this chat');
    if (chatService.isLocked(booking)) return errorResponse(res, 403, LOCKED_MESSAGE);
    if (thread.stage !== 'bot') return errorResponse(res, 409, 'This chat has already been connected to a person');

    const { actionId } = req.body;
    const result = await chatService.handleBotAction({ thread, booking, sender: req.user, actionId });
    if (result.error === 'invalid_action') return errorResponse(res, 400, 'Unknown option');

    const io = getIO();
    result.messages.forEach((projected) => broadcastMessage(io, { threadId: thread.id, booking, projected }));
    if (result.escalated) broadcastEscalation(io, { threadId: thread.id, booking, byName: req.user.name });

    return successResponse(res, 201, 'Handled', { messages: result.messages, escalated: result.escalated });
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

module.exports = { getThreadForBooking, listThreads, listMessages, sendMessage, sendBotAction, markThreadRead, getUnreadCount };

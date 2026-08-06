const { Server } = require('socket.io');
const { verifyAccessToken } = require('../utils/jwt');
const UserModel = require('../models/user.model');
const ChatMessageModel = require('../models/chatMessage.model');
const chatService = require('./chatService');
const logger = require('../utils/logger');
const allowedOrigins = require('../config/corsOrigins');

let io = null;

// Wraps the plain http.Server (see server.js) with a socket.io layer for live chat. Auth reuses
// the exact same access token + verification as auth.middleware.js's authenticate — just carried
// over the socket handshake instead of an Authorization header, since there's no per-request
// header on a persistent socket connection.
const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      methods: ['GET', 'POST'],
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('Access token required'));

      const decoded = verifyAccessToken(token);
      const user = await UserModel.findById(decoded.id);
      if (!user) return next(new Error('User not found'));
      if (user.status === 'blocked' || user.status === 'inactive') return next(new Error('Account is not active'));

      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Invalid or expired access token'));
    }
  });

  io.on('connection', (socket) => {
    logger.info(`Socket connected: user ${socket.user.id} (${socket.user.role})`);

    // Auto-joined, unlike the thread/truck rooms below which a client opts into explicitly —
    // there's no single resource id to join ahead of time for driver_requests updates (e.g. a
    // client doesn't know a broker-assigned offer's id until it exists). Lets any REST
    // controller push straight to a specific user via getIO()?.to(`user:${id}`).emit(...),
    // same pattern as driverRequest.controller.js / driverRequestTimeoutSweep.js.
    socket.join(`user:${socket.user.id}`);

    // ─── join-thread — verifies chat access before letting the socket into the room ──────────
    socket.on('join-thread', async ({ threadId } = {}, ack) => {
      try {
        const { thread, booking, error } = await chatService.getThreadWithBooking(threadId);
        if (error || !chatService.canView(booking, socket.user)) {
          return ack?.({ success: false, message: 'You do not have access to this chat' });
        }
        socket.join(`thread:${thread.id}`);
        ack?.({ success: true });
      } catch {
        ack?.({ success: false, message: 'Failed to join thread' });
      }
    });

    socket.on('leave-thread', ({ threadId } = {}) => {
      if (threadId) socket.leave(`thread:${threadId}`);
    });

    // ─── send-message — the real-time write path; shares postMessage with the REST POST ───────
    // fallback in chat.controller.js so the two can never write the message differently.
    socket.on('send-message', async ({ threadId, message } = {}, ack) => {
      try {
        const text = String(message || '').trim();
        if (!text) return ack?.({ success: false, message: 'Message cannot be empty' });

        const { thread, booking, error } = await chatService.getThreadWithBooking(threadId);
        if (error || !chatService.canSend(booking, socket.user)) {
          return ack?.({ success: false, message: 'You are not a participant in this chat' });
        }

        const projected = await chatService.postMessage({ threadId: thread.id, booking, sender: socket.user, message: text });
        io.to(`thread:${thread.id}`).emit('new-message', projected);
        ack?.({ success: true, message: projected });
      } catch {
        ack?.({ success: false, message: 'Failed to send message' });
      }
    });

    // ─── typing indicator — ephemeral, never persisted ─────────────────────────────────────────
    socket.on('typing', ({ threadId, isTyping } = {}) => {
      if (!threadId) return;
      socket.to(`thread:${threadId}`).emit('typing', { threadId, userId: socket.user.id, isTyping: !!isTyping });
    });

    // ─── join-truck-tracking / leave-truck-tracking — live GPS during the Truck-selection step
    // of booking creation. No permission check beyond being an authenticated socket: the same
    // live position is already exposed to any authenticated role via
    // GET /api/vehicles/trucks/nearby, so joining this room leaks nothing that endpoint doesn't
    // already. Location updates are pushed in by vehicle.controller.js's updateDriverLocation
    // (the PATCH /vehicles/drivers/me/location handler) via getIO() — same
    // REST-write-triggers-socket-broadcast pattern chat.controller.js uses for messages.
    socket.on('join-truck-tracking', ({ truckId } = {}, ack) => {
      if (!truckId) return ack?.({ success: false, message: 'truckId is required' });
      socket.join(`truck:${truckId}`);
      ack?.({ success: true });
    });

    socket.on('leave-truck-tracking', ({ truckId } = {}) => {
      if (truckId) socket.leave(`truck:${truckId}`);
    });

    // ─── read receipts ──────────────────────────────────────────────────────────────────────────
    socket.on('read', async ({ threadId } = {}, ack) => {
      try {
        if (!threadId) return ack?.({ success: false });
        const count = await ChatMessageModel.markThreadRead(threadId, socket.user.id);
        if (count) io.to(`thread:${threadId}`).emit('read-receipt', { threadId, userId: socket.user.id });
        ack?.({ success: true, markedCount: count });
      } catch {
        ack?.({ success: false });
      }
    });

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: user ${socket.user.id}`);
    });
  });

  return io;
};

// Lets REST controllers (chat.controller.js's POST /messages fallback) broadcast onto the same
// rooms the socket layer uses, so a message sent over plain REST still shows up live for anyone
// connected via socket.
const getIO = () => io;

module.exports = { initSocket, getIO };

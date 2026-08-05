const admin = require('firebase-admin');
const PushProvider = require('./PushProvider');
const logger = require('../../utils/logger');

// FCM caps a single multicast send at 500 tokens — one user with a handful of devices never
// gets close, so no batching loop is needed, just the cap enforced defensively.
const MAX_TOKENS_PER_SEND = 500;

// Tokens FCM reports as dead — the caller (NotificationModel) prunes these from device_tokens
// so a stale/uninstalled-app token doesn't keep getting retried forever.
const INVALID_TOKEN_ERROR_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
]);

let app = null;
const getApp = () => {
  if (app) return app;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  app = admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });
  return app;
};

class FirebasePushProvider extends PushProvider {
  async send({ tokens, title, body, data }) {
    if (!tokens?.length) return { successCount: 0, failureCount: 0, invalidTokens: [] };

    const targets = tokens.slice(0, MAX_TOKENS_PER_SEND);
    // FCM's `data` payload must be a flat object of strings — non-string values (numbers,
    // booleans, the meta object callers pass) are stringified so this never throws on a
    // caller who passed e.g. { booking_id: 123 }.
    const stringData = Object.fromEntries(
      Object.entries(data || {}).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)])
    );

    try {
      const response = await getApp().messaging().sendEachForMulticast({
        tokens: targets,
        notification: { title, body },
        data: stringData,
      });

      const invalidTokens = response.responses
        .map((r, i) => (!r.success && INVALID_TOKEN_ERROR_CODES.has(r.error?.code) ? targets[i] : null))
        .filter(Boolean);

      if (response.failureCount) {
        logger.warn(`Push send: ${response.successCount} ok, ${response.failureCount} failed (${invalidTokens.length} invalid tokens to prune)`);
      }

      return { successCount: response.successCount, failureCount: response.failureCount, invalidTokens };
    } catch (err) {
      logger.error(`Push send failed entirely: ${err.message}`);
      return { successCount: 0, failureCount: targets.length, invalidTokens: [] };
    }
  }
}

module.exports = FirebasePushProvider;

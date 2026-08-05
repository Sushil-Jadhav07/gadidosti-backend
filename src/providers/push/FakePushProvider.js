const PushProvider = require('./PushProvider');
const logger = require('../../utils/logger');

// No real FCM project wired up — logs what would have been sent and reports full success, so
// every NotificationModel.create() call path works identically in dev/test whether or not
// PUSH_PROVIDER=firebase is configured.
class FakePushProvider extends PushProvider {
  async send({ tokens, title, body, data }) {
    if (!tokens?.length) return { successCount: 0, failureCount: 0, invalidTokens: [] };
    logger.info(`[FakePushProvider] Would push to ${tokens.length} device(s): "${title}" — ${body}`);
    return { successCount: tokens.length, failureCount: 0, invalidTokens: [] };
  }
}

module.exports = FakePushProvider;

const cron = require('node-cron');
const PostpaidBillModel = require('../models/postpaidBill.model');
const UserModel = require('../models/user.model');
const NotificationModel = require('../models/notification.model');
const logger = require('../utils/logger');

// Runs once a month (1st, 00:05) — separate from the credit-limit trigger in
// booking.controller.js's createBooking, which raises a bill immediately the moment a postpaid
// client's outstanding balance reaches their limit. This sweep is the guarantee that even a
// postpaid client who never gets close to their limit still gets billed monthly for whatever
// they've accumulated. Same generate() call either way — one bill per client, bundling every
// currently-'to_be_billed' booking, never an empty bill (generate() returns null if there's
// nothing to bill).
const sweep = async () => {
  try {
    const clientIds = await PostpaidBillModel.findClientsWithOutstandingToBeBilled();
    if (!clientIds.length) return;

    const now = new Date();
    const periodEnd = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    for (const clientId of clientIds) {
      const bill = await PostpaidBillModel.generate(clientId, { trigger: 'monthly', periodStart, periodEnd });
      if (!bill) continue;
      logger.info(`Monthly postpaid bill ${bill.id} generated for client ${clientId}: ₹${bill.total_amount}`);

      const admins = await UserModel.findAll({ role: 'admin', limit: 100 });
      for (const admin of admins.users || []) {
        await NotificationModel.create({
          userId: admin.id,
          title: 'Monthly Postpaid Bill Generated',
          message: `A monthly bill of ₹${Number(bill.total_amount).toLocaleString('en-IN')} was generated for a postpaid client — review and send it from Postpaid Bills.`,
          type: 'payment',
          meta: { bill_id: bill.id, client_id: clientId },
        });
      }
    }
  } catch (err) {
    logger.error(`Monthly postpaid bill sweep failed: ${err.message}`);
  }
};

// Called once from server.js at startup. '5 0 1 * *' = 00:05 on the 1st of every month.
const startMonthlyPostpaidBillSweep = () => {
  cron.schedule('5 0 1 * *', sweep);
  logger.info('🔔 Monthly postpaid bill sweep scheduled (00:05 on the 1st of each month)');
};

module.exports = { startMonthlyPostpaidBillSweep, sweep };

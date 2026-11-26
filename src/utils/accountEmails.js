const { getEmailProvider } = require('../providers/email');
const logger = require('./logger');

// Not a secret — safe as a plain default. Override via ADMIN_NOTIFICATION_EMAIL in .env if this
// ever needs to change without a code deploy.
const ADMIN_NOTIFICATION_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL || 'admin@gadidost.com';

const ROLE_LABEL = { client: 'Client', broker: 'Broker', driver: 'Driver', admin: 'Admin', staff: 'Staff', gps_owner: 'GPS Owner' };

// EMAIL_PROVIDER=fake (the default until SMTP_HOST/SMTP_USER/SMTP_PASSWORD/EMAIL_FROM are set in
// .env) just logs instead of sending — see providers/email/index.js. Both functions below are
// safe to call unconditionally either way.
const emailProvider = getEmailProvider();

// Fire-and-forget by design, same convention as NotificationModel.sendPush — nobody's
// registration or login should ever fail, or even slow down, because an email didn't go out.
// Callers invoke this without awaiting it.
const safeSend = async (payload, context) => {
  try {
    const result = await emailProvider.send(payload);
    if (!result?.success) logger.error(`Email send failed (${context})`);
  } catch (err) {
    logger.error(`Email send threw (${context}): ${err.message}`);
  }
};

// Called from every account-creation path (register, registerDriverWithTruck, registerAdmin,
// googleSignIn's new-user branch) — one place so a future signup path can't forget to notify
// admin just because it's not one of the ones that existed when this was written.
const notifyAdminOfNewAccount = (user) => {
  const roleLabel = ROLE_LABEL[user.role] || user.role;
  safeSend({
    to: ADMIN_NOTIFICATION_EMAIL,
    subject: `New ${roleLabel} account: ${user.name || user.phone || user.email || user.id}`,
    html: `
      <p>A new ${roleLabel.toLowerCase()} account was just created on GadiDost.</p>
      <ul>
        <li><strong>Name:</strong> ${user.name || '—'}</li>
        <li><strong>Phone:</strong> ${user.phone || '—'}</li>
        <li><strong>Email:</strong> ${user.email || '—'}</li>
        <li><strong>Role:</strong> ${roleLabel}</li>
        <li><strong>User ID:</strong> ${user.id}</li>
      </ul>
    `,
  }, `new-account-alert for ${user.id}`);
};

// Call with the user row fetched BEFORE UserModel.updateLastLogin runs for this request —
// last_login_at is only ever null the very first time an account logs in; every call after that
// has a real timestamp there, which is what makes this safe to call unconditionally on every
// login path (plain login, Google, Firebase phone) without a separate "is this their first
// login" flag threaded through each one. Silently skips an account with no email on file rather
// than failing — plenty of phone-only accounts never add one.
const sendWelcomeEmailIfFirstLogin = (user) => {
  if (user.last_login_at || !user.email) return;
  const roleLabel = ROLE_LABEL[user.role] || user.role;
  safeSend({
    to: user.email,
    subject: 'Welcome to GadiDost',
    html: `
      <p>Hi ${user.name || 'there'},</p>
      <p>Welcome to GadiDost! Your ${roleLabel.toLowerCase()} account is ready to go.</p>
      <p>If you ever have questions, just reply to this email.</p>
      <p>— Team GadiDost</p>
    `,
  }, `welcome-email for ${user.id}`);
};

module.exports = { notifyAdminOfNewAccount, sendWelcomeEmailIfFirstLogin };

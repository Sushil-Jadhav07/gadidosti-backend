// One-off admin credential recovery. Run from the backend project root, on
// whichever machine can reach the target database — reads the same .env file
// (DATABASE_URL / DB_HOST etc.) that app.js loads, so it hits whatever DB
// that .env points at (local, or production on the VPS).
//
// Usage:
//   node scripts/recover-admin.js reset <email> <newPassword>
//   node scripts/recover-admin.js create <name> <10-digit-phone> <email> <password>
//
// Delete this file (or at least stop using it) once you've regained access —
// it's a bypass around the normal authenticate+authorize('admin') gate.

require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../src/config/db');

async function resetPassword(email, newPassword) {
  const passwordHash = await bcrypt.hash(newPassword, 12);
  const result = await pool.query(
    `UPDATE users
     SET password_hash = $1, role = 'admin', status = 'active',
         is_email_verified = true, is_phone_verified = true
     WHERE email = $2
     RETURNING id, name, email, phone, role, status`,
    [passwordHash, email]
  );

  if (result.rowCount === 0) {
    console.error(`No user found with email ${email}. Use "create" instead if this admin never existed.`);
    process.exit(1);
  }

  console.log('Password reset. Admin can now log in with the new password:');
  console.log(result.rows[0]);
}

async function createAdmin(name, phone, email, password) {
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    `INSERT INTO users (name, email, phone, password_hash, role, status, is_phone_verified, is_email_verified)
     VALUES ($1, $2, $3, $4, 'admin', 'active', true, true)
     RETURNING id, name, email, phone, role, status`,
    [name, email, phone, passwordHash]
  );

  console.log('Admin created:');
  console.log(result.rows[0]);
}

async function main() {
  const [, , mode, ...args] = process.argv;

  if (mode === 'reset') {
    const [email, newPassword] = args;
    if (!email || !newPassword) {
      console.error('Usage: node scripts/recover-admin.js reset <email> <newPassword>');
      process.exit(1);
    }
    await resetPassword(email, newPassword);
  } else if (mode === 'create') {
    const [name, phone, email, password] = args;
    if (!name || !phone || !email || !password) {
      console.error('Usage: node scripts/recover-admin.js create <name> <10-digit-phone> <email> <password>');
      process.exit(1);
    }
    await createAdmin(name, phone, email, password);
  } else {
    console.error('Usage:\n  node scripts/recover-admin.js reset <email> <newPassword>\n  node scripts/recover-admin.js create <name> <10-digit-phone> <email> <password>');
    process.exit(1);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

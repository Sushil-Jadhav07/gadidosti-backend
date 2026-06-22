require('dotenv').config();
const pool = require('./db');
const bcrypt = require('bcryptjs');

const seed = async () => {
  const client = await pool.connect();
  try {
    console.log('🌱 Seeding database...');

    const passwordHash = await bcrypt.hash('Admin@123456', 12);

    await client.query(`
      INSERT INTO users (name, email, phone, password_hash, role, status, is_phone_verified, is_email_verified)
      VALUES
        ('Super Admin',   'admin@ssklogistics.in',   '9000000001', $1, 'admin',  'active', true, true),
        ('Test Client',   'client@ssklogistics.in',  '9000000002', $1, 'client', 'active', true, true),
        ('Test Broker',   'broker@ssklogistics.in',  '9000000003', $1, 'broker', 'active', true, true),
        ('Test Driver',   'driver@ssklogistics.in',  '9000000004', $1, 'driver', 'active', true, true)
      ON CONFLICT (phone) DO NOTHING;
    `, [passwordHash]);

    console.log('✅ Seed complete!');
    console.log('   Admin   → phone: 9000000001 | password: Admin@123456');
    console.log('   Client  → phone: 9000000002 | password: Admin@123456');
    console.log('   Broker  → phone: 9000000003 | password: Admin@123456');
    console.log('   Driver  → phone: 9000000004 | password: Admin@123456');
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
};

seed();

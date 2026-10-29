// Test environment is configured BEFORE any app module is imported (config reads env at import time).
process.env.NODE_ENV = 'test';
process.env.ENABLE_CRON = 'false';
process.env.JWT_SECRET ||= 'test-secret-test-secret-test-secret';
process.env.DB_NAME = process.env.DB_TEST_NAME || 'gym_classes_test';
process.env.BOOKING_CUTOFF_MINUTES = '120';
process.env.GYM_TIMEZONE ||= 'Asia/Kolkata';

const { config } = await import('../../src/config.js');
const mysql = (await import('mysql2/promise')).default;

export async function dbAvailable() {
  try {
    const { host, port, user, password } = config.db;
    const c = await mysql.createConnection({ host, port, user, password, connectTimeout: 2000 });
    await c.end();
    return true;
  } catch {
    return false;
  }
}

export async function prepareDatabase() {
  const { migrate } = await import('../../scripts/migrate.js');
  await migrate(config.db.database);
  return (await import('../../src/db.js')).pool;
}

export async function reset(pool) {
  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of ['notifications', 'bookings', 'classes', 'memberships', 'membership_plans', 'users']) await pool.query(`TRUNCATE TABLE ${t}`);
  await pool.query('SET FOREIGN_KEY_CHECKS = 1');
}

let counter = 0;
export function factory(pool) {
  const { dateInTz, addDays, toSql } = { ...awaitedTime };
  const today = () => dateInTz(new Date(), config.gymTimezone);
  const api = {
    async user(role = 'member', name) {
      counter += 1;
      const [r] = await pool.query('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)', [name || `${role} ${counter}`, `${role}${counter}@t.test`, 'x', role]);
      return r.insertId;
    },
    async plan(type = 'monthly') {
      const [r] = await pool.query('INSERT INTO membership_plans (name, type, price_minor) VALUES (?, ?, 100)', [type, type]);
      return r.insertId;
    },
    async membership(userId, planId, startOffset = -1, endOffset = 30) {
      await pool.query('INSERT INTO memberships (user_id, plan_id, start_date, end_date) VALUES (?, ?, ?, ?)', [userId, planId, addDays(today(), startOffset), addDays(today(), endOffset)]);
    },
    /** member with a valid membership */
    async activeMember() {
      const u = await api.user('member');
      api.planId ||= await api.plan();
      await api.membership(u, api.planId);
      return u;
    },
    async klass({ capacity = 2, startsInMinutes = 24 * 60, trainerId, durationMinutes = 60 } = {}) {
      const trainer = trainerId ?? (await api.user('trainer'));
      const starts = new Date(Date.now() + startsInMinutes * 60_000);
      const [r] = await pool.query('INSERT INTO classes (title, trainer_id, starts_at, duration_minutes, capacity) VALUES (?, ?, ?, ?, ?)', ['Test Class', trainer, toSql(starts), durationMinutes, capacity]);
      return { id: r.insertId, trainerId: trainer };
    },
    async rows(classId) {
      const [rows] = await pool.query('SELECT id, user_id, status, cancel_reason FROM bookings WHERE class_id = ? ORDER BY id', [classId]);
      return rows;
    },
    async occupied(classId) {
      const [[r]] = await pool.query("SELECT COUNT(*) AS n FROM bookings WHERE class_id = ? AND status IN ('booked','attended','no_show')", [classId]);
      return Number(r.n);
    },
  };
  return api;
}
const awaitedTime = await import('../../src/lib/time.js');

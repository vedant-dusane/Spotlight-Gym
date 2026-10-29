// Wipes ALL data and loads demo data. Run with: npm run db:seed (or db:reset to migrate + seed).
import bcrypt from 'bcryptjs';
import { pool } from '../src/db.js';
import { config } from '../src/config.js';
import { addDays, dateInTz, toSql } from '../src/lib/time.js';
import { membershipEndDate } from '../src/lib/policy.js';
import { runExpiryReminders } from '../src/jobs/expiryReminders.js';

const PASSWORDS = { admin: 'Admin123!', trainer: 'Trainer123!', member: 'Member123!' };
const now = new Date();
const today = dateInTz(now, config.gymTimezone);

const minutesFromNow = (m) => new Date(now.getTime() + m * 60_000);
// Regular timetable slots. 01:30 UTC = 07:00 IST and 12:30 UTC = 18:00 IST (shift them if your gym is elsewhere).
const slot = (dayOffset, h, min) => { const d = new Date(now); d.setUTCDate(d.getUTCDate() + dayOffset); d.setUTCHours(h, min, 0, 0); return d; };

async function insert(table, row) {
  const keys = Object.keys(row);
  const [res] = await pool.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, keys.map((k) => row[k]));
  return res.insertId;
}

async function main() {
  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of ['notifications', 'bookings', 'classes', 'memberships', 'membership_plans', 'users']) await pool.query(`TRUNCATE TABLE ${t}`);
  await pool.query('SET FOREIGN_KEY_CHECKS = 1');

  const hashes = Object.fromEntries(await Promise.all(Object.entries(PASSWORDS).map(async ([k, v]) => [k, await bcrypt.hash(v, 10)])));
  const user = (name, email, role) => insert('users', { name, email, role, password_hash: hashes[role] });

  const admin = await user('Ava Admin', 'admin@gym.test', 'admin');
  const tara = await user('Tara Trainer', 'tara@gym.test', 'trainer');
  const tom = await user('Tom Trainer', 'tom@gym.test', 'trainer');
  const alice = await user('Alice Member', 'alice@gym.test', 'member');
  const bob = await user('Bob Member', 'bob@gym.test', 'member');
  const carol = await user('Carol Member', 'carol@gym.test', 'member');
  const dave = await user('Dave Expired', 'dave@gym.test', 'member');
  const eve = await user('Eve NoPlan', 'eve@gym.test', 'member');
  const frank = await user('Frank Member', 'frank@gym.test', 'member');
  const grace = await user('Grace Member', 'grace@gym.test', 'member');

  const monthly = await insert('membership_plans', { name: 'Monthly', type: 'monthly', price_minor: 199900 });
  const quarterly = await insert('membership_plans', { name: 'Quarterly', type: 'quarterly', price_minor: 549900 });

  const membership = (userId, planId, start, end) => insert('memberships', { user_id: userId, plan_id: planId, start_date: start, end_date: end });
  const buy = (userId, planId, type, start) => membership(userId, planId, start, membershipEndDate(start, type));
  await buy(alice, quarterly, 'quarterly', addDays(today, -20));
  await buy(bob, monthly, 'monthly', addDays(today, -10));
  await membership(carol, monthly, addDays(today, -27), addDays(today, 3));   // expires in 3 days -> reminder demo
  await membership(dave, monthly, addDays(today, -60), addDays(today, -31));  // expired
  // eve: no membership at all
  await buy(frank, quarterly, 'quarterly', addDays(today, -5));
  await buy(grace, monthly, 'monthly', addDays(today, -1));

  const cls = (title, trainer, startsAt, capacity, duration = 60, description = null) =>
    insert('classes', { title, description, trainer_id: trainer, starts_at: toSql(startsAt), duration_minutes: duration, capacity });
  const book = (classId, userId, status = 'booked') => insert('bookings', { class_id: classId, user_id: userId, status });

  // Regular timetable for the next 7 days
  for (let d = 1; d <= 7; d += 1) {
    await cls('Morning Yoga', tara, slot(d, 1, 30), 12, 60, 'Slow flow to start the day. All levels.');
    await cls('Evening HIIT', tom, slot(d, 12, 30), 10, 45, 'High-intensity intervals. Bring water and a towel.');
  }
  // Demo: a FULL class (2/2) with a waitlist of 2. Sign in as alice and cancel -> carol is promoted automatically.
  const full = await cls('Sunrise Vinyasa (FULL demo)', tara, slot(1, 3, 0), 2, 60, 'Capacity 2: alice + bob booked, carol and frank waitlisted.');
  await book(full, alice); await book(full, bob);
  await book(full, carol, 'waitlisted'); await book(full, frank, 'waitlisted');
  // Demo: a one-spot class to try the race ("last spot booked by two people at once").
  await cls('Private Mobility (1 spot)', tom, slot(2, 7, 0), 1, 30, 'Single spot. Great for testing concurrent booking.');
  // Demo: starts in 90 minutes -> inside the 2h cutoff, booking/cancelling is closed.
  await cls('Lunch HIIT (booking closed demo)', tom, minutesFromNow(90), 8, 45);
  // Demo: started 20 minutes ago -> trainer (tara) can mark attendance now.
  const live = await cls('Pilates Core (attendance demo)', tara, minutesFromNow(-20), 10, 60);
  await book(live, alice); await book(live, bob); await book(live, grace);

  // History for the attendance report
  const history = [
    [-2, tara, 'Morning Yoga', [[alice, 'attended'], [bob, 'attended'], [grace, 'no_show']]],
    [-4, tom, 'Evening HIIT', [[alice, 'attended'], [bob, 'no_show'], [frank, 'attended']]],
    [-7, tara, 'Morning Yoga', [[alice, 'attended'], [carol, 'attended'], [frank, 'attended']]],
    [-9, tom, 'Evening HIIT', [[bob, 'attended'], [carol, 'no_show'], [grace, 'attended']]],
    [-12, tara, 'Morning Yoga', [[alice, 'no_show'], [bob, 'attended'], [carol, 'attended']]],
  ];
  for (const [offset, trainer, title, rows] of history) {
    const id = await cls(title, trainer, slot(offset, 1, 30), 12);
    for (const [u, s] of rows) await book(id, u, s);
  }

  const reminders = await runExpiryReminders({ now });

  console.log('\nDemo data loaded.\n');
  console.log('Demo logins');
  console.log('  Admin    admin@gym.test                        /', PASSWORDS.admin);
  console.log('  Trainers tara@gym.test, tom@gym.test           /', PASSWORDS.trainer);
  console.log('  Members  alice, bob, carol, dave, eve, frank, grace @gym.test /', PASSWORDS.member);
  console.log(`\nReminders created: ${reminders.created}. Admin id ${admin}, eve (no plan) id ${eve}, dave (expired) id ${dave}.`);
}

main()
  .then(() => pool.end())
  .catch((err) => { console.error('Seed failed:', err); pool.end().finally(() => process.exit(1)); });

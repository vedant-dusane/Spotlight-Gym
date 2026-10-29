import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { dbAvailable, factory, prepareDatabase, reset } from './helpers.js';

const up = await dbAvailable();
const skip = up ? false : 'MySQL not reachable. Start it (npm run db:up) and check DB_* in .env.';

// One shared pool for the whole file: close it once, after every suite has finished.
after(async () => { if (up) await (await import('../../src/db.js')).pool.end(); });

const rejection = async (promise) => { try { await promise; } catch (e) { return e; } return assert.fail('expected the promise to reject'); };

describe('booking, capacity and waitlist (real MySQL)', { skip }, () => {
  let pool, f, booking, classes, attendance;

  before(async () => {
    pool = await prepareDatabase();
    booking = await import('../../src/services/bookingService.js');
    classes = await import('../../src/services/classService.js');
    attendance = await import('../../src/services/attendanceService.js');
  });
  beforeEach(async () => { await reset(pool); f = factory(pool); });

  test('the last spot is never double-booked: 12 simultaneous requests for 1 spot', async () => {
    const cls = await f.klass({ capacity: 1 });
    const users = await Promise.all(Array.from({ length: 12 }, () => f.activeMember()));
    const results = await Promise.all(users.map((userId) => booking.bookClass({ userId, classId: cls.id })));

    assert.equal(results.filter((r) => r.status === 'booked').length, 1);
    assert.equal(results.filter((r) => r.status === 'waitlisted').length, 11);
    assert.equal(await f.occupied(cls.id), 1);
    // waitlist positions are unique 1..11
    const positions = results.filter((r) => r.status === 'waitlisted').map((r) => r.waitlistPosition).sort((a, b) => a - b);
    assert.deepEqual(positions, Array.from({ length: 11 }, (_, i) => i + 1));
  });

  test('capacity holds for larger classes under load (20 requests, 5 spots)', async () => {
    const cls = await f.klass({ capacity: 5 });
    const users = await Promise.all(Array.from({ length: 20 }, () => f.activeMember()));
    await Promise.all(users.map((userId) => booking.bookClass({ userId, classId: cls.id })));
    assert.equal(await f.occupied(cls.id), 5);
    assert.equal((await f.rows(cls.id)).filter((r) => r.status === 'waitlisted').length, 15);
  });

  test('the same member double-clicking only ever gets one live booking', async () => {
    const cls = await f.klass({ capacity: 5 });
    const userId = await f.activeMember();
    const settled = await Promise.allSettled(Array.from({ length: 6 }, () => booking.bookClass({ userId, classId: cls.id })));
    assert.equal(settled.filter((s) => s.status === 'fulfilled').length, 1);
    assert.equal(settled.filter((s) => s.status === 'rejected').every((s) => ['ALREADY_BOOKED', 'ALREADY_WAITLISTED'].includes(s.reason.code)), true);
    assert.equal((await f.rows(cls.id)).length, 1);
  });

  test('cancelling promotes the waitlist strictly in order, on the server', async () => {
    const cls = await f.klass({ capacity: 2 });
    const [u1, u2, u3, u4, u5] = await Promise.all([1, 2, 3, 4, 5].map(() => f.activeMember()));
    const b1 = await booking.bookClass({ userId: u1, classId: cls.id });
    const b2 = await booking.bookClass({ userId: u2, classId: cls.id });
    await booking.bookClass({ userId: u3, classId: cls.id });   // sequential => deterministic queue order
    await booking.bookClass({ userId: u4, classId: cls.id });
    await booking.bookClass({ userId: u5, classId: cls.id });

    const first = await booking.cancelBooking({ bookingId: b1.bookingId, actor: { id: u1, role: 'member' } });
    assert.deepEqual(first.promoted.map((p) => p.userId), [u3]);
    const second = await booking.cancelBooking({ bookingId: b2.bookingId, actor: { id: u2, role: 'member' } });
    assert.deepEqual(second.promoted.map((p) => p.userId), [u4]);

    const status = Object.fromEntries((await f.rows(cls.id)).map((r) => [r.user_id, r.status]));
    assert.deepEqual([status[u3], status[u4], status[u5]], ['booked', 'booked', 'waitlisted']);
    assert.equal(await f.occupied(cls.id), 2);
    const [notes] = await pool.query("SELECT user_id FROM notifications WHERE kind = 'waitlist_promoted' ORDER BY id");
    assert.deepEqual(notes.map((n) => n.user_id), [u3, u4]);
  });

  test('two cancellations at the same instant promote exactly the first two, never over capacity', async () => {
    const cls = await f.klass({ capacity: 2 });
    const [u1, u2, u3, u4, u5] = await Promise.all([1, 2, 3, 4, 5].map(() => f.activeMember()));
    const b1 = await booking.bookClass({ userId: u1, classId: cls.id });
    const b2 = await booking.bookClass({ userId: u2, classId: cls.id });
    for (const u of [u3, u4, u5]) await booking.bookClass({ userId: u, classId: cls.id });

    await Promise.all([
      booking.cancelBooking({ bookingId: b1.bookingId, actor: { id: u1, role: 'member' } }),
      booking.cancelBooking({ bookingId: b2.bookingId, actor: { id: u2, role: 'member' } }),
    ]);
    const status = Object.fromEntries((await f.rows(cls.id)).map((r) => [r.user_id, r.status]));
    assert.deepEqual([status[u3], status[u4], status[u5]], ['booked', 'booked', 'waitlisted']);
    assert.equal(await f.occupied(cls.id), 2);
  });

  test('a freed spot cannot be stolen by a new booker while people are waiting', async () => {
    const cls = await f.klass({ capacity: 1 });
    const [owner, waiter, sneaky] = await Promise.all([1, 2, 3].map(() => f.activeMember()));
    const b = await booking.bookClass({ userId: owner, classId: cls.id });
    await booking.bookClass({ userId: waiter, classId: cls.id });
    await Promise.all([
      booking.cancelBooking({ bookingId: b.bookingId, actor: { id: owner, role: 'member' } }),
      booking.bookClass({ userId: sneaky, classId: cls.id }),
    ]);
    const status = Object.fromEntries((await f.rows(cls.id)).filter((r) => r.status !== 'cancelled').map((r) => [r.user_id, r.status]));
    assert.equal(status[waiter], 'booked');
    assert.equal(status[sneaky], 'waitlisted');
    assert.equal(await f.occupied(cls.id), 1);
  });

  test('promotion skips (and removes) a waitlisted member whose membership lapsed', async () => {
    const cls = await f.klass({ capacity: 1 });
    const [owner, lapsed, next] = await Promise.all([1, 2, 3].map(() => f.activeMember()));
    const b = await booking.bookClass({ userId: owner, classId: cls.id });
    await booking.bookClass({ userId: lapsed, classId: cls.id });
    await booking.bookClass({ userId: next, classId: cls.id });
    await pool.query("UPDATE memberships SET status = 'cancelled' WHERE user_id = ?", [lapsed]);

    const res = await booking.cancelBooking({ bookingId: b.bookingId, actor: { id: owner, role: 'member' } });
    assert.deepEqual(res.promoted.map((p) => p.userId), [next]);
    const status = Object.fromEntries((await f.rows(cls.id)).map((r) => [r.user_id, r]));
    assert.equal(status[lapsed].status, 'cancelled');
    assert.equal(status[lapsed].cancel_reason, 'membership_inactive');
  });

  test('only members with an active membership can book', async () => {
    const cls = await f.klass();
    const none = await f.user('member');
    assert.equal((await rejection(booking.bookClass({ userId: none, classId: cls.id }))).code, 'MEMBERSHIP_INACTIVE');

    const expired = await f.user('member');
    await f.membership(expired, await f.plan(), -60, -31);
    assert.equal((await rejection(booking.bookClass({ userId: expired, classId: cls.id }))).code, 'MEMBERSHIP_INACTIVE');

    const endsSoon = await f.user('member');
    await f.membership(endsSoon, await f.plan(), -10, 0); // ends today
    const later = await f.klass({ startsInMinutes: 5 * 24 * 60 });
    assert.equal((await rejection(booking.bookClass({ userId: endsSoon, classId: later.id }))).code, 'MEMBERSHIP_EXPIRES_BEFORE_CLASS');
    assert.equal(await f.occupied(cls.id), 0);
  });

  test('booking and cancelling close 2 hours before the class', async () => {
    const userId = await f.activeMember();
    const tooSoon = await f.klass({ startsInMinutes: 90 });
    assert.equal((await rejection(booking.bookClass({ userId, classId: tooSoon.id }))).code, 'BOOKING_CLOSED');

    const ok = await f.klass({ startsInMinutes: 150 });
    const b = await booking.bookClass({ userId, classId: ok.id });
    assert.equal(b.status, 'booked');
    // time passes: now it is 90 minutes before the class
    const later = new Date(Date.now() + 60 * 60_000);
    const err = await rejection(booking.cancelBooking({ bookingId: b.bookingId, actor: { id: userId, role: 'member' }, now: later }));
    assert.equal(err.code, 'CANCEL_WINDOW_CLOSED');
    assert.equal(await f.occupied(ok.id), 1);
  });

  test("members cannot cancel somebody else's booking", async () => {
    const cls = await f.klass();
    const [a, b] = await Promise.all([f.activeMember(), f.activeMember()]);
    const booked = await booking.bookClass({ userId: a, classId: cls.id });
    const err = await rejection(booking.cancelBooking({ bookingId: booked.bookingId, actor: { id: b, role: 'member' } }));
    assert.equal(err.status, 404);
  });

  test('raising capacity moves waitlisted members in immediately, lowering below booked is refused', async () => {
    const cls = await f.klass({ capacity: 1 });
    const [u1, u2, u3] = await Promise.all([1, 2, 3].map(() => f.activeMember()));
    for (const u of [u1, u2, u3]) await booking.bookClass({ userId: u, classId: cls.id });
    const res = await classes.updateClass(cls.id, { capacity: 2 });
    assert.deepEqual(res.promoted.map((p) => p.userId), [u2]);
    assert.equal(await f.occupied(cls.id), 2);
    assert.equal((await rejection(classes.updateClass(cls.id, { capacity: 1 }))).code, 'CAPACITY_BELOW_BOOKED');
  });

  test('cancelling a class cancels all bookings and notifies members', async () => {
    const cls = await f.klass({ capacity: 1 });
    const [u1, u2] = await Promise.all([f.activeMember(), f.activeMember()]);
    await booking.bookClass({ userId: u1, classId: cls.id });
    await booking.bookClass({ userId: u2, classId: cls.id });
    const res = await classes.cancelClass(cls.id);
    assert.equal(res.cancelledBookings, 2);
    assert.equal((await f.rows(cls.id)).every((r) => r.status === 'cancelled'), true);
    assert.equal((await rejection(booking.bookClass({ userId: u1, classId: cls.id }))).code, 'CLASS_CANCELLED');
  });

  test('attendance: only the class trainer, only after start, only confirmed spots', async () => {
    const trainer = await f.user('trainer');
    const other = await f.user('trainer');
    const started = await f.klass({ capacity: 3, startsInMinutes: 30, trainerId: trainer });
    const [u1, u2] = await Promise.all([f.activeMember(), f.activeMember()]);
    // member booked earlier (direct insert: the class "started" after they booked)
    const ids = [];
    for (const u of [u1, u2]) ids.push((await pool.query("INSERT INTO bookings (class_id, user_id, status) VALUES (?, ?, 'booked')", [started.id, u]))[0].insertId);

    const records = [{ bookingId: ids[0], status: 'attended' }, { bookingId: ids[1], status: 'no_show' }];
    const notYet = await rejection(attendance.markAttendance({ classId: started.id, actor: { id: trainer, role: 'trainer' }, records }));
    assert.equal(notYet.code, 'CLASS_NOT_STARTED');

    const after45 = new Date(Date.now() + 45 * 60_000);
    const wrongTrainer = await rejection(attendance.markAttendance({ classId: started.id, actor: { id: other, role: 'trainer' }, records, now: after45 }));
    assert.equal(wrongTrainer.status, 403);

    const bad = await rejection(attendance.markAttendance({ classId: started.id, actor: { id: trainer, role: 'trainer' }, records: [{ bookingId: 999999, status: 'attended' }], now: after45 }));
    assert.equal(bad.status, 400);

    await attendance.markAttendance({ classId: started.id, actor: { id: trainer, role: 'trainer' }, records, now: after45 });
    const status = Object.fromEntries((await f.rows(started.id)).map((r) => [r.user_id, r.status]));
    assert.deepEqual([status[u1], status[u2]], ['attended', 'no_show']);
    assert.equal(await f.occupied(started.id), 2); // attended / no_show still occupy their spot
  });

  test('a trainer cannot be double-booked for overlapping classes', async () => {
    const trainer = await f.user('trainer');
    const start = new Date(Date.now() + 48 * 3600_000);
    await classes.createClass({ title: 'A', trainerId: trainer, startsAt: start, durationMinutes: 60, capacity: 5 });
    const err = await rejection(classes.createClass({ title: 'B', trainerId: trainer, startsAt: new Date(start.getTime() + 30 * 60_000), durationMinutes: 60, capacity: 5 }));
    assert.equal(err.code, 'TRAINER_BUSY');
  });
});

describe('HTTP API: validation, auth and roles (real MySQL)', { skip }, () => {
  let pool, server, base, f;

  before(async () => {
    pool = await prepareDatabase();
    const { createApp } = await import('../../src/app.js');
    server = createApp().listen(0);
    base = `http://127.0.0.1:${server.address().port}/api`;
  });
  beforeEach(async () => { await reset(pool); f = factory(pool); });
  after(() => { server?.closeAllConnections?.(); server?.close(); });

  const call = async (method, path, body, token) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  test('register validates input on the server and never exposes the password hash', async () => {
    const bad = await call('POST', '/auth/register', { name: 'A', email: 'nope', password: 'short' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'VALIDATION_ERROR');
    assert.ok(bad.body.error.details.length >= 2);

    const ok = await call('POST', '/auth/register', { name: 'Zed Member', email: 'Zed@Example.com', password: 'Passw0rd!' });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.user.email, 'zed@example.com');
    assert.equal(ok.body.user.role, 'member');
    assert.equal('password_hash' in ok.body.user, false);

    assert.equal((await call('POST', '/auth/register', { name: 'Zed Two', email: 'zed@example.com', password: 'Passw0rd!' })).status, 409);
    assert.equal((await call('POST', '/auth/login', { email: 'zed@example.com', password: 'wrong-pass1' })).status, 401);
    assert.equal((await call('POST', '/auth/login', { email: 'zed@example.com', password: 'Passw0rd!' })).status, 200);
  });

  test('end to end: member books through the API, role checks are enforced', async () => {
    const reg = await call('POST', '/auth/register', { name: 'Mia Member', email: 'mia@t.test', password: 'Passw0rd!' });
    const token = reg.body.token;
    const cls = await f.klass({ capacity: 1 });

    assert.equal((await call('GET', '/classes')).status, 401);                                  // no token
    assert.equal((await call('POST', `/classes/${cls.id}/bookings`, null, token)).body.error.code, 'MEMBERSHIP_INACTIVE');

    const plan = await f.plan('monthly');
    assert.equal((await call('POST', '/memberships', { planId: plan }, token)).status, 201);    // buys a plan

    const booked = await call('POST', `/classes/${cls.id}/bookings`, null, token);
    assert.equal(booked.status, 201);
    assert.equal((await call('POST', `/classes/${cls.id}/bookings`, null, token)).status, 409); // duplicate

    const list = await call('GET', '/classes', null, token);
    assert.equal(list.body.classes.find((c) => c.id === cls.id).my.status, 'booked');

    // members cannot create classes or read rosters
    const create = await call('POST', '/classes', { title: 'Nope', trainerId: cls.trainerId, startsAt: new Date(Date.now() + 9e7).toISOString(), capacity: 5 }, token);
    assert.equal(create.status, 403);
    assert.equal((await call('GET', `/classes/${cls.id}/roster`, null, token)).status, 403);

    // invalid id and body are rejected before touching the DB
    assert.equal((await call('POST', '/classes/abc/bookings', null, token)).status, 400);
  });
});

import { config } from '../config.js';
import { pool, withTransaction } from '../db.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../errors.js';
import { OCCUPYING, bookingClosesAt } from '../lib/policy.js';
import { fromSql, toSql } from '../lib/time.js';
import { lockClass } from './bookingService.js';
import { addNotification } from './notificationService.js';
import { countOccupied, promoteWaitlist } from './waitlistService.js';

export function serializeClass(r) {
  const startsAt = fromSql(r.starts_at);
  const booked = Number(r.booked_count ?? 0);
  const my = r.my_booking_id
    ? { bookingId: r.my_booking_id, status: r.my_status, waitlistPosition: r.my_status === 'waitlisted' ? Number(r.my_position) : null }
    : null;
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    trainerId: r.trainer_id,
    trainerName: r.trainer_name,
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + r.duration_minutes * 60_000).toISOString(),
    durationMinutes: r.duration_minutes,
    capacity: r.capacity,
    status: r.status,
    bookedCount: booked,
    waitlistCount: Number(r.waitlist_count ?? 0),
    spotsLeft: Math.max(0, r.capacity - booked),
    isFull: booked >= r.capacity,
    bookingClosesAt: bookingClosesAt(startsAt, config.bookingCutoffMinutes).toISOString(),
    my,
  };
}

/** Class list with live counts and (optionally) the calling member's own booking. One query, no N+1. */
export async function listClasses({ from, to, userId = null, trainerId = null }) {
  const params = [userId, toSql(from), toSql(to)];
  let trainerSql = '';
  if (trainerId) { trainerSql = 'AND c.trainer_id = ?'; params.push(trainerId); }
  const [rows] = await pool.query(
    `SELECT c.*, u.name AS trainer_name,
            (SELECT COUNT(*) FROM bookings b WHERE b.class_id = c.id AND b.status IN (?)) AS booked_count,
            (SELECT COUNT(*) FROM bookings b WHERE b.class_id = c.id AND b.status = 'waitlisted') AS waitlist_count,
            mb.id AS my_booking_id, mb.status AS my_status,
            (SELECT COUNT(*) FROM bookings w WHERE w.class_id = c.id AND w.status = 'waitlisted' AND w.id <= mb.id) AS my_position
       FROM classes c
       JOIN users u ON u.id = c.trainer_id
       LEFT JOIN bookings mb ON mb.class_id = c.id AND mb.user_id = ? AND mb.status <> 'cancelled'
      WHERE c.starts_at >= ? AND c.starts_at < ? ${trainerSql}
      ORDER BY c.starts_at ASC, c.id ASC
      LIMIT 500`,
    [OCCUPYING, ...params],
  );
  return rows.map(serializeClass);
}

async function assertTrainer(conn, trainerId) {
  // FOR UPDATE on the trainer row also serialises concurrent schedule changes for the same trainer.
  const [rows] = await conn.query("SELECT id FROM users WHERE id = ? AND role = 'trainer' FOR UPDATE", [trainerId]);
  if (!rows.length) throw badRequest('Selected trainer does not exist.', [{ field: 'trainerId', message: 'Choose a valid trainer' }]);
}

async function assertNoTrainerClash(conn, trainerId, startsAt, durationMinutes, excludeId) {
  const end = new Date(startsAt.getTime() + durationMinutes * 60_000);
  const [rows] = await conn.query(
    `SELECT id, title FROM classes
      WHERE trainer_id = ? AND status = 'scheduled' AND id <> ?
        AND starts_at < ? AND DATE_ADD(starts_at, INTERVAL duration_minutes MINUTE) > ? LIMIT 1`,
    [trainerId, excludeId ?? 0, toSql(end), toSql(startsAt)],
  );
  if (rows.length) throw conflict('TRAINER_BUSY', `That trainer is already teaching "${rows[0].title}" at an overlapping time.`);
}

export async function createClass(input, now = new Date()) {
  return withTransaction(async (conn) => {
    await assertTrainer(conn, input.trainerId);
    if (input.startsAt <= now) throw badRequest('Class start time must be in the future.', [{ field: 'startsAt', message: 'Must be in the future' }]);
    await assertNoTrainerClash(conn, input.trainerId, input.startsAt, input.durationMinutes, null);
    const [res] = await conn.query(
      'INSERT INTO classes (title, description, trainer_id, starts_at, duration_minutes, capacity) VALUES (?, ?, ?, ?, ?, ?)',
      [input.title, input.description || null, input.trainerId, toSql(input.startsAt), input.durationMinutes, input.capacity],
    );
    return { id: res.insertId };
  });
}

export async function updateClass(classId, patch, now = new Date()) {
  return withTransaction(async (conn) => {
    const cls = await lockClass(conn, classId);
    if (cls.status === 'cancelled') throw conflict('CLASS_CANCELLED', 'This class is cancelled and cannot be edited.');
    if (fromSql(cls.starts_at) <= now) throw conflict('CLASS_STARTED', 'This class has already started and cannot be edited.');

    const next = {
      title: patch.title ?? cls.title,
      description: patch.description === undefined ? cls.description : patch.description,
      trainerId: patch.trainerId ?? cls.trainer_id,
      startsAt: patch.startsAt ?? fromSql(cls.starts_at),
      durationMinutes: patch.durationMinutes ?? cls.duration_minutes,
      capacity: patch.capacity ?? cls.capacity,
    };

    const occupied = await countOccupied(conn, classId);
    if (next.capacity < occupied) {
      throw conflict('CAPACITY_BELOW_BOOKED', `${occupied} members are already booked, so capacity cannot go below ${occupied}.`);
    }
    if (next.startsAt <= now) throw badRequest('Class start time must be in the future.', [{ field: 'startsAt', message: 'Must be in the future' }]);

    const timeOrTrainerChanged = patch.startsAt || patch.trainerId || patch.durationMinutes;
    if (timeOrTrainerChanged) {
      await assertTrainer(conn, next.trainerId);
      await assertNoTrainerClash(conn, next.trainerId, next.startsAt, next.durationMinutes, classId);
    }

    await conn.query(
      'UPDATE classes SET title = ?, description = ?, trainer_id = ?, starts_at = ?, duration_minutes = ?, capacity = ? WHERE id = ?',
      [next.title, next.description || null, next.trainerId, toSql(next.startsAt), next.durationMinutes, next.capacity, classId],
    );

    // More capacity => waitlisted members move in right now, in order.
    const promoted = await promoteWaitlist(conn, { ...cls, capacity: next.capacity }, now);

    if (patch.startsAt) {
      const [people] = await conn.query("SELECT user_id FROM bookings WHERE class_id = ? AND status IN ('booked','waitlisted')", [classId]);
      for (const p of people) {
        await addNotification(conn, { userId: p.user_id, kind: 'class_rescheduled', message: `"${next.title}" was rescheduled. Please check the new time.` });
      }
    }
    return { id: classId, promoted };
  });
}

export async function cancelClass(classId, now = new Date()) {
  return withTransaction(async (conn) => {
    const cls = await lockClass(conn, classId);
    if (cls.status === 'cancelled') throw conflict('CLASS_CANCELLED', 'This class is already cancelled.');
    if (fromSql(cls.starts_at) <= now) throw conflict('CLASS_STARTED', 'This class has already started.');

    await conn.query("UPDATE classes SET status = 'cancelled' WHERE id = ?", [classId]);
    const [people] = await conn.query("SELECT id, user_id FROM bookings WHERE class_id = ? AND status IN ('booked','waitlisted') FOR UPDATE", [classId]);
    await conn.query(
      "UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancel_reason = 'class_cancelled' WHERE class_id = ? AND status IN ('booked','waitlisted')",
      [toSql(now), classId],
    );
    for (const p of people) {
      await addNotification(conn, { userId: p.user_id, kind: 'class_cancelled', message: `"${cls.title}" has been cancelled.` });
    }
    return { cancelledBookings: people.length };
  });
}

/** Roster for a class. Only the class's own trainer or an admin may see it. */
export async function getRoster(classId, actor) {
  const [classes] = await pool.query(
    'SELECT c.*, u.name AS trainer_name FROM classes c JOIN users u ON u.id = c.trainer_id WHERE c.id = ?',
    [classId],
  );
  if (!classes.length) throw notFound('Class');
  const cls = classes[0];
  if (actor.role !== 'admin' && !(actor.role === 'trainer' && cls.trainer_id === actor.id)) {
    throw forbidden('Only the trainer of this class can view its roster.');
  }
  const [rows] = await pool.query(
    `SELECT b.id, b.status, u.id AS user_id, u.name, u.email
       FROM bookings b JOIN users u ON u.id = b.user_id
      WHERE b.class_id = ? AND b.status <> 'cancelled'
      ORDER BY FIELD(b.status, 'booked', 'attended', 'no_show', 'waitlisted'), b.id`,
    [classId],
  );
  let pos = 0;
  const entries = rows.map((r) => ({
    bookingId: r.id, userId: r.user_id, name: r.name, email: r.email, status: r.status,
    waitlistPosition: r.status === 'waitlisted' ? ++pos : null,
  }));
  const booked = entries.filter((e) => OCCUPYING.includes(e.status)).length;
  return {
    class: serializeClass({ ...cls, booked_count: booked, waitlist_count: pos }),
    entries,
    canMarkAttendance: cls.status === 'scheduled' && fromSql(cls.starts_at) <= new Date(),
  };
}

export { AppError };

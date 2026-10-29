import { config } from '../config.js';
import { withTransaction, pool } from '../db.js';
import { AppError, conflict, forbidden, notFound } from '../errors.js';
import { OCCUPYING, bookingClosesAt, isWithinChangeWindow } from '../lib/policy.js';
import { fromSql, toSql } from '../lib/time.js';
import { checkEligibility, countOccupied, countWaitlisted, promoteWaitlist } from './waitlistService.js';

/**
 * THE concurrency primitive of the app.
 * Every operation that can change who holds a spot in a class takes this row lock FIRST.
 * Transactions for the same class therefore run one at a time; different classes never block each other.
 */
export async function lockClass(conn, classId) {
  const [rows] = await conn.query('SELECT * FROM classes WHERE id = ? FOR UPDATE', [classId]);
  if (!rows.length) throw notFound('Class');
  return rows[0];
}

const waitlistPosition = async (conn, classId, bookingId) => {
  const [[row]] = await conn.query("SELECT COUNT(*) AS n FROM bookings WHERE class_id = ? AND status = 'waitlisted' AND id <= ?", [classId, bookingId]);
  return Number(row.n);
};

/** Book a spot, or join the waitlist if the class is full. */
export async function bookClass({ userId, classId, now = new Date() }) {
  return withTransaction(async (conn) => {
    const cls = await lockClass(conn, classId);   // <- nothing else may touch this class until we commit
    const startsAt = fromSql(cls.starts_at);

    if (cls.status !== 'scheduled') throw conflict('CLASS_CANCELLED', 'This class has been cancelled.');
    if (!isWithinChangeWindow(startsAt, now, config.bookingCutoffMinutes)) {
      throw conflict('BOOKING_CLOSED', `Booking closes ${config.bookingCutoffMinutes / 60} hours before the class starts.`);
    }

    const [existing] = await conn.query("SELECT id, status FROM bookings WHERE class_id = ? AND user_id = ? AND status <> 'cancelled'", [classId, userId]);
    if (existing.length) {
      throw conflict(existing[0].status === 'waitlisted' ? 'ALREADY_WAITLISTED' : 'ALREADY_BOOKED',
        existing[0].status === 'waitlisted' ? 'You are already on the waitlist for this class.' : 'You have already booked this class.');
    }

    const eligibility = await checkEligibility(conn, userId, cls, now);
    if (!eligibility.ok) throw new AppError(403, eligibility.code, eligibility.message);

    // Self-heal: if a spot is free while people are waiting (e.g. capacity was raised), fill it first.
    await promoteWaitlist(conn, cls, now);

    const occupied = await countOccupied(conn, classId);
    const waiting = await countWaitlisted(conn, classId);
    // Join the queue if the class is full OR others are already waiting (no jumping the line).
    const status = occupied < cls.capacity && waiting === 0 ? 'booked' : 'waitlisted';

    let insertId;
    try {
      const [res] = await conn.query('INSERT INTO bookings (class_id, user_id, status) VALUES (?, ?, ?)', [classId, userId, status]);
      insertId = res.insertId;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw conflict('ALREADY_BOOKED', 'You have already booked this class.');
      throw err;
    }

    if (status === 'booked') {
      return { bookingId: insertId, status, waitlistPosition: null, message: `You're booked into "${cls.title}".` };
    }
    const position = await waitlistPosition(conn, classId, insertId);
    return { bookingId: insertId, status, waitlistPosition: position, message: `"${cls.title}" is full. You're #${position} on the waitlist and will be moved in automatically if a spot opens.` };
  });
}

/**
 * Cancel a booking or leave the waitlist.
 * Cancelling a confirmed spot immediately promotes the first eligible person on the waitlist - in the
 * SAME transaction, so the spot can never be seen as "free" by anybody else.
 */
export async function cancelBooking({ bookingId, actor, now = new Date() }) {
  return withTransaction(async (conn) => {
    const [pre] = await conn.query('SELECT class_id FROM bookings WHERE id = ?', [bookingId]);
    if (!pre.length) throw notFound('Booking');

    const cls = await lockClass(conn, pre[0].class_id);
    const [rows] = await conn.query('SELECT * FROM bookings WHERE id = ? FOR UPDATE', [bookingId]);
    const booking = rows[0];
    if (!booking) throw notFound('Booking');

    const isAdmin = actor.role === 'admin';
    if (!isAdmin && booking.user_id !== actor.id) throw notFound('Booking'); // do not reveal other people's bookings

    if (booking.status === 'cancelled') throw conflict('ALREADY_CANCELLED', 'This booking is already cancelled.');
    if (booking.status === 'attended' || booking.status === 'no_show') {
      throw conflict('ALREADY_MARKED', 'Attendance has already been recorded for this booking.');
    }

    const startsAt = fromSql(cls.starts_at);
    if (booking.status === 'booked' && !isAdmin && !isWithinChangeWindow(startsAt, now, config.bookingCutoffMinutes)) {
      throw conflict('CANCEL_WINDOW_CLOSED', `Bookings can only be cancelled up to ${config.bookingCutoffMinutes / 60} hours before the class starts.`);
    }
    if (booking.status === 'waitlisted' && startsAt <= now && !isAdmin) {
      throw conflict('CLASS_STARTED', 'This class has already started.');
    }

    const wasOccupying = OCCUPYING.includes(booking.status);
    await conn.query(
      "UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancel_reason = ? WHERE id = ?",
      [toSql(now), isAdmin && booking.user_id !== actor.id ? 'admin' : 'member', bookingId],
    );

    const promoted = wasOccupying ? await promoteWaitlist(conn, cls, now) : [];
    return {
      cancelled: true,
      message: booking.status === 'waitlisted' ? 'You left the waitlist.' : 'Your booking was cancelled.',
      promoted,
    };
  });
}

/** A member's bookings with class details. scope = upcoming | past */
export async function listMyBookings(userId, scope, now = new Date()) {
  const upcoming = scope === 'upcoming';
  const [rows] = await pool.query(
    `SELECT b.id, b.status, b.created_at, c.id AS class_id, c.title, c.starts_at, c.duration_minutes, c.status AS class_status,
            u.name AS trainer_name,
            (SELECT COUNT(*) FROM bookings w WHERE w.class_id = b.class_id AND w.status = 'waitlisted' AND w.id <= b.id) AS position
       FROM bookings b
       JOIN classes c ON c.id = b.class_id
       JOIN users u ON u.id = c.trainer_id
      WHERE b.user_id = ? AND b.status <> 'cancelled'
        AND ${upcoming ? 'c.starts_at >= ?' : 'c.starts_at < ?'}
      ORDER BY c.starts_at ${upcoming ? 'ASC' : 'DESC'}
      LIMIT 100`,
    [userId, toSql(now)],
  );
  return rows.map((r) => {
    const startsAt = fromSql(r.starts_at);
    return {
      id: r.id,
      status: r.status,
      waitlistPosition: r.status === 'waitlisted' ? Number(r.position) : null,
      classId: r.class_id,
      title: r.title,
      trainerName: r.trainer_name,
      startsAt: startsAt.toISOString(),
      durationMinutes: r.duration_minutes,
      classStatus: r.class_status,
      canCancel: r.class_status === 'scheduled' && (r.status === 'waitlisted' ? startsAt > now : isWithinChangeWindow(startsAt, now, config.bookingCutoffMinutes)),
      cancelClosesAt: bookingClosesAt(startsAt, config.bookingCutoffMinutes).toISOString(),
    };
  });
}

export { forbidden };

import { config } from '../config.js';
import { OCCUPYING, evaluateEligibility } from '../lib/policy.js';
import { dateInTz, fromSql, toSql } from '../lib/time.js';
import { addNotification } from './notificationService.js';

export async function checkEligibility(conn, userId, cls, now) {
  const [memberships] = await conn.query(
    "SELECT id, status, start_date, end_date FROM memberships WHERE user_id = ? AND status = 'active'",
    [userId],
  );
  return evaluateEligibility(memberships, {
    today: dateInTz(now, config.gymTimezone),
    classDate: dateInTz(fromSql(cls.starts_at), config.gymTimezone),
  });
}

export async function countOccupied(conn, classId) {
  const [[row]] = await conn.query('SELECT COUNT(*) AS n FROM bookings WHERE class_id = ? AND status IN (?)', [classId, OCCUPYING]);
  return Number(row.n);
}

export async function countWaitlisted(conn, classId) {
  const [[row]] = await conn.query("SELECT COUNT(*) AS n FROM bookings WHERE class_id = ? AND status = 'waitlisted'", [classId]);
  return Number(row.n);
}

/**
 * Fills every free spot from the waitlist, strictly first-come-first-served (ORDER BY id).
 *
 * MUST be called inside a transaction that already holds the class row lock (SELECT ... FOR UPDATE),
 * which is what makes "check free spot -> promote" atomic. A waitlisted member whose membership has
 * lapsed is dropped (and told) instead of blocking everybody behind them.
 */
export async function promoteWaitlist(conn, cls, now = new Date()) {
  const promoted = [];
  if (cls.status !== 'scheduled' || fromSql(cls.starts_at) <= now) return promoted;

  for (;;) {
    if ((await countOccupied(conn, cls.id)) >= cls.capacity) break;

    const [rows] = await conn.query(
      "SELECT id, user_id FROM bookings WHERE class_id = ? AND status = 'waitlisted' ORDER BY id ASC LIMIT 1 FOR UPDATE",
      [cls.id],
    );
    if (!rows.length) break;
    const next = rows[0];

    const eligibility = await checkEligibility(conn, next.user_id, cls, now);
    if (eligibility.ok) {
      await conn.query("UPDATE bookings SET status = 'booked', promoted_at = ? WHERE id = ?", [toSql(now), next.id]);
      await addNotification(conn, {
        userId: next.user_id,
        kind: 'waitlist_promoted',
        message: `You're in! A spot opened up and you were moved from the waitlist into "${cls.title}".`,
      });
      promoted.push({ bookingId: next.id, userId: next.user_id });
    } else {
      await conn.query(
        "UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancel_reason = 'membership_inactive' WHERE id = ?",
        [toSql(now), next.id],
      );
      await addNotification(conn, {
        userId: next.user_id,
        kind: 'waitlist_removed',
        message: `You were removed from the waitlist for "${cls.title}" because your membership is not valid for that class.`,
      });
    }
  }
  return promoted;
}

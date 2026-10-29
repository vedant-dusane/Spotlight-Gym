import { withTransaction } from '../db.js';
import { badRequest, conflict, forbidden } from '../errors.js';
import { canMarkAttendance } from '../lib/policy.js';
import { fromSql } from '../lib/time.js';
import { lockClass } from './bookingService.js';

/**
 * Trainer marks attendance for their own class. Only confirmed spots can be marked, only once the class
 * has started, and re-marking is allowed (to fix a mistake). All-or-nothing: one bad id rolls back everything.
 */
export async function markAttendance({ classId, actor, records, now = new Date() }) {
  return withTransaction(async (conn) => {
    const cls = await lockClass(conn, classId);
    if (actor.role !== 'admin' && !(actor.role === 'trainer' && cls.trainer_id === actor.id)) {
      throw forbidden('You can only mark attendance for your own classes.');
    }
    if (cls.status !== 'scheduled') throw conflict('CLASS_CANCELLED', 'This class was cancelled.');
    if (!canMarkAttendance(fromSql(cls.starts_at), now)) throw conflict('CLASS_NOT_STARTED', 'Attendance can be marked once the class has started.');

    const ids = records.map((r) => r.bookingId);
    if (new Set(ids).size !== ids.length) throw badRequest('Each booking can only appear once.');

    const [rows] = await conn.query(
      "SELECT id FROM bookings WHERE class_id = ? AND id IN (?) AND status IN ('booked','attended','no_show') FOR UPDATE",
      [classId, ids],
    );
    if (rows.length !== ids.length) {
      throw badRequest('Some bookings do not belong to this class or are not confirmed spots.', [{ field: 'records', message: 'Unknown booking id' }]);
    }
    for (const r of records) {
      await conn.query('UPDATE bookings SET status = ? WHERE id = ?', [r.status, r.bookingId]);
    }
    return { updated: records.length };
  });
}

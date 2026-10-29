import { config } from '../config.js';
import { pool } from '../db.js';
import { notFound } from '../errors.js';
import { addDays, dateInTz, fromSql, toSql } from '../lib/time.js';

const range = (q, now) => {
  const t = dateInTz(now, config.gymTimezone);
  return { from: q.from || addDays(t, -90), to: q.to || t };
};
const rate = (attended, noShow) => (attended + noShow ? Math.round((attended / (attended + noShow)) * 100) : null);

/** Per-member attendance summary for classes that have already started (stretch goal). */
export async function allMembersReport(q = {}, now = new Date()) {
  const { from, to } = range(q, now);
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.email,
            COALESCE(SUM(x.status = 'attended'), 0) AS attended,
            COALESCE(SUM(x.status = 'no_show'), 0) AS no_show,
            COALESCE(SUM(x.status = 'booked'), 0) AS unmarked,
            COALESCE(SUM(x.status = 'cancelled'), 0) AS cancelled
       FROM users u
       LEFT JOIN (SELECT b.user_id, b.status FROM bookings b JOIN classes c ON c.id = b.class_id
                   WHERE c.starts_at >= ? AND c.starts_at < ? AND c.starts_at < ?) x ON x.user_id = u.id
      WHERE u.role = 'member' GROUP BY u.id ORDER BY attended DESC, u.name`,
    [`${from} 00:00:00`, `${addDays(to, 1)} 00:00:00`, toSql(now)],
  );
  return { from, to, members: rows.map((r) => ({ id: r.id, name: r.name, email: r.email, attended: +r.attended, noShow: +r.no_show, unmarked: +r.unmarked, cancelled: +r.cancelled, attendanceRate: rate(+r.attended, +r.no_show) })) };
}

export async function memberReport(userId, q = {}, now = new Date()) {
  const { from, to } = range(q, now);
  const [users] = await pool.query("SELECT id, name, email FROM users WHERE id = ? AND role = 'member'", [userId]);
  if (!users.length) throw notFound('Member');
  const [rows] = await pool.query(
    `SELECT b.id, b.status, c.title, c.starts_at, t.name AS trainer_name
       FROM bookings b JOIN classes c ON c.id = b.class_id JOIN users t ON t.id = c.trainer_id
      WHERE b.user_id = ? AND c.starts_at >= ? AND c.starts_at < ? AND c.starts_at < ?
      ORDER BY c.starts_at DESC LIMIT 200`,
    [userId, `${from} 00:00:00`, `${addDays(to, 1)} 00:00:00`, toSql(now)],
  );
  const count = (s) => rows.filter((r) => r.status === s).length;
  const attended = count('attended'); const noShow = count('no_show');
  return {
    member: users[0], from, to,
    totals: { attended, noShow, unmarked: count('booked'), cancelled: count('cancelled'), attendanceRate: rate(attended, noShow) },
    history: rows.map((r) => ({ id: r.id, status: r.status, title: r.title, trainerName: r.trainer_name, startsAt: fromSql(r.starts_at).toISOString() })),
  };
}

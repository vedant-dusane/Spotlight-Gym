import { config } from '../config.js';
import { pool, withTransaction } from '../db.js';
import { AppError, badRequest, conflict, notFound } from '../errors.js';
import { membershipEndDate, membershipState } from '../lib/policy.js';
import { addDays, dateInTz } from '../lib/time.js';
import { addNotification } from './notificationService.js';

const today = (now = new Date()) => dateInTz(now, config.gymTimezone);

export async function listPlans({ includeInactive = false } = {}) {
  const [rows] = await pool.query(`SELECT id, name, type, price_minor, is_active FROM membership_plans ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY price_minor`);
  return rows.map((p) => ({ id: p.id, name: p.name, type: p.type, priceMinor: p.price_minor, isActive: !!p.is_active }));
}

export async function createPlan({ name, type, priceMinor }) {
  const [res] = await pool.query('INSERT INTO membership_plans (name, type, price_minor) VALUES (?, ?, ?)', [name, type, priceMinor]);
  return { id: res.insertId };
}

export async function updatePlan(id, patch) {
  const sets = []; const vals = [];
  if (patch.name !== undefined) { sets.push('name = ?'); vals.push(patch.name); }
  if (patch.priceMinor !== undefined) { sets.push('price_minor = ?'); vals.push(patch.priceMinor); }
  if (patch.isActive !== undefined) { sets.push('is_active = ?'); vals.push(patch.isActive ? 1 : 0); }
  const [res] = await pool.query(`UPDATE membership_plans SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
  if (!res.affectedRows) throw notFound('Plan');
}

/**
 * Buy a plan. By default it starts today, or the day after the member's latest membership ends
 * (so renewing early never wastes days). An explicit start date must not overlap an existing membership.
 * The member row is locked so two simultaneous purchases cannot both pass the overlap check.
 */
export async function purchaseMembership({ userId, planId, startDate, now = new Date() }) {
  return withTransaction(async (conn) => {
    const [users] = await conn.query("SELECT id FROM users WHERE id = ? AND role = 'member' FOR UPDATE", [userId]);
    if (!users.length) throw badRequest('Memberships can only be bought for member accounts.', [{ field: 'userId', message: 'Not a member account' }]);

    const [plans] = await conn.query('SELECT * FROM membership_plans WHERE id = ?', [planId]);
    if (!plans.length) throw notFound('Plan');
    if (!plans[0].is_active) throw conflict('PLAN_INACTIVE', 'This plan is no longer available.');

    const t = today(now);
    const [existing] = await conn.query("SELECT start_date, end_date FROM memberships WHERE user_id = ? AND status = 'active' AND end_date >= ?", [userId, t]);
    const latestEnd = existing.reduce((max, m) => (m.end_date > max ? m.end_date : max), '');

    let start = startDate;
    if (!start) {
      start = latestEnd ? addDays(latestEnd, 1) : t;
    } else {
      if (start < t) throw badRequest('Start date cannot be in the past.', [{ field: 'startDate', message: 'Cannot be in the past' }]);
      if (start > addDays(t, 365)) throw badRequest('Start date is too far in the future.', [{ field: 'startDate', message: 'Max 1 year ahead' }]);
    }
    const end = membershipEndDate(start, plans[0].type);
    if (existing.some((m) => start <= m.end_date && end >= m.start_date)) {
      throw conflict('MEMBERSHIP_OVERLAP', 'This overlaps an existing membership. Leave the start date empty to renew right after it ends.');
    }

    const [res] = await conn.query('INSERT INTO memberships (user_id, plan_id, start_date, end_date) VALUES (?, ?, ?, ?)', [userId, planId, start, end]);
    await addNotification(conn, { userId, kind: 'membership_started', message: `Your ${plans[0].name} membership runs ${start} to ${end}.` });
    return { id: res.insertId, startDate: start, endDate: end };
  });
}

export async function cancelMembership(id) {
  const [res] = await pool.query("UPDATE memberships SET status = 'cancelled' WHERE id = ? AND status = 'active'", [id]);
  if (!res.affectedRows) throw notFound('Active membership');
}

const serialize = (m, t) => ({
  id: m.id, planId: m.plan_id, planName: m.plan_name, planType: m.plan_type,
  startDate: m.start_date, endDate: m.end_date, state: membershipState(m, t),
  daysLeft: m.end_date >= t ? Math.round((Date.parse(m.end_date) - Date.parse(t)) / 86_400_000) : 0,
});

export async function listMemberships(userId, now = new Date()) {
  const t = today(now);
  const [rows] = await pool.query(
    `SELECT m.*, p.name AS plan_name, p.type AS plan_type FROM memberships m JOIN membership_plans p ON p.id = m.plan_id
      WHERE m.user_id = ? ORDER BY m.start_date DESC, m.id DESC`, [userId]);
  const memberships = rows.map((m) => serialize(m, t));
  const current = memberships.find((m) => m.state === 'active') || null;
  return { memberships, current, hasActive: !!current };
}

/** Admin: every member with the state of their most relevant membership. */
export async function listMembers(now = new Date()) {
  const t = today(now);
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.email, u.created_at,
            (SELECT MAX(m.end_date) FROM memberships m WHERE m.user_id = u.id AND m.status = 'active') AS last_end,
            (SELECT COUNT(*) FROM memberships m WHERE m.user_id = u.id AND m.status = 'active' AND m.start_date <= ? AND m.end_date >= ?) AS active_now
       FROM users u WHERE u.role = 'member' ORDER BY u.name`, [t, t]);
  return rows.map((r) => ({
    id: r.id, name: r.name, email: r.email,
    isActive: Number(r.active_now) > 0, membershipEnds: r.last_end,
  }));
}

export { AppError };

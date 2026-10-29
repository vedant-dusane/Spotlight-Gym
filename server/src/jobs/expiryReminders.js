import cron from 'node-cron';
import { config } from '../config.js';
import { pool } from '../db.js';
import { addDays, dateInTz } from '../lib/time.js';
import { addNotification } from '../services/notificationService.js';

/**
 * Creates one in-app reminder per membership that ends within `daysBefore` days and has not been renewed.
 * Idempotent: the dedupe_key (one per membership) means running it twice never duplicates a reminder.
 */
export async function runExpiryReminders({ now = new Date(), daysBefore = config.reminderDaysBefore } = {}) {
  const t = dateInTz(now, config.gymTimezone);
  const [rows] = await pool.query(
    `SELECT m.id, m.user_id, m.end_date, p.name AS plan_name
       FROM memberships m JOIN membership_plans p ON p.id = m.plan_id
      WHERE m.status = 'active' AND m.end_date BETWEEN ? AND ?
        AND NOT EXISTS (SELECT 1 FROM memberships n WHERE n.user_id = m.user_id AND n.status = 'active' AND n.start_date > m.end_date)`,
    [t, addDays(t, daysBefore)],
  );
  let created = 0;
  for (const m of rows) {
    const days = Math.round((Date.parse(m.end_date) - Date.parse(t)) / 86_400_000);
    const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
    const ok = await addNotification(pool, {
      userId: m.user_id, kind: 'membership_expiring', dedupeKey: `expiry:${m.id}`,
      message: `Your ${m.plan_name} membership expires ${when} (${m.end_date}). Renew to keep booking classes.`,
    });
    if (ok) created += 1;
  }
  return { checked: rows.length, created };
}

export function startReminderCron() {
  if (!config.enableCron) return null;
  return cron.schedule('0 8 * * *', () => {
    runExpiryReminders().then((r) => console.log('[cron] expiry reminders', r)).catch((e) => console.error('[cron] failed', e));
  }, { timezone: config.gymTimezone });
}

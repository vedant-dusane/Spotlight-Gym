import { pool } from '../db.js';

/** Works with a pool or a transaction connection. dedupeKey makes repeat inserts a no-op. */
export async function addNotification(conn, { userId, kind, message, dedupeKey = null }) {
  const [res] = await conn.query(
    'INSERT IGNORE INTO notifications (user_id, kind, message, dedupe_key) VALUES (?, ?, ?, ?)',
    [userId, kind, message.slice(0, 255), dedupeKey],
  );
  return res.affectedRows === 1;
}

export async function listNotifications(userId) {
  const [rows] = await pool.query(
    'SELECT id, kind, message, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50',
    [userId],
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind, message: r.message, read: !!r.read_at, createdAt: new Date(`${r.created_at.replace(' ', 'T')}Z`).toISOString() }));
}

export async function markRead(userId, id) {
  await pool.query('UPDATE notifications SET read_at = UTC_TIMESTAMP() WHERE user_id = ? AND id = ? AND read_at IS NULL', [userId, id]);
}

export async function markAllRead(userId) {
  await pool.query('UPDATE notifications SET read_at = UTC_TIMESTAMP() WHERE user_id = ? AND read_at IS NULL', [userId]);
}

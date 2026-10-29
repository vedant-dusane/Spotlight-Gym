import mysql from 'mysql2/promise';
import { config } from './config.js';

export const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 20,
  timezone: 'Z',       // everything stored/read as UTC
  dateStrings: true,   // DATE/DATETIME come back as strings; lib/time.js converts them explicitly
});

const DEADLOCK = 1213;
const LOCK_WAIT_TIMEOUT = 1205;

/**
 * Runs `fn(conn)` inside a transaction and commits, or rolls back if it throws.
 *
 * READ COMMITTED is used on purpose: after we take the class row lock, every later read in the
 * transaction must see rows committed by whoever held the lock before us. (Under REPEATABLE READ
 * a snapshot could be older than the lock acquisition.)
 *
 * Deadlocks / lock timeouts are retried a few times; `fn` must therefore only touch the database.
 */
export async function withTransaction(fn, { retries = 3 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    const conn = await pool.getConnection();
    try {
      await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      try { await conn.rollback(); } catch { /* connection may already be gone */ }
      if ((err.errno === DEADLOCK || err.errno === LOCK_WAIT_TIMEOUT) && attempt < retries) continue;
      throw err;
    } finally {
      conn.release();
    }
  }
}

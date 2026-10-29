import { assertConfig, config } from './config.js';
import { createApp } from './app.js';
import { pool } from './db.js';
import { startReminderCron } from './jobs/expiryReminders.js';

assertConfig();

try {
  await pool.query('SELECT 1');
} catch (err) {
  console.error(`Cannot connect to MySQL at ${config.db.host}:${config.db.port} (db "${config.db.database}"): ${err.message}`);
  console.error('Is the database running? Try: npm run db:up && npm run db:reset');
  process.exit(1);
}

const server = createApp().listen(config.port, () => console.log(`API listening on http://localhost:${config.port}`));
startReminderCron();

const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

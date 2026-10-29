import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// One .env at the repo root. Variables already in the environment win (used by tests/CI).
dotenv.config({ path: path.resolve(here, '../../.env') });

const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 4000),
  clientOrigins: (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: int(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'gym',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'gym_classes',
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },
  gymTimezone: process.env.GYM_TIMEZONE || 'Asia/Kolkata',
  bookingCutoffMinutes: int(process.env.BOOKING_CUTOFF_MINUTES, 120),
  reminderDaysBefore: int(process.env.REMINDER_DAYS_BEFORE, 7),
  enableCron: process.env.ENABLE_CRON !== 'false',
};

/** Fail fast on an unsafe configuration instead of silently running with a weak secret. */
export function assertConfig() {
  if (!config.jwt.secret || config.jwt.secret.length < 16) {
    throw new Error('JWT_SECRET is missing or too short (min 16 chars). Copy .env.example to .env and set it.');
  }
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: config.gymTimezone });
  } catch {
    throw new Error(`GYM_TIMEZONE "${config.gymTimezone}" is not a valid IANA timezone.`);
  }
}

import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { pool } from '../db.js';
import { AppError, asyncHandler, forbidden } from '../errors.js';

/** Verifies the Bearer token, then loads the user fresh from the DB (so role changes apply instantly). */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');

  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
  } catch {
    throw new AppError(401, 'SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
  }

  const [rows] = await pool.query('SELECT id, name, email, role FROM users WHERE id = ?', [payload.sub]);
  if (!rows.length) throw new AppError(401, 'UNAUTHENTICATED', 'Account no longer exists.');
  req.user = rows[0];
  next();
});

export const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user.role) ? next() : next(forbidden());

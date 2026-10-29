import bcrypt from 'bcryptjs';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { pool } from '../db.js';
import { AppError, asyncHandler } from '../errors.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { loginSchema, registerSchema } from '../schemas.js';

const router = Router();
// Slows down password guessing. Disabled under test so suites are not throttled.
const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, skip: () => config.env === 'test',
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again in a few minutes.' } } });

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10); // keeps login timing the same for unknown emails

const sign = (user) => jwt.sign({ role: user.role }, config.jwt.secret, { subject: String(user.id), expiresIn: config.jwt.expiresIn, algorithm: 'HS256' });
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

// Self-registration always creates a MEMBER. Trainers/admins are created by seed/admin tooling only.
router.post('/register', limiter, validate(registerSchema), asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  let id;
  try {
    const [r] = await pool.query("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'member')", [name, email, hash]);
    id = r.insertId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists.', [{ field: 'email', message: 'Already registered' }]);
    throw err;
  }
  const user = { id, name, email, role: 'member' };
  res.status(201).json({ token: sign(user), user });
}));

router.post('/login', limiter, validate(loginSchema), asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
  const user = rows[0];
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
  res.json({ token: sign(user), user: publicUser(user) });
}));

router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

export default router;

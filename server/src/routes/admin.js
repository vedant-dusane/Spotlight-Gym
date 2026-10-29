import { Router } from 'express';
import { pool } from '../db.js';
import { asyncHandler } from '../errors.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { runExpiryReminders } from '../jobs/expiryReminders.js';
import { listMembers } from '../services/membershipService.js';

const router = Router();
router.use(authenticate, requireRole('admin'));

router.get('/members', asyncHandler(async (_req, res) => res.json({ members: await listMembers() })));

router.get('/trainers', asyncHandler(async (_req, res) => {
  const [rows] = await pool.query("SELECT id, name FROM users WHERE role = 'trainer' ORDER BY name");
  res.json({ trainers: rows });
}));

// Lets an admin trigger the daily reminder job on demand (handy for demos).
router.post('/run-reminders', asyncHandler(async (_req, res) => res.json(await runExpiryReminders())));

export default router;

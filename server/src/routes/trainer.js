import { Router } from 'express';
import { asyncHandler } from '../errors.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { listClasses } from '../services/classService.js';
import { classListQuery } from '../schemas.js';

const router = Router();
router.use(authenticate, requireRole('trainer'));

// The trainer's own classes. Defaults to the last 7 days + next 14 days so "just finished" classes can be marked.
router.get('/classes', validate(classListQuery, 'query'), asyncHandler(async (req, res) => {
  const now = Date.now();
  const from = req.query.from ?? new Date(now - 7 * 86_400_000);
  const to = req.query.to ?? new Date(now + 14 * 86_400_000);
  res.json({ classes: await listClasses({ from, to, trainerId: req.user.id }) });
}));

export default router;

import { Router } from 'express';
import { asyncHandler } from '../errors.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createPlan, listPlans, updatePlan } from '../services/membershipService.js';
import { idParam, planCreateSchema, planUpdateSchema } from '../schemas.js';

const router = Router();
router.use(authenticate);

router.get('/', asyncHandler(async (req, res) => {
  res.json({ plans: await listPlans({ includeInactive: req.user.role === 'admin' }) });
}));
router.post('/', requireRole('admin'), validate(planCreateSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await createPlan(req.body));
}));
router.patch('/:id', requireRole('admin'), validate(idParam, 'params'), validate(planUpdateSchema), asyncHandler(async (req, res) => {
  await updatePlan(req.params.id, req.body);
  res.json({ ok: true });
}));

export default router;

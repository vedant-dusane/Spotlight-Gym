import { Router } from 'express';
import { asyncHandler, forbidden } from '../errors.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { cancelMembership, listMemberships, purchaseMembership } from '../services/membershipService.js';
import { idParam, membershipCreateSchema } from '../schemas.js';

const router = Router();
router.use(authenticate);

router.get('/me', requireRole('member'), asyncHandler(async (req, res) => res.json(await listMemberships(req.user.id))));

router.get('/user/:id', requireRole('admin'), validate(idParam, 'params'), asyncHandler(async (req, res) => res.json(await listMemberships(req.params.id))));

// Members buy for themselves (payment is mocked); admins may buy on behalf of a member.
router.post('/', validate(membershipCreateSchema), asyncHandler(async (req, res) => {
  const { planId, startDate, userId } = req.body;
  if (req.user.role === 'member' && userId && userId !== req.user.id) throw forbidden();
  if (req.user.role === 'trainer') throw forbidden();
  const targetId = req.user.role === 'admin' ? userId : req.user.id;
  if (!targetId) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'userId is required for admins.', details: [{ field: 'userId', message: 'Required' }] } });
  res.status(201).json(await purchaseMembership({ userId: targetId, planId, startDate }));
}));

router.patch('/:id/cancel', requireRole('admin'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
  await cancelMembership(req.params.id);
  res.json({ ok: true });
}));

export default router;

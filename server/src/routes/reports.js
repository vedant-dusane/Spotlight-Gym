import { Router } from 'express';
import { asyncHandler, forbidden } from '../errors.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { allMembersReport, memberReport } from '../services/reportService.js';
import { idParam, reportQuery } from '../schemas.js';

const router = Router();
router.use(authenticate);

router.get('/members', requireRole('admin'), validate(reportQuery, 'query'), asyncHandler(async (req, res) => res.json(await allMembersReport(req.query))));

// Admin can view anyone; a member can only view their own.
router.get('/members/:id', validate(idParam, 'params'), validate(reportQuery, 'query'), asyncHandler(async (req, res) => {
  const isSelf = req.user.role === 'member' && req.user.id === req.params.id;
  if (req.user.role !== 'admin' && !isSelf) throw forbidden();
  res.json(await memberReport(req.params.id, req.query));
}));

export default router;

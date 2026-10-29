import { Router } from 'express';
import { asyncHandler } from '../errors.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { markAttendance } from '../services/attendanceService.js';
import { bookClass } from '../services/bookingService.js';
import { cancelClass, createClass, getRoster, listClasses, updateClass } from '../services/classService.js';
import { attendanceSchema, classCreateSchema, classListQuery, classUpdateSchema, idParam } from '../schemas.js';

const router = Router();
router.use(authenticate);

router.get('/', validate(classListQuery, 'query'), asyncHandler(async (req, res) => {
  const now = new Date();
  const from = req.query.from ?? now;
  const to = req.query.to ?? new Date(from.getTime() + 14 * 86_400_000);
  res.json({ classes: await listClasses({ from, to, userId: req.user.id }) });
}));

router.post('/', requireRole('admin'), validate(classCreateSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await createClass(req.body));
}));
router.patch('/:id', requireRole('admin'), validate(idParam, 'params'), validate(classUpdateSchema), asyncHandler(async (req, res) => {
  res.json(await updateClass(req.params.id, req.body));
}));
router.post('/:id/cancel', requireRole('admin'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
  res.json(await cancelClass(req.params.id));
}));

router.post('/:id/bookings', requireRole('member'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
  const result = await bookClass({ userId: req.user.id, classId: req.params.id });
  res.status(result.status === 'booked' ? 201 : 202).json(result);
}));

router.get('/:id/roster', requireRole('trainer', 'admin'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
  res.json(await getRoster(req.params.id, req.user));
}));
router.put('/:id/attendance', requireRole('trainer', 'admin'), validate(idParam, 'params'), validate(attendanceSchema), asyncHandler(async (req, res) => {
  res.json(await markAttendance({ classId: req.params.id, actor: req.user, records: req.body.records }));
}));

export default router;

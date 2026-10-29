import { Router } from 'express';
import { asyncHandler } from '../errors.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { cancelBooking, listMyBookings } from '../services/bookingService.js';
import { bookingsQuery, idParam } from '../schemas.js';

const router = Router();
router.use(authenticate);

router.get('/me', requireRole('member'), validate(bookingsQuery, 'query'), asyncHandler(async (req, res) => {
  res.json({ bookings: await listMyBookings(req.user.id, req.query.scope) });
}));

router.delete('/:id', requireRole('member', 'admin'), validate(idParam, 'params'), asyncHandler(async (req, res) => {
  res.json(await cancelBooking({ bookingId: req.params.id, actor: req.user }));
}));

export default router;

import { Router } from 'express';
import { asyncHandler } from '../errors.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { listNotifications, markAllRead, markRead } from '../services/notificationService.js';
import { idParam } from '../schemas.js';

const router = Router();
router.use(authenticate);

router.get('/me', asyncHandler(async (req, res) => {
  const notifications = await listNotifications(req.user.id);
  res.json({ notifications, unread: notifications.filter((n) => !n.read).length });
}));
router.post('/read-all', asyncHandler(async (req, res) => { await markAllRead(req.user.id); res.json({ ok: true }); }));
router.post('/:id/read', validate(idParam, 'params'), asyncHandler(async (req, res) => { await markRead(req.user.id, req.params.id); res.json({ ok: true }); }));

export default router;

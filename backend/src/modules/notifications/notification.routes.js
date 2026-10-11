import { Router } from 'express';
import { z } from 'zod';
import { tenantRoute } from '../../common/middleware/auth.js';
import { validate } from '../../common/middleware/validate.js';
import { idParam, pagination } from '../../common/validators/index.js';
import { ok } from '../../common/utils/http.js';
import * as notifications from './notification.service.js';

/** The caller's own notifications in the active workspace. Ids from the client only ever select among them. */
const router = Router();
router.use(tenantRoute);

const listQuery = z.object({ ...pagination, unread: z.enum(['true', 'false']).optional().transform((v) => v === 'true') });

router.get('/', validate({ query: listQuery }), async (req, res) => {
  const { items, meta } = await notifications.listNotifications(req.ctx, req.valid.query);
  ok(res, items, meta);
});
router.get('/unread-count', async (req, res) => ok(res, await notifications.unreadCount(req.ctx)));
router.patch('/read-all', async (req, res) => ok(res, await notifications.markAllRead(req.ctx)));
router.patch('/:id/read', validate({ params: idParam }), async (req, res) => {
  ok(res, await notifications.markRead(req.ctx, req.valid.params.id));
});

export default router;

/** /notification-preferences — the caller's channels per category (billing is always on). */
export const preferenceRouter = Router();
preferenceRouter.use(tenantRoute);
preferenceRouter.get('/', async (req, res) => ok(res, await notifications.getPreferences(req.ctx)));
preferenceRouter.patch(
  '/',
  validate({
    body: z
      .object({ preferences: z.array(z.object({ category: z.string().max(40), inApp: z.boolean(), email: z.boolean() }).strict()).min(1).max(20) })
      .strict(),
  }),
  async (req, res) => ok(res, await notifications.updatePreferences(req.ctx, req.valid.body.preferences)),
);

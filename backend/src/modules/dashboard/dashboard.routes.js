import { Router } from 'express';
import { z } from 'zod';
import { tenantRoute } from '../../common/middleware/auth.js';
import { validate } from '../../common/middleware/validate.js';
import { ok } from '../../common/utils/http.js';
import { getDashboard } from './dashboard.service.js';
import { globalSearch } from './search.service.js';

const router = Router();
router.use(tenantRoute);

router.get('/', async (req, res) => ok(res, await getDashboard(req.ctx)));

router.get('/search', validate({ query: z.object({ q: z.string().trim().min(2).max(100) }) }), async (req, res) => {
  ok(res, await globalSearch(req.ctx, req.valid.query.q));
});

export default router;

import { Router } from 'express';
import { authenticate, tenantRoute, requirePermission } from '../../common/middleware/auth.js';
import { ok } from '../../common/utils/http.js';
import * as subscriptions from './subscription.service.js';

const router = Router();

// Plan catalog: any signed-in user (needed to explain limits in upgrade prompts).
router.get('/plans', authenticate, async (_req, res) => ok(res, await subscriptions.listPlans()));

router.get('/', tenantRoute, requirePermission('SUBSCRIPTION_VIEW'), async (req, res) => {
  ok(res, await subscriptions.getSubscriptionOverview(req.ctx));
});

router.post('/cancel', tenantRoute, requirePermission('SUBSCRIPTION_MANAGE'), async (req, res) => {
  ok(res, await subscriptions.cancelSubscription(req.ctx));
});

router.post('/resume', tenantRoute, requirePermission('SUBSCRIPTION_MANAGE'), async (req, res) => {
  ok(res, await subscriptions.resumeSubscription(req.ctx));
});

export default router;

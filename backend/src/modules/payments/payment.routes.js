import { Router } from 'express';
import { z } from 'zod';
import { billingRoute, requirePermission } from '../../common/middleware/auth.js';
import { validate } from '../../common/middleware/validate.js';
import { id, pagination } from '../../common/validators/index.js';
import { ok, created } from '../../common/utils/http.js';
import * as payments from './payment.service.js';

const router = Router();

const txParams = z.object({ txRef: z.string().regex(/^tf_[A-Za-z0-9_-]{6,60}$/) });
const listQuery = z.object({ ...pagination, status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED']).optional() });

// Provider → server. Unauthenticated by design; protected by signature + server-side verification.
// POST = dashboard webhook (signed). GET = checkout callback_url (unsigned; only triggers verification).
router.post('/webhooks/chapa', async (req, res) => {
  await payments.handleChapaWebhook(req.rawBody, req.headers, req.body);
  ok(res, { received: true });
});

router.get('/webhooks/chapa', async (req, res) => {
  await payments.handleChapaCallback(req.query);
  ok(res, { received: true });
});

router.use(billingRoute); // D-13: also open to a suspended company's billing manager

router.get('/', requirePermission('BILLING_VIEW'), validate({ query: listQuery }), async (req, res) => {
  const { items, meta } = await payments.listPayments(req.ctx, req.valid.query);
  ok(res, items, meta);
});

// Choosing a plan is a subscription decision; paying is a billing action — both are required.
router.post(
  '/checkout',
  requirePermission('SUBSCRIPTION_MANAGE', 'BILLING_MANAGE'),
  validate({ body: z.object({ planId: id }).strict() }),
  async (req, res) => created(res, await payments.startCheckout(req.ctx, req.valid.body)),
);

router.get('/:txRef', requirePermission('BILLING_VIEW'), validate({ params: txParams }), async (req, res) => {
  ok(res, await payments.getPayment(req.ctx, req.valid.params.txRef));
});

router.post('/:txRef/verify', requirePermission('BILLING_VIEW'), validate({ params: txParams }), async (req, res) => {
  ok(res, await payments.verifyPayment(req.ctx, req.valid.params.txRef));
});

router.post('/:txRef/cancel', requirePermission('BILLING_MANAGE'), validate({ params: txParams }), async (req, res) => {
  ok(res, await payments.cancelPayment(req.ctx, req.valid.params.txRef));
});

export default router;

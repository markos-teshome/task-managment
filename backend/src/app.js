import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { config } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { errorHandler, notFoundHandler } from './common/middleware/errorHandler.js';

import authRoutes from './modules/auth/auth.routes.js';
import organizationRoutes, { meRouter } from './modules/organizations/organization.routes.js';
import notificationRoutes, { preferenceRouter } from './modules/notifications/notification.routes.js';
import branchRoutes from './modules/branches/branch.routes.js';
import memberRoutes from './modules/users/member.routes.js';
import roleRoutes from './modules/roles/role.routes.js';
import projectRoutes from './modules/projects/project.routes.js';
import taskRoutes from './modules/tasks/task.routes.js';
import subscriptionRoutes from './modules/subscriptions/subscription.routes.js';
import paymentRoutes from './modules/payments/payment.routes.js';
import activityRoutes from './modules/activities/activity.routes.js';
import dashboardRoutes from './modules/dashboard/dashboard.routes.js';
import platformRoutes from './modules/platform/platform.routes.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY); // proxies in front of the API, so req.ip is the real client (rate limits)

  app.use(helmet());
  app.use(compression()); // gzip JSON/CSV responses over 1 KB (lists and dashboards shrink ~80%)
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(
    express.json({
      limit: '100kb',
      // Keep the raw bytes for webhook signature verification.
      verify: (req, _res, buf) => {
        if (req.originalUrl.startsWith('/api/v1/payments/webhooks/')) req.rawBody = buf;
      },
    }),
  );
  app.use(cookieParser());
  // clientIp = the address rate limits use; check it in the logs when setting TRUST_PROXY.
  if (!config.isTest) app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' }, customProps: (req) => ({ clientIp: req.ip }) }));

  app.get('/api/health', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ success: true, data: { status: 'ok' } });
  });

  const api = express.Router();
  api.use('/auth', authRoutes);
  api.use('/me', meRouter);
  api.use('/organizations', organizationRoutes);
  api.use('/branches', branchRoutes);
  api.use('/users', memberRoutes);
  api.use('/roles', roleRoutes);
  api.use('/projects', projectRoutes);
  api.use('/tasks', taskRoutes);
  api.use('/subscription', subscriptionRoutes);
  api.use('/payments', paymentRoutes);
  api.use('/activities', activityRoutes);
  api.use('/dashboard', dashboardRoutes);
  api.use('/notifications', notificationRoutes);
  api.use('/notification-preferences', preferenceRouter);
  api.use('/platform', platformRoutes);
  app.use('/api/v1', api);

  if (config.SERVE_FRONTEND) serveFrontend(app);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

/**
 * Serves the built React app (frontend/dist) from this server: hashed assets are cached for a year, index.html
 * never (so a deploy is picked up at once), and any other GET outside /api returns index.html for client-side
 * routing (deep links and refreshes work).
 */
function serveFrontend(app) {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
  const index = path.join(dist, 'index.html');
  if (!fs.existsSync(index)) {
    logger.error({ dist }, 'SERVE_FRONTEND is on but frontend/dist/index.html is missing: run "npm run build" in frontend/');
    return;
  }
  app.use(
    express.static(dist, {
      index: false,
      setHeaders: (res, file) =>
        res.setHeader('Cache-Control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache'),
    }),
  );
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
}

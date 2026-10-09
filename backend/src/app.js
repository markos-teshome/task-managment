import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { config } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { errorHandler, notFoundHandler } from './common/middleware/errorHandler.js';

import authRoutes from './modules/auth/auth.routes.js';
import organizationRoutes from './modules/organizations/organization.routes.js';
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
  app.set('trust proxy', 1); // correct client IPs for rate limiting behind one proxy

  app.use(helmet());
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
  if (!config.isTest) app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));

  app.get('/api/health', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ success: true, data: { status: 'ok' } });
  });

  const api = express.Router();
  api.use('/auth', authRoutes);
  api.use('/organizations', organizationRoutes);
  api.use('/users', memberRoutes);
  api.use('/roles', roleRoutes);
  api.use('/projects', projectRoutes);
  api.use('/tasks', taskRoutes);
  api.use('/subscription', subscriptionRoutes);
  api.use('/payments', paymentRoutes);
  api.use('/activities', activityRoutes);
  api.use('/dashboard', dashboardRoutes);
  api.use('/platform', platformRoutes);
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

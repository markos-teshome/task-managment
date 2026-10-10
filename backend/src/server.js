import { config } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { createApp } from './app.js';
import { ensureReferenceData } from './bootstrap.js';
import { verifyMailer } from './lib/mailer.js';

async function main() {
  await prisma.$connect();
  await ensureReferenceData();

  const server = createApp().listen(config.PORT, () => {
    logger.info(`TeamFlow API listening on ${config.API_URL} (Chapa ${config.chapaTestMode ? 'TEST' : 'LIVE'} mode)`);
    logger.info(`Chapa webhook URL: ${config.API_URL}/api/v1/payments/webhooks/chapa`);
    if (!config.CHAPA_WEBHOOK_SECRET) logger.warn('CHAPA_WEBHOOK_SECRET is empty: Chapa webhooks will be rejected (401).');
    logger.info(`Email links point to ${config.APP_URL}`);
    if (config.appUrlIsLocal) {
      logger.warn('APP_URL is local: invitation, verification and password-reset links only open on this computer. To test from another device, expose the frontend publicly and set APP_URL (README → "Testing from another device").');
    }
    if (config.apiUrlIsLocal) logger.warn('API_URL is local: Chapa cannot reach the webhook/callback. Use a public URL (e.g. a tunnel).');
    verifyMailer();
  });

  const shutdown = async (signal) => {
    logger.info(`${signal} received, shutting down`);
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(async (err) => {
  logger.fatal({ err }, 'Failed to start');
  await prisma.$disconnect();
  process.exit(1);
});

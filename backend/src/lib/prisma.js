import { PrismaClient } from '@prisma/client';
import { config } from '../config/env.js';

// Transactions issue their queries one after another. On a remote database (e.g. Neon, ~300 ms per
// round-trip) Prisma's default 5 s limit is too short for multi-step operations such as creating an
// organization, so the limits are raised. They only bound how long a transaction may run.
export const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

export const prisma = new PrismaClient({
  log: config.isProd || config.isTest ? ['error'] : ['warn', 'error'],
  transactionOptions: TRANSACTION_OPTIONS,
});

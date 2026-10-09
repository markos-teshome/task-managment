import { PrismaClient } from '@prisma/client';
import { config } from '../config/env.js';

export const prisma = new PrismaClient({
  log: config.isProd || config.isTest ? ['error'] : ['warn', 'error'],
});

import pino from 'pino';
import { config } from '../config/env.js';

// Anything that could carry credentials is redacted before it reaches a log sink.
const redact = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'res.headers["set-cookie"]',
    '*.password',
    '*.currentPassword',
    '*.newPassword',
    '*.token',
    '*.accessToken',
    '*.refreshToken',
  ],
  censor: '[redacted]',
};

const usePretty = !config.isProd && !config.isTest;

export const logger = pino({
  level: config.isTest ? 'silent' : config.LOG_LEVEL,
  redact,
  ...(usePretty && {
    transport: { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } },
  }),
});

import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { config } from '../../config/env.js';

const limited = {
  success: false,
  error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes and try again.' },
};

const make = (windowMinutes, limit, keyByEmail = false, skipSuccessfulRequests = false) =>
  rateLimit({
    windowMs: windowMinutes * 60_000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => !config.RATE_LIMIT_ENABLED,
    skipSuccessfulRequests,
    message: limited,
    // Keyed by IP and, where relevant, target email — slows both spraying and focused guessing.
    keyGenerator: (req) =>
      keyByEmail && typeof req.body?.email === 'string'
        ? `${ipKeyGenerator(req.ip)}:${req.body.email.toLowerCase()}`
        : ipKeyGenerator(req.ip),
  });

// Only failed sign-ins count: brute force is throttled, people who sign in often are not.
export const loginLimiter = make(15, 10, true, true);
export const emailActionLimiter = make(15, 5, true); // forgot password, resend verification
export const registerLimiter = make(60, 10);
export const tokenLimiter = make(15, 30); // verify/reset/accept with a token

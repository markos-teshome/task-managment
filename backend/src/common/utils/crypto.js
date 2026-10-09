import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../../config/env.js';

/** High-entropy, URL-safe random secret. */
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** Tokens are stored as SHA-256 hashes; a DB leak does not leak usable links. */
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export const safeEqual = (a, b) => {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};

export const hashPassword = (plain) => bcrypt.hash(plain, config.BCRYPT_ROUNDS);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

// Used when the account does not exist, so a failed login costs the same time either way.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', 10);
export const burnPasswordCheck = (plain) => bcrypt.compare(plain, DUMMY_HASH);

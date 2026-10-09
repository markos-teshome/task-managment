import jwt from 'jsonwebtoken';
import { config } from '../../config/env.js';
import { randomToken, sha256 } from '../../common/utils/crypto.js';

/**
 * Access token: short-lived JWT, kept in memory by the SPA and sent as a Bearer header.
 * It only identifies the user and session; tenant and permissions are resolved from the
 * database on each request, so revocations and role changes apply immediately.
 */
export const signAccessToken = ({ userId, sessionId }) =>
  jwt.sign({ sid: sessionId }, config.JWT_ACCESS_SECRET, {
    subject: userId,
    expiresIn: config.JWT_ACCESS_TTL,
    algorithm: 'HS256',
    issuer: 'teamflow',
  });

export const verifyAccessToken = (token) =>
  jwt.verify(token, config.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: 'teamflow' });

/**
 * Refresh token: `<sessionId>.<secret>` in an httpOnly cookie. Only sha256(secret) is stored.
 * The secret rotates on every refresh; presenting an old secret means the token was copied,
 * so the whole session is revoked (reuse detection).
 */
export const newRefreshSecret = () => {
  const secret = randomToken(48);
  return { secret, hash: sha256(secret) };
};

export const parseRefreshToken = (raw) => {
  if (typeof raw !== 'string') return null;
  const [sessionId, secret] = raw.split('.');
  if (!sessionId || !secret || !/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
  return { sessionId, secret };
};

export const REFRESH_COOKIE = 'tf_refresh';

export const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: config.COOKIE_SECURE,
  sameSite: 'strict',
  path: '/api/v1/auth',
  maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
});

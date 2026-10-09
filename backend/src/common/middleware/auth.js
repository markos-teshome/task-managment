import { Errors } from '../errors/AppError.js';
import { verifyAccessToken } from '../../modules/auth/tokens.js';
import { loadSessionContext } from '../../modules/auth/context.js';

/**
 * Authentication — "who are you?"
 * Verifies the Bearer token, then re-checks the session and user in the database so that
 * logout, password reset and account disabling take effect before the JWT expires.
 */
export async function authenticate(req, _res, next) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(Errors.unauthenticated());

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    return next(
      err.name === 'TokenExpiredError'
        ? Errors.unauthenticated('Your session has expired. Please sign in again.', 'TOKEN_EXPIRED')
        : Errors.unauthenticated('Invalid session. Please sign in again.', 'INVALID_TOKEN'),
    );
  }

  const ctx = await loadSessionContext(payload.sid);
  if (
    !ctx ||
    ctx.userId !== payload.sub ||
    ctx.session.revokedAt ||
    ctx.session.expiresAt < new Date() ||
    ctx.user.status !== 'ACTIVE'
  ) {
    return next(Errors.unauthenticated('Your session is no longer valid. Please sign in again.', 'SESSION_REVOKED'));
  }

  req.ctx = ctx;
  next();
}

const TENANT_MESSAGES = {
  NO_WORKSPACE: 'Create or join an organization to continue.',
  MEMBERSHIP_INACTIVE: 'Your access to this organization has been removed. Contact your administrator.',
  ORGANIZATION_SUSPENDED: 'This organization is suspended. Contact TeamFlow support.',
};

/**
 * Tenant isolation — "which organization's data can you access?"
 * Guarantees req.ctx.organizationId is set. Services scope every query with it;
 * an organization id from the URL, query or body is never trusted.
 */
export function requireTenant(req, _res, next) {
  const reason = req.ctx?.tenantBlockedReason;
  if (reason) return next(Errors.forbidden(TENANT_MESSAGES[reason], reason));
  next();
}

/**
 * Authorization — "what are you allowed to do?"
 * requirePermission: all listed permissions are required.
 * requireAnyPermission: at least one is required.
 */
export const requirePermission =
  (...permissions) =>
  (req, _res, next) =>
    permissions.every((p) => req.ctx.can(p)) ? next() : next(Errors.forbidden());

export const requireAnyPermission =
  (...permissions) =>
  (req, _res, next) =>
    permissions.some((p) => req.ctx.can(p)) ? next() : next(Errors.forbidden());

export function requirePlatformAdmin(req, _res, next) {
  return req.ctx?.isPlatformAdmin ? next() : next(Errors.forbidden());
}

/** Convenience chain for tenant-scoped routes. */
export const tenantRoute = [authenticate, requireTenant];

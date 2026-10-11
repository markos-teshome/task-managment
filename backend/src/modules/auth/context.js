import { prisma } from '../../lib/prisma.js';
import { OWNER_ROLE_KEY } from '../../common/constants/permissions.js';

/**
 * Builds the request context from a session id. This is the one place where
 * "who are you" (user), "which tenant" (membership → organization) and
 * "what may you do" (role → permissions) are resolved — always from the database.
 */
export async function loadSessionContext(sessionId) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      user: true,
      membership: {
        include: {
          organization: true,
          role: { include: { permissions: { include: { permission: true } } } },
        },
      },
    },
  });
  if (!session) return null;

  const { user, membership } = session;
  const ctx = {
    sessionId: session.id,
    session,
    userId: user.id,
    user,
    // Tenant fields stay null unless the workspace is usable right now.
    membershipId: null,
    organizationId: null,
    organization: null,
    role: null,
    permissions: new Set(),
    isOwner: false,
    tenantBlockedReason: null,
    can(permission) {
      return this.permissions.has(permission);
    },
  };

  if (!membership) {
    ctx.tenantBlockedReason = 'NO_WORKSPACE';
  } else if (membership.status !== 'ACTIVE') {
    ctx.tenantBlockedReason = 'MEMBERSHIP_INACTIVE';
  } else if (membership.organization.status !== 'ACTIVE') {
    ctx.tenantBlockedReason = membership.organization.status === 'CLOSED' ? 'ORGANIZATION_CLOSED' : 'ORGANIZATION_SUSPENDED';
    // D-13: who this person is in the blocked company, so billing routes can admit its owner (see auth.js).
    ctx.blockedWorkspace = {
      membershipId: membership.id,
      organizationId: membership.organizationId,
      organization: membership.organization,
      role: { id: membership.role.id, key: membership.role.key, name: membership.role.name },
      permissions: new Set(membership.role.permissions.map((rp) => rp.permission.key)),
    };
  } else {
    ctx.membershipId = membership.id;
    ctx.organizationId = membership.organizationId;
    ctx.organization = membership.organization;
    ctx.role = { id: membership.role.id, key: membership.role.key, name: membership.role.name };
    ctx.permissions = new Set(membership.role.permissions.map((rp) => rp.permission.key));
    ctx.isOwner = membership.role.key === OWNER_ROLE_KEY;
  }

  return ctx;
}

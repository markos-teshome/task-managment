import { prisma } from '../../lib/prisma.js';
import { AppError, Errors } from '../../common/errors/AppError.js';
import { OWNER_ROLE_KEY } from '../../common/constants/permissions.js';
import { fullName, paginate } from '../../common/utils/http.js';
import { assertCanAddUsers, lockOrganization } from '../subscriptions/entitlement.service.js';
import { assertWithinOwnPermissions } from '../roles/role.service.js';
import { issueAuthToken } from '../auth/authToken.service.js';
import { sendInvitationEmail } from '../auth/auth.emails.js';
import { ACTIONS, logActivity } from '../activities/activity.service.js';

/**
 * Team management. "Users" of an organization are memberships: the person's identity (User)
 * is global, their role and status are per organization.
 */

const memberInclude = {
  user: { select: { id: true, email: true, firstName: true, lastName: true } },
  role: { select: { id: true, name: true, key: true } },
};

export const presentMember = (m) => ({
  id: m.id,
  userId: m.user.id,
  name: fullName(m.user),
  firstName: m.user.firstName,
  lastName: m.user.lastName,
  email: m.user.email,
  jobTitle: m.jobTitle,
  status: m.status,
  role: m.role,
  joinedAt: m.joinedAt,
  createdAt: m.createdAt,
  ...(m._count && { openTaskCount: m._count.assignedTasks }),
  // Pending invitations: when the current link expires, so admins know to resend.
  ...(m.status === 'INVITED' && m.authTokens && { invitation: invitationState(m.authTokens[0]) }),
});

function invitationState(token) {
  if (!token) return { expiresAt: null, expired: true };
  return { expiresAt: token.expiresAt, expired: token.expiresAt < new Date() };
}

const pendingInvitationToken = {
  authTokens: { where: { type: 'INVITATION', usedAt: null }, select: { expiresAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
};

export async function listMembers(ctx, query) {
  const { skip, take, meta } = paginate(query);
  const where = {
    organizationId: ctx.organizationId,
    ...(query.status && { status: query.status }),
    ...(query.roleId && { roleId: query.roleId }),
    ...(query.search && {
      user: {
        OR: [
          { firstName: { contains: query.search, mode: 'insensitive' } },
          { lastName: { contains: query.search, mode: 'insensitive' } },
          { email: { contains: query.search, mode: 'insensitive' } },
        ],
      },
    }),
  };
  const [items, total] = await prisma.$transaction([
    prisma.membership.findMany({
      where,
      include: {
        ...memberInclude,
        ...pendingInvitationToken,
        _count: { select: { assignedTasks: { where: { status: { not: 'COMPLETED' } } } } },
      },
      orderBy: [{ status: 'asc' }, { user: { firstName: 'asc' } }],
      skip,
      take,
    }),
    prisma.membership.count({ where }),
  ]);
  return { items: items.map(presentMember), meta: meta(total) };
}

/** Lightweight list of active members for pickers (assignee, project lead, team). */
export async function listMemberOptions(ctx) {
  const members = await prisma.membership.findMany({
    where: { organizationId: ctx.organizationId, status: 'ACTIVE' },
    include: memberInclude,
    orderBy: { user: { firstName: 'asc' } },
  });
  return members.map((m) => ({ id: m.id, name: fullName(m.user), email: m.user.email, jobTitle: m.jobTitle, role: m.role }));
}

/**
 * Resolves membership ids supplied by a client (assignee, lead, team) and guarantees each one
 * is an ACTIVE member of the caller's organization. Another tenant's id behaves exactly like a
 * non-existent id, so nothing about other organizations is revealed.
 */
export async function resolveActiveMembers(db, organizationId, ids, field = 'memberIds') {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const found = await db.membership.findMany({
    where: { id: { in: unique }, organizationId, status: 'ACTIVE' },
    include: memberInclude,
  });
  if (found.length !== unique.length) {
    throw Errors.validation([{ field, message: 'Select active members of your organization only' }]);
  }
  return found;
}

async function findMember(ctx, id, db = prisma) {
  const member = await db.membership.findFirst({ where: { id, organizationId: ctx.organizationId }, include: memberInclude });
  if (!member) throw Errors.notFound('Member');
  return member;
}

/** Validates a role for assignment: same tenant, owner-only for Owner, no escalation. */
async function resolveAssignableRole(ctx, roleId) {
  const role = await prisma.role.findFirst({
    where: { id: roleId, organizationId: ctx.organizationId },
    include: { permissions: { include: { permission: true } } },
  });
  if (!role) throw Errors.validation([{ field: 'roleId', message: 'Select a valid role' }]);
  if (role.key === OWNER_ROLE_KEY && !ctx.isOwner) {
    throw Errors.forbidden('Only an owner can grant the Owner role.', 'PRIVILEGE_ESCALATION');
  }
  assertWithinOwnPermissions(ctx, role.permissions.map((rp) => rp.permission.key));
  return role;
}

/** Admins manage people but cannot act on owners, and nobody edits their own access. */
function assertCanActOn(ctx, target) {
  if (target.id === ctx.membershipId) {
    throw Errors.forbidden('You cannot change your own role or access.', 'SELF_MODIFICATION');
  }
  if (target.role.key === OWNER_ROLE_KEY && !ctx.isOwner) {
    throw Errors.forbidden('Only an owner can change another owner.', 'OWNER_PROTECTED');
  }
}

async function assertNotLastOwner(tx, ctx, target) {
  if (target.role.key !== OWNER_ROLE_KEY) return;
  // Serialised per organization: two owners removing each other at the same moment cannot both succeed.
  await lockOrganization(tx, ctx.organizationId);
  const owners = await tx.membership.count({
    where: { organizationId: ctx.organizationId, status: 'ACTIVE', role: { key: OWNER_ROLE_KEY }, NOT: { id: target.id } },
  });
  if (owners === 0) throw Errors.conflict('An organization must always have at least one active owner.', 'LAST_OWNER');
}

export async function inviteMember(ctx, { email, firstName, lastName, roleId, jobTitle }) {
  const role = await resolveAssignableRole(ctx, roleId);

  const { member, token, user } = await prisma.$transaction(async (tx) => {
    const existingUser = await tx.user.findUnique({ where: { email } });
    if (existingUser) {
      const existing = await tx.membership.findUnique({
        where: { organizationId_userId: { organizationId: ctx.organizationId, userId: existingUser.id } },
      });
      if (existing && existing.status !== 'DEACTIVATED') {
        throw Errors.conflict('This person is already a member or has a pending invitation.', 'ALREADY_MEMBER');
      }
      if (existing) {
        throw Errors.conflict('This person was deactivated. Reactivate them from the team list instead.', 'MEMBER_DEACTIVATED');
      }
    }

    // Subscription check happens inside the transaction, under a per-organization lock.
    await assertCanAddUsers(tx, ctx.organizationId);

    const invitee = existingUser ?? (await tx.user.create({ data: { email, firstName, lastName } }));
    const membership = await tx.membership.create({
      data: { organizationId: ctx.organizationId, userId: invitee.id, roleId: role.id, status: 'INVITED', jobTitle, invitedById: ctx.membershipId },
      include: memberInclude,
    });
    const rawToken = await issueAuthToken(tx, { userId: invitee.id, type: 'INVITATION', membershipId: membership.id });
    await logActivity(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.membershipId,
      action: ACTIONS.MEMBER_INVITED,
      entityType: 'MEMBER',
      entityId: membership.id,
      metadata: { memberName: fullName(invitee), roleName: role.name },
    });
    return { member: membership, token: rawToken, user: invitee };
  });

  const emailSent = await sendInvitationEmail(
    { user, organizationName: ctx.organization.name, inviterName: fullName(ctx.user), roleName: role.name },
    token,
  );
  // The invitation exists either way; the admin is told if the email did not go out so they can resend.
  return { ...presentMember(member), emailSent };
}

export async function resendInvitation(ctx, id) {
  const member = await findMember(ctx, id);
  if (member.status !== 'INVITED') throw Errors.conflict('This member has already joined.', 'NOT_INVITED');
  // The new link replaces the old one (issueAuthToken removes unused tokens), and the expiry restarts.
  const token = await prisma.$transaction(async (tx) => {
    await tx.membership.update({ where: { id: member.id }, data: { invitedById: ctx.membershipId } });
    return issueAuthToken(tx, { userId: member.user.id, type: 'INVITATION', membershipId: member.id });
  });
  const sent = await sendInvitationEmail(
    { user: member.user, organizationName: ctx.organization.name, inviterName: fullName(ctx.user), roleName: member.role.name },
    token,
  );
  if (!sent) {
    throw new AppError(502, 'EMAIL_DELIVERY_FAILED', "We couldn't send the invitation email right now. Please try again in a few minutes.");
  }
}

export async function updateMember(ctx, id, { roleId, status, jobTitle }) {
  const target = await findMember(ctx, id);
  const changesAccess = (roleId && roleId !== target.role.id) || (status && status !== target.status);
  if (changesAccess) assertCanActOn(ctx, target);
  if (status === 'ACTIVE' && target.status === 'INVITED') {
    throw Errors.badRequest('Invited members become active when they accept their invitation.');
  }
  const role = roleId && roleId !== target.role.id ? await resolveAssignableRole(ctx, roleId) : null;

  const updated = await prisma.$transaction(async (tx) => {
    if ((role && target.role.key === OWNER_ROLE_KEY) || status === 'DEACTIVATED') await assertNotLastOwner(tx, ctx, target);
    if (status === 'ACTIVE' && target.status === 'DEACTIVATED') await assertCanAddUsers(tx, ctx.organizationId);

    const result = await tx.membership.update({
      where: { id },
      data: {
        ...(role && { roleId: role.id }),
        ...(jobTitle !== undefined && { jobTitle }),
        ...(status === 'DEACTIVATED' && target.status !== 'DEACTIVATED' && { status, deactivatedAt: new Date() }),
        ...(status === 'ACTIVE' && target.status === 'DEACTIVATED' && { status, deactivatedAt: null }),
      },
      include: memberInclude,
    });

    const base = { organizationId: ctx.organizationId, actorId: ctx.membershipId, entityType: 'MEMBER', entityId: id };
    const memberName = fullName(target.user);
    if (role) {
      await logActivity(tx, { ...base, action: ACTIONS.MEMBER_ROLE_CHANGED, metadata: { memberName, fromRole: target.role.name, toRole: role.name } });
    }
    if (status && status !== target.status) {
      const action = status === 'DEACTIVATED' ? ACTIONS.MEMBER_DEACTIVATED : ACTIONS.MEMBER_REACTIVATED;
      await logActivity(tx, { ...base, action, metadata: { memberName } });
    }
    return result;
  });
  return presentMember(updated);
}

/**
 * DELETE semantics: a pending invitation is revoked (and its seat freed); a member who has
 * joined is deactivated, never hard-deleted, so their task and activity history remains.
 */
export async function removeMember(ctx, id) {
  const target = await findMember(ctx, id);
  assertCanActOn(ctx, target);

  if (target.status !== 'INVITED') {
    return updateMember(ctx, id, { status: 'DEACTIVATED' });
  }

  await prisma.$transaction(async (tx) => {
    await tx.membership.delete({ where: { id } });
    // Drop the placeholder identity if this invitation was its only reason to exist.
    const user = await tx.user.findUnique({ where: { id: target.user.id }, include: { _count: { select: { memberships: true } } } });
    if (user && !user.passwordHash && user._count.memberships === 0) await tx.user.delete({ where: { id: user.id } });
    await logActivity(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.membershipId,
      action: ACTIONS.INVITATION_REVOKED,
      entityType: 'MEMBER',
      entityId: null,
      metadata: { memberName: fullName(target.user) },
    });
  });
  return null;
}

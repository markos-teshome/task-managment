import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, as, createTenant, createVerifiedUser, lastEmailToken, login, PASSWORD, prisma, resetDb, testOutbox } from './helpers.js';
import { config } from '../src/config/env.js';
import { sha256 } from '../src/common/utils/crypto.js';

let A, owner;

const invite = (token, body) =>
  as(token).post('/users').send({ firstName: 'Sara', lastName: 'Bekele', roleId: A.roles.EMPLOYEE.id, ...body });
const getInvitation = (token) => request(app).get(`/api/v1/auth/invitations/${encodeURIComponent(token)}`);
const accept = (body, accessToken) => {
  const req = request(app).post('/api/v1/auth/accept-invitation');
  if (accessToken) req.set('Authorization', `Bearer ${accessToken}`);
  return req.send(body);
};
const membershipOf = (email, organizationId) =>
  prisma.membership.findFirst({ where: { organizationId, user: { email } } });

beforeEach(async () => {
  await resetDb();
  A = await createTenant({ name: 'Abay Trading PLC' });
  owner = await login(A.owner.user.email);
});

describe('new person', () => {
  it('owner invites; the emailed link points to the frontend (APP_URL), not the API or a hard-coded host', async () => {
    const res = await invite(owner, { email: 'sara@example.com' });
    expect(res.status).toBe(201);
    expect(res.body.data.emailSent).toBe(true);

    const mail = testOutbox.find((m) => m.to === 'sara@example.com');
    expect(mail.subject).toMatch(/invited you to Abay Trading PLC/);
    expect(mail.text).toContain(`${config.APP_URL}/accept-invite?token=`);
    if (config.API_URL !== config.APP_URL) expect(mail.text).not.toContain(`${config.API_URL}/accept-invite`);
  });

  it('the accept page shows organization, inviter and role; the token is stored only as a hash', async () => {
    await invite(owner, { email: 'sara@example.com' });
    const token = lastEmailToken('sara@example.com');
    const res = await getInvitation(token);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      email: 'sara@example.com',
      organizationName: 'Abay Trading PLC',
      roleName: 'Employee',
      inviterName: 'Owner User',
      requiresPassword: true,
    });
    expect(await prisma.authToken.count({ where: { tokenHash: token } })).toBe(0);
    expect(await prisma.authToken.count({ where: { tokenHash: sha256(token) } })).toBe(1);
  });

  it('accepting from another device (no session) creates the account, verifies it and joins the right organization', async () => {
    await invite(owner, { email: 'sara@example.com' });
    const token = lastEmailToken('sara@example.com');

    const weak = await accept({ token, firstName: 'Sara', lastName: 'B', password: 'short' });
    expect(weak.status).toBe(422);

    const res = await accept({ token, firstName: 'Sara', lastName: 'Bekele', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ email: 'sara@example.com', organizationName: 'Abay Trading PLC' });

    const m = await membershipOf('sara@example.com', A.org.id);
    expect(m.status).toBe('ACTIVE');
    const me = await as(await login('sara@example.com')).get('/auth/me');
    expect(me.body.data.workspace.organization.name).toBe('Abay Trading PLC');
    expect(me.body.data.workspace.role.key).toBe('EMPLOYEE');
    expect(await prisma.activityLog.count({ where: { organizationId: A.org.id, action: 'MEMBER_JOINED' } })).toBe(1);
  });
});

describe('existing account', () => {

  beforeEach(async () => {
    await createVerifiedUser({ firstName: 'Dawit', email: 'dawit@example.com' });
    await invite(owner, { email: 'dawit@example.com' });
  });

  it('must prove the account is theirs with its password when not signed in', async () => {
    const token = lastEmailToken('dawit@example.com');
    expect((await getInvitation(token)).body.data.requiresPassword).toBe(false);

    const none = await accept({ token });
    expect(none.status).toBe(422);
    expect(none.body.error.details[0].field).toBe('password');
    const wrong = await accept({ token, password: 'Wrong-pass1' });
    expect(wrong.status).toBe(422);
    expect((await membershipOf('dawit@example.com', A.org.id)).status).toBe('INVITED');

    const ok = await accept({ token, password: PASSWORD });
    expect(ok.status).toBe(200);
    expect((await membershipOf('dawit@example.com', A.org.id)).status).toBe('ACTIVE');
    // The existing password is untouched and no duplicate account was created.
    expect(await prisma.user.count({ where: { email: 'dawit@example.com' } })).toBe(1);
    await login('dawit@example.com');
  });

  it('a signed-in invitee accepts without re-entering a password and lands in the new workspace', async () => {
    const session = await login('dawit@example.com');
    const token = lastEmailToken('dawit@example.com');

    const res = await accept({ token }, session);
    expect(res.status).toBe(200);
    const me = await as(session).get('/auth/me');
    expect(me.body.data.workspace.organization.name).toBe('Abay Trading PLC');
  });

  it('wrong failed passwords count towards the account lockout', async () => {
    const token = lastEmailToken('dawit@example.com');
    for (let i = 0; i < 5; i++) await accept({ token, password: `Wrong-pass${i}` });
    const locked = await accept({ token, password: PASSWORD });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
  });
});

describe('invalid, expired, used and withdrawn invitations', () => {
  it('a different signed-in account cannot claim the invitation', async () => {
    await invite(owner, { email: 'sara@example.com' });
    const token = lastEmailToken('sara@example.com');
    const intruder = await createVerifiedUser({ email: 'intruder@example.com' });
    const session = await login(intruder.email);

    const res = await accept({ token, firstName: 'X', lastName: 'Y', password: PASSWORD }, session);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INVITATION_WRONG_ACCOUNT');
    expect((await membershipOf('sara@example.com', A.org.id)).status).toBe('INVITED');
    expect(await membershipOf('intruder@example.com', A.org.id)).toBeNull();
  });

  it('an unknown or malformed token is rejected generically', async () => {
    const unknown = await getInvitation('x'.repeat(43));
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('INVALID_TOKEN');
    expect((await getInvitation('short')).status).toBe(404); // malformed ids look like missing ones
  });

  it('an expired invitation says so; a resent invitation works and replaces the old link', async () => {
    const res = await invite(owner, { email: 'sara@example.com' });
    const oldToken = lastEmailToken('sara@example.com');
    await prisma.authToken.updateMany({ where: { tokenHash: sha256(oldToken) }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const expired = await getInvitation(oldToken);
    expect(expired.status).toBe(400);
    expect(expired.body.error.code).toBe('INVITATION_EXPIRED');
    expect((await accept({ token: oldToken, firstName: 'S', lastName: 'B', password: PASSWORD })).body.error.code).toBe('INVITATION_EXPIRED');

    expect((await as(owner).post(`/users/${res.body.data.id}/resend-invitation`)).status).toBe(200);
    const newToken = lastEmailToken('sara@example.com');
    expect(newToken).not.toBe(oldToken);
    expect((await getInvitation(oldToken)).body.error.code).toBe('INVALID_TOKEN');
    expect((await accept({ token: newToken, firstName: 'S', lastName: 'B', password: PASSWORD })).status).toBe(200);
  });

  it('the team list tells admins whether a pending invitation is still valid', async () => {
    const res = await invite(owner, { email: 'sara@example.com' });
    const listed = async () => (await as(owner).get('/users')).body.data.find((m) => m.id === res.body.data.id);
    expect((await listed()).invitation).toMatchObject({ expired: false });

    await prisma.authToken.updateMany({ where: { membershipId: res.body.data.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await listed()).invitation.expired).toBe(true);
    // Active members carry no invitation details.
    expect((await as(owner).get('/users')).body.data.find((m) => m.status === 'ACTIVE').invitation).toBeUndefined();
  });

  it('a used invitation cannot be used again and creates no second membership', async () => {
    await invite(owner, { email: 'sara@example.com' });
    const token = lastEmailToken('sara@example.com');
    expect((await accept({ token, firstName: 'S', lastName: 'B', password: PASSWORD })).status).toBe(200);

    const again = await accept({ token, firstName: 'S', lastName: 'B', password: PASSWORD });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVITATION_ALREADY_ACCEPTED');
    expect((await getInvitation(token)).body.error.code).toBe('INVITATION_ALREADY_ACCEPTED');
    expect(await prisma.membership.count({ where: { organizationId: A.org.id, user: { email: 'sara@example.com' } } })).toBe(1);
  });

  it('a withdrawn (revoked) invitation is rejected', async () => {
    const res = await invite(owner, { email: 'sara@example.com' });
    const token = lastEmailToken('sara@example.com');
    expect((await as(owner).delete(`/users/${res.body.data.id}`)).status).toBe(200);

    const after = await accept({ token, firstName: 'S', lastName: 'B', password: PASSWORD });
    expect(after.status).toBe(400);
    expect(after.body.error.code).toBe('INVALID_TOKEN');
    expect(await membershipOf('sara@example.com', A.org.id)).toBeNull();
  });

  it('a duplicate invitation is refused, also when sent concurrently', async () => {
    const results = await Promise.all([invite(owner, { email: 'race@example.com' }), invite(owner, { email: 'race@example.com' })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.user.count({ where: { email: 'race@example.com' } })).toBe(1);

    const dup = await invite(owner, { email: 'race@example.com' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ALREADY_MEMBER');
  });

  it('concurrent acceptances of the same link produce exactly one membership', async () => {
    await invite(owner, { email: 'sara@example.com' });
    const token = lastEmailToken('sara@example.com');
    const body = { token, firstName: 'S', lastName: 'B', password: PASSWORD };
    const results = await Promise.all([accept(body), accept(body), accept(body)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await prisma.activityLog.count({ where: { organizationId: A.org.id, action: 'MEMBER_JOINED' } })).toBe(1);
  });
});

describe('tenant boundaries', () => {
  it("another organization cannot resend or withdraw this organization's invitation, or invite with its roles", async () => {
    const res = await invite(owner, { email: 'sara@example.com' });
    const B = await createTenant({ name: 'Gift Construction PLC' });
    const otherOwner = await login(B.owner.user.email);

    expect((await as(otherOwner).post(`/users/${res.body.data.id}/resend-invitation`)).status).toBe(404);
    expect((await as(otherOwner).delete(`/users/${res.body.data.id}`)).status).toBe(404);
    const foreignRole = await as(otherOwner)
      .post('/users')
      .send({ email: 'x@example.com', firstName: 'X', lastName: 'Y', roleId: A.roles.ADMIN.id });
    expect(foreignRole.status).toBe(422);
  });

  it('accepting joins only the organization named in the invitation, whatever the client sends', async () => {
    const B = await createTenant({ name: 'Gift Construction PLC' });
    await invite(owner, { email: 'sara@example.com' });
    const token = lastEmailToken('sara@example.com');

    const smuggled = await accept({ token, firstName: 'S', lastName: 'B', password: PASSWORD, organizationId: B.org.id });
    expect(smuggled.status).toBe(422); // unknown fields are rejected
    expect((await accept({ token, firstName: 'S', lastName: 'B', password: PASSWORD })).status).toBe(200);
    expect(await membershipOf('sara@example.com', B.org.id)).toBeNull();
    expect((await membershipOf('sara@example.com', A.org.id)).status).toBe('ACTIVE');
  });
});

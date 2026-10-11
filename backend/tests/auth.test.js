import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app, as, createVerifiedUser, lastEmailToken, login, PASSWORD, prisma, resetDb, testOutbox } from './helpers.js';

const api = request(app);

beforeEach(resetDb);

describe('registration, verification and onboarding', () => {
  it('registers, verifies by email, signs in and creates a workspace as Owner on the Free plan', async () => {
    const email = 'new.owner@example.com';
    const reg = await api.post('/api/v1/auth/register').send({ firstName: 'Abebe', lastName: 'Kebede', email, password: PASSWORD });
    expect(reg.status).toBe(201);

    // Unverified accounts cannot sign in.
    const early = await api.post('/api/v1/auth/login').send({ email, password: PASSWORD });
    expect(early.status).toBe(403);
    expect(early.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    const verify = await api.post('/api/v1/auth/verify-email').send({ token: lastEmailToken(email) });
    expect(verify.status).toBe(200);

    const loginRes = await api.post('/api/v1/auth/login').send({ email, password: PASSWORD });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data.me.workspace).toBeNull();
    expect(loginRes.body.data.me.workspaceBlockedReason).toBe('NO_WORKSPACE');
    expect(JSON.stringify(loginRes.body)).not.toContain('passwordHash');

    const token = loginRes.body.data.accessToken;
    const org = await as(token).post('/organizations').send({ name: 'Abay Trading PLC' });
    expect(org.status).toBe(201);
    const { workspace } = org.body.data.me;
    expect(workspace.role.key).toBe('OWNER');
    expect(workspace.plan.code).toBe('FREE');
    expect(workspace.permissions).toContain('BILLING_MANAGE');
  });

  it('does not reveal whether an email is already registered', async () => {
    const existing = await createVerifiedUser({ email: 'taken@example.com' });
    const a = await api.post('/api/v1/auth/register').send({ firstName: 'X', lastName: 'Y', email: existing.email, password: PASSWORD });
    const b = await api.post('/api/v1/auth/register').send({ firstName: 'X', lastName: 'Y', email: 'free@example.com', password: PASSWORD });
    expect(a.status).toBe(b.status);
    expect(a.body).toEqual(b.body);
    // The existing account was not overwritten.
    const after = await prisma.user.findUnique({ where: { id: existing.id } });
    expect(after.passwordHash).toBe(existing.passwordHash);
  });

  it('rejects weak passwords with field-level validation errors', async () => {
    const res = await api.post('/api/v1/auth/register').send({ firstName: 'A', lastName: 'B', email: 'weak@example.com', password: 'short' });
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].field).toBe('password');
  });
});

describe('login and sessions', () => {
  it('uses one generic message for unknown email and wrong password', async () => {
    const user = await createVerifiedUser();
    const wrong = await api.post('/api/v1/auth/login').send({ email: user.email, password: 'Wrong1234' });
    const unknown = await api.post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: 'Wrong1234' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('locks the account after repeated failed attempts', async () => {
    const user = await createVerifiedUser();
    for (let i = 0; i < 5; i++) await api.post('/api/v1/auth/login').send({ email: user.email, password: 'Wrong1234' });
    const res = await api.post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('rejects invalid, tampered and expired access tokens', async () => {
    const user = await createVerifiedUser();
    const token = await login(user.email);

    expect((await as('not-a-jwt').get('/auth/me')).status).toBe(401);
    expect((await api.get('/api/v1/auth/me')).status).toBe(401);

    const forged = jwt.sign({ sid: '00000000-0000-0000-0000-000000000000' }, 'some-other-secret-some-other-secret', { subject: user.id, issuer: 'teamflow' });
    expect((await as(forged).get('/auth/me')).status).toBe(401);

    const { sid } = jwt.decode(token);
    const expired = jwt.sign({ sid }, process.env.JWT_ACCESS_SECRET, { subject: user.id, issuer: 'teamflow', expiresIn: -10 });
    const res = await as(expired).get('/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('rotates refresh tokens and revokes the session when an old one is replayed', async () => {
    const user = await createVerifiedUser();
    const loginRes = await api.post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD });
    const firstCookie = loginRes.headers['set-cookie'][0].split(';')[0];
    expect(loginRes.headers['set-cookie'][0]).toMatch(/HttpOnly/i);

    const r1 = await api.post('/api/v1/auth/refresh').set('Cookie', firstCookie);
    expect(r1.status).toBe(200);
    const secondCookie = r1.headers['set-cookie'][0].split(';')[0];
    expect(secondCookie).not.toBe(firstCookie);

    // Within the grace window (concurrent tabs) a stale token is refused but the session survives.
    expect((await api.post('/api/v1/auth/refresh').set('Cookie', firstCookie)).status).toBe(401);
    expect((await as(r1.body.data.accessToken).get('/auth/me')).status).toBe(200);

    // Later, replaying the first (already rotated) token = theft signal → session revoked.
    const sessionId = firstCookie.split('=')[1].split('.')[0];
    await prisma.session.update({ where: { id: sessionId }, data: { lastUsedAt: new Date(Date.now() - 60_000) } });
    const replay = await api.post('/api/v1/auth/refresh').set('Cookie', firstCookie);
    expect(replay.status).toBe(401);
    const afterTheft = await api.post('/api/v1/auth/refresh').set('Cookie', secondCookie);
    expect(afterTheft.status).toBe(401);
    // The access token from that session stops working immediately too.
    expect((await as(r1.body.data.accessToken).get('/auth/me')).status).toBe(401);
  });

  it('logout revokes the session server-side', async () => {
    const user = await createVerifiedUser();
    const loginRes = await api.post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD });
    const cookie = loginRes.headers['set-cookie'][0].split(';')[0];
    const token = loginRes.body.data.accessToken;

    expect((await api.post('/api/v1/auth/logout').set('Cookie', cookie)).status).toBe(200);
    expect((await as(token).get('/auth/me')).status).toBe(401);
    expect((await api.post('/api/v1/auth/refresh').set('Cookie', cookie)).status).toBe(401);
  });
});

describe('password recovery', () => {
  it('resets the password with a single-use token and signs out all sessions', async () => {
    const user = await createVerifiedUser();
    const oldToken = await login(user.email);

    const forgot = await api.post('/api/v1/auth/forgot-password').send({ email: user.email });
    const forgotUnknown = await api.post('/api/v1/auth/forgot-password').send({ email: 'ghost@example.com' });
    expect(forgot.body).toEqual(forgotUnknown.body); // no enumeration
    expect(testOutbox.filter((m) => m.to === 'ghost@example.com')).toHaveLength(0);

    const resetToken = lastEmailToken(user.email);
    const reset = await api.post('/api/v1/auth/reset-password').send({ token: resetToken, password: 'BrandNew123' });
    expect(reset.status).toBe(200);

    expect((await as(oldToken).get('/auth/me')).status).toBe(401);
    expect((await api.post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD })).status).toBe(401);
    expect((await api.post('/api/v1/auth/login').send({ email: user.email, password: 'BrandNew123' })).status).toBe(200);

    const reuse = await api.post('/api/v1/auth/reset-password').send({ token: resetToken, password: 'Another123' });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error.code).toBe('INVALID_TOKEN');
  });

  it('rejects an expired reset token', async () => {
    const user = await createVerifiedUser();
    await api.post('/api/v1/auth/forgot-password').send({ email: user.email });
    await prisma.authToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await api.post('/api/v1/auth/reset-password').send({ token: lastEmailToken(user.email), password: 'BrandNew123' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('links last 30 minutes; one email a minute per account; a newer link replaces the older one', async () => {
    const user = await createVerifiedUser();
    await api.post('/api/v1/auth/forgot-password').send({ email: user.email });
    const first = lastEmailToken(user.email);
    const stored = await prisma.authToken.findFirst({ where: { userId: user.id, type: 'PASSWORD_RESET' } });
    expect(Math.abs(stored.expiresAt - Date.now() - 30 * 60_000)).toBeLessThan(10_000);

    await api.post('/api/v1/auth/forgot-password').send({ email: user.email }); // within the cooldown: no new email
    expect(testOutbox.filter((m) => m.to === user.email && m.template === 'reset-password')).toHaveLength(1);

    await prisma.authToken.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(Date.now() - 61_000) } });
    await api.post('/api/v1/auth/forgot-password').send({ email: user.email });
    const second = lastEmailToken(user.email);
    expect(second).not.toBe(first);
    expect((await api.post('/api/v1/auth/reset-password').send({ token: first, password: 'BrandNew123' })).body.error.code).toBe('INVALID_TOKEN');
    expect((await api.post('/api/v1/auth/reset-password').send({ token: second, password: 'BrandNew123' })).status).toBe(200);
  });

  it('two simultaneous uses of one link: exactly one succeeds', async () => {
    const user = await createVerifiedUser();
    await api.post('/api/v1/auth/forgot-password').send({ email: user.email });
    const token = lastEmailToken(user.email);
    const results = await Promise.all(['RaceOne1234', 'RaceTwo1234'].map((password) => api.post('/api/v1/auth/reset-password').send({ token, password })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  });

  it('no link for disabled accounts or invited people who never set a password (same answer)', async () => {
    const disabled = await createVerifiedUser();
    await prisma.user.update({ where: { id: disabled.id }, data: { status: 'DISABLED' } });
    const invited = await prisma.user.create({ data: { email: 'invited-only@example.com', firstName: 'In', lastName: 'Vited' } });
    const known = await api.post('/api/v1/auth/forgot-password').send({ email: (await createVerifiedUser()).email });
    for (const email of [disabled.email, invited.email]) {
      const res = await api.post('/api/v1/auth/forgot-password').send({ email });
      expect(res.body).toEqual(known.body);
      expect(testOutbox.filter((m) => m.to === email)).toHaveLength(0);
    }
  });

  it('a security email follows every password change: by reset link and from settings', async () => {
    const user = await createVerifiedUser();
    await api.post('/api/v1/auth/forgot-password').send({ email: user.email });
    await api.post('/api/v1/auth/reset-password').send({ token: lastEmailToken(user.email), password: 'BrandNew123' });
    const token = await login(user.email, 'BrandNew123');
    const change = await as(token).post('/auth/change-password').send({ currentPassword: 'BrandNew123', newPassword: 'Newer12345' });
    expect(change.status).toBe(200);

    const notices = testOutbox.filter((m) => m.to === user.email && m.template === 'password-changed');
    expect(notices).toHaveLength(2);
    for (const m of notices) {
      expect(m.subject).toBe('Your TeamFlow password was changed');
      expect(m.text).not.toMatch(/BrandNew123|Newer12345|token=/);
    }
  });

  it('stores only hashes of tokens', async () => {
    const user = await createVerifiedUser();
    await api.post('/api/v1/auth/forgot-password').send({ email: user.email });
    const raw = lastEmailToken(user.email);
    const stored = await prisma.authToken.findFirst({ where: { userId: user.id } });
    expect(stored.tokenHash).not.toBe(raw);
    expect(stored.tokenHash).toHaveLength(64);
  });
});

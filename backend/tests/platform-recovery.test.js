import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, createPlatformAdmin, createVerifiedUser, lastEmailToken, platform, platformLogin, PLATFORM_PASSWORD, prisma, resetDb, testOutbox } from './helpers.js';

const H = { 'X-TeamFlow-Client': 'test' };
const NEW_PASSWORD = 'Fresh-Platform-2027';
const forgot = (email) => request(app).post('/api/v1/platform/auth/forgot-password').set(H).send({ email });
const reset = (token, password = NEW_PASSWORD) => request(app).post('/api/v1/platform/auth/reset-password').set(H).send({ token, password });
const signIn = (email, password) => request(app).post('/api/v1/platform/auth/login').set(H).send({ email, password });
const resetMails = (to) => testOutbox.filter((m) => m.to === to && m.template === 'platform-reset-password');
const platformToken = (to) => resetMails(to).at(-1)?.text.match(/token=([^\s&]+)/)?.[1] ?? null;

let admin;
beforeEach(async () => {
  await resetDb();
  admin = await createPlatformAdmin();
});

describe('platform admin password recovery', () => {
  it('sends a 15-minute platform link only to platform admins, with the same answer for everyone', async () => {
    const tenantUser = await createVerifiedUser();
    const known = await forgot(admin.email);
    const unknown = await forgot('nobody@example.com');
    const tenant = await forgot(tenantUser.email);
    expect(known.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
    expect(tenant.body).toEqual(known.body);
    expect(testOutbox.filter((m) => m.to === tenantUser.email || m.to === 'nobody@example.com')).toHaveLength(0);

    const [mail] = resetMails(admin.email);
    expect(mail.subject).toBe('Reset your TeamFlow platform password');
    expect(mail.text).toMatch(/\/platform\/reset-password\?token=/);
    const stored = await prisma.platformPasswordReset.findFirst({ where: { adminId: admin.id } });
    expect(stored.tokenHash).not.toBe(platformToken(admin.email));
    expect(stored.tokenHash).toHaveLength(64);
    expect(Math.abs(stored.expiresAt - Date.now() - 15 * 60_000)).toBeLessThan(10_000);
  });

  it('resets once, signs out every session, keeps the emailed code at sign-in, and sends a security notice', async () => {
    const agent = await platformLogin(admin.email);
    expect((await platform(agent).get('/platform/auth/me')).status).toBe(200);
    await forgot(admin.email);
    const token = platformToken(admin.email);

    const res = await reset(token);
    expect(res.status).toBe(200);
    expect(res.body.data.message).toBe('Your password has been updated successfully. Please sign in again.');
    expect(res.headers['set-cookie']).toBeUndefined(); // not signed in by the reset
    expect((await platform(agent).get('/platform/auth/me')).status).toBe(401); // old session revoked

    expect((await reset(token, 'Another-Platform-2028')).body.error.code).toBe('INVALID_TOKEN'); // single use
    expect((await signIn(admin.email, PLATFORM_PASSWORD)).status).toBe(401); // old password gone
    const fresh = await signIn(admin.email, NEW_PASSWORD);
    expect(fresh.status).toBe(200);
    expect(fresh.body.data.challengeId).toBeTruthy(); // second factor still required
    expect(fresh.headers['set-cookie']).toBeUndefined();

    const notice = testOutbox.find((m) => m.to === admin.email && m.template === 'platform-password-changed');
    expect(notice.subject).toBe('Your TeamFlow platform password was changed');
    expect(notice.text).not.toContain(NEW_PASSWORD);
    const audit = await prisma.platformAuditLog.findFirst({ where: { action: 'PLATFORM_ADMIN_PASSWORD_RESET', targetId: admin.id } });
    expect(audit.metadata).toMatchObject({ via: 'email link' });
    expect(JSON.stringify(audit.metadata)).not.toContain(token);
  });

  it('two simultaneous uses of one link: exactly one succeeds', async () => {
    await forgot(admin.email);
    const token = platformToken(admin.email);
    const results = await Promise.all([reset(token, 'Race-Platform-2027a'), reset(token, 'Race-Platform-2027b')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  });

  it('rejects expired and replaced links; one email a minute', async () => {
    await forgot(admin.email);
    const first = platformToken(admin.email);
    await forgot(admin.email); // within the cooldown: nothing new
    expect(resetMails(admin.email)).toHaveLength(1);

    await prisma.platformPasswordReset.updateMany({ where: { adminId: admin.id }, data: { createdAt: new Date(Date.now() - 61_000) } });
    await forgot(admin.email);
    const second = platformToken(admin.email);
    expect(second).not.toBe(first);
    expect((await reset(first)).body.error.code).toBe('INVALID_TOKEN'); // replaced

    await prisma.platformPasswordReset.updateMany({ where: { adminId: admin.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await reset(second)).body.error.code).toBe('INVALID_TOKEN'); // expired
  });

  it('weak passwords and malformed requests are refused', async () => {
    await forgot(admin.email);
    const token = platformToken(admin.email);
    for (const weak of ['short1', 'onlyletterslong', '123456789012']) {
      expect((await reset(token, weak)).status, weak).toBe(422);
    }
    expect((await reset('x'.repeat(5))).status).toBe(422);
    const noHeader = await request(app).post('/api/v1/platform/auth/forgot-password').send({ email: admin.email });
    expect(noHeader.status).toBe(403); // the platform API's CSRF header
    expect((await reset(token)).status).toBe(200); // the link still works after the refused attempts
  });

  it('a disabled admin gets no link, and a link issued before disabling stops working; a lockout stays', async () => {
    await forgot(admin.email);
    const token = platformToken(admin.email);
    await prisma.platformAdmin.update({ where: { id: admin.id }, data: { status: 'DISABLED' } });
    expect((await reset(token)).body.error.code).toBe('INVALID_TOKEN');
    await prisma.platformPasswordReset.deleteMany();
    await forgot(admin.email);
    expect(resetMails(admin.email)).toHaveLength(1); // only the one from before

    const locked = await createPlatformAdmin();
    const until = new Date(Date.now() + 10 * 60_000);
    await prisma.platformAdmin.update({ where: { id: locked.id }, data: { lockedUntil: until } });
    await forgot(locked.email);
    expect((await reset(platformToken(locked.email))).status).toBe(200);
    expect((await prisma.platformAdmin.findUnique({ where: { id: locked.id } })).lockedUntil).toEqual(until);
  });

  it('tenant and platform reset links never cross over', async () => {
    const user = await createVerifiedUser();
    await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email });
    const tenantToken = lastEmailToken(user.email);
    expect((await reset(tenantToken)).body.error.code).toBe('INVALID_TOKEN');

    await forgot(admin.email);
    const adminToken = platformToken(admin.email);
    const tenantReset = await request(app).post('/api/v1/auth/reset-password').send({ token: adminToken, password: 'BrandNew123' });
    expect(tenantReset.body.error.code).toBe('INVALID_TOKEN');
    expect((await reset(adminToken)).status).toBe(200); // still valid for its own account
  });
});

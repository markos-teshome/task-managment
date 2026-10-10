import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { test, expect } from '@playwright/test';
import { PASSWORD, signIn, USERS, watchConsole } from './helpers.js';

// The API keeps emails in memory during e2e runs, so the test issues the invitation link the same way the
// email does (a random token whose SHA-256 is stored). The email's link format is covered by backend tests.
const { PrismaClient } = createRequire(import.meta.url)('../../backend/node_modules/@prisma/client');
const prisma = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
test.afterAll(() => prisma.$disconnect());

async function invitationLink(email, organizationSlug) {
  const membership = await prisma.membership.findFirst({
    where: { status: 'INVITED', user: { email }, organization: { slug: organizationSlug } },
  });
  const raw = crypto.randomBytes(32).toString('base64url');
  await prisma.authToken.deleteMany({ where: { membershipId: membership.id, usedAt: null } });
  await prisma.authToken.create({
    data: {
      userId: membership.userId,
      membershipId: membership.id,
      type: 'INVITATION',
      tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  return `/accept-invite?token=${raw}`;
}

async function inviteFromTeamPage(page, { email, firstName, lastName }) {
  await page.getByRole('link', { name: 'Team', exact: true }).click();
  await page.getByRole('button', { name: 'Invite member' }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite a team member' });
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByLabel('First name').fill(firstName);
  await dialog.getByLabel('Last name').fill(lastName);
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText(/Invitation sent to/)).toBeVisible();
}

test('a new person accepts an invitation on their phone and lands in the right organization', async ({ page, browser }) => {
  const email = `meron.${Date.now()}@example.com`;
  await signIn(page, USERS.owner);
  await inviteFromTeamPage(page, { email, firstName: 'Meron', lastName: 'Tadesse' });
  const link = await invitationLink(email, 'abay-trading');

  // Another device: a separate phone-sized browser with no session.
  const phone = await browser.newContext({ viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true });
  const p = await phone.newPage();
  const errors = watchConsole(p);
  await p.goto(link);
  await expect(p.getByRole('heading', { name: 'Join Abay Trading PLC' })).toBeVisible();
  await expect(p.getByText(/invited you as Employee/)).toBeVisible();
  await p.getByLabel('Create a password').fill(PASSWORD);
  await p.getByRole('button', { name: 'Accept invitation' }).click();

  await expect(p).toHaveURL(/\/login/);
  await expect(p.getByText("You've joined Abay Trading PLC")).toBeVisible();
  await p.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await p.getByRole('button', { name: 'Sign in' }).click();
  await expect(p).not.toHaveURL(/\/login/);
  await expect(p.getByText('Abay Trading PLC').first()).toBeVisible();

  // The link works once.
  await p.goto(link);
  await expect(p.getByRole('heading', { name: 'Invitation already accepted' })).toBeVisible();
  expect(errors).toEqual([]);
  await phone.close();
});

test('an existing account must enter its password to join', async ({ page, browser }) => {
  // A person who already registered elsewhere (fresh account, so other specs' demo users are untouched).
  const email = `existing.${Date.now()}@example.com`;
  const bcrypt = createRequire(import.meta.url)('../../backend/node_modules/bcryptjs');
  await prisma.user.create({
    data: { email, firstName: 'Yonas', lastName: 'Haile', passwordHash: await bcrypt.hash(PASSWORD, 4), emailVerifiedAt: new Date() },
  });
  await signIn(page, USERS.owner);
  await inviteFromTeamPage(page, { email, firstName: 'Yonas', lastName: 'Haile' });
  const link = await invitationLink(email, 'abay-trading');

  const other = await browser.newContext();
  const p = await other.newPage();
  await p.goto(link);
  await expect(p.getByText('You already have a TeamFlow account')).toBeVisible();
  await p.getByLabel('Your password').fill('Not-the-password1');
  await p.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(p.getByText('Incorrect password')).toBeVisible();

  await p.getByLabel('Your password').fill(PASSWORD);
  await p.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(p).toHaveURL(/\/login/);
  await signIn(p, email);
  await expect(p.getByText('Abay Trading PLC').first()).toBeVisible();
  await other.close();
});

test('someone signed in as a different account cannot claim the invitation', async ({ page }) => {
  const email = `claim.${Date.now()}@example.com`;
  await signIn(page, USERS.owner);
  await inviteFromTeamPage(page, { email, firstName: 'Claim', lastName: 'Test' });
  const link = await invitationLink(email, 'abay-trading');

  await page.goto(link); // still signed in as the owner
  await expect(page.getByText(`this invitation was sent to ${email}`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept invitation' })).toHaveCount(0);
});

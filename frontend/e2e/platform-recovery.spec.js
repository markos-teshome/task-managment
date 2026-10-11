import { test, expect } from '@playwright/test';
import { PASSWORD, USERS, watchConsole } from './helpers.js';
import { bcrypt, knownPlatformCode, platformResetLink, prisma } from './db.js';

const NEW_PASSWORD = 'Fresh-Platform-2027';

// Super admin recovery: platform pages only, generic answer, 12-character rule, back to sign-in, code still required.
test('platform admin recovers their password and still needs the emailed code', async ({ page }) => {
  const errors = watchConsole(page);
  try {
    await page.goto('/platform/login');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page).toHaveURL(/\/platform\/forgot-password$/);
    await expect(page.getByText("Enter your administrator email address. If an eligible account exists, we'll send you a secure reset link.")).toBeVisible();
    await page.getByLabel('Email address').fill(USERS.platform);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByText(/If an eligible administrator account exists with this email/)).toBeVisible();
    await expect(page.getByText(/expires in 15 minutes/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to platform sign-in' })).toBeVisible();

    // A company user's address gets the very same answer.
    await page.goto('/platform/forgot-password');
    await page.getByLabel('Email address').fill(USERS.owner);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByText(/If an eligible administrator account exists with this email/)).toBeVisible();

    // Dead link → request a new one on the platform page.
    await page.goto('/platform/reset-password?token=not-a-real-token-at-all');
    await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel('Confirm password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(page.getByText('This password reset link is invalid or has expired. Please request a new one.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Request new link' })).toHaveAttribute('href', '/platform/forgot-password');

    // The emailed link: 12-character rule shown live and enforced.
    await page.goto(await platformResetLink(USERS.platform));
    await page.getByLabel('New password', { exact: true }).fill('Short-pass1');
    await expect(page.getByText('At least 12 characters (not yet)')).toBeAttached();
    await page.getByLabel('Confirm password').fill('Short-pass1');
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(page.getByText('Use at least 12 characters')).toBeVisible();
    await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel('Confirm password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(page).toHaveURL(/\/platform\/login$/);
    await expect(page.getByText('Your password has been updated successfully. Please sign in again.')).toBeVisible();

    // Old password refused; new one leads to the emailed-code step, then the console.
    await page.getByLabel('Email').fill(USERS.platform);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Incorrect email or password.')).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await page.getByLabel('Sign-in code').fill(await knownPlatformCode(USERS.platform));
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page).toHaveURL(/\/platform$/);
    expect(errors).toEqual([]);
  } finally {
    await prisma.platformAdmin.update({ where: { email: USERS.platform }, data: { passwordHash: await bcrypt.hash(PASSWORD, 10), failedLoginAttempts: 0, lockedUntil: null } });
  }
});

test('platform recovery screens at phone width', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  for (const path of ['/platform/login', '/platform/forgot-password', await platformResetLink(USERS.platform)]) {
    await page.goto(path);
    await expect(page.getByRole('heading').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), path).toBe(false);
    if (process.env.SCREENS_DIR) await page.screenshot({ path: `${process.env.SCREENS_DIR}/platform-recovery-${path.split('/')[2].split('?')[0]}.png` });
  }
  await prisma.platformPasswordReset.deleteMany();
  await ctx.close();
});

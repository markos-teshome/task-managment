import { test, expect } from '@playwright/test';
import { PASSWORD, signIn, USERS, unique, watchConsole } from './helpers.js';
import { bcrypt, emailLink, prisma } from './db.js';

const MERON = 'meron@abaytrading.test'; // a seeded member no other spec signs in as

// Password recovery: generic answer, resend cooldown, live rules, dead links, reset → sign in with the new password only.
test('password recovery from forgot to sign-in', async ({ page }) => {
  const errors = watchConsole(page);
  try {
    await page.goto('/login');
    await page.getByRole('link', { name: /Forgot/ }).click();
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    await page.getByLabel('Email').fill(MERON);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByText("If an account exists with this email, you'll receive a password reset link shortly.")).toBeVisible();
    await expect(page.getByRole('button', { name: /Resend in \d+s/ })).toBeDisabled();

    // A dead link: one clear message and a way forward.
    await page.goto('/reset-password?token=not-a-real-token');
    await page.getByLabel('New password', { exact: true }).fill('Fresh-pass-2026');
    await page.getByLabel('Confirm password').fill('Fresh-pass-2026');
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(page.getByText('This password reset link is invalid or has expired. Please request a new one.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Request new link' })).toBeVisible();

    // The emailed link (issued the same way the API does).
    await page.goto(await emailLink('PASSWORD_RESET', MERON));
    await expect(page.getByRole('heading', { name: 'Create a new password' })).toBeVisible();
    await page.getByLabel('New password', { exact: true }).fill('short');
    await expect(page.getByText('At least 8 characters (not yet)')).toBeAttached();
    await page.getByLabel('New password', { exact: true }).fill('Fresh-pass-2026');
    await expect(page.getByText('At least 8 characters (met)')).toBeAttached();
    await page.getByLabel('Confirm password').fill('Fresh-pass-2027');
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(page.getByText("Passwords don't match")).toBeVisible();
    await page.getByLabel('Confirm password').fill('Fresh-pass-2026');
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/password has been reset/i)).toBeVisible();

    // Old password refused, new one works.
    await page.getByLabel('Email').fill(MERON);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(/Incorrect email or password/)).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill('Fresh-pass-2026');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).not.toHaveURL(/\/login/);
    expect(errors).toEqual([]);
  } finally {
    await prisma.user.update({ where: { email: MERON }, data: { passwordHash: await bcrypt.hash(PASSWORD, 10) } });
  }
});

// Notifications: a manager assigns work; the employee sees the badge, opens the task from the bell, and the count clears.
test('task assignment reaches the assignee through the bell', async ({ page, browser }) => {
  const errors = watchConsole(page);
  const title = unique('Review copy');
  await signIn(page, USERS.manager);
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('link', { name: 'Website Development' }).first().click();
  await page.getByRole('tab', { name: /Tasks/ }).click();
  await page.getByRole('button', { name: 'New task' }).click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByLabel('Assignee').selectOption({ label: 'Hana Tadesse' });
  await dialog.getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByText('Task created')).toBeVisible();

  const other = await browser.newContext();
  const e = await other.newPage();
  const eErrors = watchConsole(e);
  await signIn(e, USERS.employee);
  const bell = e.getByRole('button', { name: /^Notifications, \d+ unread$/ });
  await expect(bell).toBeVisible();
  await bell.click();
  const item = e.getByRole('menuitem', { name: new RegExp(`New task assigned.*${title}`) });
  await expect(item).toBeVisible();
  await item.click();
  await expect(e.getByRole('dialog', { name: 'Task details' }).getByRole('heading', { name: title })).toBeVisible();
  await e.getByRole('dialog', { name: 'Task details' }).getByRole('button', { name: 'Close task' }).click();

  // The full list shows it as read; "Mark all as read" clears the badge.
  await e.goto('/notifications');
  await expect(e.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
  await expect(e.getByRole('button', { name: new RegExp(title) })).toBeVisible();
  const markAll = e.getByRole('button', { name: 'Mark all as read' });
  if (await markAll.isEnabled()) await markAll.click();
  await expect(e.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
  expect(eErrors).toEqual([]);
  await other.close();
  expect(errors).toEqual([]);
});

// Preferences persist through the API; billing is locked; Settings tabs survive a refresh.
test('notification preferences and security settings', async ({ page }) => {
  const errors = watchConsole(page);
  await signIn(page, USERS.employee);
  await page.goto('/settings?tab=notifications');
  const email = page.getByRole('switch', { name: 'Task assignments: email' });
  await expect(email).toBeChecked();
  await email.uncheck({ force: true });
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByText('Notification preferences saved')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Notifications' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('switch', { name: 'Task assignments: email' })).not.toBeChecked();
  await expect(page.getByRole('switch', { name: 'Billing and subscription: email' })).toBeDisabled();
  await expect(page.getByText('Always emailed')).toBeVisible();
  // Put it back for other runs.
  await page.getByRole('switch', { name: 'Task assignments: email' }).check({ force: true });
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByText('Notification preferences saved')).toBeVisible();

  await page.getByRole('tab', { name: 'Security' }).click();
  await expect(page).toHaveURL(/tab=security/);
  await page.getByLabel('Current password').fill('wrong-password-1');
  await page.getByLabel('New password', { exact: true }).fill('Another-pass-2026');
  await page.getByLabel('Confirm new password').fill('Another-pass-2026');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Current password is incorrect')).toBeVisible(); // nothing changed
  expect(errors).toEqual([]);
});

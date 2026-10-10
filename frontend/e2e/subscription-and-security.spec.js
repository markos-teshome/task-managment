import { test, expect } from '@playwright/test';
import { signIn, signOut, USERS, watchConsole } from './helpers.js';

// Scenario 4 — Plan limit: blocked with an explanation → upgrade → payment confirmed → can invite.
test('owner hits the member limit, upgrades, and can invite again', async ({ page }) => {
  const errors = watchConsole(page);
  await signIn(page, USERS.giftOwner);

  await page.getByRole('link', { name: 'Team', exact: true }).click();
  await expect(page.getByText('Team member limit reached')).toBeVisible();
  await page.getByRole('button', { name: 'Invite member' }).click();
  const invite = page.getByRole('dialog', { name: 'Invite a team member' });
  await expect(invite.getByText(/supports up to 3 team members/)).toBeVisible();
  await expect(invite.getByRole('button', { name: 'Send invitation' })).toBeDisabled();
  await invite.getByRole('link', { name: 'View plans →' }).click();

  await expect(page).toHaveURL(/\/billing#plans/);
  await page.getByRole('button', { name: 'Upgrade to Professional' }).click();
  await page.getByRole('button', { name: 'Continue to payment' }).click();

  // A declined payment changes nothing…
  await page.getByRole('button', { name: 'Decline' }).click();
  await expect(page.getByRole('heading', { name: 'Payment failed' })).toBeVisible();
  await expect(page.getByText('your plan has not changed')).toBeVisible();

  // …a confirmed one activates the plan.
  await page.getByRole('link', { name: 'Try again' }).click();
  await page.getByRole('button', { name: 'Upgrade to Professional' }).click();
  await page.getByRole('button', { name: 'Continue to payment' }).click();
  await page.getByRole('button', { name: /^Pay ETB/ }).click();
  await expect(page.getByRole('heading', { name: "You're on Professional" })).toBeVisible();

  await page.getByRole('link', { name: 'Invite your team' }).click();
  await expect(page.getByText('Team member limit reached')).toHaveCount(0);
  await page.getByRole('button', { name: 'Invite member' }).click();
  const after = page.getByRole('dialog', { name: 'Invite a team member' });
  await after.getByLabel('Email').fill(`new.${Date.now()}@giftconstruction.test`);
  await after.getByLabel('First name').fill('Meseret');
  await after.getByLabel('Last name').fill('Alemayehu');
  await after.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText(/Invitation sent to/)).toBeVisible();
  expect(errors).toEqual([]);
});

// Scenario 5 — Permission and tenant protection in the UI.
test('employee cannot open protected pages or another tenant’s data', async ({ page }) => {
  // Find a project id belonging to the other organization.
  await signIn(page, USERS.giftOwner);
  await page.goto('/projects');
  await page.getByRole('link', { name: 'Bole Apartment Block' }).first().click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/);
  const foreignProjectUrl = new URL(page.url()).pathname;
  await signOut(page);

  await signIn(page, USERS.employee);
  for (const path of ['/billing', '/team', '/roles', '/activity']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: "You don't have access to this page" })).toBeVisible();
  }
  await page.goto('/platform');
  await expect(page.getByText('only available to TeamFlow administrators')).toBeVisible();

  await page.goto(foreignProjectUrl);
  await expect(page.getByText('Project not found')).toBeVisible();
  await expect(page.getByText('Bole Apartment Block')).toHaveCount(0);

  // Sidebar only offers what the role can use.
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'My Work' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Team' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Plan & billing' })).toHaveCount(0);
});

test('unauthenticated visitors are sent to sign in and returned afterwards', async ({ page }) => {
  await page.goto('/projects');
  await expect(page).toHaveURL(/\/login\?next=%2Fprojects/);
  await page.getByLabel('Email').fill(USERS.manager);
  await page.getByLabel('Password', { exact: true }).fill('Demo@1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
});

test('wrong password shows a clear error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(USERS.manager);
  await page.getByLabel('Password', { exact: true }).fill('not-the-password1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Incorrect email or password.');
});

test('platform admin manages tenants and plans', async ({ page }) => {
  await signIn(page, USERS.platform);
  await expect(page).toHaveURL(/\/platform$/);
  await expect(page.getByRole('heading', { name: 'Platform overview' })).toBeVisible();
  await page.getByRole('link', { name: 'Organizations' }).click();
  await expect(page.getByRole('cell', { name: /^Abay Trading PLC Since/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: /^Gift Construction PLC Since/ })).toBeVisible();
  await page.getByRole('link', { name: 'Plans & pricing' }).click();
  await expect(page.getByRole('heading', { name: 'Plans & pricing' })).toBeVisible();
  // The plan row shows the name and its code ("Professional PROFESSIONAL"); organization rows only the name.
  await expect(page.getByRole('cell', { name: 'Professional PROFESSIONAL' })).toBeVisible();
});

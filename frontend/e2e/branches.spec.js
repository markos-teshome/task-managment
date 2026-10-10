import { test, expect } from '@playwright/test';
import { signIn, USERS, watchConsole } from './helpers.js';

// Scenario 4: the owner creates a branch, assigns a manager and members — only people of this company.
test('owner creates a branch and manages its members', async ({ page }) => {
  const errors = watchConsole(page);
  await signIn(page, USERS.owner);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Branches' }).click();
  await expect(page.getByRole('heading', { name: 'Branches', level: 1 })).toBeVisible();
  await expect(page.getByRole('table').getByText('Head Office')).toBeVisible();

  await page.getByRole('button', { name: 'Add branch' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a branch' });
  await dialog.getByLabel('Branch name').fill('CMC Branch');
  await dialog.getByLabel('Code').fill('cmc');
  await dialog.getByLabel('Address').fill('CMC, Addis Ababa');
  await expect(dialog.getByRole('radio', { name: /Kebede Worku/ })).toHaveCount(0); // another company's owner
  await dialog.getByRole('radio', { name: /Bethel Assefa/ }).check();
  await dialog.getByRole('button', { name: 'Create branch' }).click();

  await expect(page.getByRole('heading', { name: 'CMC Branch' })).toBeVisible();
  await expect(page.getByText('CMC', { exact: true })).toBeVisible();
  const members = page.getByRole('region', { name: /Members/ });
  await expect(members.getByText('Bethel Assefa')).toBeVisible();

  await page.getByRole('button', { name: 'Add members' }).click();
  const add = page.getByRole('dialog', { name: 'Add members to CMC Branch' });
  await add.getByRole('checkbox', { name: /Yonas Girma/ }).check();
  await add.getByRole('button', { name: /^Add/ }).click();
  await expect(members.getByText('Yonas Girma')).toBeVisible();

  // Removing from a branch keeps the organization account.
  await page.getByRole('button', { name: 'Remove Yonas Girma from CMC Branch' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove from branch' }).click();
  await expect(members.getByText('Yonas Girma')).toHaveCount(0);
  await page.getByRole('link', { name: 'Team', exact: true }).click();
  await expect(page.getByRole('row', { name: /Yonas Girma/ })).toBeVisible();
  expect(errors).toEqual([]);
});

// Scenario 6: a branch manager sees their branch's work, not other branches'; direct URLs fail server-side.
test("a branch manager can't reach another branch's project or manage another branch", async ({ page, browser }) => {
  // Owner puts a project in Sar Bet Branch (Dawit manages Bole Branch, not Sar Bet).
  await signIn(page, USERS.owner);
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'New project' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await dialog.getByLabel('Project name').fill('Sar Bet Expansion');
  await dialog.getByLabel('Branch').selectOption({ label: 'Sar Bet Branch' });
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Sar Bet Expansion' })).toBeVisible();
  const projectUrl = new URL(page.url()).pathname;

  const ctx = await browser.newContext();
  const m = await ctx.newPage();
  const errors = watchConsole(m);
  await signIn(m, USERS.manager);
  await m.getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(m.getByRole('link', { name: 'Marketing Campaign Q4' }).first()).toBeVisible(); // own branch
  await expect(m.getByText('Sar Bet Expansion')).toHaveCount(0);

  await m.goto(projectUrl);
  await expect(m.getByText('Project not found')).toBeVisible();

  // Own branch: can edit details and members. Other branch: read-only, and its project stays hidden.
  await m.goto('/branches');
  await m.getByRole('table').getByRole('link', { name: 'Bole Branch' }).click();
  await expect(m.getByRole('button', { name: 'Edit' })).toBeVisible();
  await expect(m.getByRole('button', { name: 'Add members' })).toBeVisible();
  await m.goto('/branches');
  await m.getByRole('table').getByRole('link', { name: 'Sar Bet Branch' }).click();
  await expect(m.getByRole('heading', { name: 'Sar Bet Branch' })).toBeVisible();
  await expect(m.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(m.getByRole('button', { name: 'Add members' })).toHaveCount(0);
  await expect(m.getByRole('region', { name: /Projects/ }).getByText('Sar Bet Expansion')).toHaveCount(0);
  expect(errors).toEqual([]);
  await ctx.close();
});

// Scenario 10 (part): a failed request shows a clear error with a retry, not an endless loader.
test('a failed branch list shows an error with retry', async ({ page }) => {
  await signIn(page, USERS.owner);
  await page.route('**/api/v1/branches?**', (route) => route.abort());
  await page.route('**/api/v1/branches', (route) => route.abort());
  await page.goto('/branches');
  await expect(page.getByText("You're offline")).toBeVisible();
  await page.unroute('**/api/v1/branches?**');
  await page.unroute('**/api/v1/branches');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('table').getByText('Head Office')).toBeVisible();
});

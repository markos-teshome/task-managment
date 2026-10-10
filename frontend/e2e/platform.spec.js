import { test, expect } from '@playwright/test';
import { PASSWORD, signIn, USERS, watchConsole } from './helpers.js';
import { knownPlatformCode, prisma } from './db.js';

test.afterAll(() => prisma.$disconnect());

async function platformSignIn(page) {
  await page.goto('/platform/login');
  await page.getByLabel('Email').fill(USERS.platform);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page.getByLabel('Sign-in code').fill(await knownPlatformCode(USERS.platform));
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(/\/platform$/);
}

// Scenarios 7–9: dedicated console, company metadata only, suspension with feedback to the company.
test('super admin: own console, company metadata only, suspension and reactivation', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const errors = watchConsole(page);

  // A company session never opens the console.
  await signIn(page, USERS.owner);
  await page.goto('/platform');
  await expect(page).toHaveURL(/\/platform\/login$/);

  await platformSignIn(page);
  await expect(page.getByText('Platform console', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Platform overview' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main' });
  for (const item of ['Organizations', 'Subscriptions', 'Payments', 'Plans', 'Admin activity', 'System health']) {
    await expect(nav.getByRole('link', { name: item })).toBeVisible();
  }
  for (const tenantItem of ['My Work', 'Projects', 'Tasks', 'Team', 'Branches']) {
    await expect(nav.getByRole('link', { name: tenantItem, exact: true })).toHaveCount(0);
  }
  // Even with a company session in the same browser, the console shows no company context.
  await expect(page.getByRole('button', { name: /Switch organization/ })).toHaveCount(0);

  // Company detail: metadata yes, private work no, no way in.
  await nav.getByRole('link', { name: 'Organizations' }).click();
  await page.getByRole('table').getByRole('link', { name: 'Abay Trading PLC' }).click();
  await expect(page.getByRole('heading', { name: 'Abay Trading PLC' })).toBeVisible();
  await expect(page.getByText('Active branches')).toBeVisible();
  await expect(page.getByText('abebe@abaytrading.test')).toBeVisible(); // billing contact
  const body = await page.locator('main').innerText();
  for (const secret of ['Website Development', 'Marketing Campaign Q4', 'Design Homepage', 'Build Dashboard']) {
    expect(body, secret).not.toContain(secret);
  }
  await expect(page.getByText(/impersonat|enter workspace|view as owner/i)).toHaveCount(0);

  // Suspend: a reason is required; the company's people are told; nothing is deleted.
  await page.getByRole('button', { name: 'Suspend' }).click();
  const dialog = page.getByRole('dialog', { name: /Suspend Abay Trading PLC/ });
  await dialog.getByRole('button', { name: 'Suspend organization' }).click();
  await expect(dialog.getByText('Give a short reason')).toBeVisible();
  await dialog.getByLabel('Reason').fill('Unpaid invoices (e2e)');
  await dialog.getByRole('button', { name: 'Suspend organization' }).click();
  await expect(page.getByText('Abay Trading PLC suspended')).toBeVisible();
  await expect(page.getByRole('main').getByText('Suspended').first()).toBeVisible();
  await expect(page.getByText('Suspended organization Abay Trading PLC — “Unpaid invoices (e2e)”')).toBeVisible();

  const member = await browser.newContext();
  const m = await member.newPage();
  await m.goto('/login');
  await m.getByLabel('Email').fill(USERS.manager);
  await m.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await m.getByRole('button', { name: 'Sign in' }).click();
  await expect(m.getByText('Your organization is suspended. Contact TeamFlow support.')).toBeVisible();
  expect(await prisma.project.count({ where: { organization: { slug: 'abay-trading' } } })).toBeGreaterThan(0);

  // Reactivate: access comes back.
  await page.getByRole('button', { name: 'Reactivate' }).click();
  await page.getByRole('dialog', { name: /Reactivate Abay Trading PLC/ }).getByRole('button', { name: 'Reactivate' }).click();
  await expect(page.getByText('Abay Trading PLC reactivated')).toBeVisible();
  await m.goto('/'); // the same, still signed-in member simply reloads
  await expect(m.getByRole('heading', { name: /Good (morning|afternoon|evening), Dawit/ })).toBeVisible();
  await member.close();

  // The other console pages load.
  for (const [link, heading] of [['Subscriptions', 'Subscriptions'], ['Payments', 'Payments'], ['Plans', 'Plans'], ['Admin activity', 'Admin activity'], ['System health', 'System health']]) {
    await nav.getByRole('link', { name: link }).click();
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

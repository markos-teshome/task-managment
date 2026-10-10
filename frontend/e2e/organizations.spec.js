import { test, expect } from '@playwright/test';
import { signIn, USERS, watchConsole } from './helpers.js';
import { prisma } from './db.js';

test.afterAll(() => prisma.$disconnect());

const switcher = (page) => page.getByRole('button', { name: /Switch organization/ });

// Scenarios 1–2 (switcher part): one company → plain identity; a second company → compact switcher.
test('one company shows a plain identity; creating a second brings the switcher, which switches by keyboard', async ({ page }) => {
  const errors = watchConsole(page);
  const name = `Abay Ventures ${Date.now().toString(36)}`;
  await signIn(page, USERS.owner);

  await expect(page.getByRole('banner').getByText('Abay Trading PLC')).toBeVisible();
  await expect(switcher(page)).toHaveCount(0); // nothing to choose → no dropdown

  // Create from the account menu (always available).
  await page.getByRole('button', { name: /account menu/ }).click();
  await page.getByRole('menuitem', { name: 'Create organization' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create an organization' });
  await dialog.getByLabel('Organization name').fill('<b>');
  await dialog.getByRole('button', { name: 'Create organization' }).click();
  await expect(dialog.getByText(/letters or numbers|Remove the/)).toBeVisible();
  await dialog.getByLabel('Organization name').fill(name);
  await dialog.getByRole('button', { name: 'Create organization' }).click();
  await expect(page.getByText(`${name} is ready`)).toBeVisible();

  // Now there are two: the switcher appears, the new company is empty and owned by this person.
  await expect(switcher(page)).toHaveAccessibleName(new RegExp(name));
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(page.getByText('Website Development')).toHaveCount(0);

  // Two companies: no search box needed; the list itself is focusable. Esc closes, focus returns.
  await switcher(page).click();
  const list = page.getByRole('listbox', { name: 'Your organizations' });
  await expect(list).toBeFocused();
  await expect(page.getByRole('combobox', { name: 'Search organizations' })).toHaveCount(0);
  await expect(list.getByRole('option', { name: new RegExp(name) })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(switcher(page)).toBeFocused();

  // Keyboard switch back to Abay Trading.
  await switcher(page).click();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(switcher(page)).toHaveAccessibleName(/Abay Trading PLC/);
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Website Development' }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

// Scenario 3: different roles in different companies — navigation and actions follow the active role.
test('switching from Owner in one company to Manager in another changes navigation and data', async ({ page }) => {
  const errors = watchConsole(page);
  const owner = await prisma.user.findUnique({ where: { email: USERS.owner } });
  const gift = await prisma.organization.findUnique({ where: { slug: 'gift-construction' } });
  const managerRole = await prisma.role.findFirst({ where: { organizationId: gift.id, key: 'MANAGER' } });
  const membership = await prisma.membership.create({ data: { organizationId: gift.id, userId: owner.id, roleId: managerRole.id, status: 'ACTIVE', joinedAt: new Date() } });
  try {
    await signIn(page, USERS.owner);
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Plan & billing' })).toBeVisible(); // Owner at Abay

    await switcher(page).click();
    await page.getByRole('option', { name: /Gift Construction PLC/ }).click();
    await expect(switcher(page)).toHaveAccessibleName(/Gift Construction PLC/);
    await expect(page.getByRole('button', { name: /account menu/ })).toContainText('Manager');
    await expect(nav.getByRole('link', { name: 'Plan & billing' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Roles & permissions' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Projects', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Bole Apartment Block' }).first()).toBeVisible();
    await expect(page.getByText('Website Development')).toHaveCount(0); // nothing from Abay Trading
    await page.goto('/billing');
    await expect(page.getByRole('heading', { name: "You don't have access to this page" })).toBeVisible();

    // Back to Owner at Abay.
    await switcher(page).click();
    await page.getByRole('option', { name: /Abay Trading PLC/ }).click();
    await expect(nav.getByRole('link', { name: 'Plan & billing' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await prisma.membership.delete({ where: { id: membership.id } });
  }
});

// Scenario 5: a company with only its head office gets no branch choices.
test('a single-branch company sees no branch filter or branch field', async ({ page }) => {
  await signIn(page, USERS.giftOwner);
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Branch' })).toHaveCount(0);
  await page.getByRole('button', { name: 'New project' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await expect(dialog.getByLabel('Project name')).toBeVisible();
  await expect(dialog.getByLabel('Branch')).toHaveCount(0);
});

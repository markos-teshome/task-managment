import { test, expect } from '@playwright/test';
import { signIn, USERS, unique, watchConsole } from './helpers.js';
import { prisma } from './db.js';

// D-1/D-11: archived projects are read-only history; only the Owner deletes them, permanently, with the typed name.
test('owner archives a project, sees its tasks read-only, then deletes it permanently', async ({ page }) => {
  const errors = watchConsole(page);
  await signIn(page, USERS.owner);

  const name = unique('Old Tender');
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'New project' }).first().click();
  const projectDialog = page.getByRole('dialog', { name: 'New project' });
  await projectDialog.getByLabel('Project name').fill(name);
  await projectDialog.getByLabel('Status').selectOption('ACTIVE');
  await projectDialog.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await page.getByRole('tab', { name: /Tasks/ }).click();
  await page.getByRole('button', { name: 'Add the first task' }).click();
  const taskDialog = page.getByRole('dialog', { name: 'New task' });
  await taskDialog.getByLabel('Title').fill('Price list');
  await taskDialog.getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByRole('table').getByRole('button', { name: 'Price list', exact: true })).toBeVisible();

  // Not archived yet: no delete.
  await page.getByRole('button', { name: 'More project actions' }).click();
  await expect(page.getByRole('menuitem', { name: /Delete permanently/ })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Archive project' }).click();
  await expect(page.getByText('Project archived')).toBeVisible();

  // Archived: the task is still listed, read-only.
  await page.getByRole('table').getByRole('button', { name: 'Price list', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Task details' });
  await expect(drawer.getByText('This task belongs to an archived project.')).toBeVisible();
  await expect(drawer.getByLabel('Task title')).toHaveCount(0);
  await drawer.getByRole('button', { name: 'Close task' }).click();

  await page.getByRole('button', { name: 'More project actions' }).click();
  await page.getByRole('menuitem', { name: /Delete permanently/ }).click();
  const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: /Permanently delete/ }));
  await confirm.getByLabel(/Type .* to confirm/).fill(name);
  await confirm.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.getByText('Project permanently deleted')).toBeVisible();
  await expect(page).toHaveURL(/\/projects$/);
  expect(errors).toEqual([]);
});

// D-1: admins no longer see permanent deletion at all.
test('admin cannot permanently delete projects', async ({ page }) => {
  await signIn(page, USERS.admin);
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('link', { name: 'Website Development' }).first().click();
  await page.getByRole('button', { name: 'More project actions' }).click();
  await expect(page.getByRole('menuitem', { name: /Delete/ })).toHaveCount(0);
});

// D-13: a suspended company's owner can only reach billing.
test('suspended owner is offered billing resolution only', async ({ page }) => {
  const org = await prisma.organization.findUnique({ where: { slug: 'gift-construction' } });
  await prisma.organization.update({ where: { id: org.id }, data: { status: 'SUSPENDED' } });
  try {
    const errors = watchConsole(page);
    await signIn(page, USERS.giftOwner);
    await expect(page.getByText('Your organization is suspended. Contact TeamFlow support.')).toBeVisible();
    await page.getByRole('link', { name: 'Resolve billing' }).click();
    await expect(page.getByRole('heading', { name: 'Resolve billing' })).toBeVisible();
    await expect(page.getByText('Paying does not lift the suspension automatically.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Plans' })).toBeVisible();
    await page.goto('/projects'); // anything else sends them back
    await expect(page).toHaveURL(/\/onboarding/);
    expect(errors).toEqual([]);
  } finally {
    await prisma.organization.update({ where: { id: org.id }, data: { status: 'ACTIVE' } });
  }
});

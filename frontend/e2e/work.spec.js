import { test, expect } from '@playwright/test';
import { signIn, USERS, watchConsole } from './helpers.js';

// Scenario 2 — Manager: relevant dashboard → project → create & assign task → change status → monitor.
test('manager plans and monitors work', async ({ page }) => {
  const errors = watchConsole(page);
  await signIn(page, USERS.manager);

  await expect(page.getByRole('heading', { name: 'Team workload' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Plan & billing' })).toHaveCount(0); // no subscription access

  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('link', { name: 'Website Development' }).first().click();
  await expect(page.getByRole('heading', { name: 'Website Development' })).toBeVisible();
  const before = await page.getByText(/\d+\/\d+ tasks done/).textContent();

  await page.getByRole('tab', { name: /Tasks/ }).click();
  await page.getByRole('button', { name: 'New task' }).click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await dialog.getByLabel('Title').fill('Accessibility review');
  await dialog.getByLabel('Priority').selectOption('HIGH');
  await dialog.getByLabel('Assignee').selectOption({ label: 'Bethel Assefa' });
  await dialog.getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByText('Task created')).toBeVisible();

  // Open the task drawer and move it forward.
  await page.getByRole('table').getByRole('button', { name: 'Accessibility review', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Task details' });
  await expect(drawer.getByLabel('Task title')).toHaveValue('Accessibility review');
  await drawer.getByRole('button', { name: /Status: To do/ }).click();
  await page.getByRole('menuitem', { name: 'Completed' }).click();
  await expect(page.getByText('Completed “Accessibility review”')).toBeVisible();
  await expect(drawer.getByText('Completed', { exact: true }).first()).toBeVisible();
  await drawer.getByRole('button', { name: 'Close task' }).click();

  // Progress reflects the change.
  await expect(page.getByText(/\d+\/\d+ tasks done/)).not.toHaveText(before);
  expect(errors).toEqual([]);
});

// Scenario 3 — Employee: sees own work immediately, updates and completes an assigned task.
test('employee finds and completes their work', async ({ page }) => {
  const errors = watchConsole(page);
  await signIn(page, USERS.employee);

  await expect(page.getByRole('heading', { name: 'My work' })).toBeVisible();
  await page.getByRole('link', { name: 'My Work', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overdue' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();

  await page.getByRole('button', { name: 'Build Dashboard', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Task details' });
  await expect(drawer.getByRole('heading', { name: 'Build Dashboard' })).toBeVisible();
  await expect(drawer.getByLabel('Task title')).toHaveCount(0); // employees cannot rename
  await expect(drawer.getByLabel('Assignee')).toHaveCount(0); // nor reassign

  await drawer.getByRole('button', { name: /Status: To do/ }).click();
  await page.getByRole('menuitem', { name: 'In progress' }).click();
  await expect(page.getByText('Moved to In progress')).toBeVisible();
  await drawer.getByRole('button', { name: 'Close task' }).click();

  await page.getByRole('button', { name: 'Mark “Build Dashboard” as complete' }).click();
  await expect(page.getByText('Completed “Build Dashboard”')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recently completed' })).toBeVisible();
  expect(errors).toEqual([]);
});

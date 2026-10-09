import { test, expect } from '@playwright/test';
import { signIn, USERS, watchConsole } from './helpers.js';

const noHorizontalOverflow = async (page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

// Scenario 6 — Main workflows on a phone.
test('employee workflow on a phone', async ({ page }) => {
  const errors = watchConsole(page);
  await signIn(page, USERS.employee);
  await noHorizontalOverflow(page);

  // Navigation lives in a drawer.
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'My Work' }).click();
  await expect(page.getByRole('heading', { name: 'My Work', level: 1 })).toBeVisible();
  await noHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Create Login', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Task details' });
  await expect(drawer.getByRole('heading', { name: 'Create Login' })).toBeVisible();
  const box = await drawer.boundingBox();
  expect(box.width).toBeLessThanOrEqual(page.viewportSize().width + 0.5); // drawer fits the screen (sub-pixel tolerance)
  await drawer.getByRole('button', { name: /Status: In progress/ }).click();
  await page.getByRole('menuitem', { name: 'Completed' }).click();
  await expect(page.getByText('Completed “Create Login”')).toBeVisible();
  expect(errors).toEqual([]);
});

test('owner pages fit a phone screen', async ({ page }) => {
  const errors = watchConsole(page);
  await signIn(page, USERS.owner);
  for (const path of ['/', '/projects', '/tasks', '/team', '/roles', '/activity', '/billing', '/settings']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await noHorizontalOverflow(page);
  }

  // Dialogs become bottom sheets that fit the viewport.
  await page.goto('/projects');
  await page.getByRole('button', { name: 'New project' }).click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  const box = await dialog.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width + 0.5);
  expect(box.height).toBeLessThanOrEqual(page.viewportSize().height);
  await expect(dialog.getByRole('button', { name: 'Create project' })).toBeInViewport();
  expect(errors).toEqual([]);
});

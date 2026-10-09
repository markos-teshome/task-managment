import { expect } from '@playwright/test';

export const PASSWORD = 'Demo@1234';
export const USERS = {
  owner: 'abebe@abaytrading.test',
  admin: 'sara@abaytrading.test',
  manager: 'dawit@abaytrading.test',
  employee: 'hana@abaytrading.test',
  giftOwner: 'kebede@giftconstruction.test',
  platform: 'admin@teamflow.test',
};

export async function signIn(page, email) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export async function signOut(page) {
  await page.getByRole('button', { name: /account menu/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
}

/** Collects console errors and failed page scripts; assert it stays empty. */
export function watchConsole(page) {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // Expected, handled API answers (e.g. a 403/404 the UI explains) are logged by the browser as resource errors.
    if (/Failed to load resource: the server responded with a status of (40[0-9]|422)/.test(m.text())) return;
    errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

export const unique = (prefix) => `${prefix} ${Date.now().toString(36).slice(-5)}`;

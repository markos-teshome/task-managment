import { test, expect } from '@playwright/test';
import { signIn, USERS, watchConsole } from './helpers.js';

test('owner creates a second organization from the switcher and switches with search and keyboard', async ({ page }) => {
  const errors = watchConsole(page);
  const name = `Abay Ventures ${Date.now().toString(36)}`;
  await signIn(page, USERS.owner);

  const trigger = () => page.getByRole('button', { name: /Switch organization/ });
  await trigger().click();
  const search = page.getByRole('combobox', { name: 'Search organizations' });
  await expect(search).toBeFocused();
  await expect(page.getByRole('listbox', { name: 'Your organizations' }).getByRole('option', { name: /Abay Trading PLC/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(search).toHaveCount(0);
  await expect(trigger()).toBeFocused();

  // Create: the person becomes Owner of a new, empty, Free workspace.
  await trigger().click();
  await page.getByRole('button', { name: 'Create organization' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create an organization' });
  await dialog.getByLabel('Organization name').fill('<b>');
  await dialog.getByRole('button', { name: 'Create organization' }).click();
  await expect(dialog.getByText(/letters or numbers|Remove the/)).toBeVisible();
  await dialog.getByLabel('Organization name').fill(name);
  await dialog.getByRole('button', { name: 'Create organization' }).click();
  await expect(page.getByText(`${name} is ready`)).toBeVisible();
  await expect(trigger()).toHaveAccessibleName(new RegExp(name));
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(page.getByText('Website Development')).toHaveCount(0); // nothing from Abay Trading

  // Search, then keyboard-select Abay Trading.
  await trigger().click();
  await page.getByRole('combobox', { name: 'Search organizations' }).fill('zzz');
  await expect(page.getByText('No organizations match')).toBeVisible();
  await page.getByRole('combobox', { name: 'Search organizations' }).fill('trading');
  await expect(page.getByRole('listbox', { name: 'Your organizations' }).getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(trigger()).toHaveAccessibleName(/Abay Trading PLC/);
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Website Development' }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

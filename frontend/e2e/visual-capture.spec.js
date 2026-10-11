import { test, expect } from '@playwright/test';
import { signIn, USERS } from './helpers.js';

// Visual review captures (not pixel assertions). Run with SCREENS_DIR set; SCREENS_TAG names the set (e.g. before/after).
const OUT = process.env.SCREENS_DIR;
const TAG = process.env.SCREENS_TAG ?? 'screen';
test.skip(!OUT, 'set SCREENS_DIR to capture screens');

for (const [name, viewport] of [['desktop', { width: 1366, height: 820 }], ['phone', { width: 375, height: 760 }]]) {
  test(`list footers ${name}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    await signIn(page, USERS.owner);
    for (const [path, file] of [
      ['/team', 'team'],
      ['/projects', 'projects'],
      ['/tasks', 'tasks'],
      ['/tasks?search=zz-no-such-task', 'tasks-empty'],
      ['/notifications', 'notifications'],
      ['/billing', 'billing'],
    ]) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `${OUT}/${TAG}-${name}-${file}.png`, fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow, `${path} overflows horizontally`).toBe(false);
    }
    await ctx.close();
  });
}

test('platform list footers', async ({ page }) => {
  const { knownPlatformCode } = await import('./db.js');
  const { PASSWORD } = await import('./helpers.js');
  await page.setViewportSize({ width: 1366, height: 820 });
  await page.goto('/platform/login');
  await page.getByLabel('Email').fill(USERS.platform);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('Sign-in code')).toBeVisible();
  await page.getByLabel('Sign-in code').fill(await knownPlatformCode(USERS.platform));
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(/\/platform$/);
  for (const [path, file] of [['/platform/organizations', 'orgs'], ['/platform/subscriptions', 'subs'], ['/platform/payments', 'payments'], ['/platform/activity', 'audit']]) {
    await page.goto(path);
    await expect(page.getByRole('navigation', { name: 'Pagination' }).getByText(/^Showing /)).toBeVisible();
    await page.screenshot({ path: `${OUT}/${TAG}-platform-${file}.png`, fullPage: true });
  }
});

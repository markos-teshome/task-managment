import { test, expect } from '@playwright/test';
import { signIn, USERS } from './helpers.js';

// Visual review captures (not assertions on pixels): the new screens at desktop and phone width.
const OUT = process.env.SCREENS_DIR;
test.skip(!OUT, 'set SCREENS_DIR to capture screens');

for (const [name, viewport] of [['desktop', { width: 1366, height: 820 }], ['phone', { width: 375, height: 760 }]]) {
  test(`screens ${name}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    await signIn(page, USERS.employee);
    await page.getByRole('button', { name: /^Notifications/ }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${name}-bell.png` });
    await page.keyboard.press('Escape');
    for (const [path, file] of [['/notifications', 'list'], ['/settings?tab=notifications', 'prefs'], ['/settings?tab=security', 'security']]) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `${OUT}/${name}-${file}.png`, fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow, `${path} overflows horizontally`).toBe(false);
    }
    await ctx.close();
    const anon = await browser.newContext({ viewport });
    const p = await anon.newPage();
    await p.goto('/forgot-password');
    await p.getByLabel('Email').fill('nobody@example.com');
    await p.getByRole('button', { name: 'Send reset link' }).click();
    await expect(p.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await p.screenshot({ path: `${OUT}/${name}-forgot-sent.png` });
    await anon.close();
  });
}

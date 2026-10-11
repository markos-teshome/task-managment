import { test, expect } from '@playwright/test';
import { signIn, USERS, watchConsole } from '../e2e/helpers.js';

// The production build served by the production API: one address, real security headers, real cookies.
test('production server: app, deep links, caching, security headers, sign-in and API', async ({ page, request }) => {
  const errors = watchConsole(page);

  // Security headers (helmet) and caching: index.html never cached, hashed assets cached for a year.
  const index = await request.get('/projects/some-deep-link');
  expect(index.status()).toBe(200);
  expect(index.headers()['content-type']).toContain('text/html');
  expect(index.headers()['cache-control']).toBe('no-cache');
  expect(index.headers()['content-security-policy']).toContain("default-src 'self'");
  expect(index.headers()['strict-transport-security']).toBeTruthy();
  const asset = (await index.text()).match(/\/assets\/[^"]+\.js/)[0];
  const js = await request.get(asset);
  expect(js.headers()['cache-control']).toContain('immutable');
  expect(['gzip', 'br']).toContain(js.headers()['content-encoding']); // compressed (Brotli when the browser supports it)

  // Unknown API paths stay JSON 404s (not the app's HTML).
  const missing = await request.get('/api/v1/does-not-exist');
  expect(missing.status()).toBe(404);
  expect(await missing.json()).toMatchObject({ success: false });

  // Real browser flow on the production build.
  await signIn(page, USERS.owner);
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Abebe/ })).toBeVisible();
  const cookies = await page.context().cookies();
  const refresh = cookies.find((c) => c.httpOnly && c.path === '/api/v1/auth');
  expect(refresh, 'refresh cookie').toBeTruthy();
  expect(refresh.secure).toBe(true);
  expect(refresh.sameSite).toBe('Strict');

  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
  await page.reload(); // deep link refresh served by the API's SPA fallback
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
  await page.goto('/tasks?search=Login');
  await expect(page.getByRole('navigation', { name: 'Pagination' })).toBeVisible();
  await page.goto('/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});

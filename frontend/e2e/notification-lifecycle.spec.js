import { test, expect } from '@playwright/test';
import { signIn, signOut, USERS, watchConsole } from './helpers.js';
import { prisma } from './db.js';

/** Notifications for Hana, written as the API writes them (the creating events are covered by backend tests). */
async function hana() {
  const m = await prisma.membership.findFirst({ where: { user: { email: USERS.employee }, organization: { slug: 'abay-trading' } } });
  return m;
}
async function give(member, n, extra = {}, from = 1) {
  const base = Date.now();
  await prisma.notification.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      organizationId: member.organizationId, membershipId: member.id, type: 'TASK_ASSIGNED',
      title: `Lifecycle ${from + i}`, message: `Notification number ${from + i}`, link: '/my-work', entityType: 'TASK',
      createdAt: new Date(base - (n - i) * 1000), ...extra,
    })),
  });
}
const bell = (page) => page.getByRole('banner').getByRole('button', { name: /^Notifications/ });

test.afterEach(async () => {
  await prisma.notification.deleteMany({ where: { title: { startsWith: 'Lifecycle' } } });
});

test('badge, read/unread and persistence across refresh and sign-in', async ({ page }) => {
  const errors = watchConsole(page);
  const member = await hana();
  await prisma.notification.deleteMany({ where: { membershipId: member.id } });
  await signIn(page, USERS.employee);
  await expect(bell(page)).toHaveAccessibleName('Notifications'); // 0 unread: no number

  await give(member, 1);
  await page.reload();
  await expect(bell(page)).toHaveAccessibleName('Notifications, 1 unread');
  await expect(bell(page).getByText('1', { exact: true })).toBeVisible();

  await give(member, 2, {}, 2); // Lifecycle 2 and 3
  await page.reload();
  await expect(bell(page)).toHaveAccessibleName('Notifications, 3 unread');

  // Opening the dropdown marks nothing; the row's own control marks one, and the badge follows at once.
  await bell(page).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: /Lifecycle 3/ }).first()).toBeVisible();
  await expect(menu.getByText('3 unread')).toBeVisible(); // (the page behind an open menu is hidden from assistive tech)
  await menu.getByRole('menuitem', { name: 'Mark “Lifecycle 3” as read' }).click();
  await expect(menu.getByText('2 unread')).toBeVisible(); // updated at once, menu stays open
  await page.keyboard.press('Escape');
  await expect(bell(page)).toHaveAccessibleName('Notifications, 2 unread');
  await expect.poll(async () => prisma.notification.count({ where: { membershipId: member.id, readAt: null } })).toBe(2);

  // All shows read and unread; Unread only the unread ones.
  await page.goto('/notifications');
  await expect(page.getByRole('main').getByText(/^Lifecycle \d/)).toHaveCount(3);
  await page.getByRole('tab', { name: /Unread/ }).click();
  await expect(page.getByRole('main').getByText(/^Lifecycle \d/)).toHaveCount(2);

  // Persisted: refresh, then sign out and in again.
  await page.reload();
  await expect(bell(page)).toHaveAccessibleName('Notifications, 2 unread');
  await signOut(page);
  await signIn(page, USERS.employee);
  await expect(bell(page)).toHaveAccessibleName('Notifications, 2 unread');

  // Mark all: badge gone, Unread empty, every row read in the database.
  await page.goto('/notifications?filter=unread');
  await page.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(bell(page)).toHaveAccessibleName('Notifications');
  await expect(page.getByText("You're all caught up")).toBeVisible();
  expect(await prisma.notification.count({ where: { membershipId: member.id, readAt: null } })).toBe(0);
  await page.getByRole('tab', { name: /All/ }).click();
  await expect(page.getByRole('main').getByText(/^Lifecycle \d/)).toHaveCount(3);

  // 100+ unread shows 99+.
  await give(member, 120, {}, 10);
  await page.reload();
  await expect(bell(page)).toHaveAccessibleName('Notifications, 120 unread');
  await expect(bell(page).getByText('99+')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a notification for a deleted task opens a safe "not found", and nobody else sees it', async ({ page, browser }) => {
  const member = await hana();
  await prisma.notification.deleteMany({ where: { membershipId: member.id } });
  const gone = '00000000-0000-4000-8000-000000000001';
  await give(member, 1, { title: 'Lifecycle deleted task', link: `/my-work?task=${gone}`, entityId: gone });
  await signIn(page, USERS.employee);
  await bell(page).click();
  await page.getByRole('menu').getByRole('menuitem', { name: /Lifecycle deleted task/ }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Task details' });
  await expect(drawer.getByText('Task not found')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(bell(page)).toHaveAccessibleName('Notifications'); // it was marked read

  for (const other of [USERS.manager, USERS.giftOwner]) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await signIn(p, other);
    await p.goto('/notifications');
    await expect(p.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
    await expect(p.getByText('Lifecycle deleted task')).toHaveCount(0);
    await ctx.close();
  }
});

test('an API failure shows an error with Retry, not endless skeletons', async ({ page }) => {
  await signIn(page, USERS.employee);
  await page.route('**/api/v1/notifications?*', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Notifications are unavailable right now.' } }) }),
  );
  await page.goto('/notifications');
  await expect(page.getByText('Notifications are unavailable right now.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /Try again|Retry/ })).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
});

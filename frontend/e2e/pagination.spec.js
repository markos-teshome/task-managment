import { test, expect } from '@playwright/test';
import { signIn, USERS, watchConsole } from './helpers.js';
import { prisma } from './db.js';

const PREFIX = 'Paging check';

// 45 tasks in a seeded project, all due the same day (ties on purpose); removed afterwards.
test.beforeAll(async () => {
  const project = await prisma.project.findFirst({ where: { name: 'Website Development', organization: { slug: 'abay-trading' } } });
  const owner = await prisma.membership.findFirst({ where: { organizationId: project.organizationId, user: { email: USERS.owner } } });
  await prisma.task.createMany({
    data: Array.from({ length: 45 }, (_, i) => ({
      organizationId: project.organizationId, projectId: project.id, createdById: owner.id,
      title: `${PREFIX} ${String(i + 1).padStart(2, '0')}`, dueDate: new Date('2026-12-15'),
    })),
  });
});
test.afterAll(async () => {
  await prisma.task.deleteMany({ where: { OR: [{ title: { startsWith: PREFIX } }, { title: { startsWith: 'qa' } }] } });
});

const rows = (page) => page.getByRole('table').getByRole('button', { name: new RegExp(`^${PREFIX}`) });

test('tasks: numbered pages, page size, search reset, URL, back/forward, no repeats', async ({ page }) => {
  const errors = watchConsole(page);
  await signIn(page, USERS.owner);
  await page.goto(`/tasks?search=${encodeURIComponent(PREFIX)}`);
  await expect(page.getByText('Showing 1–20 of 45')).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Pagination' });
  await expect(nav.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('button', { name: 'Previous page' })).toBeDisabled();

  const seen = new Set();
  const collect = async () => {
    await expect(rows(page).first()).toBeVisible();
    for (const t of await rows(page).allTextContents()) {
      expect(seen.has(t), `repeated ${t}`).toBe(false);
      seen.add(t);
    }
  };
  await collect();
  await nav.getByRole('button', { name: 'Page 2' }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByText('Showing 21–40 of 45')).toBeVisible();
  await collect();
  await nav.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('Showing 41–45 of 45')).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Next page' })).toBeDisabled();
  await collect();
  expect(seen.size).toBe(45);

  // Back/Forward walk the pages; refresh keeps the page.
  await page.goBack();
  await expect(page.getByText('Showing 21–40 of 45')).toBeVisible();
  await page.goForward();
  await expect(page.getByText('Showing 41–45 of 45')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Showing 41–45 of 45')).toBeVisible();

  // Page size: range recalculated, back to page 1, kept in the URL.
  await nav.getByLabel('Rows per page').selectOption('50');
  await expect(page).toHaveURL(/pageSize=50/);
  await expect(page).not.toHaveURL(/page=3/);
  await expect(page.getByText('Showing 1–45 of 45')).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Next page' })).toBeDisabled(); // a single page: footer stays, controls disabled
  await expect(nav.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  await nav.getByLabel('Rows per page').selectOption('10');
  await expect(page.getByText('Showing 1–10 of 45')).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Page 5' })).toBeVisible();

  // A new search starts at page 1 and counts the whole database.
  await nav.getByRole('button', { name: 'Page 2' }).click(); // with 10 per page: 1 2 3 … 5
  await expect(page).toHaveURL(/page=2/);
  await page.getByLabel('Search tasks').fill(`${PREFIX} 4`);
  await expect(rows(page)).toHaveCount(6); // "Paging check 4" matches 40–45, found across all pages
  await expect(page).not.toHaveURL(/page=2/);
  await expect(page.getByText('Showing 1–6 of 6')).toBeVisible(); // one page: the footer is still there
  expect(errors).toEqual([]);
});

test('a page that no longer exists moves back to the last real page', async ({ page }) => {
  const errors = watchConsole(page);
  await signIn(page, USERS.owner);
  await page.goto(`/tasks?search=${encodeURIComponent(PREFIX)}&page=9`);
  await expect(page).toHaveURL(/page=3/);
  await expect(page.getByText('Showing 41–45 of 45')).toBeVisible();
  expect(errors).toEqual([]);
});

test('phone width: compact "Page x of y" and no horizontal overflow', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await signIn(page, USERS.owner);
  await page.goto(`/tasks?search=${encodeURIComponent(PREFIX)}`);
  const nav = page.getByRole('navigation', { name: 'Pagination' });
  await expect(nav.getByText('Page 1 of 3')).toBeVisible();
  await nav.getByRole('button', { name: 'Next page' }).click();
  await expect(nav.getByText('Page 2 of 3')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await ctx.close();
});

// The footer is always there under the list: 0, 1, 5, 10, 20 and 21 matching records.
test('footer for 0, 1, 5, 10, 20 and 21 records', async ({ page }) => {
  const errors = watchConsole(page);
  const project = await prisma.project.findFirst({ where: { name: 'Website Development', organization: { slug: 'abay-trading' } } });
  const owner = await prisma.membership.findFirst({ where: { organizationId: project.organizationId, user: { email: USERS.owner } } });
  for (const n of [1, 5, 10, 20, 21]) {
    await prisma.task.createMany({
      data: Array.from({ length: n }, (_, i) => ({ organizationId: project.organizationId, projectId: project.id, createdById: owner.id, title: `qa${n}x item ${i + 1}` })),
    });
  }
  await signIn(page, USERS.owner);
  const nav = page.getByRole('navigation', { name: 'Pagination' });
  const cases = [
    ['qa0x', 'Showing 0 of 0', 1],
    ['qa1x', 'Showing 1–1 of 1', 1],
    ['qa5x', 'Showing 1–5 of 5', 1],
    ['qa10x', 'Showing 1–10 of 10', 1],
    ['qa20x', 'Showing 1–20 of 20', 1],
    ['qa21x', 'Showing 1–20 of 21', 2],
  ];
  for (const [term, text, pages] of cases) {
    await page.goto(`/tasks?search=${term}`);
    await expect(nav.getByText(text), term).toBeVisible();
    await expect(nav.getByLabel('Rows per page')).toHaveValue('20');
    await expect(nav.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    if (pages === 1) await expect(nav.getByRole('button', { name: 'Next page' })).toBeDisabled();
    else await expect(nav.getByRole('button', { name: 'Next page' })).toBeEnabled();
  }
  await nav.getByRole('button', { name: 'Next page' }).click();
  await expect(nav.getByText('Showing 21–21 of 21')).toBeVisible();

  // Team (8 people): a one-page footer directly under the table.
  await page.goto('/team');
  await expect(nav.getByText(/Showing 1–\d+ of \d+/)).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');
  expect(errors).toEqual([]);
});

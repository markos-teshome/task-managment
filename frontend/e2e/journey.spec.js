import { test, expect } from '@playwright/test';
import { signIn, signOut, watchConsole } from './helpers.js';
import { emailLink, prisma } from './db.js';

test.afterAll(() => prisma.$disconnect());

/**
 * The final acceptance rule, end to end in the browser, for a brand-new company:
 * register owner → verify → create organization → invite → accept → assign role → project → task →
 * assign work → member updates the task → dashboard → hit the plan limit → upgrade → confirm payment →
 * new limit applies → activity history. Then isolation against an unrelated company.
 */
test('a new company goes from sign-up to a paid plan', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const errors = watchConsole(page);
  const id = Date.now().toString(36);
  const ownerEmail = `owner.${id}@example.com`;
  const memberEmail = `member.${id}@example.com`;
  const company = `Journey Trading ${id}`;
  const PASSWORD = 'Journey123';

  // 1. Register and verify.
  await page.goto('/register');
  await page.getByLabel('First name').fill('Liya');
  await page.getByLabel('Last name').fill('Mekonnen');
  await page.getByLabel('Work email').fill(ownerEmail);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  await page.goto(await emailLink('EMAIL_VERIFICATION', ownerEmail));
  await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible();

  // 2. Sign in and create the organization (onboarding).
  await page.goto('/login');
  await page.getByLabel('Email').fill(ownerEmail);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Organization name').fill(company);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page.getByText(`Here's what's happening at ${company}.`)).toBeVisible();
  // One company: a plain identity, no dropdown; its default branch and Free plan exist.
  await expect(page.getByRole('banner').getByText(company)).toBeVisible();
  await expect(page.getByRole('button', { name: /Switch organization/ })).toHaveCount(0);
  await expect(page.getByText('Free plan', { exact: true }).first()).toBeVisible();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Branches' }).click();
  await expect(page.getByRole('table').getByText('Head Office')).toBeVisible();
  const slug = (await prisma.organization.findFirst({ where: { name: company } })).slug;

  // 3. Invite a member and review before sending.
  await page.getByRole('link', { name: 'Team', exact: true }).click();
  await page.getByRole('button', { name: 'Invite member' }).click();
  const invite = page.getByRole('dialog', { name: 'Invite a team member' });
  await invite.getByLabel('Email').fill(memberEmail);
  await invite.getByLabel('First name').fill('Robel');
  await invite.getByLabel('Last name').fill('Assefa');
  await expect(invite.getByText(company, { exact: true })).toBeVisible(); // review line names the organization
  await invite.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText(`Invitation sent to ${memberEmail}`)).toBeVisible();
  await expect(page.getByRole('row', { name: /Robel Assefa/ }).getByText('Invite pending')).toBeVisible();

  // 4. The member accepts on another device.
  const other = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const m = await other.newPage();
  await m.goto(await emailLink('INVITATION', memberEmail, slug));
  await expect(m.getByRole('heading', { name: `You're invited to join ${company}` })).toBeVisible();
  await m.getByLabel('Create a password').fill(PASSWORD);
  await m.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(m.getByText(`You've joined ${company}`)).toBeVisible();

  // 5. Owner assigns a role: Employee → Manager.
  await page.reload();
  await page.getByRole('button', { name: 'Actions for Robel Assefa' }).click();
  await page.getByRole('menuitem', { name: 'Change role' }).click();
  const roleDialog = page.getByRole('dialog', { name: 'Change role' });
  await roleDialog.getByLabel('Role').selectOption({ label: 'Manager' });
  await roleDialog.getByRole('button', { name: 'Save role' }).click();
  await expect(page.getByRole('row', { name: /Robel Assefa/ }).getByText('Manager')).toBeVisible();

  // 6. Project and task assigned to the member.
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'New project' }).first().click();
  const projectDialog = page.getByRole('dialog', { name: 'New project' });
  await projectDialog.getByLabel('Project name').fill('Warehouse Launch');
  await projectDialog.getByLabel('Status').selectOption('ACTIVE');
  await expect(projectDialog.getByLabel('Branch')).toHaveCount(0); // only the head office: no branch choice
  await projectDialog.getByRole('checkbox', { name: /Robel Assefa/ }).check(); // only the team can be assigned (D-12)
  await projectDialog.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Warehouse Launch' })).toBeVisible();
  await page.getByRole('tab', { name: /Tasks/ }).click();
  await page.getByRole('button', { name: 'Add the first task' }).click();
  const taskDialog = page.getByRole('dialog', { name: 'New task' });
  await taskDialog.getByLabel('Title').fill('Count opening stock');
  await taskDialog.getByLabel('Assignee').selectOption({ label: 'Robel Assefa' });
  await taskDialog.getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByRole('table').getByRole('button', { name: 'Count opening stock', exact: true })).toBeVisible();

  // 7. The member signs in and completes their task.
  await signInAs(m, memberEmail, PASSWORD);
  await m.getByRole('link', { name: 'Open My Work' }).click(); // phone: navigation is behind the menu button
  await m.getByRole('button', { name: 'Mark “Count opening stock” as complete' }).click();
  await expect(m.getByRole('button', { name: 'Reopen “Count opening stock”' })).toBeVisible(); // moved to Recently completed
  await other.close();

  // 8. The owner's dashboard reflects it.
  await page.getByRole('link', { name: 'Overview' }).click();
  await expect(page.getByRole('link', { name: /Warehouse Launch/ }).first()).toBeVisible();
  await expect(page.getByText('100%').first()).toBeVisible();

  // 9. Free plan: 3 members (owner, Robel, one pending invite) — then the plan explains the limit.
  await page.getByRole('link', { name: 'Team', exact: true }).click();
  await page.getByRole('button', { name: 'Invite member' }).click();
  await invite.getByLabel('Email').fill(`third.${id}@example.com`);
  await invite.getByLabel('First name').fill('Third');
  await invite.getByLabel('Last name').fill('Person');
  await invite.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText('Team member limit reached')).toBeVisible();

  // 10. Upgrade. The customer comes back before paying: TeamFlow keeps verifying on a bounded schedule,
  //     then shows a recoverable "still being confirmed" state — never a failure, never a fake success.
  await page.getByRole('link', { name: 'Plan & billing' }).click();
  await page.getByRole('button', { name: 'Upgrade to Professional' }).click();
  await page.getByRole('button', { name: 'Continue to payment' }).click();
  await expect(page.getByRole('heading', { name: 'Chapa test checkout' })).toBeVisible();
  const txRef = decodeURIComponent(new URL(page.url()).pathname.split('/').pop());
  await page.goto(`/billing/return?tx_ref=${encodeURIComponent(txRef)}`);
  await expect(page.getByRole('heading', { name: 'Verifying your payment…' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your payment is still being confirmed' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Free plan')).toBeVisible(); // nothing activated yet

  // The payment completes at Chapa later; "Check status" picks it up.
  await page.request.post(`http://localhost:4900/checkout/${encodeURIComponent(txRef)}/success`, { maxRedirects: 0 });
  await page.getByRole('button', { name: 'Check status' }).click();
  await expect(page.getByRole('heading', { name: "You're on Professional" })).toBeVisible();
  await expect(page.getByText(txRef)).toBeVisible(); // receipt shows the real reference
  await expect(page.getByText('Now: 15 members · 25 projects')).toBeVisible();
  await page.getByRole('link', { name: 'Invite your team' }).click();
  await expect(page.getByText('Team member limit reached')).toHaveCount(0);

  // 11. The history records the story.
  await page.getByRole('link', { name: 'Activity' }).click();
  for (const text of [`created the organization "${company}"`, 'invited Robel Assefa', 'created project "Warehouse Launch"', 'completed', 'Professional']) {
    await expect(page.getByText(text).first()).toBeVisible();
  }

  // 12. Isolation: another company's owner sees none of it.
  await signOut(page);
  await signIn(page, 'kebede@giftconstruction.test');
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(page.getByText('Warehouse Launch')).toHaveCount(0);
  const projectId = (await prisma.project.findFirst({ where: { name: 'Warehouse Launch', organization: { slug } } })).id;
  await page.goto(`/projects/${projectId}`);
  await expect(page.getByText(/not found/i).first()).toBeVisible();
  expect(errors).toEqual([]);
});

async function signInAs(page, email, password) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

import { test, expect } from '@playwright/test';
import { signIn, USERS, unique, watchConsole } from './helpers.js';

// Scenario 1 — Owner: dashboard → project → task → member → role → activity → subscription upgrade.
test('owner runs the organization end to end', async ({ page }) => {
  const errors = watchConsole(page);
  await signIn(page, USERS.owner);

  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Abebe/ })).toBeVisible();
  await expect(page.getByText("Here's what's happening at Abay Trading PLC.")).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Team workload' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Plan', exact: true })).toBeVisible();

  // Create a project with a lead.
  const projectName = unique('Customer Onboarding');
  await page.getByRole('button', { name: 'New project' }).click();
  const projectDialog = page.getByRole('dialog', { name: 'New project' });
  await projectDialog.getByLabel('Project name').fill(projectName);
  await projectDialog.getByLabel('Status').selectOption('ACTIVE');
  await projectDialog.getByLabel('Responsible person').selectOption({ label: 'Dawit Bekele — Project Manager' });
  await projectDialog.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
  await expect(page.getByText('Project created')).toBeVisible();

  // Add a task assigned to an employee.
  await page.getByRole('tab', { name: /Tasks/ }).click();
  await page.getByRole('button', { name: 'Add the first task' }).click();
  const taskDialog = page.getByRole('dialog', { name: 'New task' });
  await taskDialog.getByLabel('Title').fill('Prepare welcome pack');
  await taskDialog.getByLabel('Assignee').selectOption({ label: 'Hana Tadesse' });
  await taskDialog.getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByRole('table').getByRole('button', { name: 'Prepare welcome pack', exact: true })).toBeVisible();

  // The assignee joined the project team automatically.
  await page.getByRole('tab', { name: /Team/ }).click();
  await expect(page.getByRole('tab', { name: /Team/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel').getByText('Hana Tadesse')).toBeVisible();

  // Invite a team member.
  await page.getByRole('link', { name: 'Team', exact: true }).click();
  await page.getByRole('button', { name: 'Invite member' }).click();
  const invite = page.getByRole('dialog', { name: 'Invite a team member' });
  const email = `${Date.now()}@abaytrading.test`;
  await invite.getByLabel('Email').fill(email);
  await invite.getByLabel('First name').fill('Selam');
  await invite.getByLabel('Last name').fill('Tesfaye');
  await invite.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText(`Invitation sent to ${email}`)).toBeVisible();

  // Create a custom role with readable, grouped permissions.
  await page.getByRole('link', { name: 'Roles & permissions' }).click();
  await page.getByRole('button', { name: 'New role' }).click();
  const roleDialog = page.getByRole('dialog', { name: 'New role' });
  await roleDialog.getByLabel('Role name').fill(unique('Auditor'));
  await expect(roleDialog.getByText('PROJECT_UPDATE')).toHaveCount(0); // no raw identifiers
  await roleDialog.getByRole('checkbox', { name: 'View' }).last().check(); // Activity → View (last group in order)
  await roleDialog.getByRole('button', { name: 'Create role' }).click();
  await expect(page.getByText(/role created/)).toBeVisible();

  // Activity history shows what just happened.
  await page.getByRole('link', { name: 'Activity' }).click();
  await expect(page.getByText(`created project "${projectName}"`)).toBeVisible();
  await expect(page.getByText('invited Selam Tesfaye as Employee')).toBeVisible();

  // Upgrade Professional → Business through the payment flow.
  await page.getByRole('link', { name: 'Plan & billing' }).click();
  await page.getByRole('button', { name: 'Upgrade to Business' }).click();
  await expect(page.getByRole('dialog', { name: 'Review your plan change' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to payment' }).click();
  await expect(page.getByRole('heading', { name: 'Chapa test checkout' })).toBeVisible(); // left TeamFlow for the provider
  await page.getByRole('button', { name: /^Pay ETB/ }).click();
  await expect(page.getByRole('heading', { name: "You're on Business" })).toBeVisible();

  await page.getByRole('link', { name: 'Back to plan & billing' }).click();
  await expect(page.locator('#current-plan')).toHaveText('Business');
  await expect(page.getByText('Unlimited').first()).toBeVisible();

  expect(errors).toEqual([]);
});

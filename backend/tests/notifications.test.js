import { beforeEach, describe, expect, it, vi } from 'vitest';
import { as, chapaFake, createProject, createTask, createTenant, login, prisma, resetDb, testOutbox } from './helpers.js';
import { processDeliveries } from '../src/modules/notifications/notification.delivery.js';
import { addisToday, runDailyReminders } from '../src/modules/notifications/notification.jobs.js';

// SMTP stays in-memory (testOutbox); `mailFailures` makes the next N sends fail like a temporary SMTP outage.
const mailer = vi.hoisted(() => ({ failures: 0 }));
vi.mock('../src/lib/mailer.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, sendMail: async (msg) => (mailer.failures > 0 ? (mailer.failures--, false) : actual.sendMail(msg)) };
});

let T, tk, plans;
const id = (key) => (key === 'owner' ? T.owner.membership.id : T.members[key].membership.id);
const email = (key) => (key === 'owner' ? T.owner.user.email : T.members[key].user.email);
const inbox = (key) => as(tk[key]).get('/notifications');
const types = async (key) => (await inbox(key)).body.data.map((n) => n.type);
const taskTypes = async (key) => (await types(key)).filter((t) => t.startsWith('TASK_'));
const DAY = 86_400_000;

beforeEach(async () => {
  await resetDb();
  mailer.failures = 0;
  plans = Object.fromEntries((await prisma.subscriptionPlan.findMany()).map((p) => [p.code, p]));
  T = await createTenant({ name: 'Notify Co', members: [{ key: 'manager', role: 'MANAGER' }, { key: 'emp', role: 'EMPLOYEE' }, { key: 'emp2', role: 'EMPLOYEE' }] });
  await prisma.subscription.update({ where: { organizationId: T.org.id }, data: { planId: plans.BUSINESS.id, currentPeriodEnd: new Date(Date.now() + 30 * DAY) } });
  tk = {};
  for (const key of ['owner', 'manager', 'emp', 'emp2']) tk[key] = await login(email(key));
});

describe('task notifications', () => {
  it('assignment notifies the assignee in-app and by email, with a link to the task', async () => {
    const p = await createProject(tk.manager, { name: 'Website', memberIds: [id('emp')] });
    const task = await createTask(tk.manager, p.id, { title: 'Design homepage', assigneeId: id('emp') });

    const [n, added] = (await inbox('emp')).body.data; // newest first
    expect(n).toMatchObject({ type: 'TASK_ASSIGNED', title: 'New task assigned', link: `/my-work?task=${task.id}`, read: false });
    expect(n.message).toContain('“Design homepage” in Website');
    expect(added.type).toBe('PROJECT_MEMBER_ADDED');
    expect((await as(tk.emp).get('/notifications/unread-count')).body.data.count).toBe(2);

    await processDeliveries();
    const mail = testOutbox.find((m) => m.to === email('emp') && m.template === 'notification:TASK_ASSIGNED');
    expect(mail.subject).toBe('New task assigned');
    expect(mail.text).toContain(`/my-work?task=${task.id}`);
    expect((await prisma.notificationDelivery.findFirst()).status).toBe('SENT');
  });

  it('assigning yourself, or a failed assignment, notifies no one', async () => {
    const p = await createProject(tk.manager, { memberIds: [id('emp'), id('manager')] });
    await createTask(tk.manager, p.id, { assigneeId: id('manager') });
    const refused = await as(tk.manager).post('/tasks').send({ projectId: p.id, title: 'Not on team', assigneeId: id('emp2') });
    expect(refused.status).toBe(422);
    expect(await prisma.notification.count({ where: { type: { startsWith: 'TASK_' } } })).toBe(0);
  });

  it('reassignment tells the new and the old assignee; saving the same assignee again tells nobody', async () => {
    const p = await createProject(tk.manager, { memberIds: [id('emp'), id('emp2')] });
    const task = await createTask(tk.manager, p.id, { assigneeId: id('emp') });
    await as(tk.manager).patch(`/tasks/${task.id}`).send({ assigneeId: id('emp2') });
    await as(tk.manager).patch(`/tasks/${task.id}`).send({ assigneeId: id('emp2') });

    expect(await taskTypes('emp2')).toEqual(['TASK_ASSIGNED']);
    expect(await taskTypes('emp')).toEqual(['TASK_UNASSIGNED', 'TASK_ASSIGNED']);
    expect((await prisma.activityLog.count({ where: { action: 'TASK_ASSIGNED' } }))).toBe(2);
  });

  it('completion notifies the project lead only, not the whole team', async () => {
    const p = await createProject(tk.manager, { leadId: id('manager'), memberIds: [id('emp'), id('emp2')] });
    const task = await createTask(tk.manager, p.id, { assigneeId: id('emp') });
    await as(tk.emp).patch(`/tasks/${task.id}`).send({ status: 'COMPLETED' });
    expect(await types('manager')).toEqual(['TASK_COMPLETED']);
    expect(await types('emp2')).toEqual(['PROJECT_MEMBER_ADDED']);
    expect(await types('owner')).toEqual([]);
  });
});

describe('project notifications', () => {
  it('team additions, removals and new leads are told; a removed person gets no link', async () => {
    const p = await createProject(tk.owner, { leadId: id('manager'), memberIds: [id('emp')] });
    expect(await types('manager')).toEqual(['PROJECT_LEAD_ASSIGNED']);
    expect(await types('emp')).toEqual(['PROJECT_MEMBER_ADDED']);

    await as(tk.owner).post(`/projects/${p.id}/members`).send({ membershipIds: [id('emp2')] });
    await as(tk.owner).delete(`/projects/${p.id}/members/${id('emp')}`);
    const [removed] = (await inbox('emp')).body.data;
    expect(removed).toMatchObject({ type: 'PROJECT_MEMBER_REMOVED', link: null, entityId: null });
    expect(await types('emp2')).toEqual(['PROJECT_MEMBER_ADDED']);
  });
});

describe('reading is private to the recipient and the workspace', () => {
  it("nobody can read or mark someone else's notifications, and other organizations see nothing", async () => {
    const p = await createProject(tk.manager, { memberIds: [id('emp')] });
    await createTask(tk.manager, p.id, { assigneeId: id('emp') });
    const [n] = (await inbox('emp')).body.data;

    expect((await inbox('emp2')).body.data).toHaveLength(0); // not on this project: nothing at all
    expect((await as(tk.emp2).patch(`/notifications/${n.id}/read`)).status).toBe(404);
    const B = await createTenant({ name: 'Other Co' });
    const tB = await login(B.owner.user.email);
    expect((await as(tB).get('/notifications')).body.data).toHaveLength(0);
    expect((await as(tB).patch(`/notifications/${n.id}/read`)).status).toBe(404);
    expect((await as(tB).patch('/notifications/read-all')).status).toBe(200);
    expect((await prisma.notification.findUnique({ where: { id: n.id } })).readAt).toBeNull();

    const read = await as(tk.emp).patch(`/notifications/${n.id}/read`);
    expect(read.body.data.count).toBe(1); // the "added to project" one is still unread
    expect((await as(tk.emp).patch('/notifications/read-all')).body.data.count).toBe(0);
    expect((await as(tk.emp).get('/notifications?unread=true')).body.data).toHaveLength(0);
  });

  it('a deactivated member loses the inbox, and queued emails to them are skipped', async () => {
    const p = await createProject(tk.manager, { memberIds: [id('emp')] });
    await createTask(tk.manager, p.id, { assigneeId: id('emp') });
    await prisma.membership.update({ where: { id: id('emp') }, data: { status: 'DEACTIVATED' } });
    expect((await inbox('emp')).status).toBe(403);
    await processDeliveries();
    expect((await prisma.notificationDelivery.findFirst()).status).toBe('SKIPPED');
    expect(testOutbox.filter((m) => m.to === email('emp'))).toHaveLength(0);
  });
});

describe('preferences', () => {
  it('turning email off stops the email; turning in-app off hides it; billing cannot be turned off', async () => {
    const prefs = (await as(tk.emp).get('/notification-preferences')).body.data;
    expect(prefs.find((p) => p.category === 'TASK_ASSIGNMENTS')).toMatchObject({ inApp: true, email: true, locked: false });
    expect(prefs.find((p) => p.category === 'BILLING')).toMatchObject({ locked: true });

    const off = await as(tk.emp).patch('/notification-preferences').send({ preferences: [{ category: 'TASK_ASSIGNMENTS', inApp: true, email: false }] });
    expect(off.status).toBe(200);
    const p = await createProject(tk.manager, { memberIds: [id('emp')] });
    await createTask(tk.manager, p.id, { assigneeId: id('emp') });
    expect(await types('emp')).toContain('TASK_ASSIGNED');
    expect(await prisma.notificationDelivery.count()).toBe(0);

    await as(tk.emp).patch('/notification-preferences').send({ preferences: [{ category: 'TASK_ASSIGNMENTS', inApp: false, email: false }] });
    await createTask(tk.manager, p.id, { assigneeId: id('emp') });
    expect((await types('emp')).filter((t) => t === 'TASK_ASSIGNED')).toHaveLength(1);

    const billing = await as(tk.owner).patch('/notification-preferences').send({ preferences: [{ category: 'BILLING', inApp: false, email: false }] });
    expect(billing.status).toBe(422);
  });
});

describe('email delivery', () => {
  it('a temporary SMTP failure is retried later; the business change is unaffected', async () => {
    const p = await createProject(tk.manager, { memberIds: [id('emp')] });
    mailer.failures = 1;
    const task = await createTask(tk.manager, p.id, { assigneeId: id('emp') });
    expect(task.assignee.id).toBe(id('emp'));

    await processDeliveries();
    let d = await prisma.notificationDelivery.findFirst();
    expect(d).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(d.nextAttemptAt > new Date()).toBe(true);

    await prisma.notificationDelivery.update({ where: { id: d.id }, data: { nextAttemptAt: new Date() } });
    await processDeliveries();
    d = await prisma.notificationDelivery.findFirst();
    expect(d).toMatchObject({ status: 'SENT', attempts: 2 });
    expect(testOutbox.filter((m) => m.template === 'notification:TASK_ASSIGNED')).toHaveLength(1);
  });
});

describe('daily reminders (08:00 Addis Ababa)', () => {
  it('due tomorrow and overdue reminders go out once, stop for completed tasks, and escalate after three days', async () => {
    const today = addisToday();
    const p = await createProject(tk.manager, { leadId: id('manager'), memberIds: [id('emp')] });
    const dueTomorrow = await createTask(tk.manager, p.id, { title: 'Tomorrow', assigneeId: id('emp') });
    const done = await createTask(tk.manager, p.id, { title: 'Done', assigneeId: id('emp') });
    const late = await createTask(tk.manager, p.id, { title: 'Late', assigneeId: id('emp') });
    const veryLate = await createTask(tk.manager, p.id, { title: 'Very late', assigneeId: id('emp') });
    const ancient = await createTask(tk.manager, p.id, { title: 'Ancient', assigneeId: id('emp') });
    const set = (t, days, data = {}) => prisma.task.update({ where: { id: t.id }, data: { dueDate: new Date(today.getTime() + days * DAY), ...data } });
    await set(dueTomorrow, 1);
    await set(done, 1, { status: 'COMPLETED' });
    await set(late, -1);
    await set(veryLate, -3);
    await set(ancient, -40); // old data never floods anyone
    await prisma.notification.deleteMany();

    await runDailyReminders();
    await runDailyReminders(); // a second run (restart, second instance) adds nothing
    const mine = (await inbox('emp')).body.data;
    expect(mine.map((n) => n.title).sort()).toEqual(['Task due tomorrow', 'Task overdue', 'Task still overdue']);
    expect(mine.some((n) => n.message.includes('Done') || n.message.includes('Ancient'))).toBe(false);
    const lead = (await inbox('manager')).body.data;
    expect(lead).toHaveLength(1);
    expect(lead[0]).toMatchObject({ title: 'Overdue task in your project', link: `/projects/${p.id}?task=${veryLate.id}` });
  });

  it('billing holders hear 7 days and 1 day before a paid plan ends, and when it has ended', async () => {
    // The period ends at a fixed moment; the daily runs happen as time passes.
    const end = new Date(Date.now() + 30 * DAY);
    await prisma.subscription.update({ where: { organizationId: T.org.id }, data: { currentPeriodEnd: end } });
    const runAt = (daysBeforeEnd) => runDailyReminders(new Date(end.getTime() - daysBeforeEnd * DAY));
    await runAt(10);
    expect(await types('owner')).toEqual([]);
    await runAt(6.5);
    await runAt(5.5);
    expect(await types('owner')).toEqual(['SUBSCRIPTION_EXPIRING']);
    await runAt(0.5);
    await runAt(-0.5);
    expect((await inbox('owner')).body.data.map((n) => n.title)).toEqual(['Subscription ended', 'Subscription ends tomorrow', 'Subscription ends soon']);
    expect(await types('manager')).toEqual([]); // no billing information for non-billing roles
  });
});

describe('payments notify only after trusted confirmation', () => {
  it('nothing while pending; a receipt when Chapa confirms; a failure notice when it fails', async () => {
    const pay = async () => (await as(tk.owner).post('/payments/checkout').send({ planId: plans.PROFESSIONAL.id })).body.data.txRef;
    const txRef = await pay();
    await as(tk.owner).post(`/payments/${txRef}/verify`);
    expect(await types('owner')).toEqual([]);

    chapaFake.settle(txRef, 'success');
    await as(tk.owner).post(`/payments/${txRef}/verify`);
    await as(tk.owner).post(`/payments/${txRef}/verify`); // repeated confirmation: still one receipt
    const [receipt] = (await inbox('owner')).body.data;
    expect(receipt).toMatchObject({ type: 'PAYMENT_SUCCEEDED', link: '/billing' });
    expect(receipt.message).toContain(txRef);
    expect(await prisma.notification.count({ where: { type: 'PAYMENT_SUCCEEDED' } })).toBe(1);

    const failed = await pay();
    chapaFake.settle(failed, 'failed');
    await as(tk.owner).post(`/payments/${failed}/verify`);
    expect((await types('owner'))[0]).toBe('PAYMENT_FAILED');
    expect(await types('manager')).toEqual([]);
  });
});

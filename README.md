# TeamFlow

A multi-company, subscription-based project and task management platform.

Several organizations (for example **Abay Trading PLC** and **Gift Construction PLC**) use the same application, each
with its own members, roles, projects, tasks, subscription, payments and activity history. No organization can see or
change another organization's data. The subscription plan really changes what an organization can do: the Free
plan stops at 3 members, and upgrading through the payment flow lifts the limit immediately.

| Layer | Technology |
|---|---|
| Frontend | React 19 (Vite), React Router, TanStack Query, Tailwind CSS v4, Radix (dialogs/menus) — `frontend/` |
| Backend | Node.js 20+, Express 5 — `backend/` |
| Database | PostgreSQL 14+ |
| ORM | Prisma 6 |
| Validation | Zod |
| Tests | Vitest + Supertest (API, real PostgreSQL) · Playwright (end-to-end, desktop + phone) |

> **Design rationale** (multi-tenancy, auth, RBAC, subscriptions, payments, frontend & design system) is in **[ARCHITECTURE.md](ARCHITECTURE.md)**.

---

## Quick start

Prerequisites: Node.js 20+ and PostgreSQL 14+ running locally. Commands work in Git Bash, macOS/Linux shells
and PowerShell.

```bash
# 1. Databases — one for the app, one that the test suite may wipe
createdb -U postgres teamflow
createdb -U postgres teamflow_test
#   (or in psql:  CREATE DATABASE teamflow;  CREATE DATABASE teamflow_test;)

# 2. Backend — from the repository root
cd backend
cp .env.example .env            # set DATABASE_URL, TEST_DATABASE_URL, JWT_ACCESS_SECRET, SMTP_* and CHAPA_* (see Configuration)
npm install                     # also generates the Prisma client
npx prisma migrate deploy       # creates the schema
npm run db:seed                 # optional demo organizations, users, projects and tasks (empty database only)
npm run dev                     # API on http://localhost:4000

# 3. Frontend — in a second terminal, from the repository root
cd frontend
cp .env.example .env            # defaults work with the dev proxy
npm install
npm run dev                     # http://localhost:5173  (proxies /api to :4000)
```

Open http://localhost:5173 and either **create an account** (a real verification email is sent through your SMTP
server) or sign in with a demo account below. No manual database changes are needed: the permission catalog and
default plans are created automatically.

## Demo accounts (optional seed)

`npm run db:seed` creates two sample organizations so roles and tenant isolation can be explored immediately. It
only runs on an empty database (it refuses to wipe one that holds real sign-ups or payments unless `SEED_FORCE=1`).
Demo accounts are pre-verified, use reserved `.test` addresses (no email is ever sent to them) and share the
password **`Demo@1234`**.

| Organization | Role | Email | Shows |
|---|---|---|---|
| — (platform) | **Super admin** | `admin@teamflow.test` | Platform console: tenants, plans/pricing, revenue |
| Abay Trading PLC · *Professional* | **Owner** | `abebe@abaytrading.test` | Everything incl. billing, roles, custom role "QA Reviewer" |
| | **Admin** | `sara@abaytrading.test` | Manages people & work; can view but not change billing |
| | **Manager** | `dawit@abaytrading.test` | Projects, tasks, team workload; no subscription access |
| | **Employee** | `hana@abaytrading.test` | My Work: overdue, today, upcoming; updates own task status |
| | Employee | `yonas@abaytrading.test` | Marketing work |
| | QA Reviewer (custom) | `bethel@abaytrading.test` | Custom role in action |
| Gift Construction PLC · *Free, 3/3 members* | **Owner** | `kebede@giftconstruction.test` | Hit the member limit → upgrade through Chapa test checkout |
| | Manager | `liya@giftconstruction.test` | |
| | Employee | `samuel@giftconstruction.test` | |

The seed also includes a deactivated member with historical tasks (Meron), a pending invitation (Kalkidan), a project
without a lead, a completed project, and overdue and blocked tasks. Abay's Professional subscription is provisioned
by the seed; the seed creates **no payment records** — payments only come from real Chapa transactions. Dates are relative to the day you seed, so "today" and "overdue" always make sense.

**Try the isolation:** sign in as Abebe, copy a project URL, sign in as Kebede and open it → "Project not found".

**Try the subscription:** sign in as Kebede → Team → Invite → plan-limit message → Billing → upgrade to Professional
→ Chapa test checkout (test number `0900123456`) → back in TeamFlow "You're on Professional" → invite now works.

## Configuration

`backend/.env` (see `.env.example` for all keys):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Application database |
| `TEST_DATABASE_URL` | Separate database used by `npm test` (its data is deleted) |
| `JWT_ACCESS_SECRET` | ≥ 32 random characters |
| `APP_URL` | **Frontend** URL people open. Every email link (invitation, verification, password reset) and the payment return page use it, so it must be reachable from the recipient's device — `localhost` only works on this computer (refused in production) |
| `API_URL` | **API** URL as reachable by Chapa (webhook + callback). May equal `APP_URL` when the frontend proxies `/api` |
| `CORS_ORIGINS` | Allowed browser origins when the frontend is served from a different origin than the API |
| `COOKIE_SECURE` | `true` behind HTTPS |
| `CHAPA_SECRET_KEY` | **Required.** Chapa API key — a `CHASECK_TEST-…` test key (a live key is refused unless `CHAPA_ALLOW_LIVE=true`) |
| `CHAPA_WEBHOOK_SECRET` | The "Secret hash" registered in Chapa's dashboard (webhooks are rejected without it) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | **Required.** SMTP account that sends verification, password-reset and invitation emails |
| `MAIL_FROM` | Optional sender; defaults to `TeamFlow <SMTP_USER>` |

The server validates its configuration on start and refuses to run with missing or invalid values.

### Payments with Chapa (test mode)

1. In `backend/.env`: `CHAPA_SECRET_KEY=<your CHASECK_TEST-… key>` and `CHAPA_WEBHOOK_SECRET=<any long random string>`.
2. Make the API publicly reachable (deploy it, or run a tunnel such as `ngrok http 4000`) and set `API_URL` to that
   public URL. `APP_URL` is where Chapa sends the customer back after paying.
3. In the Chapa dashboard → Settings → Webhooks, enter the **webhook URL**
   `<API_URL>/api/v1/payments/webhooks/chapa` and the same **Secret hash** as `CHAPA_WEBHOOK_SECRET`.
4. Restart the API. On start-up it prints the webhook URL and warns if the secret is empty or `API_URL` is local.

The same URL serves both Chapa calls: the signed webhook (**POST**, checked with `x-chapa-signature` or
`chapa-signature`) and the checkout `callback_url` (**GET**, unsigned). Neither is trusted on its own — each one
triggers a server-side `GET /transaction/verify/{tx_ref}` to Chapa, and the plan is activated only if Chapa reports
success for the exact amount and currency, exactly once.

In Chapa test mode use the test number `0900123456` (OTP `12345` if asked); no real money moves.

### Testing from another device (invitation links)

An invitation email links to `APP_URL/accept-invite?token=…`. With `APP_URL=http://localhost:5173`, a colleague who
clicks it gets *"localhost refused to connect"*: `localhost` is **their own** device. To try invitations with
another computer or a phone while everything runs on your machine, expose the **frontend** over HTTPS. One tunnel
is enough, because the Vite dev server proxies `/api` to the backend:

1. `ngrok http 5173` → note the public URL, e.g. `https://abcd-1234.ngrok-free.app`.
2. `frontend/.env.local`: `VITE_ALLOWED_HOSTS=abcd-1234.ngrok-free.app` (Vite refuses unknown host names);
   restart `npm run dev` in `frontend/`.
3. `backend/.env`: `APP_URL=https://abcd-1234.ngrok-free.app`, and `API_URL=` the same URL (Chapa then reaches
   `/api/v1/payments/webhooks/chapa` through the same tunnel); restart the API. It logs `Email links point to …`.
4. Send a new invitation (links in earlier emails keep the old address; use **Resend** to issue a fresh one).

Nothing is hard-coded: when the tunnel URL changes, update these values. In production, set `APP_URL` to the real
frontend domain and `API_URL` to the real API domain.

### Email (SMTP)

TeamFlow sends real emails for account verification (link valid 24 h, single use, resend available), password
reset (1 h, single use) and team invitations (7 days). On start-up the API checks the SMTP login and logs
`SMTP connection verified` or the exact error. With **Gmail**: turn on 2-Step Verification, create an
[App Password](https://myaccount.google.com/apppasswords), and use `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`,
`SMTP_USER=<your address>`, `SMTP_PASS=<the 16-character app password>` — Gmail rejects the normal account password.

## Commands

Backend (`cd backend`):

| Command | |
|---|---|
| `npm run dev` | API with auto-reload |
| `npm start` | API (production) |
| `npx prisma migrate deploy` | Apply migrations (production / fresh DB) |
| `npm run db:migrate` | Create a new migration after editing `schema.prisma` (development) |
| `npm run db:seed` | Wipe and recreate demo data |
| `npm test` | Run the test suite (uses `TEST_DATABASE_URL`) |

Frontend (`cd frontend`):

| Command | |
|---|---|
| `npm run dev` | Dev server with API proxy |
| `npm run build` | Production build into `dist/` (serve it behind the same origin as the API, or set `VITE_API_URL`) |
| `npm run test:e2e` | End-to-end tests — starts its own isolated stack (test database, fake Chapa); safe to run anytime |

Reference data (permission catalog and default plans) is created automatically at startup — a fresh database works
after `migrate deploy` without running the seed or any manual SQL.

## Main features

- **Authentication:** register, email verification, login/logout, forgot/reset password, invitations,
  rotating refresh tokens, account lockout, rate limiting.
- **Multi-tenant workspaces:** server-derived tenant context, 404 for foreign ids, composite tenant foreign keys,
  a searchable organization switcher (only your own organizations) with "Create organization", and a guard that
  stops a second tab from showing one organization's data under another's name.
- **Role-based access:** Owner/Admin/Manager/Employee + custom roles on every plan, grouped permission editor,
  escalation protection, changes effective immediately.
- **Team management:** invite (with a review of organization and role), invitation status (pending / expired with
  one-click resend), change role, deactivate/reactivate, revoke invitation, seat usage vs plan.
- **Invitations:** a dedicated accept page showing organization, inviter and role; new people create their account
  there, existing accounts confirm with their password; clear screens for expired, already-accepted, withdrawn,
  wrong-account and network problems.
- **Projects:** status, priority, dates, lead, team, progress, search/filter/sort, pagination, archive/restore.
- **Tasks:** status workflow (To do → In progress → Blocked → Completed), priority, due date, assignee, filters,
  My Work buckets, CSV export (Business plan).
- **Subscriptions:** Free / Professional / Business, editable by the platform admin; limits and features enforced
  server-side; expiry falls back to Free; cancel at period end.
- **Payments:** review → Chapa hosted checkout (test mode) → "Verifying your payment…" with bounded re-checks →
  activation only after server-side verification. A slow confirmation ends in a recoverable "still being confirmed"
  screen with **Check status** (never a fake failure or success); refreshing the page re-reads the server state;
  success shows the receipt (plan, amount, time, reference).
- **Dashboard:** key counts, my work, project progress, team workload, recent activity, plan usage.
- **Activity history:** who did what, when — filterable, per project.
- **Platform console:** organizations, suspend/reactivate, plan pricing & limits, revenue.

### Using the app

- **Navigation** is grouped (Workspace · Organization · Account) and only shows what your role can use. On phones
  and tablets it opens from the ☰ button.
- **Organizations:** click the organization name in the top bar to search your organizations, switch (↑/↓,
  Enter, Esc) or create a new one.
- **Search** (top bar or Ctrl/⌘ K) finds projects, tasks and people you can see.
- **Tasks open in a side drawer** from anywhere (`?task=<id>` in the URL, so links can be shared). Click a status
  badge to change it; the round checkbox completes a task in one click.
- **Filters live in the URL**, so a filtered view can be bookmarked or shared; Back undoes a filter.
- **Plan limits are explained before you hit them**: seat usage on the Team page, an upgrade path for owners and a
  "ask your owner" note for everyone else.

## How it works (short version — details in [ARCHITECTURE.md](ARCHITECTURE.md))

**Multi-tenancy.** One database; every tenant-owned row carries `organizationId`. The organization is never taken
from the request — it comes from the signed-in session (`token → session → membership → organization`). Every query
is scoped by it, another tenant's ids answer **404** exactly like ids that don't exist, and composite foreign keys
make PostgreSQL itself reject cross-tenant links (e.g. a task pointing at another tenant's project).

**Roles & permissions.** Permissions are checked by the API on every request (role changes apply immediately); the UI
only hides what you can't use.

| | Owner | Admin | Manager | Employee |
|---|---|---|---|---|
| Organization settings, roles | ✓ | view roles | – | – |
| Subscription & billing | manage | view | – | – |
| Team (invite, roles, deactivate) | ✓ | ✓ (not owners, never grants Owner) | view | – |
| Projects | all | all | all except delete | only projects they're on |
| Tasks | all | all | all | update the status of **their own** tasks |
| Activity history | ✓ | ✓ | ✓ | – |

Owners can create **custom roles** with their own permissions on every plan (PDF §04 lists it as an Owner capability).
Nobody can grant a permission they don't hold.

**Subscriptions.** Free (3 members, 3 active projects) · Professional (15 / 25) · Business (unlimited,
CSV export) — prices, limits and features are database rows the platform admin can edit. Limits are enforced on the
server at the moment of adding a member/project (with a lock against concurrent requests). When a paid period ends
the organization falls back to Free limits automatically; nothing is deleted.

**Payments.** Choose plan → server creates a PENDING payment at the plan's price → Chapa hosted
checkout → the **server** verifies with the provider → one transaction marks it SUCCEEDED and activates the plan.
Duplicate callbacks or clicks have no further effect; the browser can never declare a payment successful.

## Project structure

```
backend/
  prisma/            schema.prisma, migrations/, seed.js
  src/
    config/          validated environment
    common/          errors, middleware (auth, tenant, permissions, validation, rate limits), validators, utils
    modules/         auth · organizations · users · roles · projects · tasks · subscriptions · payments
                     · activities · dashboard · platform        (each: *.routes.js + *.service.js)
  tests/             API integration tests (Vitest + Supertest)
frontend/
  src/
    app/             router, route guards, navigation, app shell (sidebar, top bar, search)
    components/      design-system primitives (ui/), feedback states, layout, brand
    features/        one folder per area: auth, dashboard, projects, tasks, team, roles, billing, activity, …
    lib/ hooks/      API client, formatting, status vocabulary, URL filters
    styles/          design tokens (brand colours, type, radius, motion)
  e2e/               Playwright end-to-end scenarios
```

## API overview

Base path `/api/v1`. All responses: `{ success, data, meta? }` or `{ success: false, error: { code, message, details? } }`.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register · verify-email · resend-verification · login · refresh · logout · forgot-password · reset-password · accept-invitation · change-password · switch-workspace`, `GET/PATCH /auth/me`, `GET /auth/invitations/:token` |
| Organization | `POST /organizations`, `GET/PATCH /organizations/current` |
| Team | `GET/POST /users`, `GET /users/options`, `PATCH/DELETE /users/:id`, `POST /users/:id/resend-invitation` |
| Roles | `GET/POST /roles`, `GET /roles/permissions`, `PATCH/DELETE /roles/:id` |
| Projects | `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id`, `POST /projects/:id/archive · restore · members`, `DELETE /projects/:id/members/:membershipId`, `GET /projects/:id/activity` |
| Tasks | `GET/POST /tasks`, `GET /tasks/my-work · export`, `GET/PATCH/DELETE /tasks/:id` |
| Subscription | `GET /subscription`, `GET /subscription/plans`, `POST /subscription/cancel · resume` |
| Payments | `GET /payments`, `POST /payments/checkout`, `GET /payments/:txRef`, `POST /payments/:txRef/verify · cancel`, `POST /payments/webhooks/chapa` |
| Activity / Dashboard | `GET /activities`, `GET /dashboard`, `GET /dashboard/search?q=` |
| Invitations | `GET /auth/invitations/:token`, `POST /auth/accept-invitation` (new account: name + password; existing account: its password, or signed in as that account) |
| Platform | `GET /platform/overview · organizations · plans · payments · audit-log`, `PATCH /platform/organizations/:id`, `POST/PATCH /platform/plans[/:id]` |

## Testing

```bash
cd backend && npm test
```

118 integration tests run against a real PostgreSQL database and cover the business-critical scenarios
(results: [PHASE1_BACKEND_AUDIT.md](PHASE1_BACKEND_AUDIT.md), [PHASE2_FRONTEND_QA.md](PHASE2_FRONTEND_QA.md),
[FINAL_REQUIREMENTS_COMPLIANCE.md](FINAL_REQUIREMENTS_COMPLIANCE.md)):

- **Invitations:** link uses `APP_URL`; accept page shows organization, inviter and role; new person accepts
  without a session; existing account must give its password (or be signed in as itself); wrong signed-in account
  refused; expired / used / withdrawn / replaced links; resend; duplicate and concurrent invitations and
  acceptances; cross-tenant resend/withdraw; organization fixed by the invitation.
- **Payment lifecycle:** cancelled at Chapa, abandoned → EXPIRED, late success after expiry or after being
  superseded is honoured, Chapa unreachable or 5xx → 503 with nothing changed (webhook retried), settlement from
  stored state only, unique transaction references, cross-tenant references → 404.
- **Organizations & platform:** second organization as Owner with default roles and Free plan; per-person duplicate
  names; name validation; switching scopes every view; stale-tab `WORKSPACE_CHANGED`; platform access separate from
  ownership; audited platform actions; command-line-only provisioning.

- **Chapa webhook & callback:** missing/forged signatures rejected; both Chapa signature schemes accepted; payment
  verified with Chapa's API before activation; checkout always creates a Chapa payment; a "success" webhook for a charge Chapa reports failed/pending/
  underpaid does not activate; duplicate and concurrent deliveries activate exactly once; the callback's `status`
  query parameter is ignored; other providers' payments are never touched.

- **Tenancy:** Tenant A guessing Tenant B's project/task/member/role/payment ids → 404 for read, update, delete,
  archive; cross-tenant task creation and assignment rejected; smuggled `organizationId` ignored/rejected; another
  tenant's ids used as list filters return nothing; lists, search, dashboard, subscription usage and activity
  scoped; DB rejects a cross-tenant task even when the API is bypassed.
- **RBAC:** employee → billing denied; manager → subscription denied; admin invites but cannot grant Owner or touch
  owners; role edits by admins rejected; Owner role locked; employee can only change the status of own tasks; role
  changes and deactivation apply immediately to live sessions.
- **Subscription & payments:** Free limit rejects the 4th member; pending invitations hold seats; project quota;
  concurrent invites cannot exceed the limit; upgrade lifts the limit immediately; duplicate/concurrent confirmation
  has exactly one effect; failed and pending payments change nothing; client cannot set the price; expiry falls back
  to Free without deleting data; downgrade below usage refused; features unlock with the plan.
- **Auth:** full register → verify → login → create workspace flow; no account enumeration; lockout; invalid,
  forged and expired tokens; refresh rotation with reuse detection; logout revocation; single-use and expiring reset
  tokens; tokens stored hashed.

### End-to-end (browser)

```bash
cd frontend && npm run test:e2e        # uses the installed Chrome; set PW_CHANNEL=msedge for Edge
```

16 Playwright scenarios drive the real UI against the real API. Playwright starts an isolated stack on its own ports —
the API on the **test** database (seeded fresh), the frontend, and `e2e/fake-chapa-server.mjs`, a stand-in for
Chapa's API and hosted checkout — so tests never touch live Chapa, your development database or running servers.
Automated tests never send real email either: under `NODE_ENV=test` emails go to an in-memory outbox.

1. **Owner** — dashboard → create project with lead → add & assign a task → assignee joins the team → invite a
   member → create a custom role (no raw permission keys shown) → activity shows it all → upgrade to Business via
   the payment flow → new limits shown.
2. **Manager** — workload dashboard, no billing nav → project → create & assign task → complete it in the task
   drawer → project progress updates.
3. **Employee** — My Work buckets → open task (cannot rename or reassign) → move to In progress → complete.
4. **Plan limit** — Free org at 3/3 → limit explained, invite disabled → View plans → declined payment changes
   nothing → successful payment → "You're on Professional" → invitation succeeds.
5. **Protection** — employee opening /billing, /team, /roles, /activity, /platform gets an access screen; another
   tenant's project URL shows "Project not found" and leaks nothing; nav only shows permitted items. Also: sign-in
   redirect back to the requested page, wrong-password message, platform console.
6. **Phone (Pixel 7)** — employee workflow through the navigation drawer and task drawer; every owner page has no
   horizontal overflow; dialogs open as bottom sheets that fit the screen.
7. **Full journey (final acceptance rule)** — a brand-new owner registers → verifies → creates the organization →
   invites (with review) → the member accepts on a phone → role changed to Manager → project → task assigned → the
   member completes it → dashboard shows 100% → Free limit reached → upgrade, comes back before paying: "Verifying…"
   then "still being confirmed" → pays → **Check status** → Professional with receipt → limit lifted → activity
   history → another company cannot see any of it.
8. **Invitations** — new person on a phone; existing account must enter its password (wrong password refused);
   signed in as someone else → refused; expired invitation flagged in the team list and resent.
9. **Organization switcher** — keyboard and Escape, create an organization (invalid name rejected), search with no
   matches, keyboard selection, data of each organization kept apart.

Every scenario also asserts there are no unexpected console errors.

Scripted checks run during Phase 2 (results in [PHASE2_FRONTEND_QA.md](PHASE2_FRONTEND_QA.md)): every page per role at
320, 375, 768 and 1440 px — no horizontal overflow, no console errors — and an axe-core audit of 21 pages and states
(including the switcher, invite dialog, accept page and payment page): 0 violations.

## Assumptions

- "Responsible team and person" = a project **team** (members) plus a **lead** (responsible person).
- A user can belong to several organizations; one is active per session.
- Seats count active members **and** pending invitations.
- Deactivated members keep their tasks (shown as deactivated) until a manager reassigns them.
- The platform super admin administers tenants and plans but does not read tenants' business data.
- Prices are in ETB, monthly.
- Organization names are not globally unique (different companies may share a name); one person cannot have two
  workspaces with the same name. No organization names are suggested from other tenants.
- Super admins are provisioned only from the command line:
  `cd backend && npm run platform-admin -- grant|revoke <email>` (or `-- list`). The account must exist and be
  verified; every grant, revocation and console action is written to the platform audit log.

## Known limitations

- **Logo:** the official Teamwork IT Solution logo file was not provided. A placeholder mark in the brand colours is
  used; replacing it is a one-file change in `frontend/src/components/brand/Logo.jsx`.
- **Chapa** runs in **test mode** (a live key is refused without `CHAPA_ALLOW_LIVE=true`). Locally, Chapa needs a
  public `API_URL` (e.g. an ngrok tunnel) to reach the webhook/callback; a free ngrok URL changes on every restart.
- There is no in-app notification centre (not part of the requirements); the activity history and toasts cover it.
- Monthly billing only — no proration, invoices or refunds. One assignee per task.
- No real-time updates (changes from other people appear on refetch / window focus), no dark mode, English only.
- Rate-limit counters are in memory (one API instance). Emails are sent synchronously (no queue).
- `npm audit` in `backend/` reports advisories in the **Prisma CLI's** transitive dependencies (dev tooling, not
  the runtime client); npm's suggested "fix" is a downgrade, so it was left as is. Frontend: 0 vulnerabilities.

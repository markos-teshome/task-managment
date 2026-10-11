# TeamFlow

**Multi-Tenant SaaS Project & Task Management System**

Developed by **Markos Eshome** · Full-Stack Developer Practical Assessment · **Teamwork IT Solution PLC**

TeamFlow lets many organizations share one application while each keeps its own members, roles, projects, tasks,
subscription, payments and history — fully isolated from every other organization. The subscription plan really
changes what an organization can do: limits are enforced by the server, and upgrading through Chapa lifts them as
soon as the payment is verified.

## Live Application

| Service | Platform | URL |
|---|---|---|
| Frontend | Vercel | https://task-flow-alpha-blond.vercel.app |
| Backend API | Render | https://taskflow-api-5afh.onrender.com |
| API Health | Render | https://taskflow-api-5afh.onrender.com/api/health |

The frontend forwards `/api/*` to the Render API, so the browser talks to a single address. The backend runs on
Render's free plan: the first request after a period of inactivity can take up to a minute while it starts.

## Technology Stack

| Area | Technology |
|---|---|
| Frontend | React 19 (Vite), React Router, TanStack Query, Tailwind CSS v4, Radix UI |
| Backend | Node.js 20+, Express 5, Zod validation |
| Database | PostgreSQL (Neon in production) |
| ORM | Prisma 6 |
| Payments | Chapa (test mode) |
| Email | Brevo HTTPS API in production, any SMTP server locally |
| Tests | Vitest + Supertest (API), Playwright (browser) |

## Key Features

- **Multi-tenant organizations** — one person can belong to several organizations and switch between them; every
  organization's data is isolated on the server.
- **Authentication** — registration with email verification, sign-in with rotating refresh tokens, account lockout,
  forgot/reset password, change password, team invitations by email.
- **Super Admin platform console** — a separate identity with password + emailed sign-in code; manages
  organizations (suspend, reactivate, close), plans, subscriptions and payments, with an audit log. It never sees
  an organization's projects or tasks.
- **Role-based permissions** — Owner, Admin, Manager and Employee roles plus custom roles; every permission is
  checked by the API.
- **Projects and tasks** — status, priority, dates, responsible person and team, progress, archive/restore;
  tasks with assignees, due dates, a status workflow, a personal *My Work* view and CSV export (Business plan).
- **Branches** — organizations can organize people and projects by branch.
- **Subscription plans and limits** — Free, Professional and Business, enforced at the moment a member, project or
  branch is added.
- **Chapa payments** — hosted checkout; a plan is activated only after the server verifies the payment with Chapa.
- **Notifications and activity history** — in-app notification centre with unread badge, per-person email
  preferences, daily due-date and subscription reminders, and a filterable activity timeline.
- **Search, filters and pagination** — on every list, with filters kept in the URL.
- **Responsive interface** — desktop, tablet and phone.

## System Architecture

```text
React Frontend (Vercel)
          |
          v   /api/* forwarded by Vercel
Node.js REST API (Render)
          |
          v
Prisma ORM
          |
          v
PostgreSQL (Neon)
```

**Tenant isolation.** Every organization-owned row carries `organizationId`. The organization is never taken from
the request: it is derived from the signed-in session (session → membership → organization), every query is scoped
by it, and another organization's ids answer *404* exactly like ids that do not exist. Composite foreign keys make
PostgreSQL itself reject cross-organization links.

**Authorization.** Permissions are evaluated by the API on every request; the interface only hides what a role
cannot use. Design details are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Local Setup

Prerequisites: Node.js 20+ and PostgreSQL 14+.

```bash
# 1. Clone
git clone https://github.com/markos-teshome/task-managment.git
cd task-managment

# 2. Databases: one for the app, one the test suite may reset
createdb -U postgres teamflow
createdb -U postgres teamflow_test

# 3. Backend
cd backend
cp .env.example .env        # fill in the values (see Environment Configuration)
npm install                 # also generates the Prisma client
npm run db:deploy           # apply the database migrations
npm run db:seed             # optional demo data (empty database only)
npm run dev                 # API on http://localhost:4000

# 4. Frontend (second terminal)
cd frontend
cp .env.example .env        # the defaults work with the development proxy
npm install
npm run dev                 # app on http://localhost:5173 (proxies /api to :4000)
```

The permission catalog and default plans are created automatically when the API starts.

## Environment Configuration

All variables are listed with placeholders in `backend/.env.example` and `frontend/.env.example`. Never commit real
values.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection used by the app (Neon: the pooled address) |
| `DIRECT_URL` | Optional direct (non-pooled) connection used only for migrations |
| `TEST_DATABASE_URL` | Separate database for `npm test` — its data is deleted |
| `APP_URL` | Public **frontend** address. Every email link and the payment return page point here |
| `API_URL` | Public **API** address that Chapa calls for the webhook and callback |
| `CORS_ORIGINS` | Browser origins allowed to call the API (the frontend address) |
| `JWT_ACCESS_SECRET` | Signing secret for access tokens (at least 32 random characters) |
| `COOKIE_SECURE` | `true` behind HTTPS (required in production) |
| `CHAPA_SECRET_KEY` | Chapa API key; test keys (`CHASECK_TEST-…`) unless `CHAPA_ALLOW_LIVE=true` |
| `CHAPA_WEBHOOK_SECRET` | The webhook secret hash configured in the Chapa dashboard |
| `BREVO_API_KEY`, `MAIL_FROM` | Email through Brevo's HTTPS API; `MAIL_FROM` must be a sender verified in Brevo |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | SMTP email, used when `BREVO_API_KEY` is not set |
| `TRUST_PROXY` | Number of proxies in front of the API, so rate limits see the real client address |
| `SERVE_FRONTEND` | `true` when the API also serves the built frontend (single-service deployment) |
| `VITE_API_URL` | **Frontend:** API base path, default `/api/v1` (same origin through the proxy or rewrite) |

The API validates its configuration at start-up and refuses to run in production with a localhost `APP_URL`,
non-HTTPS addresses, insecure cookies, a live Chapa key without approval, or no email configuration.

## Roles and Access

| Role | Scope | Can do |
|---|---|---|
| **Super Admin** | Platform | Manages organizations, plans, subscriptions and payments; no access to organizations' projects or tasks |
| **Owner** | Organization | Everything in the organization, including billing, roles, ownership transfer and closure requests |
| **Admin** | Organization | Manages members and all projects and tasks; views billing |
| **Manager** | Organization | Runs the projects they lead, created, belong to or whose branch they manage |
| **Employee** | Organization | Works on the projects they belong to and updates the status of their own tasks |

Super Admins are a separate identity created from the command line only:

```bash
cd backend
PLATFORM_ADMIN_PASSWORD='<12+ characters, letters and numbers>' npm run platform-admin -- create <email> <first> <last>
```

## Testing

```bash
cd backend && npm test          # API integration tests on a real PostgreSQL database (TEST_DATABASE_URL)
cd frontend && npm run test:e2e # Playwright browser tests on an isolated stack (test database, fake Chapa)
cd frontend && npm run build    # production build
```

At the latest run: **210 backend tests passed**, and **36 Playwright browser tests passed** (3 optional
screenshot-capture tests skipped). They cover tenant isolation, permissions, invitations, the payment lifecycle,
subscription limits, notifications, pagination and password recovery. Automated tests never contact Chapa or send
real email.

## Demo Access

The live database contains no shared demo accounts. To try the live application, create an organization with
**Create one** on the sign-in page (a verification email is sent), or contact the developer for test access.

Locally, `npm run db:seed` creates two sample organizations whose accounts share the password `Demo@1234`
(reserved `.test` addresses, no email is sent to them):

| Organization | Role | Email |
|---|---|---|
| Abay Trading PLC (Professional) | Owner | `abebe@abaytrading.test` |
| | Admin | `sara@abaytrading.test` |
| | Manager | `dawit@abaytrading.test` |
| | Employee | `hana@abaytrading.test` |
| Gift Construction PLC (Free, at its 3-member limit) | Owner | `kebede@giftconstruction.test` |

In Chapa test mode, pay with the test number `0900123456`; no real money moves.

## Deployment

- **Frontend** on Vercel (root directory `frontend`). `frontend/vercel.json` forwards `/api/*` to the Render API and
  serves the app for deep links.
- **Backend** on Render (root directory `backend`): start command `npm run db:deploy && npm start`, health check
  `/api/health`.
- **Database** on Neon PostgreSQL.
- **Email** through Brevo's HTTPS API (Render's free plan blocks SMTP ports).
- **Payments** through Chapa in test mode; webhook `<API_URL>/api/v1/payments/webhooks/chapa`.
- **Configuration** comes only from each platform's environment settings. A `Dockerfile` is also provided for a
  single-service deployment.

## Project Structure

```text
backend/
  prisma/        schema, migrations, demo seed
  src/
    config/      validated environment configuration
    common/      middleware (auth, tenancy, permissions, validation, rate limits), errors, utilities
    lib/         database client, logger, email
    modules/     auth, organizations, users, roles, branches, projects, tasks, subscriptions,
                 payments, notifications, activities, dashboard, platform
  scripts/       platform admin CLI, migration runner
  tests/         API integration tests
frontend/
  src/
    app/         router, route guards, application shell
    components/  shared UI components
    features/    one folder per area (auth, projects, tasks, team, billing, notifications, platform, …)
  e2e/           Playwright browser tests
README.md
```

---

TeamFlow was developed to demonstrate practical full-stack engineering, secure multi-tenant architecture,
maintainable code, and real-world SaaS business logic.

**Developer: Markos Eshome**

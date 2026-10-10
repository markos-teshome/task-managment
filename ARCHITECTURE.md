# TeamFlow — Architecture & decisions

This document explains *why* the system is built the way it is. Setup instructions are in the [README](README.md).

## 1. Shape of the system

```
React SPA ──HTTP/JSON──► Express API (Node.js) ──Prisma──► PostgreSQL
                          │
                          ├─ auth          sessions, tokens, verification, recovery, invitations
                          ├─ organizations tenant creation & settings
                          ├─ users         team (memberships), invitations, roles assignment
                          ├─ roles         RBAC: system + custom roles, permission catalog
                          ├─ projects      projects, team, archive
                          ├─ tasks         tasks, my-work, CSV export
                          ├─ subscriptions plans, entitlements (limits & features)
                          ├─ payments      checkout via Chapa (provider adapter), settlement
                          ├─ activities    audit trail
                          ├─ dashboard     aggregates, global search
                          └─ platform      super-admin console (tenants, plans, revenue)
```

One deployable API, one database. No queues, caches or microservices — nothing in the requirements needs them,
and every extra moving part would be something to explain and operate without a matching benefit.

Each module has `*.routes.js` (HTTP + validation + permission guard) and `*.service.js` (business rules + data
access). There is **no separate repository layer**: Prisma already is a typed data mapper, and wrapping it would add
files without adding meaning. Services own their tenant-scoped queries.

## 2. Multi-tenancy

**Model:** shared database, shared schema, every tenant-owned row carries `organizationId`.

**Where the tenant comes from:** never from the client. A request's tenant is resolved like this:

```
Bearer JWT ──► session id ──► sessions row ──► membership ──► organization (+ role → permissions)
```

The JWT only carries `sub` (user) and `sid` (session). The *active workspace* is stored on the session row, so even a
user who belongs to several organizations cannot address another one by editing a request — they can only switch
through `POST /auth/switch-workspace`, which checks that the membership is theirs.

**Three independent checks on every tenant request** (`src/common/middleware/auth.js`):

| Question | Mechanism |
|---|---|
| Who are you? | `authenticate` — JWT signature/expiry **and** session/user re-checked in the DB |
| Which organization? | `requireTenant` — membership must be ACTIVE and the organization ACTIVE |
| What may you do? | `requirePermission(...)` — permissions loaded from the DB on every request |

**Scoping queries:** every service query includes `organizationId: ctx.organizationId`. Lookups by id are always
`findFirst({ where: { id, organizationId } })`, so another tenant's id produces **404**, exactly like a non-existent id
(no "403 — exists but not yours" oracle).

**Defence in depth in the database:** where Prisma can express it, child rows reference their parent with a
**composite foreign key** `(id, organizationId)`:

- `tasks(projectId, organizationId) → projects(id, organizationId)`
- `memberships(roleId, organizationId) → roles(id, organizationId)`
- `project_members(projectId|membershipId, organizationId) → …`

So even a bug in a service cannot attach a task to another tenant's project — PostgreSQL rejects it (there is a test
for this). Optional references (task assignee, project lead) cannot be composite in Prisma, so the service validates
them with `resolveActiveMembers()`.

**Mass assignment:** request bodies are validated with `.strict()` Zod schemas. Unknown fields such as
`organizationId`, `createdById` or `amountCents` are rejected with a 422, not silently ignored.

## 3. Identity: User vs Membership

- **User** = a global identity (email, password). One person, one login.
- **Membership** = that person inside one organization (role, status, job title).

All tenant data points at **memberships**, not users (task assignee, project lead, activity actor). Benefits:

- a person can belong to several organizations without duplicated accounts;
- cross-tenant assignment is impossible to express by accident;
- deactivating someone keeps their history intact — tasks and activity still show their name, with a "deactivated"
  marker. Joined members are never hard-deleted; only unaccepted invitations are.

## 4. Authentication

| Concern | Decision |
|---|---|
| Passwords | bcrypt (cost 12). Max 72 bytes is enforced instead of silently truncated. |
| Access token | JWT HS256, 15 min, kept **in memory** by the SPA (not localStorage → not readable by injected scripts after reload). |
| Refresh token | `<sessionId>.<secret>` in an **httpOnly, SameSite=Strict** cookie scoped to `/api/v1/auth`. Only `sha256(secret)` is stored. |
| Rotation | Every refresh issues a new secret. Presenting an old one = token copied → the session is revoked. A 15-second grace window treats a stale token right after a rotation as two tabs refreshing at once (refused, not revoked). |
| Revocation | Logout revokes the session row; access tokens die with it because the session is checked per request. Password reset revokes **all** sessions; password change revokes all *other* sessions. |
| Email tokens | Verification (24 h), reset (1 h), invitation (7 d): random 256-bit, stored hashed, single-use (atomic conditional update), new token invalidates older ones. |
| Enumeration | Register, resend verification and forgot password return the same response whether the account exists or not. Login uses one message for "no account" and "wrong password", and burns a bcrypt comparison for unknown emails to equalise timing. |
| Brute force | Rate limiting per IP (+ per target email) on auth endpoints — for sign-in only *failed* attempts count, so people who sign in often are never throttled; account lock for 15 min after 5 failed passwords. |
| Logging | pino with redaction of `authorization`, cookies, passwords and tokens. Emails go out over SMTP; their single-use links are never logged. |

**Onboarding:** registration creates only the user. After email verification the user creates a workspace
(`POST /organizations`), which atomically creates the organization, the four system roles, the Owner membership and a
Free subscription. Unverified sign-ups therefore never create tenants.

## 5. Authorization (RBAC)

- The **permission catalog** lives in code (`src/common/constants/permissions.js`) and is upserted into the DB on start.
  Adding a permission is a code change, never a manual DB edit.
- Every organization gets **system roles** Owner / Admin / Manager / Employee. Boundaries follow the brief:

| | Owner | Admin | Manager | Employee |
|---|---|---|---|---|
| Organization settings | ✓ | | | |
| Billing & subscription | manage | view | – | – |
| Roles | manage | view | – | – |
| Team | ✓ | ✓ (not owners) | view | – |
| Projects | all | all | all (no delete) | own projects |
| Tasks | all | all | all | update status of **own** tasks |
| Activity | ✓ | ✓ | ✓ | – |

- **Custom roles** are available to owners on every plan (creating roles is an Owner capability in the brief, not a
  paid extra). They are composed from the catalog in a grouped permission editor.
- **Privilege escalation guard:** nobody can create/edit a role, or assign a role to someone, that carries a
  permission they don't hold themselves. Only an owner can grant the Owner role. Non-owners cannot act on owners.
  Nobody can change their own role/status. The Owner role is locked. An organization can never lose its last owner.
- **Changes are immediate:** permissions are read from the DB per request, so a role change or deactivation applies
  on the user's next click, without waiting for token expiry.
- **Project visibility:** `PROJECT_VIEW_ALL` sees all projects; `PROJECT_VIEW` sees only projects whose team includes
  you. Tasks follow their project (plus: you always see tasks assigned to you).

## 6. Subscriptions & entitlements

- Plans are **rows**, not constants — the platform admin edits prices, limits (`maxUsers`, `maxProjects`, `null` =
  unlimited) and feature flags (`DATA_EXPORT` — CSV export on Business) without a deploy. Defaults are only inserted when missing.
- **All checks go through `entitlement.service.js`** (`assertCanAddUsers`, `assertCanCreateProject`, `assertFeature`,
  `getEntitlementSummary`). Nothing checks a plan inline.
- **Effective plan** = the subscribed plan while the subscription is live, otherwise Free. Expiry is evaluated at read
  time — no cron job — so limits drop the moment a period ends.
- **Seats** = active members + pending invitations (an invitation reserves a seat).
- **Projects quota** counts non-archived projects; archiving frees a slot, restoring re-checks the limit.
- **Race safety:** quota checks run inside a transaction that first takes `SELECT … FOR UPDATE` on the organization
  row, so three simultaneous invitations for the last seat produce exactly one success (tested).
- **Over-limit after downgrade/expiry:** nothing is deleted; adding is blocked until usage fits or the org upgrades.
  Switching to a plan smaller than current usage is refused up-front with an explanation.

## 7. Payments

```
choose plan ─► POST /payments/checkout ─► Payment(PENDING, txRef) ─► provider checkout page
                                                                        │
          webhook / return redirect / "check status" ─► processPayment(txRef)
                                                          │ provider.verify(txRef)  (server-to-server)
                                                          ▼
                       one transaction: PENDING→SUCCEEDED (conditional) + activate plan + activity
```

- **Provider adapter:** `ChapaProvider` implements `initialize()` and `verify()`; the subscription logic only talks to
  that interface. Chapa is the only runtime provider (test mode; a live key needs `CHAPA_ALLOW_LIVE=true`). Older
  rows of other providers are kept as read-only history.
- **Trust:** a payment succeeds only through `processPayment`, which asks the provider for the real status and checks
  amount and currency against what we charged. The client never reports success; the price is taken from the plan on
  the server.
- **States:** `PENDING → SUCCEEDED | FAILED | CANCELLED | EXPIRED`. `SUCCEEDED` and `FAILED` are final. A checkout not
  completed within 60 minutes becomes `EXPIRED` (lazily, when the organization's payments are read or verified), so
  nothing stays "processing" forever. `CANCELLED` (by the customer, by Chapa, or superseded by a newer checkout) and
  `EXPIRED` can still become `SUCCEEDED` — only when Chapa verifies the customer did pay, because money that was taken
  must never be ignored. There is no separate PROCESSING state: confirmation is one atomic step.
- **Provider outages:** if Chapa cannot be reached (network error, timeout, 5xx), verification answers
  `503 PAYMENT_VERIFICATION_UNAVAILABLE` and changes nothing; the return page offers "Check again" and a webhook gets a
  5xx, so Chapa retries it. An outage is never read as "unpaid".
- **Idempotency:** every transition is an `updateMany … where status = <status that was read>` inside the same
  transaction as the plan activation. Duplicate webhooks, double clicks and races find nothing to update and cause no
  side effects (tested with concurrent calls). `txRef` is unique.
- **Chapa:** initialise/verify per Chapa's API. The dashboard webhook (POST) is authenticated by HMAC-SHA256
  (`x-chapa-signature` or `chapa-signature`); the checkout `callback_url` (GET) is unsigned and only triggers
  verification. Verified end to end with a real Chapa test-mode transaction.
- **Tests never call Chapa:** API tests replace `fetch` with a fake of Chapa's HTTP API (`tests/fakeChapa.js`);
  end-to-end tests run against `e2e/fake-chapa-server.mjs` through the existing `CHAPA_BASE_URL` setting. The
  application code under test is unchanged.
- Pricing is monthly; renewing the same plan extends the period; switching plans starts a new period (no proration —
  a deliberate simplification).

## 8. Activity log

Append-only `activity_logs` rows written **in the same transaction** as the change they describe. `metadata` stores
display values (project name, task title, member name) captured at the time, so history stays readable after renames
or deletions. A denormalised `projectId` makes a project's timeline one indexed query. No secrets are ever stored.

## 9. Platform (super admin)

A user with `isPlatformAdmin` has no membership and therefore **cannot call tenant APIs at all**. The platform console
covers tenant administration only — organizations (suspend/reactivate), plans (pricing/limits/features) and revenue.
It deliberately does not let the operator browse customers' projects or tasks. Suspending an organization blocks its
members on their next request.

Provisioning is **command-line only** (`npm run platform-admin -- grant|revoke <email>`): registration and the API can
never set `isPlatformAdmin`, and the flag is re-read on every request, so a revocation applies immediately. Every
console change (suspend/reactivate, plan create/update with old and new values) and every grant/revocation is written to
`platform_audit_logs` (actor, action, target, metadata), readable at `GET /platform/audit-log`.

## 9a. Invitations and workspaces

- The invitation (a hashed, 7-day, single-use token tied to one user and one membership) decides the organization and
  role; the client cannot choose either. Withdrawing an invitation deletes the membership and its token.
- **New person:** sets name and password on the accept page; following the emailed link proves the address, so the
  account is verified. **Existing account:** must enter its password, or already be signed in as that account.
  **Signed in as someone else:** refused (`INVITATION_WRONG_ACCOUNT`).
- Expired and already-accepted links get their own messages (only the token holder sees them); withdrawn, replaced
  and unknown links get one generic answer. Token consumption and the `INVITED → ACTIVE` change are both conditional
  updates in one transaction, so concurrent acceptances produce one membership.
- The active workspace belongs to the session. The SPA sends the membership it is showing as `X-Workspace-Id`; if
  another tab switched the session, tenant routes answer `409 WORKSPACE_CHANGED` instead of returning the other
  organization's data, and the SPA reloads.

## 10. Errors & validation

- All input (body, params, query) is parsed by Zod in `validate()`; handlers only read `req.valid`.
- One response shape: `{ success: true, data, meta? }` / `{ success: false, error: { code, message, details? } }`.
- Stable machine-readable codes (`SUBSCRIPTION_USER_LIMIT`, `PRIVILEGE_ESCALATION`, `EMAIL_NOT_VERIFIED`…) so the UI
  can react specifically (e.g. show "View plans" on limit errors).
- Status codes: 401 unauthenticated, 403 forbidden, 404 not found / other tenant, 402 plan limit, 409 business
  conflict, 422 validation, 429 rate limited.
- Unknown errors are logged with full detail server-side and returned as a generic 500. Prisma/SQL/JWT messages never
  reach the client.

## 11. Frontend

```
src/
├── app/            router (lazy routes), guards, navigation config, layouts (AppShell, Sidebar, Topbar, Search)
├── components/
│   ├── ui/         design-system primitives: Button, form fields, Badge, Avatar, Progress, Dialog/Drawer,
│   │               Menu, DataTable, Tabs, Pagination, search/filter inputs, Skeleton
│   ├── feedback/   EmptyState, ErrorState, AccessDenied, PlanLimitNotice, loaders
│   ├── layout/     PageHeader, Toolbar, Section, Panel
│   └── brand/      Logo (single swap point for the official logo file)
├── features/       auth · dashboard · projects · tasks · team · roles · billing · activity · settings · platform
│                   (each: api.js query hooks + its pages and components)
├── hooks/          useUrlFilters, useMediaQuery, useDocumentTitle
├── lib/            API client, query client, formatting, status vocabulary, form rules
└── styles/         design tokens (one @theme block)
```

**Data flow.** `lib/api.js` is the only module that calls `fetch`. It owns the base URL, the bearer token and JSON
handling, makes one silent refresh-and-retry on an expired token (shared by concurrent requests), and normalises
every failure into an `ApiError { status, code, message, details }`. Features wrap endpoints in TanStack Query
hooks, and mutations invalidate the related caches: a task change refreshes project progress, dashboard counts and
activity. Server data is never copied into component state.

**Session.** The access token lives only in memory; on load, the httpOnly refresh cookie restores the session. In
development Vite proxies `/api`, so the SPA and API share an origin and the cookie is first-party. A non-secret
`localStorage` hint ("has signed in before") avoids a refresh request that would certainly fail for anonymous
visitors. When a refresh fails, the app returns to sign-in with "Your session expired" instead of showing broken
pages. A 403 meaning "removed from this organization" reloads the profile and shows the workspace screen.

**Permission-aware UI.** `useAuth().can()` and `canAny()` read the permissions returned by `/auth/me`. They decide
which navigation items, buttons and fields appear, and route guards show an *Access denied* page for URLs typed by
hand. This is presentation only: the API authorises every action again, and the e2e suite checks both. Mutations
that may change the caller's own rights (role edits, plan changes) reload `/auth/me`.

**Design system.** The brand colours come from the Teamwork identity: deep navy for structure, primary actions and
the sidebar, and yellow only for the active marker, the current plan and highlights. Neutral surfaces and semantic
success/warning/danger/info colours complete the palette. All are defined once as tokens in `styles/index.css`.
One status vocabulary (`lib/status.js`) gives every project, task, member and payment state the same label, colour
and icon everywhere. Badges always carry text and an icon, so colour is never the only signal. Typography is Inter at
13–14 px in the workspace, with a small heading scale. Information is grouped with dividers and compact lists rather
than a card around everything.

**Responsive strategy.** At 1024 px and wider there is a collapsible navy sidebar; below that, a navigation drawer.
Lists render as semantic tables from 768 px and as compact stacked rows on phones (`DataTable`). On phones, dialogs
become bottom sheets and toolbars collapse their filters behind a *Filters* button. Inputs use 16 px text on phones to
avoid iOS zoom. Controls are 40 px tall on touch screens and 32 px on desktop.

**Accessibility.** Radix primitives provide focus trapping, Escape-to-close and focus return for dialogs and menus.
Every field is labelled (`Field` wires `label`, `aria-describedby` and `aria-invalid`), focus outlines are visible,
there is a skip link, tabs are keyboard-navigable and icon-only buttons have accessible names. Text colours were
tuned to WCAG AA contrast after an axe-core audit, which now reports 0 violations on the main pages.

**Tasks in a drawer.** A task opens in a side drawer addressed by `?task=<id>`, from any page: lists, projects,
My Work or search. Fields are edited in place next to their values, the list stays visible on large screens, the
link is shareable, and Back closes the drawer.

**Brand asset.** The official Teamwork logo file was not in the repository. `components/brand/Logo.jsx` renders a
placeholder mark in the brand colours; putting the real file in `src/assets/` and rendering it there updates every
screen.

## 12. Known simplifications

- Monthly billing only; no proration, invoices or refunds.
- One assignee per task (sufficient for the brief; a join table would allow several).
- Email delivery is synchronous with graceful failure; a production system would use a queue.
- Rate-limit counters are in-process memory (fine for one instance; a shared store is needed for several).
- No ownership-transfer workflow; owners can promote another member to Owner instead.
- No real-time updates (other people's changes appear on refetch/focus); no dark mode; English only.

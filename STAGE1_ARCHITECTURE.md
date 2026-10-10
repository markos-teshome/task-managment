# TeamFlow — Stage 1: SaaS Architecture, Branches, Platform Super Admin

Date: 2026-10-11 · Scope: backend, database, security. The frontend received only the minimum needed to keep working
with the new platform sign-in (redesign is Stage 2).

## 1. Repository audit (before changes)

| Area | Found | Action |
|---|---|---|
| Multi-organization model | Already correct. `User` is a person; `Membership` is unique per (user, organization) and carries the role. One person could own or join several organizations; switching changed the session's workspace; a stale-tab guard existed. | Kept. Added `GET /me/organizations` and `POST /organizations/switch`. |
| Several owners / last owner | Several owners allowed; last-owner check present. **Race found:** two owners removing each other at the same moment could both pass the check and leave no owner. | Fixed: the check now locks the organization row. Tested with concurrent requests. |
| Super admin | `users.isPlatformAdmin` boolean on the normal tenant account; signed in through tenant login; no second factor; no session separation. | **Replaced** by a separate `platform_admins` identity with two-factor sign-in and its own session. The boolean was removed after migrating its holders. |
| Platform privacy | Organization list exposed per-company **project counts**; queries returned included objects. | Every platform response is now built from an explicit field allowlist. No project or task data, not even counts. |
| Branches | Did not exist. | New `branches` and `branch_memberships` tables, projects can belong to a branch, branch limits on plans. |
| Activity history | Visible organization-wide to `ACTIVITY_VIEW` holders. With branches, it would have leaked branch-only project names. | Entries about projects are now filtered to projects the reader can see. |
| Visibility composition | Project visibility and the search filter both used a top-level `OR`. Adding branch rules as `OR` would have let a search **override** visibility. | Visibility now sits under `AND`. A test proves search cannot widen it. |
| Tests | 118 backend tests, 16 e2e tests, all passing | Extended to 149 backend tests; e2e updated. |

Must be preserved, and is: registration, verification, invitations, payments (Chapa test mode, idempotent
settlement), projects, tasks, subscriptions, entitlements, multi-tenant isolation, all existing data.

## 2. Architectural decisions

1. **One person, many organizations.** No new membership model was needed: the existing one already separates
   identity from per-organization role. Organization names stay non-unique across tenants. One person cannot have
   two workspaces with the same name.
2. **Super admin is a different identity**, not a flag or role on a tenant user. A platform admin has no
   memberships and no tenant session, so platform authority cannot reach tenant APIs. A tenant user cannot become
   one through any request: there is no API for it, and creation is CLI-only.
3. **Two-factor platform sign-in by emailed code** (your choice):
   - password, then a 6-digit code;
   - the code is hashed, valid 10 minutes, 5 attempts, single use, and only the newest code works.
4. **Separate platform session:** an opaque `<id>.<secret>` cookie, hashed in `platform_sessions`.
   - Cookie: `HttpOnly`, `SameSite=Strict`, `Path=/api/v1/platform`.
   - Lifetime: 8 h absolute, 30 min idle; revalidated against the database on every request.
   - Writes also require the `X-TeamFlow-Client` header (CSRF defence in depth).
5. **Branches are parts of an organization, never tenants.** Every organization has exactly one default branch
   ("Head Office"), enforced by a partial unique index. Branches are archived, never deleted.
6. **Projects are organization-wide (`branchId = NULL`) or belong to one branch.** Tasks inherit scope from their
   project; there is no task-level branch column, so nothing can drift out of sync.
7. **Existing projects stay organization-wide** after migration, so nobody's access changes.
8. **Subscriptions belong to the organization.** Users, projects and branches are counted company-wide by one
   entitlement service, under the same per-organization lock.

## 3. Database relationships (new and changed)

```
Organization 1─N Branch 1─N BranchMembership N─1 Membership N─1 User
             │      └─ managerId → Membership (same organization)
             └─ 1─N Project ─ branchId? → Branch (same organization) ── 1─N Task (scope inherited)
SubscriptionPlan.maxBranches (null = unlimited)
PlatformAdmin 1─N PlatformSession · 1─N PlatformLoginChallenge · 1─N PlatformAuditLog
```

Constraints enforced **in the database**, not just in code:

| Constraint | How |
|---|---|
| Branch member belongs to the branch's organization | Composite FKs `(branchId, organizationId)` and `(membershipId, organizationId)` |
| Project's branch belongs to the project's organization | Composite FK `(branchId, organizationId) → branches(id, organizationId)` (raw SQL, `MATCH SIMPLE`) |
| Branch manager belongs to the same organization | Composite FK `(managerId, organizationId) → memberships(id, organizationId)` (raw SQL) |
| One default branch per organization | Partial unique index `WHERE "isDefault"` |
| Branch name / code unique per organization | `@@unique([organizationId, name])`, `@@unique([organizationId, code])` |
| Branch membership unique | PK `(branchId, membershipId)` |

The three raw-SQL constraints are documented in `schema.prisma`. If a future `prisma migrate dev` proposes dropping
them, keep them.

## 4. Migration and backfill — `20261011000000_branches_platform_admins`

The migration runs in one transaction, in this order:
1. New tables and columns.
2. Backfill:
   - copy every `isPlatformAdmin` user into `platform_admins` (same password hash; the tenant user row is kept);
   - re-point existing platform audit entries to the new admin ids;
   - create a "Head Office" default branch for every organization;
   - insert the two branch permissions and grant them to existing system roles: Owner and Admin both, Manager
     `BRANCH_VIEW`. Custom roles are untouched;
   - set branch limits on the default plans: Free 1, Professional 5, Business unlimited.
3. A verification block refuses to drop `isPlatformAdmin` unless every holder was copied.
4. Drop the flag.
5. Final verification aborts the migration unless organizations = default branches and no project was moved.

Data steps use `NOT EXISTS` / `ON CONFLICT`, so they are safe to re-run by hand. Rollback steps are in the file
header.

**Evidence: migration run on a copy of your local database with real data** (`CREATE DATABASE … TEMPLATE
teamflow`; the original was not touched). All tenant counts were identical before and after:

| organizations | users | memberships | roles | projects | tasks | payments (succeeded) | subscriptions | activity | auth tokens |
|---|---|---|---|---|---|---|---|---|---|
| 4 | 18 | 15 | 17 | 7 | 23 | 13 (5) | 4 | 113 | 9 |

`role_permissions` went from 225 to 245: the 20 expected branch grants. 4 default branches; 1 platform admin
copied.

**Applied to:** the test database (on every run), the preview database and **Neon** (your `DATABASE_URL`). On Neon
all tenant counts were identical and there are 4 default branches. **Not applied to your local `teamflow`
database** — run `npx prisma migrate deploy` against it when you switch back.

## 5. API changes

All tenant routes are under `/api/v1`, authenticated with the tenant Bearer token, and scoped to the session's
active organization.

| Endpoint | Permission | Notes / errors |
|---|---|---|
| `GET /me/organizations` | signed in | `{ activeOrganizationId, activeMembershipId, organizations: [{ membershipId, organization{id,name}, role{key,name}, isActive }] }` — only the caller's active memberships |
| `POST /organizations` | verified user | Now also creates the default branch (same transaction) |
| `POST /organizations/switch` `{ organizationId }` | signed in | `404` unless the caller has an active membership there; returns a new token + profile. `POST /auth/switch-workspace` remains as a compatible alias |
| `GET /branches?status&search` | any member | All branches with `BRANCH_VIEW`/`BRANCH_MANAGE`; otherwise only branches the caller belongs to or manages |
| `POST /branches` `{ name, code?, description?, address?, managerId? }` | `BRANCH_MANAGE` | `402 SUBSCRIPTION_BRANCH_LIMIT`; `422` duplicate name/code or foreign/inactive manager |
| `GET /branches/:id` | visible | Includes members and `canManage`; `404` otherwise (also for other tenants) |
| `PATCH /branches/:id` `{ name, code, description, address, managerId, status, isDefault: true, reassignProjectsTo }` | `BRANCH_MANAGE`; the branch manager may change only description/address | `409 DEFAULT_BRANCH_REQUIRED`, `409 BRANCH_HAS_ACTIVE_PROJECTS` (send `reassignProjectsTo`: a branch id or `null` for organization-wide), `402` on reactivation over the limit |
| `POST /branches/:id/members` `{ membershipIds }` | `BRANCH_MANAGE` or the branch manager | Active members of the same organization only; branch must be active |
| `DELETE /branches/:id/members/:membershipId` | same | `409 BRANCH_MANAGER_REQUIRED` for the current manager |
| `GET/POST/PATCH /projects` | unchanged | New `branchId` field (null = organization-wide) and `?branchId=<id>|none` filter; `422` unless the branch is active and the caller works there (or has `BRANCH_MANAGE`) |
| `GET /subscription`, `/auth/me` | unchanged | Plan includes `maxBranches`; usage includes `branches` |

**Platform API** (`/api/v1/platform`, platform session cookie, `X-TeamFlow-Client` header on writes):

| Endpoint | Notes |
|---|---|
| `POST /auth/login` `{ email, password }` | → `{ challengeId, expiresAt, sentTo: "a•••@domain" }`; code emailed. `401 INVALID_CREDENTIALS`, `429 ACCOUNT_LOCKED` (5 wrong passwords → 15 min), `403 ACCOUNT_DISABLED`, `502` if the email cannot be sent |
| `POST /auth/verify` `{ challengeId, code }` | Sets the session cookie; `401 INVALID_CODE` |
| `POST /auth/logout`, `GET /auth/me` | |
| `GET /overview` | Counts, revenue by currency, plan distribution, failed payments (30 d), subscriptions ending in 7 d |
| `GET /organizations?search&status&planCode&page` | Allowlist: id, name, status, createdAt, activeMembers, activeBranches, plan, subscriptionStatus, currentPeriodEnd |
| `GET /organizations/:id` | Plus subscription dates and limits, owners as billing contacts, payment summary |
| `PATCH /organizations/:id/status` `{ status, reason }` | Reason required to suspend; audited; data kept; members get `403 ORGANIZATION_SUSPENDED` |
| `GET /subscriptions?status=ACTIVE|EXPIRED|CANCELING&planCode&endingWithinDays` | Renewal and expiry view |
| `GET /payments?status&organizationId` | References, amounts, status, failure reason |
| `GET /plans`, `POST /plans`, `PATCH /plans/:id` | `maxBranches` added; changes audited with old and new values |
| `GET /health` | Database latency, SMTP check, Chapa mode and webhook-secret presence, failed/stale payments, recent internal errors (type, route, request id, time only) |
| `GET /audit-logs?action&organizationId` | Actor, action, target, metadata, IP, time |

## 6. Authorization design

Every tenant request is evaluated in this order:
1. Authentication: JWT plus the session re-checked in the database.
2. Tenant context from the session's membership. Never from ids the browser sends.
3. Membership active and organization active (`403 MEMBERSHIP_INACTIVE` / `ORGANIZATION_SUSPENDED`), plus the
   stale-tab guard.
4. Permission (`requirePermission`).
5. Branch and project scope in the services.
6. Entitlements via `entitlement.service`, under a per-organization lock.

Foreign or hidden ids return `404`.

Project visibility (`visibleProjectsWhere`, the single rule used by projects, tasks, dashboard, search and activity):

| Caller | Sees |
|---|---|
| `PROJECT_VIEW_ALL` + `BRANCH_MANAGE` (Owner, Admin) | Every project in the organization |
| `PROJECT_VIEW_ALL` (Manager, custom roles) | Organization-wide projects + projects of branches they belong to or manage + projects whose team they are on |
| `PROJECT_VIEW` only (Employee) | Projects whose team they are on (an organization-wide project is **not** visible automatically) |

Tasks are visible when their project is visible, or when assigned to the caller.

Platform requests: platform cookie → session valid (absolute, idle, admin active) → client header on writes. There
is no code path from a platform session to tenant data, and no impersonation.

## 7. Super admin security controls

- **Identity:**
  - separate `platform_admins` table;
  - no public registration, no API to create or promote;
  - CLI-only provisioning (`create`, `reset-password`, `disable`, `enable`, `list`);
  - the password comes from `PLATFORM_ADMIN_PASSWORD` (≥ 12 characters, letters and numbers), never from argv;
  - the last active admin cannot be disabled.
- **Sign-in:**
  - bcrypt password, lockout after 5 failures;
  - emailed one-time code (hashed, 10 min, 5 attempts, single use);
  - rate-limited endpoints;
  - wrong attempts logged without secrets.
- **Session:**
  - hashed secret in an `HttpOnly`, `SameSite=Strict` cookie limited to `/api/v1/platform`;
  - 8 h absolute, 30 min idle;
  - revoked on logout, disable or password reset;
  - re-checked on every request.
- **Privacy:** allowlisted responses only (§5). No project or task content or counts, no activity details, no
  passwords or tokens. Tested by asserting that a project name, description, task title, `passwordHash` and
  `tokenHash` never appear in platform responses.
- **Audit:** sign-ins, suspensions/reactivations (with reason), plan changes (old → new), and admin creation,
  disable, enable and password reset, each with actor, target, time and IP.

## 8. Branch business rules

- Default branch "Head Office" is created with every organization. The default cannot be archived; make another
  active branch the default first. There is always exactly one.
- Create, edit and archive: `BRANCH_MANAGE` (Owner, Admin). The branch manager edits description/address and
  manages members of their own branch only.
- The manager must be an active member of the same organization and is automatically added as a branch member.
  They can't be removed from the branch until another manager is set.
- People can belong to several branches. Members of another organization are refused (API `422`; database FK).
- **Archive instead of delete.**
  - Archiving a branch with active projects requires `reassignProjectsTo` (another active branch, or `null` =
    organization-wide).
  - Archived projects keep their branch link, and branch memberships stay, so history is intact.
  - Inactive branches accept no new members or projects.
  - Reactivation counts against the plan limit.
- Limits: active branches (including the default) count against `maxBranches`. Assumed defaults are Free 1,
  Professional 5, Business unlimited, editable by the platform admin. A downgrade below current branch usage is
  refused. Projects and users are counted company-wide regardless of branch.

## 9. Tests executed (isolated test database `teamflow_test`)

**Backend: 149 passed / 0 failed** across 10 files (118 before Stage 1; 31 added or rewritten). E2E: **16 passed /
0 failed**. ESLint clean, production build OK, `prisma validate` OK.

| # | Required scenario | Test (file) | Result |
|---|---|---|---|
| 1–2 | One user creates one, then a second company (no duplicate account) | `organizations` — "same account owns two companies…" | PASS |
| 3–4 | Switching; no old-tenant data | `organizations` — switch endpoint, "every tenant-scoped view follows…", stale-tab 409 | PASS |
| 5 | Each company has its own subscription | `organizations` — two companies, two subscriptions | PASS |
| 6–7 | Several owners; final owner cannot be removed (incl. concurrent mutual removal) | `organizations` — "several owners, never zero" (3 tests) | PASS |
| 8–9 | Owner creates a branch; default branch automatic | `branches`, `organizations` | PASS |
| 10 | Employee in two branches | `branches` | PASS |
| 11 | Branch manager limited to their branch | `branches` | PASS |
| 12 | No branch access across organizations (API + database) | `branches` (2 tests) | PASS |
| 13 | Organization-wide projects follow permission rules | `branches` — employees still need team membership; manager scope; search cannot widen | PASS |
| 14 | Super admin sees allowed metadata | `platform` — exact allowlisted keys | PASS |
| 15 | Super admin cannot read projects or tasks | `platform` — no names, descriptions or counts in any response | PASS |
| 16 | Guessed ids on tenant APIs with a platform session → 401 | `platform` | PASS |
| 17 | Organization owner cannot use platform APIs | `platform` | PASS |
| 18–19 | Suspension blocks, keeps data, audited; reactivation restores | `platform` | PASS |
| 20 | Limits are company-wide (branches, projects across branches, downgrade) | `branches` (2 tests) | PASS |
| 21 | Archiving keeps history | `branches` (2 tests) | PASS |
| 22–25 | Registration, invitations, payments, projects and tasks still work | `auth`, `invitations`, `payment-lifecycle`, `chapa-webhook`, `subscription`, `rbac`, `tenancy` + all 16 e2e | PASS |

Also tested: the emailed code is required, hashed and single use; 5 wrong codes lock the challenge; idle expiry;
sign-out; disabled admin; CSRF header; CLI password strength and audit; disabling signs out at once.

## 10. Remaining issues and assumptions

- **Demo super admin email:** the seeded `admin@teamflow.test` (and the copy migrated on Neon and on your local
  database) cannot receive the sign-in code. Create a real one:
  `PLATFORM_ADMIN_PASSWORD='…' npm run platform-admin -- create you@company.com First Last`. Alternatively, set
  `SEED_PLATFORM_ADMIN_EMAIL` before seeding.
- **The old tenant user row of a former super admin is kept** (no data deletion). With those credentials they can
  still sign in to the tenant app, where they have no workspace and are asked to create one.
- **Assumed branch limits** (Free 1, Professional 5, Business unlimited) — not in the brief; editable.
- **Stage 2 frontend items:**
  - branch management screens;
  - branch selector on projects;
  - platform organization detail, subscriptions, health and audit views;
  - hiding the organization switcher's dropdown for single-organization users (Stage 1 contract). The Phase 2
    switcher currently always opens, to offer "Create organization".
- **Recent internal errors** in `/platform/health` are kept in memory per process; full details stay in the server
  log.
- The local `teamflow` database (real data) is not migrated yet (§4).
- Chapa webhook secret mismatch and the shared Neon and ngrok credentials, from earlier phases, are still pending.

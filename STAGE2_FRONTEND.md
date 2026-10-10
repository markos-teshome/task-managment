# TeamFlow — Stage 2: SaaS Frontend, Owner Workspace, Branches & Super Admin

Date: 2026-10-11 · Built on the Stage 1 APIs (`STAGE1_ARCHITECTURE.md`). Same stack and design tokens (navy
`#14295c` with yellow accent `#f5b700`, compact type and radii); no new dependencies.

## 1. Existing UI issues found

| Issue | Where | Resolution |
|---|---|---|
| A one-company owner saw a dropdown with nothing to choose | Top bar (`OrganizationSwitcher`) | One company: plain identity (initials + name, not a control). Two or more: the switcher. |
| The switcher always showed a search box, even for two companies | Switcher | Search appears only from 6 companies; otherwise the list itself takes keyboard focus. |
| The switcher was the only way to create a company | Top bar | "Create organization" is also in the account menu. |
| With two companies the keyboard could not reach the list (`autoFocus` is ignored on non-form elements) | Switcher | Focus moved explicitly when the list opens (caught by an e2e test). |
| A member signing in after their company was suspended saw "create your organization" instead of "suspended" | Sign-in workspace selection (backend) | Lands on the suspended company, so the suspension message shows; the tenant API still refuses it. |
| No branch screens; projects knew nothing about branches | — | Branches page, branch detail, branch field and filter on projects. |
| The platform console had four pages, a project count per company, and would have shown the company switcher if the browser also held a company session | `PlatformPages.jsx`, Top bar | Rebuilt console (8 areas, allowlisted data); platform mode never shows tenant context. |
| The overview's admin-action list was flooded with sign-ins | Platform overview | Overview shows actions that changed something; the full log keeps sign-ins. |
| Section headers with and without a button were misaligned | `Section` | Minimum header height. |

## 2. Pages redesigned or added

**Workspace**

| Page | Change |
|---|---|
| **Overview** (was Dashboard) | Header with company name and a plan chip. Compact figures: active projects, open tasks (with "due this week"), overdue, completion, team seats, branches. Each figure appears only for people allowed to act on it, and all are real backend data. |
| **Branches** (new, `/branches`) | Compact table: Branch (code, default, address) · Manager · Members · Projects · Status · ⋯. Search and status filter, plan usage meter, limit notice, empty, error and loading states, phone layout. |
| **Branch detail** (new, `/branches/:id`) | One focused page, no tabs: status, manager, counts, address. Members (add/remove, branch vs organization membership explained). The branch's projects with progress. Edit, make default, archive (with project reassignment) and reactivate. |
| **Projects** | Branch filter (only with more than one branch), branch label on rows and on the project page, branch field in the form ("Organization-wide" by default; only branches the person may use). |
| **Onboarding** (no company) | Adds how to join an existing company by invitation. |

**Platform console** (`/platform`, separate sign-in and session)

| Page | Contents |
|---|---|
| Overview | Companies, suspended, live paid subscriptions, pending and failed payments, revenue; recently registered; companies needing attention; companies by plan; recent admin actions |
| Organizations | Company · Plan · Billing · Members · Branches · Status · Registered · ⋯. Search, plan and status filters, pagination |
| Organization detail | Identity, status, plan, billing status, period and renewal, limits, counts, billing contacts, payment summary, platform admin history. Suspend/Reactivate |
| Subscriptions | Plan, price, status, renewal; filters by status, plan and "ends within 7/30 days" |
| Payments | Company, reference, amount, provider, status (failure reason on hover); search by company or reference; status filter |
| Plans | Price, member/project/branch limits, features; editor with validation, a note on how many companies are affected, and a warning when lowering a limit |
| Admin activity | Who, what, when, IP; filter by action |
| System health | Database latency, payment mode, stale checkouts, server errors; checks list; recent error routes (no messages) |

The console has its own sidebar ("Platform console" tag, Platform and Operations groups) and its own top bar
("TeamFlow platform console"). There is no company switcher, no tenant navigation, and no "enter workspace" or
impersonation anywhere.

## 3. Components created or reused

- **New:**
  - `OrganizationSwitcher` (identity + switcher) and `CreateOrganizationDialog`;
  - `BranchFormModal`, `ArchiveBranchDialog`, `ReactivateBranchDialog`;
  - platform `StatStrip`, `OrganizationStatusDialog`, `usePlatformQuery`, `describeAudit`;
  - `RequirePlatformSession` and `PlatformLoginPage` (from Stage 1).
- **Extended:**
  - `MemberPicker` gained a single-choice mode (branch manager);
  - `filterNav` accepts workspace-based conditions (Branches for people who work in a branch);
  - `Sidebar` and `Topbar` have a platform mode;
  - `Section` header alignment.
- **Reused unchanged:** `DataTable` (desktop table / phone rows), `PageHeader`, `Toolbar`, `SearchInput`,
  `FilterSelect`, `Pagination`, `StatusBadge`, `Badge`, `Modal`, `ConfirmDialog`, `EmptyState`, `ErrorState`,
  `PlanLimitNotice`, `UsageMeter`, `Progress`, `Skeleton`, `Menu`.

No duplicate tables, modals or buttons were introduced. The old `PlatformPages.jsx` was removed.

## 4. API integrations

| Frontend | API |
|---|---|
| Switcher, onboarding | `POST /organizations/switch`, `POST /organizations`; `/auth/me` (`memberships`, `workspace.myBranches`, `usage.branches`, `plan.maxBranches`) |
| Branches | `GET/POST /branches`, `GET/PATCH /branches/:id`, `POST /branches/:id/members`, `DELETE /branches/:id/members/:membershipId` |
| Projects | `branchId` on create/update, `?branchId=<id>|none` |
| Platform | `/platform/auth/*`, `overview`, `organizations[/:id]`, `organizations/:id/status`, `subscriptions`, `payments` (+ new `search`), `plans`, `audit-logs`, `health` |

Small backend additions made for these screens, all tested:
- `workspace.myBranches` in `/auth/me`;
- `activeOrganizations`, `activePaidSubscriptions` and `pendingPayments` on the platform overview;
- `search` on platform payments;
- the suspended-company sign-in fix.

## 5. Workspace-switching behaviour

- The switcher lists only `me.memberships` (the API returns only the caller's own active memberships).
- Switching calls `POST /organizations/switch`. The response (new token + profile) is applied by
  `applySession`, which sets the token and workspace header and clears the whole query cache before rendering
  the new company. Nothing from the previous company can appear under the new name.
- Permissions, plan, usage and branches come from the new profile, so navigation and actions follow the new role
  immediately (tested Owner → Manager).
- Every tenant request carries `X-Workspace-Id`. A tab still showing another company gets `409` and reloads.
- No organization id is stored in local storage. The server decides the active organization from the session.

## 6. Branch-management behaviour

- Owners and admins (`BRANCH_MANAGE`): add, edit, make default, archive, reactivate, set managers and members.
  Branch managers: edit description/address and members of their own branch. Others with `BRANCH_VIEW`: read-only.
  People without it: only branches they work in.
- **Archive dialog:** explains that nothing is deleted. It asks where active projects should go (another branch or
  organization-wide) and shows the server's message if refused.
- Choosing a manager or adding members offers only active members of the current company.
- Removing someone from a branch keeps their organization membership; the dialog says so.
- **Single-branch companies:** no branch filter, no branch field.
- Visibility is enforced by the API. The UI never relies on a filter for security: a branch manager opening
  another branch's project URL gets "Project not found".

## 7. Super Admin privacy enforcement

- **Server side (Stage 1):** allowlisted responses only; platform sessions are rejected by tenant APIs.
- **UI side:**
  - the console only calls `/platform/*`;
  - the organization detail lists identity, status, plan, billing, renewal, limits, counts, billing contacts and
    platform admin history;
  - a visible note states that projects, tasks, files and the company's activity are not available;
  - no impersonation or "enter workspace" control exists.
- The platform e2e test asserts that no project or task names appear on the company detail page, and that no
  impersonation wording exists.

## 8. Screens and flows tested

**Browser end-to-end (Playwright, isolated stack): 21 passed / 0 failed** (final full run).

| Scenario from the brief | Spec | Result |
|---|---|---|
| 1 First organization (one company, no dropdown, Head Office branch, Free plan, owner works) | `journey` | PASS |
| 2 Second company (no duplicate account, switcher appears, switching reloads) | `organizations` | PASS |
| 3 Owner in A, Manager in B (navigation, billing access and data follow the role) | `organizations` | PASS |
| 4 Create branch (appears, members assignable, no cross-company members) | `branches` | PASS |
| 5 Single branch (no branch filter or field) | `organizations`, `journey` | PASS |
| 6 Branch manager (own branch only; other branch's project URL fails server-side) | `branches` | PASS |
| 7 Super Admin login (dedicated console, no tenant navigation) | `platform` | PASS |
| 8 Super Admin opens company (metadata only, no impersonation) | `platform` | PASS |
| 9 Suspension (reason required, status and audit update, member told, data kept, reactivation) | `platform` | PASS |
| 10 Errors (failed request + retry; expired sessions, unauthorized pages, slow payment confirmation are covered by existing specs) | `branches`, `subscription-and-security`, `journey` | PASS |
| Existing flows: registration, invitations, payments, projects/tasks, mobile | all other specs | PASS |

Also checked (scripted, preview stack):
- **Responsive sweep:** 19 pages (11 workspace + 8 platform) × 5 widths (320, 375, 768, 1024, 1440) =
  **95 page/width combinations, no horizontal overflow, no console errors.**
- **Accessibility:** axe-core on all 19 pages at 1440 px — **0 violations.**
- **Screenshots reviewed** for the overview, branches, branch detail, project form, manager view and every console
  page, on desktop and phone.

## 9. Build and test results

| Check | Result |
|---|---|
| Backend tests (Vitest + Supertest, isolated test DB) | **151 passed / 0 failed** (10 files) |
| Browser e2e (Playwright) | **21 passed / 0 failed** |
| ESLint (backend, frontend, e2e) | 0 problems |
| Production build (`vite build`) | OK |
| Responsive / axe | see §8 |

## 10. Remaining issues

- **Branch lists are not paginated:** companies have few branches; the API returns them all, and search and status
  filters are server-side.
- **No platform "Settings" page:** Stage 1 exposes no platform settings API. Platform admins are managed with the
  CLI (`npm run platform-admin`).
- **The demo super admin `admin@teamflow.test` can't receive the sign-in code by real email.** Create a real admin
  with the CLI, or set `SEED_PLATFORM_ADMIN_EMAIL`. The e2e suite sets a known code in the test database.
- **Managers can read every branch's name and counts** (`BRANCH_VIEW`), but not other branches' projects. This is
  the Stage 1 permission design; remove `BRANCH_VIEW` from the Manager role to restrict it.
- **Safari and Firefox not tested** (only Chrome available).
- **From earlier stages:**
  - Chapa webhook secret;
  - rotate the shared Neon and ngrok credentials;
  - migrate the local `teamflow` database.

# TeamFlow —  Backend Audit

Date: 2026-10-10 · Scope: backend, database, security, business logic (plus the minimum frontend changes the new API
behaviour required) · Source of truth: *Test project for markos.pdf* (sections 01–25, 13 pages).

A requirement is marked **PASS** only when an automated test or a recorded run shows the expected behaviour.
Code existing is not enough.

---

## 1. Root causes of the reported issues

| Issue | Root cause | Fix |
|---|---|---|
| **3 — Invitation link opens "localhost refused to connect"** | Email links are built from `APP_URL`, which was `http://localhost:5173` (confirmed in the startup log). `localhost` is the *recipient's* device, so the link can only work on the developer's computer. The Vite dev server also refused unknown host names, so even a tunnel to the frontend would have been blocked. The link format itself (frontend route, URL-encoded token) was correct, and the API URL was not being used by mistake. | `APP_URL` (frontend) and `API_URL` (API) are documented as separate settings. Trailing slashes are removed. The API refuses to start in production with a localhost `APP_URL`, and in development it logs where email links point plus a warning when that is localhost. `VITE_ALLOWED_HOSTS` lets the dev server answer a tunnel host. README → *Testing from another device* explains the one-tunnel setup (the Vite proxy serves both app and API). Nothing is hard-coded. |
| **3 — Invitation acceptance rules** | Holding the link was enough to attach an **existing** account to an organization. Expired and already-used links got the same generic error. The inviter's name was not stored. | Existing accounts must enter their password or already be signed in as that account. A different signed-in account is refused. Expired and already-accepted links get their own messages. `memberships.invitedById` was added. Activation is conditional, so concurrent acceptances produce one membership. |
| **2 — Payments** | (1) Starting a new checkout marked the older one `CANCELLED`, and settlement ignored any non-`PENDING` payment, so a customer who paid an older or abandoned checkout was **charged without getting the plan**. (2) There was no expiry: an abandoned checkout stayed `PENDING` forever. (3) A network error or 5xx from Chapa while verifying became a 500 error, or was treated as "still pending". (4) Chapa's `cancelled` status was not mapped. | `EXPIRED` state (60-minute checkout window, applied when payments are read or verified). A verified late success on a `CANCELLED`/`EXPIRED` payment is honoured. An unreachable Chapa gives `503 PAYMENT_VERIFICATION_UNAVAILABLE` with nothing changed, and the webhook answers 5xx so Chapa retries. `cancelled` maps to `CANCELLED`. The return page has explicit Expired and Cancelled outcomes. |
| **1 — Organization name / selection** | The data model already supported several organizations per person (`Membership` with a per-organization role), creating a further organization, and switching. Gaps: weak name validation; one person could create two workspaces with the same name; and because the active workspace belongs to the session, a second tab could still show organization A while its requests returned organization B's data. | Name rules (spaces collapsed, must contain a letter or number, no control characters or `<>`, 2–80 characters). One person's workspaces must have distinct names. The SPA sends `X-Workspace-Id`; a mismatch returns `409 WORKSPACE_CHANGED` and the SPA reloads. No name suggestions are drawn from other tenants: no data is explicitly permitted for that, and suggestions would reveal that a tenant exists. The **searchable** switcher is UI work for Phase 2 (§12). |
| **4 — Platform super admin** | A console existed (tenants, plans, revenue), but provisioning was seed-only and platform actions were not audited. | `scripts/platform-admin.js` (`npm run platform-admin -- grant|revoke|list`): command line only, and the account must exist and be verified. Added the `platform_audit_logs` table and `GET /platform/audit-log`. Suspend/reactivate and plan create/update (old and new values) are recorded. |
| **5 — Remote database latency** | On Neon (us-east-2, ~300 ms per round-trip), loading the session context with its nested relations took one query per level. Requests took 16–19 s, close to the 20 s transaction limit. | Prisma `relationJoins` loads nested relations in one SQL query. Measured afterwards on the same database: login 7.0 s, dashboard 7.3 s, create project 5.4 s. The rest is geography (§10). |

> The prompt's Issue 2 text began partway through, at "Do not hard-code tunnel addresses…". Payment requirements were
> taken from the visible part: states, the mock-mode rule, the 17 test scenarios and activation rules.
> **Mock mode is not used.** Chapa test mode is the only runtime provider, so the mock-payment requirements are
> NOT APPLICABLE.

## 2. Backend issues fixed (complete list)

1. A paid but superseded or expired checkout was never activated (lost payment). Fixed with verified late settlement.
2. No `EXPIRED` state, so abandoned checkouts stayed pending forever.
3. Chapa network errors or 5xx while verifying returned 500 instead of a clear, recoverable 503. Webhooks are now
   retried by Chapa.
4. Chapa `cancelled` status was not mapped.
5. An existing account could be attached to an organization by anyone holding its invitation link.
6. A different signed-in account was not refused when accepting someone else's invitation.
7. Expired and already-accepted invitations were indistinguishable from invalid ones.
8. Invitation activation was not conditional (it relied only on token consumption). It is now
   `updateMany … where status = INVITED`.
9. A failed password during acceptance did not count towards the account lockout. It now shares the login
   bookkeeping.
10. Inviter not recorded or shown.
11. Organization-name validation (control characters, markup, whitespace-only and punctuation-only names).
12. Duplicate workspace names for the same person.
13. A stale tab could show organization B's data under organization A's UI (`WORKSPACE_CHANGED`).
14. Email links could silently point to localhost. Production now refuses it, development warns, and trailing
    slashes are normalised.
15. Platform-admin actions were unaudited, and there was no controlled provisioning path.
16. N+1 relation loading on the hot path (`relationJoins`).
17. Earlier in this session: the Prisma transaction timeout was raised for remote databases
    (`TRANSACTION_OPTIONS`, also used by the seed).

## 3. Prisma schema and migrations

Migration `20261010000000_payment_expiry_inviter_platform_audit` is **additive only**: no existing row changes.

| Change | Purpose | Deletion policy |
|---|---|---|
| `PaymentStatus.EXPIRED` | Abandoned checkouts | — |
| `memberships.invitedById` → `memberships.id` | Inviter shown on the accept page | `ON DELETE SET NULL` |
| `platform_audit_logs` (`actorId` → `users.id`, index on `createdAt`) | Platform audit trail | `ON DELETE SET NULL`, so history survives |
| `generator previewFeatures = ["relationJoins"]` | Single-query relation loading | — (no SQL change) |

Rollback notes are in the migration file. A table and column can be dropped. PostgreSQL cannot drop an enum value,
so map `EXPIRED` rows to `CANCELLED` and the unused label is harmless.

Applied to: the test database (by every test run) and the Neon database in `backend/.env`, using
`prisma migrate deploy` over the direct URL. **The local `teamflow` database (which holds the Kabba Transport data
and real Chapa test payments) was not migrated.** Run `npx prisma migrate deploy` against it before using it again.
`prisma db push` was not used.

Model check (Issue 1): `User` is a global identity. `Membership` (unique `(organizationId, userId)`) carries the
**per-organization role** via a composite FK `(roleId, organizationId)`. `Role`/`Permission` are per organization and
global respectively. An invitation is an `INVITED` membership plus an `AuthToken(INVITATION)` tied to that membership,
cascade-deleted with it. `Subscription` is one per organization. No new membership architecture was needed.

## 4. Folder structure changes

```
backend/scripts/platform-admin.js                        new — super-admin provisioning (CLI only)
backend/prisma/migrations/20261010000000_…/              new migration
backend/tests/invitations.test.js                        new (15 tests)
backend/tests/payment-lifecycle.test.js                  new (13)
backend/tests/organizations.test.js                      new (8)
backend/tests/platform.test.js                           new (6)
frontend/e2e/invitation.spec.js                          new (3 browser scenarios)
```
The module layout is unchanged: `auth · organizations · users (memberships, invitations) · roles · projects · tasks ·
subscriptions · payments · activities · dashboard · platform`, each with `*.routes.js` (HTTP + Zod validation) and
`*.service.js` (business rules + persistence). Chapa is isolated in `payments/providers/chapa.provider.js`. Shared
concerns are centralised in `common/middleware` (authenticate, optionalAuthenticate, requireTenant, permissions,
validation, errors), `config/env.js`, `lib/logger.js` and `lib/mailer.js`.

## 5. API contract changes (summary)

All responses use `{ success, data, meta? }` or `{ success: false, error: { code, message, details? } }`.

| Endpoint | Change |
|---|---|
| `GET /auth/invitations/:token` | Adds `inviterName` and `expiresAt`. Errors: `INVITATION_EXPIRED`, `INVITATION_ALREADY_ACCEPTED`, `INVALID_TOKEN` (unknown, withdrawn or replaced). |
| `POST /auth/accept-invitation` | Optional `Authorization`. `password` = new password (new account) or current password (existing account, unless signed in as it). Errors: `422` on the `password` field, `403 INVITATION_WRONG_ACCOUNT`, `429 ACCOUNT_LOCKED`, plus the token errors above. A signed-in invitee's session switches to the joined workspace. |
| Any tenant route | Optional `X-Workspace-Id: <membershipId>`. A mismatch returns `409 WORKSPACE_CHANGED`. |
| `POST /organizations` | Name normalised and validated (422). `409 ORGANIZATION_NAME_IN_USE` for a duplicate among the caller's own workspaces. |
| `GET /payments?status=EXPIRED` | New filter value. Payment `status` can be `EXPIRED`. |
| `POST /payments/:txRef/verify`, webhooks | `503 PAYMENT_VERIFICATION_UNAVAILABLE` when Chapa is unreachable (nothing changed). |
| `GET /platform/audit-log` | New (platform admins only). |

## 6. Payment lifecycle

```
checkout ─► PENDING ──verify/webhook/callback──► Chapa verify API (server-to-server)
              │   success + amount & currency match ─► SUCCEEDED (+ plan activated, activity) — final
              │   failed / amount mismatch           ─► FAILED — final
              │   cancelled at Chapa / by customer / superseded ─► CANCELLED ┐
              │   not completed within 60 min        ─► EXPIRED   ┘ ─ verified success later ─► SUCCEEDED
              └─ Chapa unreachable/5xx ─► 503, unchanged (webhook retried by Chapa)
```

- **Trusted confirmation only:** the browser never reports success. The webhook signature is checked, then Chapa's
  verify API decides. The price comes from the server.
- **Transactional activation:** the payment state change, `PAYMENT_COMPLETED` activity, subscription upsert and
  `SUBSCRIPTION_CHANGED`/`RENEWED` activity happen in one transaction. Each transition is conditional on the status
  that was read, so duplicate or concurrent triggers cause no side effects.
- **No endless loading:** the return page polls up to 10 times, then shows "Still waiting / Check again". Checkouts
  expire after 60 min. An outage shows a clear retry message. Reopening the browser or refreshing re-verifies from the
  stored row (no client state).

## 7. Invitation lifecycle

```
invite (seat check under lock) ─► INVITED membership + hashed 7-day token ─► email: APP_URL/accept-invite?token=…
accept:  token valid? ─ expired → INVITATION_EXPIRED · used → INVITATION_ALREADY_ACCEPTED · unknown/withdrawn/replaced → INVALID_TOKEN
         signed in as another account → INVITATION_WRONG_ACCOUNT
         new person → name + password (account verified) │ existing → password, or signed in as that account
         one transaction: consume token (conditional) + INVITED→ACTIVE (conditional) + MEMBER_JOINED
resend → new token, old link dead, expiry restarts · withdraw → membership and token deleted, seat freed
```
Tokens: 256-bit random, stored as SHA-256, single use, scoped to one user and membership, never logged.
Rate-limited endpoint. Expired and used messages are shown only to the token holder, so nothing can be enumerated.

## 8. Multi-tenant security evidence

All of the following are automated, passing tests:
- **Tenancy:** cross-tenant read/update/delete/archive of projects, tasks, members, roles and payments → 404.
  Cross-tenant task creation and assignment rejected. A smuggled `organizationId` is ignored or rejected. Foreign ids
  used as filters return nothing. Lists, search, dashboard, usage and activity are scoped. The database rejects a
  cross-tenant task even when the API is bypassed (`tenancy.test.js`, 14 tests).
- **Invitations:** a foreign tenant cannot resend or withdraw an invitation, or invite with another tenant's role.
  Acceptance joins only the invited organization (`invitations.test.js`).
- **Payments:** another tenant's `txRef` → 404 for read, verify and cancel (`payment-lifecycle.test.js`).
- **Workspaces:** switching only into the caller's own memberships. Every view follows the active organization.
  Stale tabs get `WORKSPACE_CHANGED` (`organizations.test.js`).
- **RBAC:** 24 tests (`rbac.test.js`). **Platform:** owners have no platform access, and `isPlatformAdmin` cannot be
  set via the API (`platform.test.js`).

## 9. PDF requirement traceability matrix

Legend: M = mandatory, O = optional/suggested. "Test" names the evidence.

| # | Requirement (PDF § / page) | M/O | Implementation | DB | Test evidence | Status |
|---|---|---|---|---|---|---|
| 1 | Multiple independently registered organizations (§02 p2, §04 p3) | M | `organizations` module | `organizations`, `memberships` | auth: register→verify→create; organizations: second org | PASS |
| 2 | Strong tenant isolation (§02, §06 p4–5, §15 p8) | M | `requireTenant`, org-scoped services, composite FKs | composite FKs | tenancy (14), invitations, payment-lifecycle | PASS |
| 3 | User registration (§05 p4) | M | `auth.register` | `users` | auth | PASS |
| 4 | Login / logout (§05) | M | sessions + rotating refresh | `sessions` | auth (rotation, reuse, logout) | PASS |
| 5 | Account verification (§05) | M | email token | `auth_tokens` | auth (verify flow, hashed tokens) | PASS |
| 6 | Password recovery (§05) | M | reset token, sessions revoked | `auth_tokens` | auth (single use, expiry) | PASS |
| 7 | Organization management (§04 p3) | M | `PATCH /organizations/current` | — | rbac (owner manages settings) | PASS |
| 8 | Owner privileges (§04 p3–4, §14 p8) | M | system role OWNER (locked) | `roles` | rbac | PASS |
| 9 | Admin manages users, no owner authority (§14) | M | ADMIN + escalation guard | — | rbac (cannot grant Owner or touch owners) | PASS |
| 10 | Manager: projects + tasks, not subscription (§05, §14) | M | MANAGER role | — | rbac, e2e work.spec | PASS |
| 11 | Employee: assigned work, no billing (§05, §14) | M | EMPLOYEE role | — | rbac, e2e mobile/work | PASS |
| 12 | Owner creates custom roles with permissions (§04 p4) | M | `roles` module | `roles`, `role_permissions` | rbac (Free plan custom role) | PASS |
| 13 | Secure RBAC enforcement (§14, §15) | M | `requirePermission`, DB re-check per request | — | rbac (24) | PASS |
| 14 | Projects: name, description, status, priority, dates, team + person (§10 p6–7) | M | `projects` | `projects`, `project_members` | rbac, tenancy, e2e owner/work | PASS |
| 15 | Task creation and assignment (§11 p7) | M | `tasks` | `tasks` | rbac, tenancy | PASS |
| 16 | Employees update progress (§11) | M | own-task status only | — | rbac (own task only) | PASS |
| 17 | Managers monitor work (§11) | M | dashboard, filters | — | e2e work.spec | PASS |
| 18 | Organization dashboard (§12 p7) | M | `dashboard` | — | tenancy (scoped counts), organizations | PASS |
| 19 | Subscription plans Free/Professional/Business (§07 p5) | M | DB plans | `subscription_plans` | subscription | PASS |
| 20 | Functional user/project limits + upgrade message (§08 p5–6) | M | `entitlement.service` (locked) | — | subscription (exact message, concurrency) | PASS |
| 21 | Payment initiation and confirmation (§09 p6) | M | Chapa test mode | `payments` | subscription, chapa-webhook, payment-lifecycle (13) | PASS |
| 22 | Subscription activation → new limits (§09) | M | `activatePaidPlan` in confirmation tx | `subscriptions` | subscription, payment-lifecycle | PASS |
| 23 | Activity / audit history (§13 p7–8) | M | `activity_logs` in same tx | `activity_logs` | rbac, subscription, invitations | PASS |
| 24 | Basic application security (§15, §18.4) | M | helmet, rate limits, Zod strict, hashed tokens, lockout | — | auth, rbac, tenancy | PASS |
| 25 | Platform super admin = system owner (§22 p12) | M | `platform` module + CLI provisioning + audit | `platform_audit_logs` | platform (6), e2e platform | PASS |
| 26 | Demo accounts (owner, admin, manager, employee, super admin) + sample data (§22) | M | `prisma/seed.js` | — | e2e suite runs on seeded data | PASS |
| 27 | GitHub-ready repo + README (§22) | M | README, ARCHITECTURE, `.gitignore` | — | history checked: no `.env`/keys in any commit | PASS for the pushed state (`origin/main` = `a2a1cb5`). This phase's changes are not committed yet. |
| 28 | Not dependent on manual DB changes (§20 p11) | M | migrations + reference-data bootstrap | — | tests apply migrations to a fresh DB | PASS |
| 29 | UI: clean, responsive, loading/empty/error states (§16 p9, §18.7) | M | frontend | — | e2e desktop + phone (13) | PASS for the flows covered. Full UI review is Phase 2. |
| 30 | Searchable organization switcher (prompt, Issue 1) | O | menu switcher (not searchable) | — | — | PARTIAL — Phase 2 |
| 31 | Search, filtering, timeline, reports (§21 p11) | O | search, filters, timelines, CSV export (Business) | — | tenancy, subscription | PASS (where built) |
| 32 | Mock payment mode (prompt Issue 2) | O | not used — real Chapa test mode | — | — | NOT APPLICABLE |

## 10. Automated test results

| Suite | Result |
|---|---|
| Backend (Vitest + Supertest, real PostgreSQL `teamflow_test`) | **117 passed / 0 failed** (9 files: auth 11, chapa-webhook 11, invitations 15, organizations 8, payment-lifecycle 13, platform 6, rbac 24, subscription 15, tenancy 14). The full suite ran twice: before and after the new tests. |
| End-to-end (Playwright, isolated stack, desktop + phone) | **13 passed / 0 failed**, including 3 new invitation scenarios (new person on a phone in a separate session, existing account with password, wrong signed-in account) |
| Static checks | ESLint (no-undef, unused vars, hooks rules): 0 problems. `prisma validate`: valid. Frontend production build: OK. |
| Migrations | `migrate deploy` on the test DB (every run) and on Neon: applied cleanly |

Payment scenarios from the prompt → evidence: 1 upgrade ✔ · 2 failed ✔ · 3 cancelled ✔ · 4 expired ✔ · 5 duplicate
webhook ✔ · 6 invalid signature ✔ · 7 repeated confirmation ✔ · 8 network failure ✔ · 9 refresh during processing ✔
(re-verify from stored state) · 10 close/reopen browser ✔ (listing expires or settles from the DB) · 11 delayed success ✔
· 12 cross-tenant reference ✔ · 13 downgrade/plan change ✔ (cancel at period end, below-usage refusal) · 14
entitlement change ✔ · 15 no activation before verification ✔ · 16 duplicate txRef ✔ · 17 server restart ✔
(settlement is stateless).

Invitation scenarios → 1–13 ✔ automated. 14 (mobile browser) ✔ phone viewport in a separate browser context.
15 (redirects keep the invitation context): the accept page needs no login redirect, and after acceptance the login
page is pre-filled with the invited email ✔.

## 11. Untested external dependencies (NOT TESTED in this phase)

| Item | Blocker |
|---|---|
| Real Chapa **webhook** delivery to this API | The Chapa dashboard "Secret hash" does not match `CHAPA_WEBHOOK_SECRET`, so real webhooks get 401. The owner must set the same value in the dashboard. (A real test-mode payment was verified earlier through the verify/callback path.) |
| Real invitation email opened on **another physical device** | Needs a public `APP_URL` (tunnel or deployment) set by the owner. The link format and acceptance are covered by tests. |
| Real SMTP delivery in this phase | Not re-sent in this phase. Gmail SMTP was verified working on 2026-10-08. |
| Production-grade latency | Local machine to Neon us-east-2 is ~300 ms per query. Host the API in or near the database region, or use local PostgreSQL for development. |

## 12. Handoff to Phase 2 (frontend)

- Searchable organization switcher. The backend already provides `me.memberships` (only the caller's active
  memberships) and `POST /auth/switch-workspace`.
- An entry point to "Create another organization" for existing users (`POST /organizations` already works).
- Optional: show "invitation expired" and the inviter on the team list.

## 13. Environment configuration

`backend/.env` (template: `backend/.env.example`):

```
DATABASE_URL=…            # app DB (Neon pooled URL, or local PostgreSQL)
TEST_DATABASE_URL=…       # separate DB that tests wipe — must never be the app DB (enforced)
APP_URL=…                 # FRONTEND URL used in every email link — must open on the recipient's device
API_URL=…                 # API URL reachable by Chapa (may equal APP_URL behind the Vite proxy)
CORS_ORIGINS=…            # only needed when frontend and API are on different origins
JWT_ACCESS_SECRET=…       # ≥ 32 random characters
CHAPA_SECRET_KEY=CHASECK_TEST-…   CHAPA_WEBHOOK_SECRET=… (same as the dashboard Secret hash)
SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS
```
`frontend/.env.local` (dev only): `VITE_ALLOWED_HOSTS=<tunnel host>` when testing from another device.
Migrations on Neon: use the **direct** URL (host without `-pooler`) with `npx prisma migrate deploy`.
Super admin: `cd backend && npm run platform-admin -- grant <email>`.

## 14. Manual verification required

1. Set the Chapa dashboard Secret hash to equal `CHAPA_WEBHOOK_SECRET`, then make one test payment and confirm the
   webhook returns 200 in the API log.
2. Follow README → *Testing from another device*, send an invitation, and accept it on a phone on mobile data.
3. Run `npx prisma migrate deploy` against the local `teamflow` database before switching back to it.
4. Commit and push this phase's changes when ready. The current history is clean: no `.env` in any commit, and the
   old `frontend/dist.zip` (deleted in `26a2cda`) contains only `.env.example`. Rotate the Neon password and the
   ngrok token, both of which were shared in chat.

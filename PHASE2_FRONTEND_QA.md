# TeamFlow — Phase 2 Frontend & End-to-End QA

Date: 2026-10-10 · Scope: React frontend, UX, loading system, invitation and payment experiences, responsive and
accessibility checks, and full end-to-end QA against the assessment PDF and `PHASE1_BACKEND_AUDIT.md`.

Results below come from tests and scripted checks that were actually run in this phase. Nothing is reported as
passing without a run behind it.

---

## 1. Starting point and design decision

The existing frontend was inspected page by page (34 screenshots, desktop + phone, every role) before any change.
It already followed the brief's design vision:

- compact navy sidebar with a yellow active marker;
- 13 px base text, 6–8 px radii, restrained shadows;
- tables rather than card walls, colour + icon + label status badges;
- centralised design tokens in `src/styles/index.css` (navy `#14295c`, yellow `#f5b700`, semantic colours).

**Decision:** keep the brand and layout, and fix the specific gaps instead of redesigning. A redesign would add risk
without improving the product, which the PDF warns against in §20 ("unnecessarily complicated") and §25 ("simple,
clean").

## 2. What changed

| Area | Change | Files |
|---|---|---|
| **Organization switcher** (Task 1) | Replaced the plain menu with a searchable combobox. Shows initials tile, name, chevron; search; your organizations only, each with your role; checkmark on the current one; "Create organization". Keyboard: ↑/↓/Home/End/Enter, Esc returns focus to the trigger. Closes on outside click and when focus leaves. Spinner while switching; empty search result message; phone-width panel. Switching clears every cached query and refreshes permissions and plan. | `features/organizations/OrganizationSwitcher.jsx` (new), `app/layouts/Topbar.jsx` |
| **Create organization** (Task 1) | Compact dialog for signed-in users, using the same name rules as the API (`rules.organizationName`). "Name already used by you" shown on the field. No directory of other companies: the backend offers no permitted suggestion source, and suggesting names would reveal which tenants exist. | `features/organizations/CreateOrganizationDialog.jsx` (new), `lib/forms.js`, `features/auth/OnboardingPage.jsx` |
| **Invitations — owner side** (Task 2) | Invite dialog shows a review line: "x will join <Org> as <Role>. The link is valid for 7 days." The team list shows **Invite pending** (tooltip with expiry) or **Invite expired** with an inline **Resend**. The Joined column shows "Invite until <date>". The list refreshes after a resend (bug fix). The phone row puts the status under the name. | `features/team/MemberModals.jsx`, `TeamPage.jsx`, `team/api.js`, `lib/status.js`; backend `member.service.js` (adds `invitation: { expiresAt, expired }`) |
| **Invitations — invitee side** (Task 2) | "You're invited to join <Org>" with a summary (Organization · Invited by · Role · Invitation for). Dedicated screens: expired, already accepted, invalid / withdrawn, wrong signed-in account (with Sign out), **network failure with Try again**. No raw errors are shown. | `features/auth/AcceptInvitePage.jsx` |
| **Payment verification** (Task 3) | Rewritten return page: "Verifying your payment…" with a restrained brand ring around a shield (never a checkmark before confirmation). Bounded re-checks (2, 2, 3, 3, 5, 5, 8, 10 s ≈ 40 s). Stops on success, failure, cancellation or expiry. A provider outage (503) or network error during the checks is treated as "not known yet", never as failure. The timeout shows "Your payment is still being confirmed. Please check your payment status." with **Check status**. Success shows a receipt (plan, amount, confirmed time, reference) and refreshes plan, limits, billing, dashboard and activity. A refresh re-reads the server. | `features/billing/PaymentReturnPage.jsx` |
| **Loading system** (Task 4) | One set of primitives:<br>• `.tf-progress` — thin navy bar with a yellow lead, used on the splash screen;<br>• `.tf-skeleton` — soft shimmer for all skeletons;<br>• brand-coloured `Spinner`;<br>• buttons keep their size while loading (existing).<br>Splash shows the compact brand mark, progress bar and "Loading your workspace…". The dashboard skeleton mirrors the real layout (5 metric tiles, project rows, side panels). Reduced motion turns animations into static tints. | `styles/index.css`, `components/ui/Misc.jsx`, `components/feedback/PageLoader.jsx`, `features/dashboard/DashboardPage.jsx` |
| **Space efficiency** (Task 6) | The dashboard's empty "My Work" card (a tall block) became a one-line notice. Team phone rows no longer squeeze names. | `DashboardPage.jsx`, `TeamPage.jsx` |
| **Accessibility** | The switcher's accessible name now starts with its visible text (axe `label-content-name-mismatch` fixed on every page). | `OrganizationSwitcher.jsx` |
| **Demo data** | The seeded pending invitation now has an inviter and a live (hashed, unusable) link, so it shows as *pending* instead of *expired*. | `backend/prisma/seed.js` |

Unchanged on purpose: sidebar groups and collapse, page headers, tables, filters in the URL, task drawer, review
step before payment, roles editor. They already met Tasks 5–7.

## 3. Bugs found and fixed in this phase

1. Resending an invitation did not refresh the team list, so its status stayed stale until a reload.
2. Phone layout: an expired invitation's badge squeezed the member's name to one letter at 320 px.
3. axe "serious" issue on every page: the switcher's spoken name didn't match its visible text.
4. Demo data: the seeded pending invitation had no link, so it always looked expired.
5. Existing e2e checks that relied on timing, now fixed: a platform-plans assertion ran before the page replaced
   the organizations table; a toast-based assertion was replaced by the lasting result.

## 4. Test results

| Check | Tool | Result |
|---|---|---|
| Backend integration tests (real PostgreSQL test DB) | Vitest + Supertest | **118 passed / 0 failed**, 9 files (adds the invitation-status listing test) |
| Browser end-to-end (isolated stack: API on test DB, fake Chapa, Vite) | Playwright, Chrome | **16 passed / 0 failed** — final full run. Earlier runs in this phase had failures in new or changed specs (selectors, timing, test interference); each was diagnosed and fixed, then the full suite re-run. |
| Accessibility | axe-core 4.x, 21 pages and states (login, register, 9 workspace pages, switcher open, invite dialog, payment return, accept page on phone, 4 platform pages) | **0 violations** after fix (11 before, all the same switcher issue) |
| Responsive | Scripted sweep, 4 roles × pages × 320 / 375 / 768 / 1440 px (68 screenshots) | **No horizontal overflow, no console errors**; screenshots reviewed |
| Static | ESLint (no-undef, unused vars, hooks rules), Vite production build, `prisma validate` | Clean / built / valid |

### End-to-end scenarios (all passing)

1. **Full journey — the brief's final acceptance rule:**
   - register a new owner → verify by email link → create the organization;
   - invite with review → member accepts on a phone → role changed Employee → Manager;
   - create a project and a task assigned to the member → member completes it → owner's dashboard shows 100%;
   - the Free member limit is reached and explained;
   - upgrade, but come back before paying: "Verifying…" → "still being confirmed" (plan unchanged);
   - payment completes at Chapa → **Check status** → Professional, with the real reference in the receipt → limit
     lifted;
   - the activity history records organization, invitation, project, completion and plan change;
   - **another company's owner cannot see the project, not even by URL.**
2. New person accepts an invitation on a phone in a separate session, signs in, lands in the right organization;
   the link then shows "already accepted".
3. Existing account must enter its password (wrong password refused).
4. Signed in as someone else → refused, with Sign out offered.
5. Expired invitation flagged in the team list → Resend → back to pending.
6. Organization switcher: focus, Esc, create (invalid name rejected), no-match search, keyboard selection, data kept
   apart.
7. Owner end to end (project with lead, task, team, invite, custom role, activity, upgrade to Business).
8. Plan limit: declined payment changes nothing, successful payment lifts the limit.
9. Employee blocked from protected pages and from another tenant's project.
10. Sign-in redirect back to the requested page.
11. Wrong-password message.
12. Platform admin: tenants and plans.
13. Manager plans and monitors work.
14. Employee completes their work.
15. Employee workflow on a phone.
16. All owner pages fit a phone screen.

## 5. What could not be tested here (NOT TESTED)

| Item | Why | What covers it instead |
|---|---|---|
| Opening a real invitation email on a different physical device | Needs a public `APP_URL` (tunnel or deployment), set by the owner | Separate phone-sized browser session in e2e; email link format in backend tests. README → *Testing from another device* |
| Real Chapa hosted checkout and webhook in this phase | Live test-mode checkout needs a person to complete it; webhooks need the dashboard Secret hash to match `CHAPA_WEBHOOK_SECRET` | Fake Chapa server with the same API; a real test-mode payment was verified on 2026-10-08 |
| Real SMTP delivery in this phase | Not re-sent in this phase | Gmail SMTP verified on 2026-10-08; tests use an in-memory outbox |
| Safari / Firefox engines | Only Chrome is installed for Playwright here | Standards-based CSS; no engine-specific APIs |

## 6. Remaining configuration

- `APP_URL` must be a URL the recipient can open (tunnel or deployment) for invitation links to work on other
  devices.
- The Chapa dashboard Secret hash must equal `CHAPA_WEBHOOK_SECRET`.
- Rotate the Neon password and ngrok token that were shared in chat.
- Migrate the local `teamflow` database before switching back to it.

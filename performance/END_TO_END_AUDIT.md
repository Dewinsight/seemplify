# Performance management end-to-end audit

## Remediation verification — 27 September 2026

The 26 September findings below are historical reproduction evidence. The confirmed defects are addressed on `fix/performance-acceptance-remediation`; this is a review candidate, not production certification. Do not merge or deploy automatically.

### Implemented

- Performance-specific least-privilege employee grants; explicit team cycle-create/manage grants for managers/leads; explicit cycle and analytics endpoint gates. Other product defaults, custom roles and explicit overrides/denies are preserved.
- Transactional IdP schema-4 migration updates inherited Performance defaults and account authorization revisions. Performance refreshes retired schema-3 sessions and rejects failed/still-retired refreshes rather than using old elevated grants. OIDC client IDs, callbacks, proxy and cookies unchanged. Historical IDP protection rules were recovered from Git and read before auth edits.
- Partial unique indexes for populated goal assignment and check-in idempotency keys. Ordinary multiple goals/check-ins no longer collide on a missing key. A dry-run/apply migration builds replacements before removing legacy sparse indexes, and stops on populated-key duplicates.
- Live bearer-authenticated IdP member/team roster for appraisal selection and colleague search; users do not need a prior Performance login. Profile-only local projection supports existing downstream references. No-team employees stay visible and unselectable with the existing reason. Upstream failure is an explicit retryable error, not a stale/empty authorization fallback. Manager/team-lead scope remains derived from IdP claims.
- Mobile cycle sections collapse; Previous/Continue remain at the bottom with 44px touch controls and safe-area padding. Roster errors have Retry and validation errors receive focus. Desktop editing stays expanded.
- Discussion editing and final review use server-supplied viewer capabilities. Managers acting as employees can acknowledge their own finalized outcome. Discussion dates round-trip in the local timezone. Final rating explanation and ten-character override reason refer to calculated evidence, not AI.
- Earlier Recognition recipient/error/mobile-tab fixes, 1:1 compose-entry fix, accessible question labels and their regression tests are included.
- PR-only Performance acceptance workflow runs backend, IdP contracts, typecheck, build and browser regressions without any deployment job; production QA installs IdP dependencies for cross-service contracts.

### Verification evidence

- Full backend suite passed: 102 legacy + 37 unit + 53 integration, then 3 additional stale-policy tests passed independently. Total covered: **195 tests**. Integration includes real initialized indexes and dry-run/apply migration replay, not only collections with dropped indexes.
- **29 IdP tests passed** (access-control, auth redirects, recovery).
- **41 Playwright UI regressions passed**, including ownership-aware acknowledgement, evidence override reason, 390px section disclosure/navigation, Recognition contract and 1:1 scheduling entry. These are mocked-API regressions, not live integration.
- **69 real OIDC/API acceptance checks passed**, including ten role logins, peer denial, staff cycle/analytics denial, repeated goal creation, authorized manager decision, standard/calibrated appraisals, final acknowledgement, persistence and other-tenant rejection.
- **18 follow-up checks passed**, including second goal approval, team-lead assignment -> staff acknowledgement, support plan manager -> HR -> staff handoff, actual browser employee assessment -> manager review -> discussion -> HR finalization -> staff acknowledgement, mobile Recognition and scheduling.
- Additional live roster/mobile check passed: a newly created IdP employee who had never logged into Performance was selectable; Dan without a team was shown disabled; revoking Performance assignment removed the new employee from the next live roster; mobile sections expanded/collapsed without horizontal overflow.
- TypeScript, edited-file diagnostics and whitespace checks passed. Production-mode Next build passed in a sanitized temporary source snapshot with offline Google-font fixtures; this proves application compilation, not external font availability or visual font fidelity.
- Earlier reruns interrupted by a stalled Next dev server are not counted as passes. The clean rerun was performed after restarting the local frontend. External AI/email/calendar/storage/presence remain isolated; there is no production or all-device sign-off.

### Required rollout steps (not executed against production)

1. Review PR and authorization policy changes. Back up policy/index metadata and use the normal tested-release process. The IdP must support transactions (replica set); schema migration is atomic and retry-safe.
2. Pause goal/check-in writers for the index migration. Set the appropriate environment's protected `MONGO_URI` and run `node scripts/migrateGoalIdempotencyIndexes.js` from `performance/backend` to inspect the dry run. Resolve any populated-key duplicates; run the same command with `--apply`. Do not use `syncIndexes` or drop unrelated indexes.
3. Release the IdP schema-4 policy and Performance API together; allow authorization resolution to migrate stored default policy. Old Performance schema-3 sessions must refresh or sign in again. Review explicit role/member overrides intentionally retained by migration.
4. Run real role-denial and manager/lead/HR positive acceptance against the exact release revision, including ordinary multi-goal creation and never-logged-in roster. Verify API startup/index logs and authenticated browser handoffs. No merge/deploy is part of this task.

### Still outside this verification scope

Real provider accounts, email/digest delivery, calendar invitations, file storage, Learning synchronization, all secondary-module CRUD, Safari/device hardware, load/concurrency and usability studies with first-time users are not claimed passed. These are integration/acceptance gaps, not silently closed findings. The PR describes them explicitly.

---

## Intended journey

1. Employees and managers maintain targets as OKRs throughout the performance period.
2. HR or a line manager opens a review cycle and chooses employees who have a valid reporting manager.
3. The employee completes an AI-guided reflection. The assistant asks for target outcomes, evidence, achievements, challenges, learning, and future goals, then produces an editable self-assessment draft.
4. The line manager reviews the employee submission. AI provides evidence prompts, rating assistance, and a bias check, but the manager owns the submitted rating and narrative.
5. Employee and manager hold a performance discussion and record agreed strengths, improvements, development actions, support, and next steps.
6. The rating is calibrated when the cycle requires it, then the final outcome is confirmed.
7. The employee reviews and acknowledges the final outcome.

## Findings

- Cycle creation had two competing models: a legacy draft-and-launch dialog and a newer create-and-launch form.
- `/admin/appraisal-cycles/new` was not a real page. It entered the dynamic cycle-detail route and redirected a second time to `/new/edit`.
- Creating a cycle exposed cycle metadata, eight phase dates, participants, rating weights, and four feature switches at once.
- The role of AI was described after the fact rather than within the workflow where employees and managers make decisions.
- Manager submission skipped the performance discussion and moved directly to calibration or final review.
- Completing a discussion in a calibration-enabled cycle produced a status that calibration did not accept, leaving the appraisal unable to continue.
- The main appraisal list did not show Discussion as a workflow step and offered no discussion action.
- Final employee acknowledgement was only offered for an intermediate discussion status, even though finalisation changed the appraisal to `completed`.
- The application has substantial pre-existing lint debt, so a clean production build is currently the reliable frontend release gate.

## Changes made

- Established one canonical workflow transition service and covered it with Node tests.
- Manager submission now always opens the performance-discussion stage.
- Completing the discussion now moves to calibration when enabled, otherwise directly to final review.
- Final acknowledgement is reachable after the appraisal is completed.
- Added Discussion to appraisal progress and action controls.
- Added a real static cycle-creation route.
- Replaced the all-at-once creation screen with three steps: Review period, People, Confirm.
- Kept phase dates and scope controls available when editing an existing cycle, without making them prerequisites for starting a new one.
- Explained the employee, AI, line-manager, discussion, calibration, and finalisation responsibilities before launch.

## Verification

- Backend state-machine tests cover calibrated and non-calibrated journeys plus employee/manager action ownership.
- Backend route and workflow-service syntax checks pass.
- The Next.js production build passes and includes the new static `/admin/appraisal-cycles/new` route.

---

## Acceptance audit — 26 September 2026

### Decision: BLOCKED for release sign-off

The historical verification above is not a current release certificate. This audit found reproducible authorization and goal-creation defects despite passing existing regressions. No production deployment was performed and no production data was used.

**Environment:** localhost IdP 4000, Performance API 5004, Next frontend 5005; isolated Mongo replica at 27028 with `performance_local_identity` and `performance_local_db`. Outbound integrations and notification workers were disabled. Synthetic identities included organization owner, organization admin, separate HR manager, line manager, team lead, ordinary staff, staff without a manager, and an owner of a second tenant. Login used real OIDC; lifecycle requests used the resulting sessions, not injected roles.

**Revision:** application baseline `2d8c935ee58c4703b684e3d04296d16106326308` plus the local UI changes listed below. Main was subsequently fast-forwarded to `390d75c6fa0adcbdf24275d9831b7aa970a7e220`; that update only adds the repository malware-scan workflow and does not change Performance or the IdP permission catalogue. Local fixes are not committed or deployed.

### What was actually exercised

- **Existing backend suites:** 76 legacy + 37 unit + 51 integration = **164 passed**, no failed/skipped tests. Integration tests use synthetic sessions and memory Mongo; they are not OIDC E2E.
- **Mocked browser regressions:** **39 passed** after fixes (2.7 minutes), then **3 focused regressions passed** after strengthening the accessible-name assertion. These use intercepted API responses and fallback fonts in the isolated runner; they are not live-integration evidence.
- **Frontend TypeScript:** zero errors after all current UI edits. Edited-file IDE diagnostics and `git diff --check` also passed. A production build was not run in this audit.
- **Real OIDC/API run:** 10 identities authenticated with expected displayed roles. Standard and calibrated appraisal paths both reached `employee_acknowledged`, with persisted rating and audit entries. Tested custom required questions, draft save/readback, employee/manager ownership, other-tenant 404s, and peer appraisal 403s. First run recorded 65 successful checks and 4 unexpected outcomes; follow-up diagnosis below supersedes any interpretation of those as four independent defects.
- **Real browser controls:** HR completed the four-step create-and-launch wizard with Ada selected. On a separate API-created synthetic cycle, staff filled the real assessment form, saved and reloaded the draft, submitted, manager navigated all review steps and submitted, manager recorded discussion, HR finalized, and staff acknowledged on a 390px mobile viewport. These five handoffs plus scheduling entry and inline recognition error checks all passed (**7 checks**). The finalization path used manual assessment with AI disabled.
- **Real support-plan API handoff:** manager draft -> HR review -> HR approval -> employee acknowledgement -> employee progress check-in (40%) read back by manager. Staff HR-decision attempt rejected with 403.
- **Real mobile Recognition UI:** search -> select -> send -> recipient Received tab -> acknowledge -> reload verified after the fix.
- **Team lead:** real OIDC role and hierarchy-scoped roster verified (Eli visible, Ada outside that team's roster). Assignment/acknowledgement could not complete because of the duplicate-goal index failure. This flow is NOT signed off.
- **Staff route smoke:** OKRs, Appraisals, Feedback, 1:1s, Check-ins, Development, Recognition, Support Plans, Project Feedback rendered. This is navigation/render coverage, NOT full CRUD coverage for those modules.

### Open findings and remediation sequence

#### P0 — Staff can approve another employee's goal

**Reproduction:** sign in separately as Ada and Ben (both `employee`); Ada creates and submits a goal; Ben posts an approve decision. Expected 403; actual 200 with persisted approval. Marcus's subsequent legitimate decision returns 409 because the peer already approved it. This secondary 409 is a consequence, not a separate manager bug.

**Cause:** `Identityprovider/src/config/accessControlCatalog.js:457-499` grants staff every delegable Performance permission except five exclusions. It includes `okr:decide:all`, `okr:edit:all`, and `goal:assign:all`. `performance/backend/middleware/rbac.js:343-359` treats the signed permission matrix as authoritative; `performance/backend/services/goalPermissionService.js:187-197` correctly follows the overly broad `okr:decide:all` grant. The existing integration sessions omit this real permission matrix.

**Remediation:** identity/access-control owner defines explicit least-privilege employee grants (self-service), report-scoped manager/lead grants, and organization-wide HR/admin grants. Review existing stored global/organization policies and refresh claims after migration; changing only catalogue defaults may not update persisted policies. Preserve legitimate explicit delegated access. Add contract tests consuming the real IdP-generated matrix plus real OIDC negative tests for goal read/edit/assign/approve/check-in. Do not add an unrelated local authorization authority or disable auth.

**Exit criteria:** staff cannot approve/edit/assign peers' individual goals; direct-report manager/lead can perform intended actions; HR/admin retain organization access; overrides/denies and cross-tenant behavior covered. Requires protected IdP change verification; the referenced root `IDP-CRITICAL-RULES.md` was unavailable during this audit, so no IdP policy code was changed.

#### P0 — Staff can create appraisal cycles without cycle-create permission

**Reproduction:** Ada posts a valid cycle name and period to `/api/appraisals/cycles`. Expected 403; actual **201**, persisted draft `6ab7c5d058e8c7d50fc94532`. An earlier invalid-payload probe returned 400, which alone was not sufficient evidence; the valid probe confirmed the bypass.

**Cause:** cycle creation uses generic `requireManager`; that guard accepts analytics or review permissions. Real staff claims contain those permissions. The route's team-scope restriction only applies when the effective role is an appraiser other than HR, leaving the effective `employee` role unrestricted after the permissive guard.

**Remediation:** enforce an explicit cycle-creation authorization rule consistent with the intended HR/manager/team-lead product contract, then validate target scope for every non-HR caller. Do not infer cycle-write privileges from analytics-read access. Test matrix/role conflicts and valid payloads, not only invalid-body rejection.

**Exit criteria:** unprivileged staff receives 403 before validation/writes; permitted manager/lead can launch only for assigned scope; HR/admin launch works. No cycle appears after a rejected request.

#### P1 — Second ordinary goal fails due to compound sparse unique index

**Reproduction:** with one normal goal already in Northwind Labs, Ada creates another (no idempotency key). Actual 500: `E11000` on `organizationId_1_assignment.idempotencyKey_1`, null key. Team-lead assignment without a key fails the same way.

**Cause:** `performance/backend/models/OKR.js:204-207` declares a compound `{ organizationId, assignment.idempotencyKey }` unique sparse index. Since organizationId is always present, missing keys still collide within that organization.

**Remediation:** data/backend owner replaces it with an explicitly named partial unique index restricted to valid populated idempotency keys. Prepare a controlled migration for the existing index (model changes alone do not replace it), inspect existing populated-key duplicates, and preserve idempotent replay semantics. Do not drop the production index blindly.

**Exit criteria:** multiple employees can create multiple unkeyed goals in one tenant; identical populated key replays safely; different keys and cross-tenant keys work; manager and team-lead assignment/acknowledgement pass. Add integration coverage that awaits real index creation, not a fresh database with dropped indexes.

#### P1 — Participant roster depends on local login sync and excludes no-team staff

**Observed:** before staff login, HR saw HTTP 200 with zero employees even though IdP had accounts and a reporting team. The local database held only Hannah. After real role logins, eligible staff appeared. Dan (staff without a team/manager) remained omitted, contrary to the wizard's explanation that unavailable people remain visible.

**Source:** `performance/backend/services/appraisalAccessService.js:191-245` reads locally synced users then drops users without matching teams. User search similarly relies on local team/membership mirrors.

**Remediation:** implement/reconcile the IdP-backed roster projection for newly onboarded people without requiring first app login; indicate sync/loading/error states separately from no results; show ineligible no-manager people with a reason and an appropriate link to fix reporting structure. Keep IdP as membership authority.

**Exit criteria:** new staff are discoverable before their first Performance login, no-manager people are shown disabled, and removed/inactive/cross-tenant users remain inaccessible. Production webhook provisioning was not tested here, so the before-first-login observation includes a local integration limitation.

#### P2 — Mobile cycle designer requires excessive scrolling

**Observed:** at 390 x 844, review-design document height was 5,294px, no horizontal document overflow, and Continue/Previous were only at the top. The primary buttons measured about 42.5px high.

**Remediation:** UX/frontend owner uses collapsed section summaries, progressive disclosure for advanced settings, a visible validation summary with focus on the first error, and reachable bottom/sticky navigation respecting safe areas and keyboard. Target at least 44px controls. Preserve full desktop editing capabilities.

**Exit criteria:** completing or validating the last question does not require scrolling through five screens to continue; all controls work at 320/390/768px and keyboard/200% text zoom.

#### P2 — Analytics guard and role navigation disagree

Staff `/analytics/performance` returned 200 instead of the documented manager/HR restriction. A Ben probe returned zero participants, and source filtering limits non-HR to self/direct reports; organization-wide appraisal data exposure was NOT demonstrated. Address the generic guard and real claim defaults with the P0 authorization work; decide whether a distinct personal analytics endpoint is intended.

#### P2 — Final-rating and secondary workflow UX still need review

Source observation (not fully runtime-tested): final-review justification copy refers to overriding AI, but the server can require a 10-character justification when overriding the calculated evidence rating even with AI disabled. Use evidence-based wording and identical client/server validation. Retest manager-as-employee acknowledgement and discussion editability by action ownership, not merely manager status. Export, feedback anonymity, learning sync, and talent workflows still require real UI/API acceptance beyond current mocks/integration coverage.

### Local fixes applied and verified

1. **Recognition contract:** map search result `id` to request `recipient.userId`. The old UI produced 400 despite a selected recipient. Real mobile send/receive/acknowledge/reload now works. Mock search data now matches the actual API shape and the test asserts recipient.userId.
2. **Recognition error placement:** render submission error inside the modal while open. A real self-recognition rejection is now visible in the dialog. Preserve the draft on failure.
3. **Recognition mobile tabs:** use scrollable tabs with mobile scroll controls instead of clipping the trailing tab (300px available versus 335px content at 390px viewport).
4. **1:1 creation entry:** `/one-on-ones/new` sets `compose=true`; the list opens scheduling even without a preselected employee. Real mobile dialog verified; regression added.
5. **Cycle question accessibility:** associate visible prompts with text, numeric, rating, choice and checkbox controls. Real text-question labels now work for accessible-name automation; self-assessment persistence and submission passed. The regression locates by question name rather than placeholder.

### Remaining acceptance work / explicit exclusions

- Real AI routing, account consent, streaming, quota and provider failure behavior; no external account was connected.
- Outbound email, notification worker delivery/retry/digests, calendar invitations, attachments/storage, learning integrations, presence: disabled/unavailable locally, not passed.
- Real full CRUD for feedback/360 anonymity, recurring 1:1s, development plans, project feedback, talent/succession, calibration-group operations and report downloads. Existing lower-level or mocked coverage is not equivalent.
- Safari/iOS/Android hardware, offline/reconnect, concurrent edits, expired-session recovery during unsaved work, accessibility tree/keyboard for every dialog, timezone/DST, realistic load.
- Team-lead assignment and clean repeatable multi-goal workflow after index remediation.
- No claim that the application has zero bugs. No production or authenticated live-deployment smoke was performed.

### Repeatable evidence

Local evidence and scripts live under the ignored `performance/backend/node_modules/.performance-local/` directory. They deliberately use synthetic accounts and fixed local databases; never point them at production. Successful test submissions are retained for browser inspection. The local runners are diagnostic scripts, not yet a committed CI gate.

- `regression-results-20260926.txt`: backend and baseline TypeScript commands/counts and original Next lock failure.
- `real-acceptance.cjs` / `real-acceptance-results.json`: 10 OIDC identities, two API appraisal lifecycles, negatives and staff route smoke.
- `followup-acceptance.cjs` / `followup-acceptance-results.json`: confirmed valid staff cycle creation, real permission matrix, second-goal failure, support-plan API handoff, recognition UI.
- `verify-browser-lifecycle.cjs` / `browser-lifecycle-results.json`: five actual form handoffs plus scheduling and modal-error verification (7 passed).
- `verify-cycle-launch.cjs` / `cycle-launch-results.json`: actual four-step HR browser launch passed; tested separately from the downstream API-created cycle.
- `run-ui-regression.cjs`: copies tracked frontend files without `.env` into a temporary project, shares installed dependencies, and runs Playwright on port 5015 without stopping the interactive app on 5005. Local guard output goes to stderr so it does not corrupt Next's TypeScript JSON subprocess output.
- `ui-regression-output.txt`: latest isolated run; full run 39 passed and latest focused rerun 3 passed. Earlier full console evidence is retained by the terminal session.

**Remediation order:** P0 permission policy and endpoint guards -> P1 index migration and repeated-goal acceptance -> roster synchronization/ineligibility -> verified UI patch promotion -> long-form mobile UX and the outstanding integration/browser matrix. Before production approval, rerun real OIDC roles and all negative cases against the exact candidate revision, then run an authenticated deployment smoke. Do not substitute the current green unit/mock suites for this gate.

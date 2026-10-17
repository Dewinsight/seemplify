# Appraisal initiation review

Reviewed 17 October 2026 against source revision `22b75aba7f8e59cd03ba9a98a34aa21cf4433ea1` and the signed-in production interface.

## Assessment

Starting an appraisal is unnecessarily difficult. The main problems are the missing manager entry point, the requirement to configure an entire review design before choosing staff, and participant eligibility failures with no useful recovery action.

Both HR and managers already have server routes for starting appraisals. The product presents this capability primarily as an administration task called cycle management. A manager trying to review a member of staff is directed to a queue of existing work, rather than an action that starts new work.

Recommended scope: change the initiation journey and tighten its participant authorisation. Preserve the existing appraisal records, approved-goal snapshots, assessment workflow, audit trail, and central Identity authority. A new appraisal engine is not needed.

This was an evaluation. No production cycle was created, no appraisal was launched, no staff notification was sent, and no application behaviour was changed. An unsaved wizard was explored and discarded; the original Manager workspace and page were restored.

## Evidence

### Signed-in production observations

- Manager > Team Appraisals has a cycle picker and an appraisal queue, but no action to start an appraisal or add staff to the current cycle.
- Its empty state says appraisals will appear after the cycle is launched. It does not identify who can launch it or provide a launch action.
- HR can reach Admin > Administration > Cycles > Create And Launch Cycle.
- Creation has four steps: Review period, Review design, People, Confirm.
- Before choosing staff, the review-design screen exposes 17 text fields, 29 checkboxes, and 18 dropdowns, including disabled configuration controls. Accepting the default design is possible, but the screen presents the entire editor as a required step.
- The current organisation's participant picker reports **one eligible person and four unavailable**. The unavailable rows report missing reporting managers; one is the signed-in user. This is the picker's view of the locally mirrored roster, not independent verification that the authoritative Identity records also lack those relationships.
- Active cycles have View/Edit actions, but the cycle list/detail pages do not expose a clear Add participants / Start appraisals action.

### Isolated local route checks

The checks used an ephemeral MongoDB, synthetic session/IdP role claims, synthetic staff, and the real application routes. They did not use production data or run notification delivery workers. They establish route behaviour under those claims; they do not impersonate a pure line-manager account in production or prove every centrally configured permission combination.

| Case | Observed result |
|---|---|
| Manager starts a review for an eligible team member | HTTP 201; one appraisal created |
| HR starts a review for an eligible employee | HTTP 201; one appraisal created |
| Ordinary employee tries to create/launch a cycle | HTTP 403 |
| HR selects a person without an assigned reporting manager | HTTP 400, with a missing-manager error |
| Ordinary manager edits an HR-owned organisation cycle | HTTP 403; global settings unchanged |
| Manager submits an out-of-scope employee through create-and-launch while supplying an allowed team scope | **HTTP 201; an appraisal was created even though the access service rejected that employee** |
| HR submits one eligible participant and one blocked participant | HTTP 201; one created and one failed |

Private reproducible evidence: `../access/appraisal-start-audit.cjs` and `../access/appraisal-start-audit-results.json`.

## Findings and priorities

### 1. P1 — Participant checks differ between launch routes

The immediate-launch path in `backend/routes/appraisals.js:1623` validates the requested cycle team scope, then calls `createAppraisalsForCycle` at line 1696. The helper does not check each participant with `canAppraiseEmployee`. The separate launch route does perform that check at line 1919.

The local check reproduced a manager creating an appraisal for an out-of-scope employee by pairing that employee with an allowed cycle scope. This is an authorisation defect, rather than only a missing UI control. The shared launch service should resolve current-organisation membership and reporting relationships from trusted Identity-derived data, validate every participant before creating records, and avoid trusting submitted employee/team/manager metadata as authority.

This should be corrected with the simplified manager entry point. Simply showing the existing creation form to more managers would expose an inconsistent boundary.

### 2. P2 — Managers cannot discover how to initiate a review

`frontend/components/Layout.tsx:169` routes managers to `/appraisals?view=team`. That page offers existing-record actions and an admin-only Admin Panel button, but no initiation action (`frontend/app/appraisals/page.tsx:634`). Its empty state instructs the manager to wait (`:814`). The manager dashboard also links to existing work rather than starting a review.

Add **Start appraisal** to Team Appraisals and a contextual **Start appraisal** action for a staff member. The empty state should offer the same action. The manager should not need to know or type an `/admin/...` route.

### 3. P2 — Starting a review requires assessment-design work

The creation page is exported from `frontend/app/admin/appraisal-cycles/[id]/edit/page.tsx`. Its setup sequence at line 95 makes the full `CycleDesignBuilder` a required stop before staff selection. That editor is appropriate for defining standards, but creates substantial decision load for a routine appraisal.

Use an approved template with a short summary and sensible defaults. Keep detailed questions, section weights, evidence requirements, and workflow switches in a separate HR template/design task. Allow an optional advanced configuration route where policy permits it.

### 4. P2 — Missing reporting relationships block selection without a recovery action

The current screen shows the missing-manager reason, but does not provide an action to repair the reporting relationship or refresh stale roster data. Eligibility is built from mirrored users in `backend/services/appraisalAccessService.js:192` and decorated in `backend/routes/user.js:71`.

Show **Fix reporting manager** to authorised HR users, leading to Seemplify Identity, plus a refresh/recheck action. Managers should get a clear explanation and an HR recovery path. Verify the authoritative IdP relationship and synchronisation before asking users to recreate data. Keep self-review prohibited.

### 5. P2 — Review period, start date, and response deadlines are blurred

The first step asks for Period Start/End. New-cycle phase deadlines are not exposed in that flow; the Phase Timeline is rendered only when editing an existing cycle (`.../[id]/edit/page.tsx:632`). The creation payload sets `launchNow: true` at line 403.

The user needs distinct answers to: **What period are we assessing? When does the employee begin? When is their response due? When must the manager finish?** Make those explicit, with practical defaults. Show the intended start and notification consequences before the final action.

### 6. P2 — Adding staff to an active cycle is not a visible task

The server can add participant appraisals through `/cycles/:cycleId/launch`, but the active-cycle interfaces primarily offer View/Edit. A manager is pushed toward inventing another cycle to start a review for someone else.

Default Start appraisal to a suitable existing active cycle when one exists. Provide a separate one-off review option for probation, project, or ad-hoc reviews, backed by a team-scoped cycle without forcing the manager to administer an organisation-wide programme. Existing appraisals should open their current record instead of creating duplicates.

### 7. P2 — A partial launch can look like complete success

The create endpoint can return HTTP 201 with successful and failed participants. The creation form awaits the POST at line 400 and navigates to the cycle list at line 429 without reading the launch summary. The local mixed-participant check returned one success and one failure.

Show a launch receipt: started, already in progress, and blocked, with a reason and next action for each person. Retrying should be idempotent and retain successful work.

### 8. P2 — The vocabulary hides the user task and its owner

The interface alternates between cycles, appraisals, launch, start, and review. The existing Start Appraisal action at `frontend/app/appraisals/page.tsx:165` starts an already-created record; it does not initiate an appraisal for another staff member. It then navigates to a goal-setting route even though approved-goal evidence is already attached by the current workflow.

Use Start appraisal for initiation, and specific continuation actions afterward: Complete self-assessment, Review employee submission, Record discussion, Confirm outcome, Acknowledge outcome. Show **who acts next** and the relevant deadline next to each person's status. Keep historical records accessible without presenting legacy workflow concepts as the primary path.

## Recommended ownership

| Person | Can initiate | Staff scope | Organisation-wide settings |
|---|---|---|---|
| Organisation owner/admin or HR manager with Performance access | Organisation, team, or individual appraisal runs | Permitted current-organisation staff with valid reviewer relationships | Can manage approved templates and organisation cycles according to IdP permissions |
| Line manager with appraisal permission | Reviews within an existing cycle or a one-off team review | Their authorised staff; delegated hierarchy only where policy explicitly allows it | Cannot change company-wide templates, cycles, or other managers' staff |
| Employee | Completes an assigned appraisal | Their own assessment and acknowledgement | Cannot launch appraisals or assign their own reviewer |

Role names alone must not replace the central IdP permission matrix. Specific launch permission and participant scope must both be enforced by the server.

## Proposed start journey

The same initiation flow should serve HR and managers, with a different permitted staff picker.

1. **People** — choose one person or several. Identify unavailable people immediately and explain how to resolve the blocker.
2. **Review details** — use the current cycle or choose a one-off review; select an approved template, assessment period, start timing, and response deadlines. Defaults should support starting a normal review without editing questions or scoring.
3. **Confirm and start** — show staff, assigned reviewers, deadlines, and who will be notified. Start the reviews and show a per-person result with direct links to the next work item.

Detailed template editing belongs outside this normal start journey.

```mermaid
flowchart LR
    A[HR or manager: Start appraisal] --> B[Choose permitted staff]
    B --> C[Review type, period and deadlines]
    C --> D[Confirm and notify]
    D --> E[Employee self-assessment]
    E --> F[Manager review]
    F --> G[Discussion and outcome]
    G --> H[Employee acknowledgement]
```

Include HR calibration between discussion and final outcome when the selected template requires it. Preserve the existing goal snapshots and audit history rather than asking employees to set goals again inside an appraisal.

## Acceptance criteria for implementation

- A pure line-manager account can find Start appraisal from Team Appraisals, choose authorised staff, and start without entering the Admin workspace.
- HR can initiate for permitted organisation staff; a missing manager explains the blocker and provides an Identity-based repair path.
- Launch rejects out-of-scope, cross-organisation, forged-manager, and self-review requests before creating any appraisal records.
- Managers cannot change HR-owned global settings; ordinary employees cannot initiate staff appraisals.
- The existing active cycle can be reused; a one-off review does not require an organisation-wide cycle.
- The ordinary start path does not expose the full question/scoring editor.
- Assessment period and response deadlines are distinct and visible before launch.
- Duplicate retries do not duplicate appraisals or launch notifications. Partial results identify the affected people and allow recovery.
- Success shows who acts next and where to continue; empty/loading/error states support the same task on desktop and mobile, including keyboard navigation.
- Before release: focused route permission/integration checks, complete manager/HR browser journeys with controlled fixtures, production build, exact-main deployment proof, OIDC-start smoke, and authenticated acceptance. Any production invitation test must use an explicitly authorised disposable organisation/staff workflow.

## Evidence limits

No production write-path was tested by launching a real review, because that would create staff work and notifications during an evaluation. The signed-in account combines HR/admin and manager access, so pure-manager positive/negative launch checks were performed locally with synthetic claims. Screenshot capture repeatedly timed out; navigation, visible controls, eligibility labels, and field counts were inspected through the live accessibility/DOM interfaces. Authoritative Identity reporting-manager records were not independently audited.

## Implementation following the review

The implementation adds a shared `/appraisals/start` journey with People, Review details, and Confirm and start. Manager, HR dashboard and staff-profile actions lead to it. Existing open cycles can be reused; a one-off review uses an approved template and separate employee/manager response deadlines. The detailed cycle designer remains available as Configure a cycle.

All three launch routes now resolve selected user IDs through the current organization's Identity-derived roster before any cycle or appraisal write. Submitted names, team scope and reviewer details cannot assign an employee to an unauthorized manager. Missing reporting managers remain a per-person launch blocker, with a refresh/Identity recovery path. The team launch alias shares snapshot creation, notification events and duplicate handling with the canonical launch route.

The appraisal list defaults to All cycles, with Current and History & results tabs. History supports search, review-year filtering, sorting, final ratings with their scale, acknowledgement status, filtered CSV export and print. Employee, manager and organization views retain their respective access scope. The published result endpoint checks tenant, participant/reviewer permissions and completed status; its explicit response excludes calibration, AI, conversation and audit data. Frozen cycle names, periods and rating scales preserve historical context when a cycle changes or disappears. Missing final ratings remain explicitly unrated.

The result report includes the published outcome, employee reflection, shared manager assessment, discussion notes and goal achievements. Browser print supports Save as PDF. Reporting does not invent missing historical data or compare averages across incompatible rating scales.

Verification uses ephemeral MongoDB and synthetic IdP claims for manager/HR/employee authorization, forged participants/reviewers, tenant isolation, partial launches, deadlines, replay and archived results. Browser fixtures cover the simplified start journey, partial receipts, mobile layout, historical search/CSV and printable reports. Production acceptance must inspect the deployed revision and signed-in navigation without creating real staff appraisals as a side effect.

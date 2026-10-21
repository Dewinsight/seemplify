# Performance Apple design: product packages AD-07 to AD-12

Product owner: PM 2. Prepared 21 October 2026. Initial source analysis on `main`: `9e8fecc1e650fa1a637a99444aec1afa8d30b245`. This requirements handoff is preserved as the planning record; subsequent source and visual acceptance is recorded in [GROWTH-VISUAL-REVIEW](GROWTH-VISUAL-REVIEW.md), with final programme acceptance in the retained product review.

## Scope and source authority

This is a design addendum for the existing Performance application, not a replacement PRD. The user asks for the Apple design skill across **Performance Management only**. Preserve current business actions, identity authority, scope checks, privacy, saved drafts and historical evidence. Do not add API-only features merely to fill a screen.

Inputs inspected:

- **U1:** User's 21 October request: all Performance screens, Apple design, documented PM/architect/design/QA handoffs, generated concepts and illustrated delivery report.
- **P1:** [Existing product stories](../reliability-review/PRODUCT_STORIES.md), especially REL-07 to REL-12. These describe existing product behavior; their historical release statements are not fresh evidence.
- **P2:** [Existing surface catalog](../reliability-review/EXISTING_SURFACE_CATALOG.md), checked against current route files and controls.
- **P3:** Original three-page `C:/Users/User/Downloads/Seemplify Competency Assessment PRD.pdf`, all three pages extracted and read directly on 21 October 2026, alongside the [competency implementation plan](../../../docs/competency-assessment/IMPLEMENTATION-PLAN.md) and [competency stories](../../../docs/competency-assessment/stories/02-evaluation-reporting-stories.md). Page-specific preserved requirements are mapped in [DESIGN-02 section 8](DESIGN-02.md). This source covers competency assessment, not every Performance feature. No general whole-Performance PRD was supplied in this chat or located in the inspected paths.
- **S1:** Current pages under `performance/frontend/app`, shared `components/competency/CompetencyPage.tsx`, `components/Layout.tsx`, `app/theme.ts`, `app/globals.css`, and existing browser suites.
- **D1:** [Apple design skill](https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md), read 21 October 2026. Use its response, typography, material, wayfinding and accessibility principles. Gesture physics apply only to existing gesture interactions; they do not require adding gestures to forms.

## Shared acceptance contract C1

Every package below includes C1; the architect must trace C1 and its story-specific criteria to tests and screenshots.

1. **Role fidelity:** permitted employee, scoped manager and HR/admin journeys retain current controls and data. A denied or unavailable action cannot become enabled through presentation changes. Theme switches and responsive layouts cause no extra domain writes.
2. **Visual parity:** at 1440 x 900 and 390 x 844, in light and dark, page heading, primary action, content and status use the same approved Performance typography, semantic colors, spacing and control hierarchy. No clipping of the primary action or page-level horizontal overflow. Intentional wide tables scroll inside a named local region.
3. **Text and contrast:** normal text meets 4.5:1 and large text 3:1; controls/focus boundaries meet applicable 3:1 requirements. Status includes readable words, not color alone. Long realistic names, emails and translated-length labels wrap or truncate with an accessible full value.
4. **Input and focus:** keyboard reaches all actions in logical order; focus stays visible and unobscured. Dialogs expose a name, contain focus while open, close through the supported cancel/Escape path, and return focus to the opener. Touch controls target 44 CSS pixels where layout permits; no target falls below the applicable WCAG minimum without its spacing exception.
5. **Motion and materials:** press feedback starts immediately; no decorative full-screen motion or input lock. Reduced-motion preference removes spatial/elastic effects; reduced-transparency uses solid readable surfaces; increased contrast retains visible boundaries. Use opaque content surfaces and restrained translucent chrome rather than stacked glass cards.
6. **State coverage:** capture and verify loading, empty, populated, failed request with retry/recovery, denied and read-only states where implemented. A failure cannot masquerade as an empty success. Pending writes expose progress and prevent accidental duplicate submission without blocking navigation indefinitely.
7. **Evidence:** before/after screenshots use synthetic data with route, viewport, theme, revision and state. Generated concepts are explicitly labeled concepts. Local fixtures, real local API, CI, deployed revision, authenticated production, and provider outcomes remain separate evidence layers.

## AD-07 - Clear feedback, recognition and project feedback

**User story:** As a colleague or authorized project lead, I want to find the right person, audience and response action in a consistent interface so I can share useful feedback without sending it to the wrong audience.

**Source mapping:** U1; P1 REL-07 and REL-12; P2 feedback/360, recognition, project-feedback rows; S1 `feedback/page.tsx`, `recognition/page.tsx`, `project-feedback/page.tsx`, `components/feedback/*`.

**Routes:** `/feedback`, `/feedback/new` (redirect), `/team/feedback`, `/recognition`, `/project-feedback`.

**Current source observations:** feedback has six scrollable views and separate request-progress surfaces. Recognition uses feed/received/sent tabs and an audience dialog. Project creation and request dialogs contain membership-dependent selectors. These are different tasks sharing list, empty-state, tab and dialog primitives; source inspection alone does not prove a visual defect.

**Acceptance:**

- AD-07.1: C1 passes on each rendered route; redirect bookmarks retain their compose/query intent.
- AD-07.2: Feedback view tabs retain selected state and all current request/response actions. The active view is clear with keyboard and without relying solely on color; narrow layouts reveal all tab labels by local scrolling.
- AD-07.3: Give-feedback and recognition dialogs keep recipient, message and audience adjacent and readable. A failed recipient search has recovery distinct from zero results; failed send remains in the open form with entered text preserved.
- AD-07.4: Project request controls remain absent for a closed project; project participants and chosen reviewer remain legible at narrow width. Do not introduce project edit/close or withdrawal controls that are presently API-only.
- AD-07.5: Acknowledgement, sent confirmation, and request status remain visible after action. Private/anonymous reporting and existing five-distinct-author privacy behavior remain unchanged.

**Dependencies/handoff:** consume approved shared tokens first. UX supplies populated list, empty requests, recipient search failure, recognition dialog and project request at both target sizes. QA reuses `phase2-continuous-performance`, `feedback-360-recovery`, `people-and-teams` and colleague-review coverage; records any uncovered criterion rather than assuming passage.

## AD-08 - Focused check-ins and one-to-one conversations

**User story:** As an employee or their permitted manager, I want check-in and meeting information organized around the next action so I can prepare, save and revisit a conversation confidently.

**Source mapping:** U1; P1 REL-08/09/12; P2 check-ins and one-to-ones; S1 corresponding pages, `OneOnOneSchedule`, calendar and native-call components.

**Routes:** `/check-ins`, `/one-on-ones`, `/one-on-ones/new`, `/one-on-ones/[meetingId]`.

**Current source observations:** check-in filters, draft/submitted controls and an employee picker must coexist. One-to-one list has upcoming/history, participant/search filters, calendar connection, schedule dialog and detail actions. Existing dirty calendar/call edits predate this redesign and must be preserved.

**Acceptance:**

- AD-08.1: C1 passes; check-in cadence, period, visibility, pulse and content remain associated with their labels at both target sizes.
- AD-08.2: Draft save/edit/submit controls keep their existing authority; submitted entries stay read-only. Validation and save failure preserve entered content and identify the next step.
- AD-08.3: Upcoming/history and meeting detail share heading/action/status hierarchy. Schedule retains integrated and manual options; unavailable calendar or call services leave an explicit recovery/manual path where currently supported.
- AD-08.4: Meeting agenda, shared notes, private notes and action completion remain clearly differentiated. Call join/leave, microphone/camera and optional recording controls remain reachable on mobile and keyboard; recording consent is not hidden by visual simplification.
- AD-08.5: Loading, empty history, calendar failure, join failure, read-only completed meeting and long agenda are included in the evidence matrix. Synthetic media/control-plane tests are not labeled real provider/media proof.

**Dependencies/handoff:** shared form, tabs, alert, dialog and action styles. UX must inspect existing calendar changes before touching those files. QA reuses `check-in-scope-recovery`, `phase2-continuous-performance`, `calendar-direct-connect` and `one-on-one-calls.fullstack`; actual provider acceptance requires its real prerequisites.

## AD-09 - Coherent development, coaching and support plans

**User story:** As an employee or authorized manager/HR reviewer, I want plan progress, commitments and the next permitted action shown consistently so agreed development and support remain actionable.

**Source mapping:** U1; P1 REL-08/10/12; P2 development/learning, support and coaching; S1 `development/page.tsx`, `coaching/page.tsx`, `support-plans/page.tsx`.

**Routes:** `/development`, `/coaching`, `/support-plans`.

**Current source observations:** development combines plans and learning records; support contains manager-to-HR-to-employee stages; coaching uses employee/priority filtering and links to existing actions. Their meaning must not collapse into interchangeable decorative cards.

**Acceptance:**

- AD-09.1: C1 passes for employee, manager and HR views where permitted. Plan title, owner, state, due/review date and primary action are visible before secondary metadata.
- AD-09.2: Development plan goals/skills/activity completion and LMS synchronization retain current semantics. Empty learning results, failed sync and truly completed activity have distinct words and statuses; external-course links remain identifiable.
- AD-09.3: Support objectives, measurable target, commitments, milestones, review dates and employee response retain their groupings. HR approve/change/reject, employee acknowledgement and permitted outcome controls remain actor-scoped and readable.
- AD-09.4: Coaching employee/priority filters remain usable at 390px; each Open action stays adjacent to the item it affects. Denied access and unavailable insights receive clear existing recovery paths.
- AD-09.5: Plan creation/detail, failure with preserved draft, empty scoped list, pending HR review and closed/read-only outcome appear in the design/QA matrix. Do not introduce enrollment or automatic rating decisions.

**Dependencies/handoff:** approved shared form/dialog/status/table tokens. QA reuses `development-support-recovery`, `learning-development-sync`, phase-two and support regression cases. UX provides support detail and development progress screenshots, not only page headers.

## AD-10 - Legible talent review and succession evidence

**User story:** As an authorized manager or HR reviewer, I want to inspect frozen evidence and human decisions without visual ambiguity so talent and succession discussions remain grounded in the permitted record.

**Source mapping:** U1; P1 REL-10/12; P2 talent/succession; S1 `talent/page.tsx`.

**Routes:** `/talent`, including Talent reviews, Succession coverage and Explainable signals tabs and their existing dialogs.

**Current source observations:** the page contains a review selector, state transitions, evidence grid, potential/readiness fields, evidence briefs and critical-role maintenance. HR-only succession access and closed-review gates are explicit in source.

**Acceptance:**

- AD-10.1: C1 passes for manager and HR. Employee denial remains intact. The selected review, state and scope are legible before the review grid.
- AD-10.2: Frozen performance evidence remains visually read-only and distinct from editable potential, readiness and rationale. No AI brief appears as the saved human decision.
- AD-10.3: Wide grids/tables use contained horizontal navigation at narrow width; review selection, employee identity and Open/Assess action remain reachable. Zero results and no signals remain distinct from failed reads.
- AD-10.4: Closed review opens in read-only mode with Close, and has no save/transition mutation path added by redesign. Succession maintenance remains behind the existing explicit grant.
- AD-10.5: New-review, evidence-assessment, succession nominee and closed-review states are captured in both themes; long role/employee names do not obscure controls.

**Dependencies/handoff:** shared table, tabs and form contract. QA reuses `phase3-talent-planning` and `succession-maintenance`; manual visual QA inspects the evidence dialog and mobile grid, not only the landing state.

## AD-11 - Unified competency library, assessment and reports

**User story:** As HR, an authorized assessor or an assessment participant, I want expectations, evidence and published results to use one readable visual language so I can complete my part without confusing access roles, source versions or draft outcomes.

**Source mapping:** U1; P1 REL-11/12; P3 competency stories CA-001-009 and CA-101-116 and retained architecture contracts; S1 `components/competency/CompetencyPage.tsx` and library/assessment/report components. This adds presentation requirements, not a new competency data model.

**Routes (18):** `/competency`; `/competency/assessments`; `/competency/assessments/[assessmentId]`; `/competency/roles`; `/competency/roles/new`; `/competency/roles/[id]`; `/competency/frameworks`; `/competency/frameworks/new`; `/competency/frameworks/[id]`; `/competency/strategies`; `/competency/strategies/new`; `/competency/strategies/[id]`; `/competency/cycles`; `/competency/cycles/new`; `/competency/cycles/[id]`; `/competency/reports`; `/competency/reports/[assessmentId]`; `/competency/settings`. Tab states are additional evidence, not additional page routes. Embedded appraisal competency panels are covered jointly with AD-04/05 ownership assigned by the coordinator.

**Current source observations:** a shared `CompetencyPage` already controls headings, subnavigation and multiple MUI colors using suite variables. Role/framework/cycle editors, evidence panels and reports rely on that layer plus local styles. Preserve the established occupational-role versus identity-role distinction.

**Acceptance:**

- AD-11.1: C1 passes across every listed route and the embedded panels; selected subnavigation remains clear and scrollable at narrow width.
- AD-11.2: Library list/editor shares heading/action hierarchy, field spacing and version/publication status. Import validation, empty library, archived/read-only version and failed load retain current recovery.
- AD-11.3: Assessment workspace keeps role/version, expected versus observed, evidence gap and next action close together. Manual assessment remains usable without AI or recorded calls; optional recording consent and retention controls remain visible when applicable.
- AD-11.4: Draft assessor content remains private; participant published views do not gain controls or data. Human classification/finalization/reopen reason remain explicit and actor-scoped.
- AD-11.5: Published report, cohort list, version selector and permitted export remain readable in light/dark and print. New screen styling must not recolor print output into unreadable dark surfaces or change frozen evidence.
- AD-11.6: Evidence and QA matrix includes overview, list, editor, empty/error, assessment workbench, denied participant, final report, historical version, cohort and settings. Representative screenshots may demonstrate shared primitives, but the route manifest must still record each route's verification status.

**Dependencies/handoff:** reuse existing competency architecture/design/QA skills and contracts; consume the approved shared design system. QA runs current competency library, criteria, assessment, consent, CV evidence, draft, cohort, appraisal-link and recovery suites according to affected components. Do not claim all current PRD acceptance from a screenshot pass.

## AD-12 - Clear action centre, AI account and help surfaces

**User story:** As a Performance user, I want to identify pending actions, account connection state and relevant help consistently so I can recover and continue my task without interpreting technical internals.

**Source mapping:** U1; P1 REL-12; P2 action centre and AI/tutorial; S1 `action-centre/page.tsx`, `ai-account/page.tsx`, `settings/ai/page.tsx`, `tutorial/page.tsx`, shared PageGuide, AI account gate/action notices.

**Routes:** `/action-centre`, `/ai-account`, `/settings/ai`, `/tutorial`.

**Current source observations:** action centre supports read/filter/open/snooze/dismiss/complete. AI account connection and policy settings are separate from generation. PageGuide appears throughout the shell and can obscure the primary action if overemphasized.

**Acceptance:**

- AD-12.1: C1 passes; actionable notification, informational update and completed item remain distinguishable through words and control hierarchy. Empty and failed states have distinct recovery.
- AD-12.2: Account connection status, allowed next action and return path are legible. A disconnected/unavailable account does not look connected. Provider details remain secondary and no secret/token appears in screenshots or normal UI.
- AD-12.3: Existing policy restrictions, organization/account switching and manual paths are preserved. Connection reads cannot be reported as successful AI execution.
- AD-12.4: Tutorial sections remain navigable by keyboard and mobile. Contextual help stays secondary to the main task; opening/dismissing a guide preserves page state and returns focus appropriately.
- AD-12.5: Capture disconnected, pending, failed, connected synthetic account states; empty/actionable/completed action centre; and guide open/closed. Actual connection/generation is a separate production/provider receipt.

**Dependencies/handoff:** shell owner approves PageGuide and notification overlap. QA reuses reliability and action/account tests where available and adds focused coverage only for changed behavior. Root/product lead retains final authority over cross-package vocabulary and screenshot/report claims.

## Handoff and evidence status

All six packages are **requirements ready** after PM handoff. Architecture, UX concepts, implementation, QA, product acceptance and deployed verification require separate recorded decisions. This file contains no fabricated interviews, usability results or screenshots. PM 2 remains available to verify the delivered AD-07-12 outcomes after implementation.

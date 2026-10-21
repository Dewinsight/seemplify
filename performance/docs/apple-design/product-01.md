# Performance Management Apple redesign: product handoff 1

Owner: Product Manager 1. Date: 21 October 2026. Source baseline: local `main` at `9e8fecc1`; no browser or release claim is made by this document.

## Scope and evidence boundary

This is a visual and interaction improvement of the existing Performance Management app, using the user's requested [Apple design skill](https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md). It is not a new appraisal product or a new authorization model. The current user request is the redesign requirement. Existing requirements are retained from `performance/docs/reliability-review/PRODUCT_STORIES.md`, `performance/APPRAISAL_FLOW_REVIEW.md`, `performance/FEATURE_ACCEPTANCE_REVIEW.md` and current source. The available original PRD is `C:/Users/User/Downloads/Seemplify Competency Assessment PRD.pdf`; it describes the competency subprogramme, not every Performance screen. No separate whole-app Performance PRD was located in the checked repository. These stories must not be described as derived from an unseen whole-app PRD.

The app serves employees, selected reviewers, line managers and authorized HR/admin users. Its core objects are goals, appraisal records, review cycles, people/teams and historical results. Success means the same permitted work remains available, while users can identify their location, next action and recovery path consistently across light/dark themes and desktop/mobile.

## AD-01 - Consistent app foundation, sign-in and wayfinding

**Priority:** P0 foundation. **State:** ready for architecture; not implemented or verified.

**Story.** As an employee, manager or HR user, I want a calm, consistent interface that clearly shows my active workspace and organization, so I can find and continue the work I am permitted to do.

**Requirement sources:** current redesign instruction; REL-12 in `../reliability-review/PRODUCT_STORIES.md`; root `AGENTS.md` identity rules; current `frontend/components/Layout.tsx`, `ConditionalLayout.tsx`, `PageGuide.tsx`, `frontend/app/layout.tsx`, `app/login/page.tsx`, `app/globals.css`, `app/theme.ts` and `tailwind.config.js`.

**Routes/surfaces:** `/`, `/login` and the shared header, desktop navigation, mobile navigation, workspace/organization/team switchers, user/theme menus, page guide, dialogs, drawers, controls, loading/empty/error/denial states on every private route.

**Observed current issues:** source has competing system/custom fonts, warm suite surface overrides, teal Material UI controls, purple suite accents and a gradient-heavy login. Global `nav` rules also affect nested competency navigation. Repeated decorative animation and typography treatments obscure a consistent product hierarchy. This is a source diagnosis; designers must attach current screenshots before asserting visual acceptance.

**Desired behavior:** system typography; neutral adaptive canvas and surfaces; one identifiable action accent; restrained functional translucent chrome with solid fallbacks; immediate press feedback; readable controls and status colors; meaningful headings; clear current location and exit. Material UI and Tailwind must use the same tokens rather than compete in the cascade.

**Acceptance criteria**

1. Given any rendered Performance route in light or dark mode, headings, body text, buttons, inputs, menus and status surfaces follow the agreed tokens. A screenshot matrix identifies each route/state and records any justified exception.
2. Given a valid employee, manager or HR session, existing available workspace options, navigation destinations and Identity-derived authority remain the same. Switching workspace visibly changes the current workspace and routes to its dashboard; a restricted feature is not exposed by visual changes.
3. Given no session, private data remains unmounted until authentication resolves and the app hands off to Seemplify Identity. Login errors/timeouts provide retry and App Hub actions. No product-local production password form is introduced.
4. Given keyboard navigation, the current page is programmatically identified, controls have visible focus, menu open/close and Escape work, and focus returns to the trigger after dismissal. Fixed navigation does not cover focused controls or anchored content.
5. At a 390 CSS-pixel viewport and at 200% zoom, navigation and primary actions remain reachable, text wraps, and the document does not scroll horizontally. Dense tables may scroll inside labeled containers. Icon-only controls have accessible names; touch actions have usable hit areas.
6. With reduced motion enabled, nonessential translation, scaling, shimmer and looping decoration stop; loading/status information remains understandable. Reduced transparency and increased contrast use solid backgrounds and defined edges. Essential actions never wait for animation completion.
7. Press feedback occurs on pointer-down; cancellation by leaving the target and releasing does not commit an unintended action. Disabled and busy states remain distinguishable. No animation prevents a quick second legitimate interaction.
8. Existing page-guide/tutorial access, theme preference, organization/team context, notification actions and App Hub exit remain discoverable and functional. No secrets or personal production data appear in captures.

**Dependencies/ownership:** must establish token ownership before AD-02..AD-12 implementation. One developer owns `globals.css`, `theme.ts`, root layout and Tailwind tokens. Another may edit a disjoint screen only after the token contract is published. Existing dirty calendar/meeting edits are outside this story and must be preserved.

**Architecture handoff:** define adaptive semantic tokens, MUI/Tailwind integration order, scoped chrome selectors, typography sizes, motion/accessibility policy and rollback boundary. **UX handoff:** baseline desktop/mobile screenshots, foundation/control sheet and login/error/menu concept. **QA handoff:** existing `e2e/auth-route-recovery.spec.ts`, navigation accessibility suites, theme/contrast/motion checks and complete route screenshot inventory.

## AD-02 - A dashboard that leads to the next useful action

**Priority:** P1. **State:** ready for architecture. **Dependency:** AD-01 tokens and navigation contract.

**Story.** As an employee, manager or HR user, I want to scan my current performance work and open the appropriate task, so I can act without searching through equal-weight promotional cards.

**Sources:** current redesign request; REL-02/REL-12; `frontend/app/dashboard/page.tsx`, dashboard summary hook and current workspace context. **Route:** `/dashboard`, including Personal, Manager and Admin variants, organization context, team view menu and manager notifications.

**Observed source issues:** large serif dashboard title, uppercase kicker, decorative full-width dotted header, competing hero/context panels and repeated large action cards. Metrics, next work and general destinations need a clearer hierarchy. Existing feature flags and notifications already define useful task priorities.

**Acceptance**

1. The dashboard shows one page heading, active workspace/organization, current metrics and permitted task destinations with a consistent reading order. Manager actions needing attention are easy to distinguish from general navigation.
2. Personal shows own goals/appraisals and permitted growth destinations; Manager shows authorized team work; Admin shows organization/cycle/calibration/reporting work. A role cannot gain a new destination through the redesign.
3. Every metric and task link reaches its existing route/query scope; notification continuation opens the actual pending appraisal. Counts remain backed by existing responses; missing values never become invented achievements.
4. The team menu identifies the current selection, supports keyboard/Escape/focus return and updates the current view without losing context. Long organization/team names wrap or truncate accessibly and never cover actions.
5. Loading, unavailable dashboard data, zero work, no teams and no organizations each display honest status and an available recovery/next action. A dismissed guide does not remove tutorial access.
6. At desktop and 390px, the first task and its action remain visible in a logical order; card/metric content neither clips nor forces document overflow. Light/dark and reduced-motion screenshots are attached.

**Handoff:** architect freezes dashboard data/navigation behavior; UX supplies all three role variants plus attention/empty states; developers may change composition/copy but not metrics semantics. QA replays workspace switching and relevant dashboard cases in `e2e/performance-journeys.spec.ts` and `e2e/people-and-teams.spec.ts`.

## AD-03 - Goals and alignment remain readable and actionable

**Priority:** P1. **State:** ready for architecture. **Dependency:** AD-01.

**Story.** As a goal owner or authorized manager/HR user, I want to browse, create and review goals with clear scope, dates and progress, so I can understand expectations and act on the correct goal.

**Sources:** current redesign request; REL-01; current `frontend/app/okrs/page.tsx`, `app/okrs/alignment/page.tsx`, `components/goals/GoalWorkspace.tsx` and `GoalDetailsDialog.tsx`. **Routes:** `/okrs` with existing personal/team/organization query views and tabs; `/okrs/alignment`; embedded create/edit/detail/check-in/approval/alignment dialogs. The separate legacy `/team/okrs` surface is listed under AD-06 and shares this visual contract.

**Current source constraints:** goal details, lifecycle, approval and scoring distinguish unrated from zero progress; organization-level authority and valid parent scope are enforced elsewhere. A new visual summary must preserve those distinctions and cannot imply broader permission. UI mixes app-wide MUI controls with Tailwind composition.

**Acceptance**

1. Scope, selected period, active tab/filter and goal status are visible before a user acts. Create/edit/detail/approval/check-in actions use the same hierarchy and control styling as the shell.
2. Existing organization creation remains limited to current authorized actors; ordinary managers retain their actual allowed staff scope. Read-only users can open goal details without seeing misleading editable controls.
3. Details display objectives, targets, dates, owner and current rating/progress faithfully. Unrated and 0% remain distinct; statuses use text plus color. The alignment tree communicates parent/child relationships through hierarchy and expandable controls rather than color alone.
4. Validation and request failures remain in the relevant form, preserve typed work and offer retry. Cancelling/closing returns focus to the trigger; destructive actions retain existing confirmation.
5. Creating, saving, approving or checking in uses the existing API and idempotency behavior. Visual changes neither submit twice nor reset the selected period after success.
6. Desktop/mobile, keyboard, long titles, empty period, no matches, read failure and submission failure are covered. Goal dialogs fit the narrow viewport and keep their primary action reachable; alignment may use an explicit internal scroller if a true hierarchy needs width.

**Handoff:** architect records unchanged API/scope/scoring contracts and any overflow strategy; UX supplies list/filter, goal details/form, approval and alignment states; QA reuses goal scenarios in `e2e/performance-journeys.spec.ts` plus permission/backend contracts already referenced by REL-01. Appearance alone cannot certify authorization.

## AD-04 - A clear appraisal journey from initiation to retained results

**Priority:** P0 core journey. **State:** ready for architecture. **Dependencies:** AD-01; AD-03 goal evidence styling; preserve competency integration contracts from Product 2.

**Story.** As an employee, selected reviewer or authorized HR user, I want the appraisal to make my current step, saved work and next action clear, so I can complete a fair review and revisit its outcome.

**Sources:** current redesign request; REL-02 through REL-06 and REL-11; `performance/APPRAISAL_FLOW_REVIEW.md`; current appraisal routes/components and existing competency story contracts. **Routes:** `/appraisals`, `/appraisals/start`, `/appraisals/removed`, `/appraisals/[appraisalId]`, and its `/goal-setting`, `/self-assessment`, `/manager-review`, `/discussion`, `/calibration`, `/final-review`, `/report` children. Conversational assessment, custom questions, goals, evidence/documents, meetings, AI report, lifecycle/history dialogs and print styles are embedded states, not additional page routes.

**Observed source issues:** list/status cards and progress sections contain bespoke gradients, colored shadows and all-property transitions; conversational and report surfaces have independent gradient treatments. Their cleanup must preserve current workflow and evidence behavior. Existing calendar/meeting edits in the checkout are protected work; coordinate ownership before touching intersecting files.

**Acceptance**

1. Appraisal lists prioritize employee/review identity, current status, actor who acts next, due date and permitted continuation action. Current/history/removed views remain distinguishable and retain search/filter/back navigation.
2. The start wizard retains the existing three-step staff → details → confirmation journey, eligible reviewer selection, required goal checks, one-off/cycle choice and per-person partial-launch receipt. Missing eligibility is explained; retry does not duplicate successful appraisals.
3. Every active stage shows the current step, completion state and primary action using consistent type and controls. A 390px viewport shows all progress labels through an accessible responsive pattern; keyboard focus can reach the final rating and stage actions.
4. Manual and conversational assessment retain drafts, required-field errors, existing save/submit boundaries and configured custom questions. A visual change never implies an autosave that the system does not perform. AI disabled/unavailable leaves the existing manual path usable.
5. Selected-reviewer, employee, HR and read-only/completed states expose only existing allowed actions. Future or omitted workflow stages remain unavailable; a past stage stays readable where current policy permits it.
6. Meetings, calendar status, recording consent, uploads, private files and linked competency assessments retain their current permissions and data. Progress indicators must describe real state rather than animated decorative success.
7. History/result reports retain frozen versions, manager feedback and existing exports/print controls. Print output is legible on a white page with navigation/actions hidden; dark mode does not print dark blocks or white-on-white content.
8. Loading, missing record, read failure, save failure, partial launch, no matches, permission denial and lifecycle confirmation are reviewed on desktop/mobile. All failure/confirmation dialogs keep focus and preserve permitted recovery.

**Handoff:** architect freezes stage/data/permission/print behavior and identifies files with protected dirty edits; UX supplies list, start wizard, detail timeline, form/conversation, evidence, history/report and print designs; QA reuses `e2e/appraisal-navigation-accessibility.spec.ts`, `appraisal-current-task.spec.ts`, `appraisal-recovery.spec.ts`, `appraisal-calibration-readonly.spec.ts`, `embedded-report-recovery.spec.ts` and appropriate fullstack appraisal suites. Capture main stages with synthetic participants; production screenshots require authorized data handling.

## AD-05 - Coherent administration, cycles, calibration and analytics

**Priority:** P1. **State:** ready for architecture. **Dependencies:** AD-01, AD-04 state vocabulary.

**Story.** As an authorized HR administrator or manager using available insights, I want readable operational summaries, filters and records, so I can identify exceptions and make the permitted decision from trustworthy evidence.

**Sources:** current redesign request; REL-04/REL-10/REL-12; `frontend/app/admin/**`, `app/analytics/page.tsx`, existing report/cycle APIs and `FEATURE_ACCEPTANCE_REVIEW.md`. **Routes:** `/admin`, `/admin/appraisal-cycles`, `/admin/appraisal-cycles/new`, `/admin/appraisal-cycles/[id]`, `/admin/appraisal-cycles/[id]/edit`, `/admin/calibration`, `/admin/reports`, `/admin/departments/[department]`, `/admin/review-cycles`, `/analytics`. The review-cycles route is an existing legacy surface and must be accounted for without promoting it into a new primary workflow.

**Observed source issues:** dense MUI metric/card/table/form screens use inconsistent heading weights, caption/overline emphasis and chart colors; analytics copy exposes implementation language such as canonical records. Full cycle editors are intentionally separate from the ordinary start journey and must stay there.

**Acceptance**

1. Each route has a clear human-readable title, scope, active filters and main action. Existing operational summaries remain accurate; chart labels, legends and numeric values are legible in both themes and never use color as the only distinction.
2. Admin-only screens retain actual current access policy. Analytics remain available only to permitted users/resources; manager/team membership alone must not add organization-wide analytics authority.
3. Cycles retain create/edit/template/publish/launch behavior, period/deadline distinction, configured questions and lifecycle confirmation. Complex editing remains in the existing dedicated editor rather than a crowded table.
4. Calibration shows the affected person, current/proposed outcome, required rationale and completion/defer state clearly. Read-only/finalized records remain read-only; visual progress never advances an uncommitted decision.
5. Filters, drilldowns, clear/reset and exports retain current query/resource scope and result meaning. A no-data result is distinguishable from failed data. Errors have a specific retry action and preserve current filters or form edits.
6. At 390px and 200% zoom, forms and primary actions fit; data tables scroll inside bounded containers with accessible names and retain headers. Keyboard users can complete filters, dialogs and row actions without hidden controls.
7. Department names, cycle titles, large counts, missing ratings, small/empty datasets and long labels are explicitly captured. Existing chart/table explanations and exports remain available.

**Handoff:** architect defines chart theme tokens, table overflow and access/contract preservation; UX supplies admin summary, cycle editor, calibration decision and filtered analytics/report examples; QA uses existing admin/analytics/calibration scenarios in `e2e/performance-journeys.spec.ts`, `phase3-talent-planning.spec.ts`, `appraisal-calibration-readonly.spec.ts` and corresponding real-API suites. Browser chart checks are separate from report-data correctness.

## AD-06 - People, team views and colleague reviews use the same language

**Priority:** P1. **State:** ready for architecture. **Dependencies:** AD-01, AD-03/AD-04 shared status patterns.

**Story.** As an authorized manager, HR user or assigned colleague reviewer, I want a clear list/detail view of the people and review work in my scope, so I can open the correct profile or task without confusing team names or review types.

**Sources:** current redesign request; REL-07/REL-10/REL-12; `frontend/app/team/**`, `app/reviews/**`, `app/team/team.module.css`; existing colleague-review and directory contracts. **Routes:** `/team`, `/team/[userId]`, `/team/okrs`, `/team/appraisals`, `/team/reviews`, `/team/feedback`, `/reviews`, `/reviews/[id]`. The `/reviews` family represents assigned colleague-review work; do not conflate it with canonical appraisal records or relabel it without checking current vocabulary.

**Observed source issues:** team directory already uses suite tokens but detail/context menus contain independent hardcoded colors; secondary team pages use MUI tables and skeletons; assigned-review heading/cards use a separate gradient treatment. Duplicate team names are a real existing test case; IDs must remain the filtering key.

**Acceptance**

1. Directory cards/rows show the relevant person's identity, team and meaningful current status with consistent controls. Filtering retains stable IDs even when team names match, and the current team/scope is visible.
2. Manager view remains limited to its authorized people; Admin view reflects current permitted organization scope. Profile links and row actions retain existing scope and never expose foreign or unselected records.
3. Team OKR/appraisal/review/feedback summaries use the same progress, status, dates and action hierarchy as their parent journeys. Links preserve their existing destination and participant query context.
4. Assigned colleague-review list/detail distinguishes pending, in-progress and submitted/read-only states; fields, rating labels, validation, save/submit and return paths remain faithful to current behavior.
5. Search/no matches, teamless people, no direct reports, unavailable detail and denied access each have a readable result and next step. Menus close with Escape and return focus; icon actions have accessible names.
6. Long names/emails/job titles, duplicate team names and zero/unrated metrics do not break rows or cards. Desktop/mobile/zoom checks include internal table scrolling, readable skeleton/loading behavior and visible keyboard focus.

**Handoff:** architect records route distinctions, stable identity/filter keys and unchanged record permissions; UX supplies directory, profile, team table, contextual menu and colleague-review form states; QA reuses `e2e/people-and-teams.spec.ts`, `team-access-loading.spec.ts` and `colleague-reviews.fullstack.spec.ts`. A screenshot of an empty table cannot replace a populated-row/action check.

## Product review and evidence contract

For each AD package, reviewers must link the architecture section, UX specification, generated concept (clearly labeled concept), real baseline screenshot, implemented screenshot, actual test result and release revision. Mark `planned`, `design ready`, `implemented locally`, `QA passed`, `released` and `live accepted` separately. The retained PM accepts user outcomes; the architect/QA accepts contracts and verification. Neither reviewer should certify their own implementation without a second review.

These packages form a source-backed redesign backlog. They do not assert that all acceptance criteria have passed. Product 2 owns the remaining AD-07..AD-12 packages, including competency/growth and supporting surfaces; the coordinator owns the complete route register and the final illustrated delivery report.

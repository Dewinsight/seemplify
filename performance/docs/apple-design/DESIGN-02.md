# Performance design handoff: AD-07 to AD-12

UI/UX 2, 21 October 2026. Source baseline `9e8fecc1e650fa1a637a99444aec1afa8d30b245` on `main`. Status: PM/architect-approved handoff; implementation applied, final QA and release evidence tracked separately. [Product acceptance](product-02.md) is authoritative for this package.

## 1. Product cognition and direction

Performance is an existing employee/manager/HR workbench. Users arrive from their workspace or a linked action, decide which person/record needs attention, complete a permitted step, and see saved state or a recoverable error. Core objects are goals, feedback, meetings, plans, talent reviews and competency definitions/evidence/results. The mobile priority is completing the current task with its labels and primary action visible. The temperament is calm, trustworthy and precise.

Keep the existing Next/MUI/Tailwind architecture and behavior. Unify its visual foundations: platform system fonts, neutral canvas, opaque content surfaces, one blue action accent, semantic status colors, deliberate spacing and restrained depth. The requested [Apple design skill](https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md) guides feedback, typography, wayfinding, materials and user preferences. Dense form workflows do not need new gestures.

Use the coordinator's approved shared tokens (`--suite-canvas`, `--suite-surface`, `--suite-surface-muted`, `--suite-ink`, `--suite-muted`, `--suite-line`, `--suite-accent`, `--suite-action`) in both CSS and MUI. Local overrides consume tokens rather than introduce another palette. The shared implementation owner fixes the font/accent at source; do not append broad `!important` patches to individual pages.

## 2. Baseline and concept boundaries

The baseline screenshots show the actual local app at `http://127.0.0.1:5025` with existing synthetic browser-test fixtures. They are not production records or provider verification. The capture receipt names each fixture, route, viewport, failure and screenshot. Example inspected: [Feedback desktop baseline](evidence/before/feedback-desktop-light.png). Its guide button competes with Give feedback, teal and cyan controls differ from the warm canvas, and heavy card shadows create unnecessary separation.

Generated concepts supplied by the programme's design lead are inspiration. The implementation remains real semantic HTML/MUI controls, and actual after-screenshots must be compared against this handoff. No generated image can close an acceptance criterion or substitute for a missing normal-state fixture.

The generated [competency responsive concept](evidence/concepts/competency-responsive-concept.png) gives AD-11 a desktop/mobile visual target: a calm library, readable rows, clear publication state and touch-friendly actions. The [dashboard concept](evidence/concepts/dashboard-apple-concept.png) establishes the shared neutral/blue direction. Both are synthetic concept art, not implemented product evidence.

## 3. Shared composition contract

| Element | Intended behavior and appearance |
|---|---|
| Page heading | One task title at the established shared scale; plain supporting sentence beneath; primary action aligned right on desktop and next in reading order on mobile |
| Primary action | Solid blue, descriptive verb/object, consistent rounded rectangle and height; immediate press feedback; pending text while saving |
| Secondary/help action | Outlined/text treatment, visually below the task action; contextual guide remains discoverable without taking primary emphasis |
| Filters | Group directly above the affected content; readable labels, clear active state and supported reset; stack with full-width fields on narrow screens |
| Tabs | Persistent selected indication and semantic tab state; scroll locally on mobile; no cut-off last tab or page-level sideways scroll |
| Content surfaces | Opaque neutral panel, subtle boundary, deliberate grouping; no hover lift on read-only content; depth reserved for menus/dialogs |
| Dialog | Clear title, labeled content, explicit cancel/save area; body scrolls inside viewport; focus contained/returned; action footer wraps on narrow screens |
| Status | Text plus semantic tone; pending, complete, warning, failure and read-only are visually distinguishable; no implied success from a colored icon alone |
| Tables/grids | Clear row hierarchy and local horizontal scroll where necessary; identity and next action remain locatable; readable zero/null values |
| Preferences | Both themes; reduced spatial motion; solid material fallback; stronger borders for increased contrast; enlarged text and long realistic content |

## 4. AD-07 feedback, recognition and project feedback

**Entry/task:** Growth navigation, a colleague link or a request notification. Choose a view or recipient, compose, review audience, send/respond, then see the resulting status.

- Keep Feedback's current six views. Put the selected view and filter state above the list; requests use the same row/card rhythm as received/sent feedback while keeping their accept/decline/respond actions.
- Keep recipient and audience adjacent in composition dialogs. Search/loading/no results/error occupy the search region. Place send failure inside the open dialog and preserve message/audience.
- Recognition uses contribution message first, then sender/recipient/time and company value. Its acknowledgement action stays next to the record. Private/team/organization audience labels must remain explicit.
- Project list shows name, state, membership and Request feedback. Closed state suppresses that action. Project creation/request fields retain their existing order and validation; no additional metadata feature is introduced.
- Mobile: single-column records, wrapped action groups, locally scrollable views, full-width dialog fields. Long names wrap before obscuring the audience or send action.

**Required captures:** populated feedback list; requests empty and failed; recognition list and compose dialog; project list empty/populated; request dialog. In both themes and narrow layout, verify C1 plus AD-07.1-5. The `/feedback/new` redirect and `/team/feedback` scoped page remain intact.

## 5. AD-08 check-ins and one-to-ones

**Entry/task:** personal/team Growth or a meeting link. Identify period/participant, prepare content, save/submit or enter the existing conversation.

- Check-in list identifies period, cadence, status and owner before narrative. Draft editor keeps wins/priorities/blockers/support together and visibility next to the save/submit decision. Submitted content is read-only through existing rules.
- One-to-one list gives Upcoming/History a stable place. Search and participant scope sit before meeting rows. Each row shows title/person/time/status with its next available action.
- Calendar connection is a secondary functional panel, not a competing hero. Its real connection state and manual scheduling path remain readable. Preserve the preexisting calendar changes and terminology.
- Meeting detail separates agenda, shared notes, private notes and actions. Native call controls form a reachable group. Optional recording and both-participant consent cannot be collapsed into decoration or hidden for visual simplicity.
- Mobile: place conversation/schedule action before secondary connection detail. Keep text inputs at usable width and allow the detail body to scroll without losing dialog controls.

**Required captures:** draft/submitted check-in, empty/populated upcoming/history, schedule dialog, meeting detail, calendar unavailable and join failure. Existing fixtures may lack normal meeting reads; capture gaps explicitly and add valid fixture coverage before calling that route visually verified.

## 6. AD-09 development, coaching and support

**Entry/task:** Growth/Insights or linked follow-up. Identify the plan or person, read current progress, then perform the permitted next step.

- Development plan summary leads with title, participant, state and progress. Goals, skills and activities have distinct sections. Linked learning records display actual sync state and course/plan links; no generic success badge for failed sync.
- Coaching prioritizes the attention queue. Metric definitions remain secondary. Employee/priority filters affect the list below; the Open action stays attached to its specific item.
- Support plan detail shows measurable objectives, expected standard, commitments and review date before workflow actions. Separate manager draft, HR review, employee response and active follow-up through clear state text and existing permissions.
- Formal outcome/rejection/extension controls retain current confirmation/reason behavior. Do not make a sensitive workflow appear as a generic completion button.
- Mobile: stack objective fields, keep labels visible, wrap commitment rows and dialog actions. A full-width field must not force a 300px minimum-width sibling beyond the viewport.

**Required captures:** plan list empty/populated; plan detail/progress; creation dialog; learning empty/failure; coaching list/filter; HR review/employee response/closed support states. QA links them to AD-09.1-5 and existing lifecycle tests.

## 7. AD-10 talent and succession

**Entry/task:** authorized Insights navigation. Select a talent review, inspect frozen evidence, enter a human proposal/calibration or maintain permitted critical-role coverage.

- Review selector, state and person scope precede the grid. Use a neutral evidence panel for frozen values; use form controls only for editable potential/readiness/rationale.
- A human decision and an AI evidence brief must remain visibly different. Brief acceptance never looks like final classification. The rationale is adjacent to the decision fields.
- Closed review visibly states read-only and offers Close. Existing save/transition controls remain absent. Succession coverage stays behind its explicit grant.
- The grid may scroll horizontally within its panel. At 390px, employee identity, state and Assess/View remain findable without page-level overflow. Preserve full accessible names for truncated labels.

**Required captures:** review list/grid, assessment dialog, closed-review dialog, succession empty/populated and nomination form. Include denied employee and unavailable-read states. Human decision authority and frozen source evidence are unchanged.

## 8. AD-11 competency

**Entry/task:** existing competency navigation or embedded appraisal slot. HR prepares definitions/cycles; assessors compare evidence to the frozen role; participants read permitted published results.

- Keep the shared competency header and subnavigation, using the same token/control system as the rest of Performance. Back to appraisals stays secondary. Selected Overview/Assessments/Role library/Frameworks/Strategy/Cycles remains clear at narrow width.
- Library rows show name, source, publication/version and Open. Search/status filters precede the list. Editors group source/provenance, role expectations and publication decisions rather than expose one undifferentiated wall.
- Assessment workbench keeps role/version and expected-versus-observed close to findings. Evidence/manual oral/feedback/completion sections retain their existing tabs and privacy. A missing evidence state must not look like a score of zero.
- Manual assessment works without connected AI/calendar. Optional evidence consent, source-unavailable recovery and retention controls remain discoverable when applicable.
- Reports separate published human outcome, score explanation, frozen role/version and evidence. Version selector/export controls remain actor-scoped. Print keeps readable solid light surfaces and excludes interface chrome using existing print rules.
- Do not alter occupational-role versus identity-role language or introduce a new scoring/version model.

**Required captures across all 18 routes:** programme overview, lists/empty results, each new/editor type, cycle setup, assessment list/workbench, evidence/oral/completion states, published report/cohort/settings and denied/error/history views. A representative screenshot proves shared styling only; the screen manifest must still record every route's actual status.

### Direct PRD preservation mapping

All three pages of the original `C:/Users/User/Downloads/Seemplify Competency Assessment PRD.pdf` were extracted and read directly on 21 October 2026. The redesign is bounded by the user brief; the PRD supplies the existing competency requirements that presentation must preserve. [Source review receipt](evidence/prd-source-review.json) records the original file hash and inspected pages.

| Original PRD location | Preserved requirement in AD-11 | Design implication |
|---|---|---|
| Page 1, overview/input selection/frameworks/role mapping | Configurable SFIA/internal/strategy combinations, distinct native source levels and role expectations | Keep selected inputs, source/version and expected levels legible; no relabeling into an assumed universal scale |
| Page 1, evidence/oral/AI sections | Participant-linked evidence; manual oral capture; consent/access controls for recordings; optional reviewable AI drafts | Keep evidence gaps, provenance, manual path, consent and draft status visible; no extra mandatory integration |
| Page 2, evaluation workspace/completion checks | Save/resume findings, required rationale/evidence and reasoned authorized exceptions | Preserve editable versus submitted states, input labels, missing-item messages and recovery without losing drafts |
| Page 2, scoring/thresholds/ranking/finalisation | Versioned calculation; configured ranking; separate proposed outcome and assessor-controlled final classification without another approval queue | Present score explanation and human decision distinctly; do not introduce new scoring or approval behavior |
| Page 2, reports/cohort/audit/required screens | Permission-aware participant/cohort views, export parity and retained historical criteria/calculations | Preserve report scope, version context, readable print/export controls and historical evidence |
| Page 3, QA scenarios | Seven source combinations, calculation/version checks, manual oral and separately tested integrations, permission/tenant denials | Reuse the existing competency verification programme; screenshots verify presentation and cannot replace these functional checks |

## 9. AD-12 action centre, AI and tutorial

**Entry/task:** notification, account gate or Guide link. Determine pending action or connection state, perform the supported next step, return to the original task.

- Action centre rows distinguish actionable, informational and complete items with words and action hierarchy. Filters sit directly above the content and count/empty/error states stay truthful.
- AI account shows connection status, next supported action and return path first. Policy/account details remain secondary. No token/code from a real account appears in report screenshots; fixtures use synthetic data.
- Tutorial is readable task guidance with navigable sections and examples. Avoid promotional hero treatment. Page guide drawer keeps its close control reachable and restores focus to the trigger.
- Mobile: make action targets comfortably touchable, wrap preference controls and avoid floating Guide controls covering a save/footer action.

**Required captures:** actionable/empty action centre; disconnected/pending/error/synthetic-connected account; AI policy settings; tutorial; guide open/closed. Provider connection/generation remains a separately evidenced integration outcome.

## 10. Ownership and approval contract

The shared-system developer owns typography, colors, surfaces, MUI primitives and global responsive/preference behavior. Local-screen developers own only allocated screen exceptions and consume the shared tokens. They must coordinate before changing `CompetencyPage`, `PageGuide`, calendar files or shared dialogs. Existing unrelated dirty work is preserved.

For each story: PM checks acceptance and vocabulary; architect checks contract/scope/preservation; design checks rendered desktop/mobile/theme/state evidence. Any unresolved normal-state fixture, overflow, focus, contrast or hidden-action defect remains open. No approval is inferred from silence or from this document's existence.

## 11. Implemented source changes and current verification

PM and architect approved the design handoff before implementation; see [product/design review](PRODUCT-DESIGN-REVIEW.md) and the architect's review log. The first source review passed the bounded login/dashboard changes; the full review passed the feature cleanup and competency-shell inheritance.

- Login now uses one neutral sign-in/status panel, readable identity/retry/Hub actions and an announced timeout. The existing automatic Identity handoff, authenticated redirect, manual retry and 15-second recovery remain. A once-per-mount ref replaces the old synchronous effect state update; this removes its existing lint error without introducing another authentication authority.
- Dashboard retains all Personal/Manager/Admin data, feature gates and links. Its cards use a quiet action footer rather than a second button-looking surface inside a link, and loading has an accessible status message.
- Appraisal, review and report surfaces consume semantic colors instead of inline gradients. Conversational assessment headers/messages use readable opaque surfaces, explicit contrast text and restrained transitions; their assessment state and saved evidence logic is unchanged.
- Competency pages inherit the shared MUI system instead of maintaining descendant overrides for fields and buttons. Existing subnavigation, editor controls, evidence privacy and reports remain intact.
- Actual after-screen review found a contrast defect in solid-background avatars: the inherited blue foreground made some icons invisible. Matching `contrastText` is now explicit at the affected feedback, recognition, meeting, development, team, appraisal/reviewer and tutorial callsites. The call overlay uses readable primary/grey foregrounds. These edits are color properties only; previously committed calendar/call behavior is preserved.

[Differential lint receipt](evidence/lane-b-lint.json) compares current changed frontend TSX with `HEAD` in memory: no new lint error or warning categories were introduced. Existing lint debt is retained explicitly rather than labeled a clean whole-app lint pass. The dedicated login/dashboard lint command passed.

Development-server after captures were paused when simultaneous cold compilation produced document timeouts and auth-guard-only screenshots. Those attempts remain in receipts as failed/loading states. The later isolated production candidate completed all 68 route templates; [growth visual review](GROWTH-VISUAL-REVIEW.md) records the 59 inspected AD-07 to AD-12 images and per-story visual disposition. The final preference correction, actions, CI, exact-revision deployment and authenticated/provider claims retain their separate QA receipts.

Final local disposition: the [retained PM accepted all twelve stories](PRODUCT-IMPLEMENTATION-ACCEPTANCE.md) after the final preference replay and targeted Team OKRs correction. Built/tested tree `d9428462c2efea48cb52c55e4413636d7a7f4935` exactly matches committed `main` source `81212b2ae4528847d41f682af00bdb2e7810c491`. [Screen coverage](SCREEN-COVERAGE.md) indexes 117 authoritative route/state images plus five supplemental visuals, retaining earlier candidate provenance. CI, deployment and authenticated production evidence remain the architect's release gate.

## 12. Later concept comparison and bounded refinements

The user's later request for current-page comparison is recorded separately in [VISUAL-COMPARISON-GROWTH](VISUAL-COMPARISON-GROWTH.md). All 35 growth routes were freshly rendered against matched pre-redesign a93 fixtures; final built tree `7eb9c096330d19b1a854c0f45fa15d0583f09c13` includes the separately committed d1 base. The 35 page views, four populated-role theme/viewport views and strategy proof passed their recorded render checks. The review distinguishes 22 visible affordance/hierarchy gains from 13 refinements rather than claiming a structural redesign of every page.

The PM/architect-approved comparison refinements are underlined competency wayfinding, finite metadata only when the existing response supplies it, and the corrected strategy subtitle. Numeric versions are not inferred from role/framework revision or IDs. Readable existing cards are retained as a responsive adaptation; the concept's table/descriptive-summary/numeric-role-version composition is not claimed as delivered.

The final source review also closed exact conversation-panel exceptions: send icon uses `primary.contrastText`; composer and content container use opaque `background.paper` without blur. Their handlers and disabled states are unchanged. Actual conversation-mode material/contrast verification remains in the architect's focused QA receipt, separate from the growth route screenshots.

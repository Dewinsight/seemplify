# Product review of the Performance Apple design handoff

Reviewer: retained Product Manager 1. Date: 21 October 2026. Product sources: AD-01..AD-12, existing REL acceptance and current user redesign instruction. Reviewed artifacts: `DESIGN.md`, `architecture-01.md` and `evidence/concepts/dashboard-apple-concept.png`. This is a development-readiness decision, not implementation or release acceptance.

## Decision and boundaries

**Approve the shared design direction and AD-01..AD-06 for development after the actual baseline screenshot batch finishes.** Keep the existing tasks, content, scope and data; use the concept for hierarchy and materials, not as a literal inventory of actions. AD-07..AD-12 receive shared-foundation approval only until their family handoff `DESIGN-02.md` is reviewed below. No screen is accepted merely because it inherits a new token.

The concept was visually inspected. System-style typography, adaptive neutral surfaces, blue action cues, a compact context panel and readable grouped metrics fit the requested direction. Three concept details are **not approved as binding implementation instructions**: the prominent blue guide action competing with task actions; all-uppercase small metric labels; and a fixed three-card count that could hide existing permitted destinations. Follow the written secondary-help/normal-case rules and retain all current useful actions.

## Per-story acceptance mapping

| Story | Product criteria covered by the proposed contract | Product design decision | Evidence required before implementation acceptance |
|---|---|---|---|
| AD-01 | 1 token parity; 2 role/workspace fidelity; 3 Identity/recovery; 4 keyboard/focus; 5 reflow; 6 accessibility preferences; 7 immediate feedback; 8 utility access. `DESIGN` sections 2/5 and architecture R01 preserve these. | Approved for development after core baseline capture. | Light/dark native/portal controls; actual menu arrows/Escape/focus return; mobile/zoom; login error/timeout; reduced preferences. No auth changes. |
| AD-02 | 1 reading order; 2 role variants; 3 real metrics/destinations; 4 team context; 5 honest states; 6 responsive primary action. `DESIGN` section 3 retains data/links and gives a compact hierarchy. | Approved for development; preserve every existing permitted destination even if the concept shows three. | Personal/Manager/Admin screenshots and task links, notification continuation, team menu, empty/error and long organization names. |
| AD-03 | 1 visible scope/period; 2 existing authority; 3 faithful progress; 4 validation/recovery; 5 persistence; 6 mobile/keyboard/long content. Architecture R03 preserves the behavior while shared controls change. | Approved for presentation-only development. | Goal list/filter/details/form/alignment and failed-read retry; distinguish unrated from 0%; existing real-API authorization tests remain separate. |
| AD-04 | 1 current task; 2 existing initiation; 3 stages; 4 saved/manual work; 5 scope/read-only; 6 evidence/meeting/consent; 7 frozen history/print; 8 failure/recovery. Architecture R04 retains all. | Approved for presentation-only development, with protected-file coordination. | Populated list/start/detail/manual/conversation/manager/discussion/final/history/report; mobile progress; actual print; draft persistence; no fabricated autosave. |
| AD-05 | 1 operational hierarchy; 2 scope; 3 cycle behavior; 4 calibration decision; 5 filters/export; 6 reflow; 7 difficult data. Shared table/chart/form contract plus R05 supports each. | Approved for presentation-only development. | Populated filtered table/chart, cycle editor, calibration read-only/decision, export and department/long-name cases. Missing fixture data must be called unavailable. |
| AD-06 | 1 people/actions; 2 ID/scope; 3 team summaries; 4 colleague-review distinction; 5 recovery/menu; 6 long text/reflow. R06 retains route and identity differences. | Approved for presentation-only development. | Populated directory/profile/row menus/team tables/assigned-review form, duplicate team names, empty/denied and keyboard focus. |
| AD-07 | C1 plus 07.1..5: tab state, audience/recipient clarity, search/send recovery, project membership and privacy. | Shared-foundation approval; family-design review pending `DESIGN-02.md`. | Feedback/recognition/project populated and dialog states, mobile tabs, empty/error, closed project and privacy-sensitive output. |
| AD-08 | C1 plus 08.1..5: check-in status/persistence, conversation preparation, calendar failure and consent/privacy. | Shared-foundation approval; family-design review pending. | Check-in draft/submitted and one-to-one list/new/detail, disconnected calendar, native-call state and recording consent. Provider success is separate. |
| AD-09 | C1 plus package criteria for development/coaching/support and existing HR/employee handoffs. | Shared-foundation approval; family-design review pending. | Populated plan/coaching/support forms and role states, read-only/failure/recovery; learning sync truth remains unchanged. |
| AD-10 | C1 plus 10.1..5: permitted talent scope, frozen versus editable evidence, contained grid and closed-review state. | Shared-foundation approval; family-design review pending. | Manager/HR populated grids and evidence dialog, closed read-only review, mobile, empty/error and succession permission. |
| AD-11 | C1 plus 11.1..6: all 18 routes, library/version clarity, assessment evidence, privacy/human outcomes, report/history/print. | Shared-foundation approval; family-design review pending. | Every route has an explicit result; workbench/editor/report/cohort/settings states need real captures/tests. Generated concepts cannot certify the competency PRD. |
| AD-12 | C1 plus 12.1..5: action state, account truth, unchanged policy/manual path and secondary help. | Shared-foundation approval; family-design review pending. | Actionable/completed/empty/error, account disconnected/pending/failed/connected, guide focus and tutorial. A connected fixture is not real AI execution. |

## Capture and release evidence rules

Core before captures use an owned local browser against `http://127.0.0.1:5025`, existing synthetic Playwright fixtures, and the actual current source. The source analysis began at `9e8fecc1`; another workstream advanced `main` to `39c3f4ff` with calendar/notetaker changes before this programme's implementation. The capture manifest records actual capture revision and separates it from the analysis baseline.

Missing mocks, unavailable secondary data, denied states, redirects and page errors must be recorded in `evidence/before/core-capture.json`; they are useful recovery observations but do not count as populated positive acceptance. Route screenshots are a visual baseline, not proof of production, persistence or authorization. Implementation acceptance follows after developer pair review and architect QA with actual after screenshots and task evidence.

## Family handoff review - AD-07..AD-12

Reviewed `DESIGN-02.md` sections 3..9 against C1 and every story-specific criterion in `product-02.md`, plus architecture R07..R12. **AD-07..AD-12 are approved for presentation-only development after their baseline batch completes.** The previous pending decisions above are superseded by this explicit review; implementation and release acceptance remain pending.

- AD-07.1..5: retained six-view tabs, explicit recipient/audience grouping, in-form search/send recovery, closed-project action gating and existing privacy contract are specified. `/team/feedback` is a real scoped page; only `/feedback/new` redirects.
- AD-08.1..5: check-in draft/submitted visibility and persistence, meeting preparation/details, calendar recovery, private versus shared notes and consent are preserved. Missing normal meeting fixture data is an open verification item, not a design reason to remove the screen.
- AD-09.1..5: plan identity/state/action, truthful learning synchronization, measurable support commitments, role-specific transitions and failure recovery are specified. Formal HR decisions remain explicit and actor-scoped.
- AD-10.1..5: review selection/scope, frozen evidence versus editable rationale, contained mobile grid, closed read-only behavior and HR succession grant are preserved.
- AD-11.1..6: all 18 route entries, shared library/editor version hierarchy, expected-versus-observed assessment, manual/optional integration path, private drafts, human finalization and published/history/print views are specified. Actual after-state coverage must still close the route register.
- AD-12.1..5: action/informational/completed states, truthful account status, existing policy/manual paths, reachable tutorial and secondary guide behavior are specified. Synthetic connected/pending account screens cannot prove a provider login or generation.

C1 remains the shared pass bar: preserved role/data authority, both themes/target widths, text/control contrast, focus and dialog behavior, reduced preferences, honest states and per-layer evidence. The detailed required-capture lists are suitable development/QA inputs; they are not evidence that those captures or tests have already passed.

## Team A partner review of the foundation draft

Reviewed draft `performance-design.ts`, `globals.css`, `theme.ts` and `Layout.tsx` under `.codex-temp/apple-design` before import. No app source was edited by this reviewer.

| Finding | Evidence and required result | Draft disposition |
|---|---|---|
| Control-edge contrast | Proposed light strong edge `#b7b9c4` against white measured 1.95:1; dark `#626571` against `#1c1d21` measured 2.90:1. Input boundaries need an appropriate contrasting token. | Implementer changed to `#858791` light (3.58:1) and `#777a87` dark (3.94:1); subtle separators remain separate. Browser/control check remains required. |
| Dark semantic text | Existing features sometimes consume `palette[status].dark` as foreground. A light-theme deep green `#105835` on the dark surface measured 1.98:1. | Implementer adapted dark semantic `.dark` values to the current readable semantic main; verify actual status chips/forms after import. |
| Mobile-to-desktop resize | Open mobile state could survive while `lg:hidden` hides the dialog, leaving header/main inert and body scrolling locked. | Draft now observes the desktop breakpoint, closes mobile state and cleans up inert/scroll state. Verify by opening at 390px then resizing to desktop. |
| Tab leaving a custom menu | The draft initially handled arrows/Home/End/Escape but could leave an open menu when Tab moves focus behind it. | Requested close on Tab exit without preventing normal navigation; final implementation/browser review pending. |

Shared architecture, system typography, scoped materials, semantic aliases, immediate native press feedback, skip link and current-page markers fit the approved design. These source findings are peer review, not a substitute for keyboard, theme and responsive browser verification.

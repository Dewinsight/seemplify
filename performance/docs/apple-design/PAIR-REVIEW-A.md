# Team A foundation implementation peer review

Reviewer: retained PM / Team A partner. Date: 21 October 2026. Scope: imported local working-tree implementation on `main` after `39c3f4ff`. No code, commit or deployment was performed by this reviewer.

## Reviewed paths and decisions

| Paths | Review outcome |
|---|---|
| `frontend/lib/performance-design.ts`, `app/layout.tsx` | Fixed public palette values feed deterministic server-rendered CSS variables and MUI. Root layout retains existing providers/auth guard, removes remote fonts and uses Performance/Seemplify metadata. No secret, user-input CSS or API change introduced. |
| `frontend/app/theme.ts`, `app/globals.css`, `tailwind.config.js` | Shared light/dark system typography, neutral surfaces, action/status colors, portal primitives and focus/preference behavior are consistent with the approved contract. Input edges use the corrected stronger contrast tokens; semantic `.dark` foreground values adapt in dark mode. Tailwind consumes RGB aliases from the same palette. |
| `frontend/components/Layout.tsx` | Existing role/feature/workspace navigation and actions are retained. Chrome is scoped; skip/current-page semantics, desktop keyboard menus and mobile focus/inert/scroll handling were added. Breakpoint cleanup closes the hidden mobile dialog. Tab exit is handled by `onBlurCapture`, preserving native new focus. |
| `frontend/components/ui/button.tsx`, `card.tsx`, `badge.tsx` | Buttons retain native disabled/click semantics and add immediate press feedback. Card hierarchy and status badges use adaptive semantic tokens. No domain state/payload change observed. |
| `frontend/components/PageGuide.tsx` | Help becomes a secondary text/outlined action, uses adaptive surface/safe-area offsets and keeps existing drawer/tutorial access. Actual mobile overlap remains part of full-page visual review. |

The implementation preserves the framework, data hooks, central Identity and shared theme preference mechanism. `git diff --check` passed on the reviewed paths; Git emitted only line-ending normalization warnings. This peer review does not replace the architect's TypeScript/build, regression and release gates.

## Findings resolved before acceptance

1. **Control-edge contrast:** light `#858791` on white measures 3.58:1; dark `#777a87` on `#1c1d21` measures 3.94:1. Subtle content separators remain separate.
2. **Dark status foreground:** `.dark` semantic foreground adapts to readable current-mode colors, retaining semantic meaning.
3. **Accent-fill foreground:** shell account/mobile/no-organization filled surfaces now use `--suite-action-ink`; actual dark account initial computed as `rgb(7,20,38)` over `rgb(100,167,255)`.
4. **Mobile resize lock:** the breakpoint listener closes mobile state and restores document interaction when the viewport grows to desktop.
5. **Desktop Tab dismissal:** wrapper blur handling closes a menu when native focus leaves it. No premature unmount or focus reset was added.

## Independent browser verification

Controlled existing Playwright fixtures against owned local port 5025. See `evidence/after/core-shell-review.json`. **14 checks passed; zero browser page errors in this focused run.**

- ArrowDown opens a navigation menu and focuses its first item; End focuses its last item.
- Tab leaves and closes the menu while preserving focus on the next control.
- Escape closes the menu and returns focus to its trigger.
- Skip to content focuses the main region.
- Dark account initial uses the matching action-foreground token.
- Mobile navigation contains focus and makes background content inert; Escape restores the trigger.
- Resizing an open mobile navigation to desktop removes the dialog and unlocks the document.
- Reduced transparency produces solid chrome without backdrop blur.
- Increased contrast strengthens the separator token.
- Reduced motion removes spatial transition duration.
- Goal detail dismissal returns focus to its opener.
- A dark-theme goal creation dialog fits 390px with no document overflow.

Additional actual captures: `evidence/after/core-goal-details-dark-1440.png`, `core-goal-create-dark-1440.png` and `core-goal-create-dark-390.png`. These are local synthetic UI evidence, not authorization, persistence or production/provider proof.

## Disposition

**Foundation peer review passed for integrated QA.** No open blocker was found in the reviewed code or focused interaction checks after the above corrections. The full core after-screen batch, difficult-state visual review, architect regression tests and product implementation acceptance remain separate gates. Missing normal-state fixtures cannot be marked passing from shared styles or recovery screenshots.

### After-capture execution pause

The coordinator paused parallel screenshot clients so the architect can run serialized QA against the owned Next server. The partial core receipt preserves 24 attempts, including three route navigation timeouts under compile load; these are not passing route checks. The extras receipt retains repeated attempts separately and reports the latest result per requested template. All owned capture clients were stopped, while port 5025's server remained running. Resume missing/failed screenshots serially only after the coordinator releases the QA tranche. The focused 14-check result above completed before the slowdown and remains a separate evidence layer.

## Independent live-QA helper review — 21 October

**Passed source peer review.** Reviewed only the diffs in `frontend/e2e-live/appraisal-discussion-navigation.spec.ts`, `competency-role-journey.spec.ts` and `feature-actions.spec.ts`. The reviewer made no test or application edits.

- Three login waits now use the actual accessible name `Account menu` instead of the visual avatar initial `A`. Actor login URLs and API identity headers remain unchanged.
- The competency workspace trigger accepts the anchored current labels Personal, Manager or Admin, then still selects the exact actor-appropriate menu-item radio. This tolerates a persisted workspace without granting another actor's capabilities.
- Completed discussion reading first opens the existing Previous work & analytics tab. Baseline `a93ddbf9` already placed View Discussion inside that history panel. Employee and manager still must see saved, disabled discussion text; employee write denial and foreign-record denial remain asserted.
- Finalization now expects `/appraisals/{id}/report`. Baseline `a93ddbf9` already calls `router.push` with that report path after successful completion. The completed status, rating, API response, historical report and CSV assertions remain intact.

No assertion was removed, no permission requirement weakened, and no request was replaced with synthetic transport in these real disposable-API tests. Executable evidence is separate: `realapi-journeys-replay-2.json` retains 19 passes and the stale destination assertion failure; `realapi-history-replay.json` records the corrected journey passing. This is 20 covered journeys across the tranche and focused replay, not a fabricated clean single-run receipt.

The original production preference probe in this file was superseded by the optimized-build check: tree `547284f5` passes all eight focused checks and the unchanged mobile Final Rating assertion. Earlier b79 failures remain in the attempts ledger. Default route screenshots retain their original b79 provenance.

## Additional visual-comparison correction: People

Full-size before/current comparison reopened AD-06 on the pre-existing narrow People member card: stats overlapped identity while the page still passed numerical overflow checks. Root's source correction in `frontend/app/team/page.tsx` independently passed this review: the under-1280px layout reserves an avatar/identity grid row, then full-width metric and action rows; names/title/email wrap deliberately. The wide desktop arrangement remains. The former floating New 1:1 action becomes an inline outlined secondary action, retaining its existing feature predicate and exact destination. No data, scope, member action handler or API change is present.

The two added light/dark cases in `frontend/e2e/people-and-teams.spec.ts` also passed source peer review. They provide long identity/title/email and populated active/attention/score/feedback badges, assert readable width and separated geometry, then exercise the actual profile and scheduled-meeting recipient destinations. The original organization/managed-scope cases remain. Source review is not a passing browser result: final compiled candidate captures and executable results are required before closing the reopened gate.

AD-11 product review additionally approved a narrowly scoped concept-alignment change: underline the active competency subnavigation while retaining its href, focus/target and `aria-current`; show version only from existing finite numeric metadata and omit unknown values. This adds no business model, permission or API requirement. Final populated representative captures remain the designer/QA gate.

## Final frozen combined-source closure

Actual production tree `7eb9c096330d19b1a854c0f45fa15d0583f09c13` passes retained PM visual acceptance: fresh core49+5, six long-content People views and 15 matched report/conversation supplementals, with no recorded page errors/failed fixture reads/document overflow. Final People full-size/native images confirm separated readable identity, metrics and actions. All 18 refreshed matched contact sheets were inspected. Chat Send settles to 5.57:1 light / 7.49:1 dark; composer/content are opaque alpha1/opacity1 with no blur and no draft submission. Full receipt: [surface evidence](evidence/final-comparison/report-surface-capture.json). These are actual app pixels with synthetic transport, not provider/production proof.

Independent QA review retains all domain assertions. The new Schedule expectation follows the existing `/one-on-ones?compose=true` redirect with exact employeeId/name and adds the selected recipient field assertion. Latest executable receipts: combined UI25/25; real API19 initial passes/one failure, unchanged HR case3/3 replay passes, cause unknown. [Current product gate](PRODUCT-IMPLEMENTATION-ACCEPTANCE.md) supersedes historical candidate clearance. Separate main d1 analytics work is preserved and not attributed to this design programme.

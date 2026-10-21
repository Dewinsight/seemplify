# Performance Management Apple redesign: QA plan

Owner: retained Solution Architect / QA. Date: 21 October 2026. Status: planned; results belong in `REVIEW-LOG.md` and evidence manifests.

## 1. Acceptance model

Every AD story maps to product acceptance, architecture requirements, screen/state evidence, implementation paths and tests. The architect acts as QA, but the retained product reviewer checks whether the result meets the user task. Developer self-checks do not replace that acceptance pass.

Risk priorities: (1) authentication/tenant/role containment and historical appraisal integrity; (2) lost drafts, broken submit/recovery, unreadable dialogs and inaccessible navigation; (3) mobile overflow, theme contrast, chart/report readability; (4) cosmetic spacing and motion polish. [ISTQB risk-based testing](https://glossary.istqb.org/en_US/term/risk-based-testing).

## 2. Screen and state evidence

| Dimension | Required coverage |
| --- | --- |
| Route inventory | Every `app/**/page.tsx` assigned to one AD story; redirects identified separately. Record route, role, data fixture, baseline/after screenshot and result. |
| Roles | Employee/personal, manager, HR/admin and selected reviewer where applicable; denied/anonymous access remains contained. Do not infer authority from a visible menu. |
| Viewports | Desktop 1440x1000 or equivalent, mobile 390x844, plus 200% zoom/text sizing on representative dense forms/navigation. Tables scroll inside their containers. |
| Theme/material | Light, dark, system preference; portal menus/dialogs; reduced transparency and increased contrast. Text remains readable over material. |
| Motion/input | Reduced motion, keyboard focus/Tab, Enter/Space, Escape, focus restoration, immediate press feedback, disabled/busy controls. No decorative movement needed to complete a task. |
| States | Populated, empty, loading, failed read/retry, validation error, saving/saved, read-only/denied, long names/text and historical/print where present. |
| Evidence integrity | Synthetic/local data labeled clearly. Generated concepts labeled separately from implemented screenshots. Capture timestamp, source SHA and environment; exclude tokens/secrets/personal production records. |

Automated scans detect only some accessibility issues; combine them with keyboard, contrast and layout review. Do not claim WCAG conformance from screenshots or a single scan. [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing).

## 3. Execution sequence

1. Identify the process/workdir/command of any existing listener before starting servers. Initial observation: port 5015 was occupied; do not terminate an unrelated process.
2. Save a baseline inventory and representative screenshots before style changes, using safe fixtures or an authorized read-only browser session.
3. After both developer lanes are ready, run `npx tsc --noEmit` and scoped ESLint on modified source; record pre-existing failures separately. Build once with production settings after owned dev servers stop.
4. Run a dedicated design/screen matrix covering all routes and representative states. Use auto-retrying role/label assertions; wait for meaningful page state, not fixed sleeps. Save success screenshots and failure traces.
5. Run existing mocked browser journeys: `npm run test:e2e`. Include `auth-route-recovery`, `appraisal-navigation-accessibility`, `people-and-teams`, `performance-journeys`, competency library/assessment and continuous-performance suites. The folder also contains fullstack fixture tests; label individual layers accurately.
6. Stop only the owned mock-config Next server. The mocked config compiles `NEXT_PUBLIC_API_URL=http://127.0.0.1:5015/__mock-api`; the real suite compiles API5014. They must not share a running server or compete for `.next`.
7. Run `npm run test:e2e:live` sequentially against the disposable full backend (`tests/helpers/liveJourneyServer.js` API5014), with real product API requests. Save output before another Playwright invocation replaces it. This proves disposable full-application behavior, not production providers.
8. Review screenshots manually: visual hierarchy, task/action proximity, all modal/drawer/empty/error states, responsive primary action and long text. Product reviewer and architect record accepted/rework per story.
9. Only after local gates pass: commit exact approved paths; CI and deployment; live revision, OIDC start and authenticated production browser smoke. Complete release record separately.

Do not run two Next development servers or a build/dev pair against one checkout. If another task owns the existing server, coordinate or use an isolated copy/worktree with an explicitly separate output directory.

## 4. Minimum regression packages

| Family | Meaningful checks |
| --- | --- |
| Shell/login/dashboard | No private reads before auth; workspace switch; organization context; nav/guide/theme/Hub; retry/timeout; focus and responsive header. |
| Goals/OKRs | Personal/team/org permissions; list/detail/create/check-in/alignment; current/upcoming/history; error retry and modal return focus. |
| Appraisals/cycles/reviews | Launch steps; draft refresh; reviewer assignment; self/manager/discussion/calibration/final flow; historical report/CSV/print; read-only final records. |
| People/admin/analytics | Role restriction; long names/filter/empty; team switching; table scrolling; chart labels and theme contrast; drilldown/report. |
| Continuous performance | Feedback/360, recognition audience, project participants, check-in draft/submit, 1:1 scheduling/history, development, coaching, support-plan transitions and talent maintenance. Preserve existing in-flight calendar work. |
| Competency/AI/help | Versioned libraries, forms, evidence/consent, linked assessment/report, settings and error recovery; AI account unavailable/reconnect; tutorial navigation. |

Backend unit/integration reruns are required only if backend/contracts change or browser evidence raises a backend concern. This visual programme should not create backend changes merely to expand testing.

## 5. Gate and defect policy

- **Ready for implementation:** story + architecture + UX handoff and PM/architect sign-off, exact path owner, test scenarios defined.
- **Ready for QA:** both lanes finish and reconcile shared token dependencies; no overlapping edits; developer validation attached.
- **Ready for release:** no unresolved auth/data-loss/accessibility blocker; each story has reviewed screenshots and matching tests; production build passes; unrelated dirty work excluded.
- **Release complete:** pushed/CI/deployed revision agrees with tested `main`, live OIDC and authenticated smoke pass, rollback reference and PDF evidence are current.

Defects record story, route/state/role, reproduction, expected/actual, severity, owner, fix SHA and retest artifact. Failed tests are investigated rather than deleted or weakened. Unavailable provider/live evidence remains explicitly pending; no relabeling of mock success as live acceptance.

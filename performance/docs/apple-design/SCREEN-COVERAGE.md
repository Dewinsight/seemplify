# Performance screen coverage

Generated from the actual `performance/frontend/app/**/page.tsx` census and browser receipts on 21 October 2026. This is an evidence index, not an all-acceptance pass certificate. API routes, tab states and embedded controls are additional coverage; they are not counted as page routes.

## Latest matched before / current audit

This section answers the later request to inspect every current page against the desired design and a fair baseline. It supersedes the older candidate images for current visual judgement; the historical records below remain unchanged.

The matched before build is pre-redesign `a93ddbf9f5274b2083818a6c60f78c9dd49c92f5`, tree `8f97b7f88ded397c3d291158645b6fe138c3cad6`. The fresh current build is exact tree `7eb9c096330d19b1a854c0f45fa15d0583f09c13`, based on committed `d1b0307c0504548bf8b76630d622057ab9149362`; its [follow-up source manifest](evidence/followup-source-manifest.json) records the final application/test paths and subsequent commit. Both are actual isolated default production builds with the same synthetic fixture shapes/actors/states. They do not claim authenticated deployed production data.

**68/68 exact route templates** have both matched before and fresh current evidence. Matched before: 93 unique receipt images. Fresh current: 94 unique receipt images (including four populated-role desktop/mobile/theme views and one strategy metadata proof). Recorded browser errors / failed API reads / page overflows: before **0/0/0**, current **0/0/0**. [Machine-readable latest index](evidence/final-comparison/screen-coverage.json).

These are the indexed core/growth route and state receipts. Additional People, conversation and interaction supplements retain their own receipts; they do not increase the 68-template route census.

[Core visual comparison](VISUAL-COMPARISON-CORE.md) and [growth visual comparison](VISUAL-COMPARISON-GROWTH.md) judge hierarchy, density, controls, readability, task clarity and concept gaps per route. Coverage is not a claim that every page received a new structure or that every business state was visually tested.

| Exact route template | Matched before | Current final |
|---|---|---|
| `/` | [rendered-fixture](evidence/comparison-baseline/core-root-light-1440.png) · desktop light | [rendered-fixture](evidence/final-comparison/core-root-light-1440.png) · desktop light |
| `/action-centre` | [captured](evidence/comparison-baseline/growth-action-centre-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-action-centre-desktop-light.png) · desktop light |
| `/admin` | [rendered-fixture](evidence/comparison-baseline/core-admin-light-1440.png) · desktop light | [rendered-fixture](evidence/final-comparison/core-admin-light-1440.png) · desktop light |
| `/admin/appraisal-cycles` | [rendered-fixture](evidence/comparison-baseline/core-cycles-light-1440.png) · desktop light | [rendered-fixture](evidence/final-comparison/core-cycles-light-1440.png) · desktop light |
| `/admin/appraisal-cycles/[id]` | [rendered-fixture](evidence/comparison-baseline/core-cycle-detail-light-1440.png) · desktop light | [rendered-fixture](evidence/final-comparison/core-cycle-detail-light-1440.png) · desktop light |
| `/admin/appraisal-cycles/[id]/edit` | [rendered-fixture](evidence/comparison-baseline/core-cycle-edit-light-1440.png) · desktop light | [rendered-fixture](evidence/final-comparison/core-cycle-edit-light-1440.png) · desktop light |
| `/admin/appraisal-cycles/new` | [rendered-fixture](evidence/comparison-baseline/core-cycle-new-light-1440.png) · desktop light | [rendered-fixture](evidence/final-comparison/core-cycle-new-light-1440.png) · desktop light |
| `/admin/calibration` | [rendered-fixture](evidence/comparison-baseline/core-calibration-light-1440.png) · desktop light | [rendered-fixture](evidence/final-comparison/core-calibration-light-1440.png) · desktop light |
| `/admin/departments/[department]` | [rendered-fixture](evidence/comparison-baseline/core-department-light-1440.png) · desktop light | [rendered-fixture](evidence/final-comparison/core-department-light-1440.png) · desktop light |
| `/admin/reports` | [rendered-fixture](evidence/comparison-baseline/core-reports-light-1440.png) · desktop light | [rendered-fixture](evidence/final-comparison/core-reports-light-1440.png) · desktop light |
| `/admin/review-cycles` | [rendered-fixture](evidence/comparison-baseline/core-review-cycles-light-1440.png) · desktop light | [rendered-fixture](evidence/final-comparison/core-review-cycles-light-1440.png) · desktop light |
| `/ai-account` | [captured](evidence/comparison-baseline/growth-ai-account-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-ai-account-desktop-light.png) · desktop light |
| `/analytics` | [rendered-fixture](evidence/comparison-baseline/core-analytics-light-1440.png) · desktop light, desktop dark, mobile light | [rendered-fixture](evidence/final-comparison/core-analytics-light-1440.png) · desktop light, desktop dark, mobile light |
| `/appraisals` | [rendered-fixture](evidence/comparison-baseline/core-appraisals-light-1440.png) · desktop light | [rendered-fixture](evidence/final-comparison/core-appraisals-light-1440.png) · desktop light |
| `/appraisals/[appraisalId]` | [rendered-fixture](evidence/comparison-baseline/core-appraisal-detail-light-1440.png) · desktop light | [rendered-fixture](evidence/final-comparison/core-appraisal-detail-light-1440.png) · desktop light |
| `/appraisals/[appraisalId]/calibration` | [rendered-fixture](evidence/comparison-baseline/core-appraisal-calibration-light-1440.png) · desktop light | [rendered-fixture](evidence/final-comparison/core-appraisal-calibration-light-1440.png) · desktop light |
| `/appraisals/[appraisalId]/discussion` | [rendered-fixture](evidence/comparison-baseline/core-appraisal-discussion-light-1440.png) · desktop light | [rendered-fixture](evidence/final-comparison/core-appraisal-discussion-light-1440.png) · desktop light |
| `/appraisals/[appraisalId]/final-review` | [rendered-fixture](evidence/comparison-baseline/core-appraisal-final-light-1440.png) · desktop light | [rendered-fixture](evidence/final-comparison/core-appraisal-final-light-1440.png) · desktop light |
| `/appraisals/[appraisalId]/goal-setting` | [rendered-fixture](evidence/comparison-baseline/core-appraisal-goals-light-1440.png) · desktop light | [rendered-fixture](evidence/final-comparison/core-appraisal-goals-light-1440.png) · desktop light |
| `/appraisals/[appraisalId]/manager-review` | [rendered-fixture](evidence/comparison-baseline/core-appraisal-manager-light-1440.png) · desktop light, desktop dark, mobile light | [rendered-fixture](evidence/final-comparison/core-appraisal-manager-light-1440.png) · desktop light, desktop dark, mobile light |
| `/appraisals/[appraisalId]/report` | [rendered-fixture](evidence/comparison-baseline/core-appraisal-report-light-1440.png) · desktop light | [rendered-fixture](evidence/final-comparison/core-appraisal-report-light-1440.png) · desktop light |
| `/appraisals/[appraisalId]/self-assessment` | [rendered-fixture](evidence/comparison-baseline/core-appraisal-self-light-1440.png) · desktop light, desktop dark, mobile light | [rendered-fixture](evidence/final-comparison/core-appraisal-self-light-1440.png) · desktop light, desktop dark, mobile light |
| `/appraisals/removed` | [rendered-fixture](evidence/comparison-baseline/core-appraisals-removed-light-1440.png) · desktop light | [rendered-fixture](evidence/final-comparison/core-appraisals-removed-light-1440.png) · desktop light |
| `/appraisals/start` | [rendered-fixture](evidence/comparison-baseline/core-appraisal-start-light-1440.png) · desktop light, desktop dark, mobile light | [rendered-fixture](evidence/final-comparison/core-appraisal-start-light-1440.png) · desktop light, desktop dark, mobile light |
| `/check-ins` | [captured](evidence/comparison-baseline/growth-check-ins-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-check-ins-desktop-light.png) · desktop light |
| `/coaching` | [captured](evidence/comparison-baseline/growth-coaching-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-coaching-desktop-light.png) · desktop light |
| `/competency` | [captured](evidence/comparison-baseline/growth-competency-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-competency-desktop-light.png) · desktop light |
| `/competency/assessments` | [captured](evidence/comparison-baseline/growth-competency--assessments-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-competency--assessments-desktop-light.png) · desktop light |
| `/competency/assessments/[assessmentId]` | [captured](evidence/comparison-baseline/growth-competency--assessments--assessment-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-competency--assessments--assessment-desktop-light.png) · desktop light |
| `/competency/cycles` | [captured](evidence/comparison-baseline/growth-competency--cycles-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-competency--cycles-desktop-light.png) · desktop light |
| `/competency/cycles/[id]` | [captured](evidence/comparison-baseline/growth-competency--cycles--created-cycle-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-competency--cycles--created-cycle-desktop-light.png) · desktop light |
| `/competency/cycles/new` | [captured](evidence/comparison-baseline/growth-competency--cycles--new-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-competency--cycles--new-desktop-light.png) · desktop light |
| `/competency/frameworks` | [captured](evidence/comparison-baseline/growth-competency--frameworks-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-competency--frameworks-desktop-light.png) · desktop light |
| `/competency/frameworks/[id]` | [captured](evidence/comparison-baseline/growth-competency--frameworks--created-framework-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-competency--frameworks--created-framework-desktop-light.png) · desktop light |
| `/competency/frameworks/new` | [captured](evidence/comparison-baseline/growth-competency--frameworks--new-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-competency--frameworks--new-desktop-light.png) · desktop light |
| `/competency/reports` | [captured](evidence/comparison-baseline/growth-competency--reports-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-competency--reports-desktop-light.png) · desktop light |
| `/competency/reports/[assessmentId]` | [captured](evidence/comparison-baseline/growth-competency--reports--assessment-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-competency--reports--assessment-desktop-light.png) · desktop light |
| `/competency/roles` | [captured](evidence/comparison-baseline/growth-competency--roles-desktop-light.png) · desktop light, desktop dark, mobile light, mobile dark | [captured](evidence/final-comparison/growth-competency--roles-desktop-light.png) · desktop light, desktop dark, mobile light, mobile dark |
| `/competency/roles/[id]` | [captured](evidence/comparison-baseline/growth-competency--roles--created-role-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-competency--roles--created-role-desktop-light.png) · desktop light |
| `/competency/roles/new` | [captured](evidence/comparison-baseline/growth-competency--roles--new-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-competency--roles--new-desktop-light.png) · desktop light |
| `/competency/settings` | [captured](evidence/comparison-baseline/growth-competency--settings-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-competency--settings-desktop-light.png) · desktop light |
| `/competency/strategies` | [captured](evidence/comparison-baseline/growth-competency--strategies-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-competency--strategies-desktop-light.png) · desktop light |
| `/competency/strategies/[id]` | [captured](evidence/comparison-baseline/growth-competency--strategies--strategy-1-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-competency--strategies--strategy-1-desktop-light.png) · desktop light |
| `/competency/strategies/new` | [captured](evidence/comparison-baseline/growth-competency--strategies--new-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-competency--strategies--new-desktop-light.png) · desktop light |
| `/dashboard` | [rendered-fixture](evidence/comparison-baseline/core-dashboard-personal-light-1440.png) · desktop light, desktop dark, mobile light | [rendered-fixture](evidence/final-comparison/core-dashboard-personal-light-1440.png) · desktop light, desktop dark, mobile light |
| `/development` | [captured](evidence/comparison-baseline/growth-development-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-development-desktop-light.png) · desktop light |
| `/feedback` | [captured](evidence/comparison-baseline/growth-feedback-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-feedback-desktop-light.png) · desktop light |
| `/feedback/new` | [captured](evidence/comparison-baseline/growth-feedback--new-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-feedback--new-desktop-light.png) · desktop light |
| `/login` | [rendered-fixture](evidence/comparison-baseline/core-login-error-light-1440.png) · desktop light | [rendered-fixture](evidence/final-comparison/core-login-error-light-1440.png) · desktop light |
| `/okrs` | [rendered-fixture](evidence/comparison-baseline/core-goals-light-1440.png) · desktop light, desktop dark, mobile light | [rendered-fixture](evidence/final-comparison/core-goals-light-1440.png) · desktop light, desktop dark, mobile light |
| `/okrs/alignment` | [rendered-fixture](evidence/comparison-baseline/core-alignment-light-1440.png) · desktop light | [rendered-fixture](evidence/final-comparison/core-alignment-light-1440.png) · desktop light |
| `/one-on-ones` | [captured](evidence/comparison-baseline/growth-one-on-ones-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-one-on-ones-desktop-light.png) · desktop light |
| `/one-on-ones/[meetingId]` | [captured](evidence/comparison-baseline/growth-one-on-ones--507f1f77bcf86cd799439011-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-one-on-ones--507f1f77bcf86cd799439011-desktop-light.png) · desktop light |
| `/one-on-ones/new` | [captured](evidence/comparison-baseline/growth-one-on-ones--new-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-one-on-ones--new-desktop-light.png) · desktop light |
| `/project-feedback` | [captured](evidence/comparison-baseline/growth-project-feedback-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-project-feedback-desktop-light.png) · desktop light |
| `/recognition` | [captured](evidence/comparison-baseline/growth-recognition-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-recognition-desktop-light.png) · desktop light |
| `/reviews` | [rendered-fixture](evidence/comparison-baseline/core-reviews-light-1440.png) · desktop light | [rendered-fixture](evidence/final-comparison/core-reviews-light-1440.png) · desktop light |
| `/reviews/[id]` | [rendered-fixture](evidence/comparison-baseline/core-review-detail-light-1440.png) · desktop light | [rendered-fixture](evidence/final-comparison/core-review-detail-light-1440.png) · desktop light |
| `/settings/ai` | [captured](evidence/comparison-baseline/growth-settings--ai-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-settings--ai-desktop-light.png) · desktop light |
| `/support-plans` | [captured](evidence/comparison-baseline/growth-support-plans-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-support-plans-desktop-light.png) · desktop light |
| `/talent` | [captured](evidence/comparison-baseline/growth-talent-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-talent-desktop-light.png) · desktop light |
| `/team` | [rendered-fixture](evidence/comparison-baseline/core-people-light-1440.png) · desktop light, desktop dark, mobile light | [rendered-fixture](evidence/final-comparison/core-people-light-1440.png) · desktop light, desktop dark, mobile light |
| `/team/[userId]` | [rendered-fixture](evidence/comparison-baseline/core-profile-light-1440.png) · desktop light | [rendered-fixture](evidence/final-comparison/core-profile-light-1440.png) · desktop light |
| `/team/appraisals` | [rendered-fixture](evidence/comparison-baseline/core-team-appraisals-light-1440.png) · desktop light | [rendered-fixture](evidence/final-comparison/core-team-appraisals-light-1440.png) · desktop light |
| `/team/feedback` | [captured](evidence/comparison-baseline/growth-team--feedback-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-team--feedback-desktop-light.png) · desktop light |
| `/team/okrs` | [rendered-fixture](evidence/comparison-baseline/core-team-goals-light-1440.png) · desktop light | [rendered-fixture](evidence/final-comparison/core-team-goals-light-1440.png) · desktop light |
| `/team/reviews` | [rendered-fixture](evidence/comparison-baseline/core-team-reviews-light-1440.png) · desktop light | [rendered-fixture](evidence/final-comparison/core-team-reviews-light-1440.png) · desktop light |
| `/tutorial` | [captured](evidence/comparison-baseline/growth-tutorial-desktop-light.png) · desktop light | [captured](evidence/final-comparison/growth-tutorial-desktop-light.png) · desktop light |

## Historical audit and provenance

## Evidence boundaries

- Source analysis baseline: `9e8fecc1e650fa1a637a99444aec1afa8d30b245`. Before screenshots: `39c3f4ff56851609921a19e5bb1e0d226893bd59`, including the preserved calendar changes committed before programme design implementation.
- Before captures render the actual local development app. The full after-route audit renders the isolated default-Turbopack production build from source tree `b79d3ffcd1ce9b6b0fb755bfe5320e54d56bf4a0`, based on main `a93ddbf9f5274b2083818a6c60f78c9dd49c92f5`; the four final targeted images below render built app tree `d9428462c2efea48cb52c55e4413636d7a7f4935`. All use controlled synthetic browser-test API fixtures. [Initial candidate manifest](evidence/candidate-manifest.json) and [final source manifest](evidence/final-source-manifest.json) record included paths. These images do not certify production identity, persistence, calendar/media, AI generation or live deployment.
- Final tested source is committed on `main` as `81212b2ae4528847d41f682af00bdb2e7810c491`; its Git tree exactly matches the built/tested `d9428462c2efea48cb52c55e4413636d7a7f4935` tree. [Retained product acceptance](PRODUCT-IMPLEMENTATION-ACCEPTANCE.md) clears all twelve stories locally; deployment and authenticated production acceptance remain separate evidence.
- `captured` / `rendered-fixture` means a rendered visual state. It does not mean every primary action, permission or state passed. `rendered-with-unavailable-secondary-data` and recovery states retain named missing fixture reads. `empty-record-fixture` is an editor with no saved fixture record; it is not proof of loading an existing record.
- Preliminary development compilation timeouts and auth guards are retained separately in the attempts ledger / preliminary development receipt. They do not count toward the authoritative after-screen audit. The isolated compiled build completed the full route audit. The later preference-CSS correction has a separate final-candidate delta replay; these images retain their actual `b79` provenance.
- Dynamic template paths below match concrete synthetic IDs in receipts. Redirect pages are indexed by their requested route and retain the actual destination in metadata. The root page is a redirect handler.
- All required business/action/role/state checks belong in the QA criterion matrix and receipts. Representative dark/mobile images demonstrate shared primitives; they do not silently certify every route in every mode.

## Route census: 68 exact page templates

Before receipt entries after retry deduplication: 89 (27 captured, 3 empty-record-fixture, 1 recovery-fixture-missing-record, 4 recovery-only-fixture-gaps, 38 rendered-fixture, 7 rendered-with-unavailable-secondary-data, 9 unavailable-or-recovery).

Authoritative after receipt entries: 117 (59 captured, 58 rendered-fixture). Additional shell/zoom/print interaction captures are indexed by the [core contact manifest](evidence/after/core-contact-manifest.json).

Unique after screenshot files: **122** (117 route/state receipt images plus 5 supplemental shell/zoom/print images). Contact sheets and rejected diagnostic captures are excluded from that total.

Across the 117 authoritative route/state receipt entries: **0 recorded uncaught browser errors, 0 failed API reads, 0 page-level horizontal overflows**. Readable local table scrolling is intentional. Numeric overflow checks are supported by the independent full-image reviews, which found and resolved the Team OKRs wrapping defect.

Final targeted delta: **4 images**, built app tree `d9428462c2efea48cb52c55e4413636d7a7f4935`. Team OKRs light/dark desktop/mobile checks verify caption contrast 5.97:1 / 7.90:1, omitted unknown counts, retained zero counts, readable 760px table in a named keyboard-scrollable region and no page-level overflow. The earlier `b79` route audit remains labeled with its original source tree; the delta does not relabel those images. [Final delta receipt](evidence/after/team-okrs-delta-capture.json).

| Exact route template | Story package | Before visual evidence | After visual evidence |
|---|---|---|---|
| `/` | AD-01 | [rendered-fixture](evidence/before/core-root-light-1440.png) · desktop light | [rendered-fixture](evidence/after/core-root-light-1440.png) · desktop light |
| `/action-centre` | AD-12 | [captured](evidence/before/action-centre-desktop-light.png) · desktop light | [captured](evidence/after/action-centre-desktop-light.png) · desktop light |
| `/admin` | AD-05 | [unavailable-or-recovery](evidence/before/core-admin-light-1440.png) · desktop light | [rendered-fixture](evidence/after/core-admin-light-1440.png) · desktop light |
| `/admin/appraisal-cycles` | AD-05 | [rendered-fixture](evidence/before/core-cycles-light-1440.png) · desktop light | [rendered-fixture](evidence/after/core-cycles-light-1440.png) · desktop light |
| `/admin/appraisal-cycles/[id]` | AD-05 | [rendered-fixture](evidence/before/core-cycle-detail-light-1440.png) · desktop light | [rendered-fixture](evidence/after/core-cycle-detail-light-1440.png) · desktop light |
| `/admin/appraisal-cycles/[id]/edit` | AD-05 | [rendered-fixture](evidence/before/core-cycle-edit-light-1440.png) · desktop light | [rendered-fixture](evidence/after/core-cycle-edit-light-1440.png) · desktop light |
| `/admin/appraisal-cycles/new` | AD-05 | [rendered-fixture](evidence/before/core-cycle-new-light-1440.png) · desktop light | [rendered-fixture](evidence/after/core-cycle-new-light-1440.png) · desktop light |
| `/admin/calibration` | AD-05 | [rendered-with-unavailable-secondary-data](evidence/before/core-calibration-light-1440.png) · desktop light | [rendered-fixture](evidence/after/core-calibration-light-1440.png) · desktop light |
| `/admin/departments/[department]` | AD-05 | [rendered-fixture](evidence/before/core-department-light-1440.png) · desktop light | [rendered-fixture](evidence/after/core-department-light-1440.png) · desktop light |
| `/admin/reports` | AD-05 | [rendered-with-unavailable-secondary-data](evidence/before/core-reports-light-1440.png) · desktop light | [rendered-fixture](evidence/after/core-reports-light-1440.png) · desktop light |
| `/admin/review-cycles` | AD-05 | [rendered-fixture](evidence/before/core-review-cycles-light-1440.png) · desktop light | [rendered-fixture](evidence/after/core-review-cycles-light-1440.png) · desktop light |
| `/ai-account` | AD-12 | [captured](evidence/before/ai-account-desktop-light.png) · desktop light | [captured](evidence/after/ai-account-desktop-light.png) · desktop light, desktop dark, mobile light, mobile dark |
| `/analytics` | AD-05 | [rendered-fixture](evidence/before/core-analytics-light-1440.png) · desktop light, mobile light, desktop dark | [rendered-fixture](evidence/after/core-analytics-light-1440.png) · desktop light, desktop dark, mobile light |
| `/appraisals` | AD-04 | [rendered-fixture](evidence/before/core-appraisals-light-1440.png) · desktop light | [rendered-fixture](evidence/after/core-appraisals-light-1440.png) · desktop light |
| `/appraisals/[appraisalId]` | AD-04 | [unavailable-or-recovery](evidence/before/core-appraisal-detail-light-1440.png) · desktop light | [rendered-fixture](evidence/after/core-appraisal-detail-light-1440.png) · desktop light |
| `/appraisals/[appraisalId]/calibration` | AD-04 | [rendered-fixture](evidence/before/core-appraisal-calibration-light-1440.png) · desktop light | [rendered-fixture](evidence/after/core-appraisal-calibration-light-1440.png) · desktop light |
| `/appraisals/[appraisalId]/discussion` | AD-04 | [rendered-fixture](evidence/before/core-appraisal-discussion-light-1440.png) · desktop light | [rendered-fixture](evidence/after/core-appraisal-discussion-light-1440.png) · desktop light |
| `/appraisals/[appraisalId]/final-review` | AD-04 | [rendered-fixture](evidence/before/core-final-form-light-1440.png) · desktop light | [rendered-fixture](evidence/after/core-appraisal-final-light-1440.png) · desktop light |
| `/appraisals/[appraisalId]/goal-setting` | AD-04 | [rendered-fixture](evidence/before/core-appraisal-goals-light-1440.png) · desktop light | [rendered-fixture](evidence/after/core-appraisal-goals-light-1440.png) · desktop light |
| `/appraisals/[appraisalId]/manager-review` | AD-04 | [rendered-fixture](evidence/before/core-manager-form-light-1440.png) · desktop light, mobile light, desktop dark | [rendered-fixture](evidence/after/core-appraisal-manager-light-1440.png) · desktop light, desktop dark, mobile light |
| `/appraisals/[appraisalId]/report` | AD-04 | [rendered-with-unavailable-secondary-data](evidence/before/core-appraisal-report-light-1440.png) · desktop light | [rendered-fixture](evidence/after/core-appraisal-report-light-1440.png) · desktop light |
| `/appraisals/[appraisalId]/self-assessment` | AD-04 | [rendered-fixture](evidence/before/core-appraisal-self-light-1440.png) · desktop light, mobile light, desktop dark | [rendered-fixture](evidence/after/core-appraisal-self-light-1440.png) · desktop light, desktop dark, mobile light |
| `/appraisals/removed` | AD-04 | [unavailable-or-recovery](evidence/before/core-appraisals-removed-light-1440.png) · desktop light | [rendered-fixture](evidence/after/core-appraisals-removed-light-1440.png) · desktop light |
| `/appraisals/start` | AD-04 | [rendered-with-unavailable-secondary-data](evidence/before/core-appraisal-start-light-1440.png) · desktop light, desktop dark, mobile light | [rendered-fixture](evidence/after/core-appraisal-start-light-1440.png) · desktop light, desktop dark, mobile light |
| `/check-ins` | AD-08 | [captured](evidence/before/check-ins-desktop-light.png) · desktop light | [captured](evidence/after/check-ins-desktop-light.png) · desktop light |
| `/coaching` | AD-09 | [captured](evidence/before/coaching-desktop-light.png) · desktop light | [captured](evidence/after/coaching-desktop-light.png) · desktop light |
| `/competency` | AD-11 | [captured](evidence/before/competency-desktop-light.png) · desktop light | [captured](evidence/after/competency-desktop-light.png) · desktop light |
| `/competency/assessments` | AD-11 | [captured](evidence/before/competency--assessments-desktop-light.png) · desktop light | [captured](evidence/after/competency--assessments-desktop-light.png) · desktop light |
| `/competency/assessments/[assessmentId]` | AD-11 | [captured](evidence/before/competency--assessments--assessment-desktop-light.png) · desktop light | [captured](evidence/after/competency--assessments--assessment-desktop-light.png) · desktop light, desktop dark, mobile light, mobile dark |
| `/competency/cycles` | AD-11 | [captured](evidence/before/competency--cycles-desktop-light.png) · desktop light | [captured](evidence/after/competency--cycles-desktop-light.png) · desktop light |
| `/competency/cycles/[id]` | AD-11 | [empty-record-fixture](evidence/before/competency--cycles--created-cycle-desktop-light.png) · desktop light | [captured](evidence/after/competency--cycles--created-cycle-desktop-light.png) · desktop light |
| `/competency/cycles/new` | AD-11 | [captured](evidence/before/competency--cycles--new-desktop-light.png) · desktop light | [captured](evidence/after/competency--cycles--new-desktop-light.png) · desktop light |
| `/competency/frameworks` | AD-11 | [captured](evidence/before/competency--frameworks-desktop-light.png) · desktop light | [captured](evidence/after/competency--frameworks-desktop-light.png) · desktop light |
| `/competency/frameworks/[id]` | AD-11 | [empty-record-fixture](evidence/before/competency--frameworks--created-framework-desktop-light.png) · desktop light | [captured](evidence/after/competency--frameworks--created-framework-desktop-light.png) · desktop light |
| `/competency/frameworks/new` | AD-11 | [captured](evidence/before/competency--frameworks--new-desktop-light.png) · desktop light | [captured](evidence/after/competency--frameworks--new-desktop-light.png) · desktop light |
| `/competency/reports` | AD-11 | [captured](evidence/before/competency--reports-desktop-light.png) · desktop light | [captured](evidence/after/competency--reports-desktop-light.png) · desktop light |
| `/competency/reports/[assessmentId]` | AD-11 | [captured](evidence/before/competency--reports--assessment-desktop-light.png) · desktop light | [captured](evidence/after/competency--reports--assessment-desktop-light.png) · desktop light |
| `/competency/roles` | AD-11 | [captured](evidence/before/competency--roles-desktop-light.png) · desktop light | [captured](evidence/after/competency--roles-desktop-light.png) · desktop light, desktop dark, mobile light, mobile dark |
| `/competency/roles/[id]` | AD-11 | [empty-record-fixture](evidence/before/competency--roles--created-role-desktop-light.png) · desktop light | [captured](evidence/after/competency--roles--created-role-desktop-light.png) · desktop light |
| `/competency/roles/new` | AD-11 | [captured](evidence/before/competency--roles--new-desktop-light.png) · desktop light | [captured](evidence/after/competency--roles--new-desktop-light.png) · desktop light |
| `/competency/settings` | AD-11 | [captured](evidence/before/competency--settings-desktop-light.png) · desktop light | [captured](evidence/after/competency--settings-desktop-light.png) · desktop light |
| `/competency/strategies` | AD-11 | [captured](evidence/before/competency--strategies-desktop-light.png) · desktop light | [captured](evidence/after/competency--strategies-desktop-light.png) · desktop light |
| `/competency/strategies/[id]` | AD-11 | [recovery-fixture-missing-record](evidence/before/competency--strategies--strategy-1-desktop-light.png) · desktop light | [captured](evidence/after/competency--strategies--strategy-1-desktop-light.png) · desktop light |
| `/competency/strategies/new` | AD-11 | [captured](evidence/before/competency--strategies--new-desktop-light.png) · desktop light | [captured](evidence/after/competency--strategies--new-desktop-light.png) · desktop light |
| `/dashboard` | AD-02 | [rendered-fixture](evidence/before/core-dashboard-personal-light-1440.png) · desktop light, desktop dark, mobile light | [rendered-fixture](evidence/after/core-dashboard-personal-light-1440.png) · desktop light, desktop dark, mobile light |
| `/development` | AD-09 | [recovery-only-fixture-gaps](evidence/before/development-desktop-light.png) · desktop light | [captured](evidence/after/development-desktop-light.png) · desktop light, desktop dark, mobile light, mobile dark |
| `/feedback` | AD-07 | [captured](evidence/before/feedback-desktop-light.png) · desktop light | [captured](evidence/after/feedback-desktop-light.png) · desktop light, desktop dark, mobile light, mobile dark |
| `/feedback/new` | AD-07 | [captured](evidence/before/feedback--new-desktop-light.png) · desktop light | [captured](evidence/after/feedback--new-desktop-light.png) · desktop light |
| `/login` | AD-01 | [rendered-fixture](evidence/before/core-login-error-light-1440.png) · desktop light | [rendered-fixture](evidence/after/core-login-error-light-1440.png) · desktop light |
| `/okrs` | AD-03 | [rendered-fixture](evidence/before/core-goals-light-1440.png) · desktop light, desktop dark, mobile light | [rendered-fixture](evidence/after/core-goals-light-1440.png) · desktop light, desktop dark, mobile light |
| `/okrs/alignment` | AD-03 | [rendered-fixture](evidence/before/core-alignment-light-1440.png) · desktop light | [rendered-fixture](evidence/after/core-alignment-light-1440.png) · desktop light |
| `/one-on-ones` | AD-08 | [recovery-only-fixture-gaps](evidence/before/one-on-ones-desktop-light.png) · desktop light | [captured](evidence/after/one-on-ones-desktop-light.png) · desktop light |
| `/one-on-ones/[meetingId]` | AD-08 | [recovery-only-fixture-gaps](evidence/before/one-on-ones--meeting-1-desktop-light.png) · desktop light | [captured](evidence/after/one-on-ones--507f1f77bcf86cd799439011-desktop-light.png) · desktop light |
| `/one-on-ones/new` | AD-08 | [recovery-only-fixture-gaps](evidence/before/one-on-ones--new-desktop-light.png) · desktop light | [captured](evidence/after/one-on-ones--new-desktop-light.png) · desktop light, desktop dark, mobile light, mobile dark |
| `/project-feedback` | AD-07 | [captured](evidence/before/project-feedback-desktop-light.png) · desktop light | [captured](evidence/after/project-feedback-desktop-light.png) · desktop light |
| `/recognition` | AD-07 | [captured](evidence/before/recognition-desktop-light.png) · desktop light | [captured](evidence/after/recognition-desktop-light.png) · desktop light |
| `/reviews` | AD-06 | [rendered-fixture](evidence/before/core-reviews-light-1440.png) · desktop light | [rendered-fixture](evidence/after/core-reviews-light-1440.png) · desktop light |
| `/reviews/[id]` | AD-06 | [rendered-with-unavailable-secondary-data](evidence/before/core-review-detail-light-1440.png) · desktop light | [rendered-fixture](evidence/after/core-review-detail-light-1440.png) · desktop light |
| `/settings/ai` | AD-12 | [captured](evidence/before/settings--ai-desktop-light.png) · desktop light | [captured](evidence/after/settings--ai-desktop-light.png) · desktop light |
| `/support-plans` | AD-09 | [captured](evidence/before/support-plans-desktop-light.png) · desktop light | [captured](evidence/after/support-plans-desktop-light.png) · desktop light, desktop dark, mobile light, mobile dark |
| `/talent` | AD-10 | [captured](evidence/before/talent-desktop-light.png) · desktop light | [captured](evidence/after/talent-desktop-light.png) · desktop light, desktop dark, mobile light, mobile dark |
| `/team` | AD-06 | [rendered-fixture](evidence/before/core-people-light-1440.png) · desktop light, desktop dark, mobile light | [rendered-fixture](evidence/after/core-people-light-1440.png) · desktop light, desktop dark, mobile light |
| `/team/[userId]` | AD-06 | [rendered-fixture](evidence/before/core-profile-light-1440.png) · desktop light | [rendered-fixture](evidence/after/core-profile-light-1440.png) · desktop light |
| `/team/appraisals` | AD-06 | [rendered-fixture](evidence/before/core-team-appraisals-light-1440.png) · desktop light | [rendered-fixture](evidence/after/core-team-appraisals-light-1440.png) · desktop light |
| `/team/feedback` | AD-06 | [captured](evidence/before/team--feedback-desktop-light.png) · desktop light | [captured](evidence/after/team--feedback-desktop-light.png) · desktop light |
| `/team/okrs` | AD-06 | [rendered-with-unavailable-secondary-data](evidence/before/core-team-goals-light-1440.png) · desktop light | [rendered-fixture](evidence/after/team-okrs-table-final-light-1440.png) (final delta) · desktop light, desktop dark, mobile light, mobile dark |
| `/team/reviews` | AD-06 | [rendered-fixture](evidence/before/core-team-reviews-light-1440.png) · desktop light | [rendered-fixture](evidence/after/core-team-reviews-light-1440.png) · desktop light |
| `/tutorial` | AD-12 | [captured](evidence/before/tutorial-desktop-light.png) · desktop light | [captured](evidence/after/tutorial-desktop-light.png) · desktop light |

## Explicit gaps

- Before route templates without a capture: none.
- After route templates without an attempt: none.
- Before recovery/empty fixtures remain labeled as limitations of the baseline. After route captures use valid populated, empty or recovery UI states as recorded; screenshot coverage does not replace workflow/action/permission tests. Read the QA receipts for functional acceptance, final-candidate preference replay, release and external-provider boundaries.

## Raw receipts

- [before/core-capture.json](evidence/before/core-capture.json)
- [before/core-extras-capture.json](evidence/before/core-extras-capture.json)
- [before/capture-02-receipt.json](evidence/before/capture-02-receipt.json)
- [after/core-capture.json](evidence/after/core-capture.json)
- [after/core-extras-capture.json](evidence/after/core-extras-capture.json)
- [after/capture-02-receipt.json](evidence/after/capture-02-receipt.json)
- [after/team-okrs-delta-capture.json](evidence/after/team-okrs-delta-capture.json)

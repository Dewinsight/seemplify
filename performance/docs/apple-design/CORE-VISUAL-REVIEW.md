# Core visual review and candidate screenshot receipt

Reviewer: retained PM / UI review partner. Date: 21 October 2026. Candidate source tree: `b79d3ffcd1ce9b6b0fb755bfe5320e54d56bf4a0`, based on `a93ddbf9f5274b2083818a6c60f78c9dd49c92f5`. Server: local isolated default Turbopack production build, port 5035. These are synthetic browser states, not deployed production or real-provider proof.

## Captures completed

- `evidence/after/core-capture.json`: 49 actual captures, including all 35 core desktop-light entries, seven desktop-dark and seven mobile-light representatives. Zero browser page errors, failed API reads, document horizontal overflow or development-overlay elements in this batch.
- `evidence/after/core-extras-capture.json`: five editable/manual/populated/history templates, all rendered without browser or API errors. These supplement the legitimate empty or read-only states in the route batch.
- Goal details/create dark desktop, create dark 390px, create at 200% text size, and white-paper report print: five additional actual captures. The enlarged-text goal dialog fits the viewport and keeps its primary action visible; document overflow remains false. Print output was inspected as a readable white report with dark text and hidden controls.
- `evidence/after/core-contact-manifest.json`: 59 unchanged screenshots arranged into five deterministic contact sheets. All five sheets were visually inspected, with full-size inspection of the goal dialog, editable forms and print result.

Older development-server partial attempts remain under `evidence/after/attempts/`; navigation timeouts and the interrupted batch are not silently counted as passing screenshots. Candidate metadata is explicit in the authoritative receipts. Read-only supplemental synthetic response shapes were added for current component contracts missing from the original journey fixture: disabled competency bootstrap/no links, lifecycle permissions/empty Removed, empty calibration, admin/organization summaries, team goals and historical-review display. Those responses establish visual states only; they cannot prove backend permissions, persistence or data correctness.

## Contact-sheet inspection

| Contact | Images | Review |
|---|---|---|
| 1 | 1-12: sign-in, role dashboards, goals/alignment, appraisals/start/removed/detail/goal evidence | Consistent hierarchy and navigation. Empty/next-actor states are honest; existing routes/actions remain identifiable. No structural clipping observed. |
| 2 | 13-24: assessment/reviewer/discussion/calibration/final/report and admin/cycles | Manual/read-only distinctions remain visible. The final-rating fixture intentionally lacks a calculated evidence rating and correctly disables completion; it is not a finalization-success claim. Dedicated cycle editing remains separate from launch. |
| 3 | 25-36: reports/department/analytics/people/team/history and dark dashboard | Charts and populated rows render. Historical review remains read-only. One Avg.Progress card contrast issue was raised below before final approval. |
| 4 | 37-48: dark core and narrow dashboard/goals/start/reviewer/analytics | Dark text/surfaces remain distinct. Mobile primary actions wrap, workflow labels stay reachable, long reviewer/analytics pages scroll vertically without document sideways overflow. |
| 5 | 49-59: people mobile, editable forms, populated goals/history, dark dialogs, enlarged text and print | Form/control hierarchy and local scrolling are usable. Print is legible on white. No new structural defect beyond the recorded preference and stat-card issues. |

## Issues and evidence boundaries

1. **Production preference fallback:** the production optimizer retains backdrop blur in the current tree's reduced-transparency rule. The independent shell probe reproduces it; architect QA identified the declaration-order cause and requested a refreshed candidate. This remains a final-tree retest gate. The earlier development-server 14-check pass does not certify the optimized production rule.
2. **Team OKR stat-card label:** `/team/okrs` uses bright `success.light` / `warning.light` / `error.light` backgrounds with the normal `text.secondary` label. This misses the shared text-contrast/neutral-surface contract. Requested fix: neutral paper background, retaining the meaningful semantic numeric/status color. Final candidate capture and review are required after the fix.
3. **Report probe fixture correction:** an added print probe initially omitted required employee/manager identities, producing a fixture-driven name error; that failed attempt is retained in `after/attempts/b79-shell-review.json`. The full route batch already used valid identities and had no report error. The corrected standalone print probe passed with zero browser errors in `core-print-review.json`.

**Disposition:** core default presentation and the documented positive/empty/read-only states are ready for final candidate QA after the two visual/preference corrections. This is not an all-product acceptance certificate. Retained PM implementation acceptance waits for the complete 68-route matrix, final candidate QA/role evidence and exact release provenance.

## Final correction verification

Final source and production app/test tree `d9428462c2efea48cb52c55e4413636d7a7f4935` resolves the preference and metric-card findings. The final eight focused checks and original mobile Final Rating assertion pass. The four-view [Team OKRs delta](evidence/after/team-okrs-delta-capture.json) records 5.97:1 light / 7.90:1 dark label contrast, omitted unknown count and retained zero.

Full-size mobile review of the first delta found one-character employee/title wrapping; that attempt is preserved under `after/attempts/team-okrs-547/`. The corrected populated table has a 760px minimum width in a 324px named, focusable horizontal region. Arrow keys scroll it; Tab reveals the View Details link at 305–335px inside the 390px viewport. Employee name is 115px wide and a single line, title remains readable, no document overflow or browser/API error occurs. Both themes were visually inspected after the correction. [Retained product acceptance](PRODUCT-IMPLEMENTATION-ACCEPTANCE.md) now clears local release; production acceptance remains separate.

## Final frozen combined-source closure

Actual production tree `7eb9c096330d19b1a854c0f45fa15d0583f09c13` passes retained PM visual acceptance: fresh core49+5, six long-content People views and 15 matched report/conversation supplementals, with no recorded page errors/failed fixture reads/document overflow. Final People full-size/native images confirm separated readable identity, metrics and actions. All 18 refreshed matched contact sheets were inspected. Chat Send settles to 5.57:1 light / 7.49:1 dark; composer/content are opaque alpha1/opacity1 with no blur and no draft submission. Full receipt: [surface evidence](evidence/final-comparison/report-surface-capture.json). These are actual app pixels with synthetic transport, not provider/production proof.

Independent QA review retains all domain assertions. The new Schedule expectation follows the existing `/one-on-ones?compose=true` redirect with exact employeeId/name and adds the selected recipient field assertion. Latest executable receipts: combined UI25/25; real API19 initial passes/one failure, unchanged HR case3/3 replay passes, cause unknown. [Current product gate](PRODUCT-IMPLEMENTATION-ACCEPTANCE.md) supersedes historical candidate clearance. Separate main d1 analytics work is preserved and not attributed to this design programme.

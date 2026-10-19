# Competency assessment release evidence

Latest follow-up, 19 October: the complete admin → selected manager → employee flow was verified with five actual local IdP accounts, and five defects were fixed. [PR139](https://github.com/Dewinsight/seemplify/pull/139) is live at `92dce5c3`. Reviewed-head and merged-main CI both passed 208 integration / 19 suites, 83 legacy, 38 unit, two IdP migrations, 709 HTTP requests with zero failures, 111 interface tests and 30 real-API browser tests without retries, plus production build. Core passed 13 prerequisites, 45 browser cases without retries and deployment. Independent verification confirmed all 13 running revisions/health and authenticated owner report/history navigation. [QA report](ROLE-JOURNEY-QA.md), [live receipt](evidence/role-journey-live-release.json).

Earlier release history: `3095926a` is deployed and all thirteen Core services were verified healthy at that exact revision. Authenticated production manual assessment, actual personal ChatGPT gpt-5.6-terra analysis and immutable v1/v2 report/PDF acceptance passed with synthetic content. AI never selected the human rating/outcome; optional provider metadata was absent and remains Not recorded. All prior user-editable organisation settings were restored exactly, leaving AI/call evidence off. Production Start appraisal confirmation/preflight only was exercised; full fresh-local linked launch is separate. New external call artifacts, actual client pilot and full production restore remain uncertified.

## Reviewed source

- Feature PR: [135](https://github.com/Dewinsight/seemplify/pull/135).
- Reviewed feature head: `b8a6ff1ef658d87d8499c335e28992c4b0180c82`.
- Merged application revision: `cbc547f0f75ea14052dd1adc9be01d7a1b7aa9c7`. Its complete tree matches the reviewed feature head.
- Deployment correction PR [136](https://github.com/Dewinsight/seemplify/pull/136) merged as `e2e57a51e8e8f39f3d68dde3dce5e05ce62ea97f`; its earlier healthy rollout preceded the final guard deployment.
- Runtime guard PR [137](https://github.com/Dewinsight/seemplify/pull/137), reviewed head `f43677131a6cd42c6cb88e77cc8ee9f7033aed1b`, merged at03:31:48UTC as `3095926ae41bf31e7b883c1e8a83044e1b97c272`; that exact revision is now verified running across all thirteen Core services.
- Independent product and architecture reviews approved the scope and final cohort-report navigation.
- Unrelated local appraisal-lifecycle work is excluded.

## Verification

| Layer | Result and scope |
|---|---|
| Full clean-source backend integration | Earlier feature checkpoint: 193 tests across 18 suites. Runtime-guard exact-head CI: 199 tests across 18 suites passed against disposable MongoDB |
| Identity | 42 focused checks passed, including actual persisted schema 3 and 4 migrations to schema 5 |
| Full application HTTP journeys | 709 requests, no failures; synthetic identities use the real IdP catalogue and directory builder |
| Local browser | 43 focused cases plus a separate 29-case production-mode real-API suite passed; counts overlap other layers and are not summed |
| Final navigation | Existing cohort case now clicks the real overview link; passed without retries; clean webpack build passed |
| Actual local cohort | Authenticated overview link opened the real report; downloaded PDF strictly parsed and matched the synthetic participant, score 80 and one-of-one finalised total |
| Actual production role intake | TXT/PDF/DOCX each passed authenticated upload, real ClamAV, extraction, review/edit/confirmation and saved draft. A private original download matched its source bytes. Imported role/native framework/cycle published. [Safe receipt](evidence/production-manual-acceptance.json) |
| Actual production manual assessment | Official service launch with fresh current-owner authority and existing smoke identity; no ordinary parent appraisal or emails. Actual UI evidence, submitted oral finding, attributed assessor feedback and finding with both evidence links; score80/coverage1/1/Suitable. Participant PDF2 pages/5,802 bytes and cohort PDF1 page/2,832 bytes strictly verified |
| Existing production Start appraisal | Current reviewer eligibility, published role/cycle selection and final-confirmation preflight passed; launch button was not clicked. Full fresh-local linked launch is separate evidence, not a completed production linked launch |
| Private backup and restore | 11 Linux POSIX archive checks and 5 real MongoDB reference checks passed; no full production restore was performed |
| Required security scan | [39185493206](https://github.com/Dewinsight/seemplify/actions/runs/39185493206) passed at the reviewed head |
| Reviewed PR Performance CI | [39185494953](https://github.com/Dewinsight/seemplify/actions/runs/39185494953) passed: 105 browser cases passed first attempt and 2 passed on retry; separate real-API browser suite 29/29 without retries; final build passed |
| Merged-main Performance CI | [39186949448](https://github.com/Dewinsight/seemplify/actions/runs/39186949448) passed at `cbc547f0`: all 107 browser cases passed without retries, separate real-API browser suite 29/29, 709 HTTP requests without failures, 193 integration checks and final build passed |
| Corrected Core rollout | [39190929695](https://github.com/Dewinsight/seemplify/actions/runs/39190929695) succeeded at `e2e57a51`: thirteen prerequisite jobs passed; coordinator verified all thirteen actual running Core services healthy at that exact revision |
| Runtime-guard exact PR CI | [39193949849](https://github.com/Dewinsight/seemplify/actions/runs/39193949849) passed at `f4367713`: 199 integration cases/18 suites, 83 legacy, 38 unit, two actual persisted migrations, 709 HTTP requests/zero failures, 107 browser cases without retries, 29 real-API browser cases without retries and production build. [Safe receipt](evidence/runtime-guard-performance-ci.json) |
| Final merged-main CI | [39195119875](https://github.com/Dewinsight/seemplify/actions/runs/39195119875) passed at3095926a:199 integration/eighteen suites,83 legacy,38 unit,two persisted migrations,709 HTTP requests/zero failures,106 browser cases first attempt plus one retry-pass (107 eventual),29 real-API browser cases without retries and build. [Safe receipt](evidence/final-main-performance-ci.json) |
| Final Core rollout | [39195119921](https://github.com/Dewinsight/seemplify/actions/runs/39195119921) succeeded: thirteen prerequisites,41 browser cases without retries and build. All thirteen actual Core revisions matched3095926a; health/OIDC/scanner/private-mode and eighteen models/32 indexes verified. [Safe final receipt](evidence/final-core-release.json) |
| Actual production personal AI and history | Authenticated requesting-user ChatGPT route returned gpt-5.6-terra with exact new synthetic-source citation; human edited draft and independently selected rating/outcome. Published v2 score80/coverage1/1/Suitable; v1 rationale/sources/date/hash unchanged. Both historical-v1 and final-v2 PDFs strictly verified, both v2 pages visually inspected. Prior editable settings restored/compared exactly. [Safe receipt](evidence/production-ai-history-acceptance.json) |
| Experience baseline | Separate job failed with the same 57 failed/cancelled titles as the earlier baseline; Experience source and workflow are unchanged; Node 20/22 SDK checks passed |

The earlier PR run's two retry-passed browser cases exposed test interaction limits: a cold development-route navigation exceeded a five-second assertion, and a forced rating click occurred during smooth scrolling. Trace review demonstrated neither a production API error nor a returned application error. The earlier cbc547f0 merged-main repeat passed all107 cases without retries; the earlier history is retained rather than erased.

## Production gate and verified maintenance

Historical setup failure: the initial [Core deployment](https://github.com/Dewinsight/seemplify/actions/runs/39186949445) passed twelve prerequisites and failed while installing an unlocked backend with `npm ci`. PR 136 corrected that one workflow command. The corrected [Core deployment](https://github.com/Dewinsight/seemplify/actions/runs/39190929695) subsequently succeeded with all thirteen prerequisites; actual healthy running revisions were verified at `e2e57a51`.

The coordinator verified production policy schema 5 and seven built-in role rows: staff 26 grants, manager 54, department head 56, and HR/admin/owner 87. Exactly 65 old Performance login sessions were expired with controlled backend handling; the backend is healthy. This refresh retains business records, saved drafts and IdP sessions; normal SSO restores Performance access. The live backup-service lock was applied and verified, with the existing timer retained; no full production backup or restore was certified. Safe receipts: [default-role migration](evidence/default-role-migration.json) and [production operations](evidence/production-operations.json). These completed maintenance checks do not establish the later guard deployment or authenticated live feature acceptance.

Runtime/model readiness passed: eighteen models and32 declared indexes verified after exactly one optional projection collection and one unique index were created, with no TTL or business-document initialization. Final [Core deployment39195119921](https://github.com/Dewinsight/seemplify/actions/runs/39195119921) subsequently succeeded and all thirteen actual running revisions/health matched3095926a. [Final runtime/readiness receipt](evidence/final-core-release.json). Authenticated production manual intake and later actual AI/report-history acceptance are separately recorded; they are not inferred from container health.

## Additional application gate

Final independent review found that the competency AI route bypassed Performance's global ChatGPT off switch. PR137 implements strict fresh-policy checks before dispatch and ready-draft publication: ChatGPT-off/unavailable settings fail closed with no local fallback; successful missing-row reads use documented environment defaults. Exact PR and merged-main CI passed and the final runtime is deployed. Actual personal AI acceptance on3095926a used a newly authored synthetic source and current assessor acknowledgment, returned gpt-5.6-terra with an exact quote, and left rating/observed level unset until a human selected them. Optional upstream provider metadata was null and remains truthfully Not recorded; no provider value was inferred.

After the human-edited finding was published as v2, v1's rationale, sources, date and report hash remained unchanged. Its historical PDF was successfully regenerated and its contents verified; no PDF-byte identity is claimed. Version 2's two-page PDF was strictly verified and every page inspected. All prior user-editable organisation settings were restored via UI and compared exactly, including AI/call evidence off, blank notice/retentions and24-hour export retention. Normal policy history remained intact without resetting a raw policy version. [Actual AI/history/settings receipt](evidence/production-ai-history-acceptance.json).

## Boundaries

Actual personal AI acceptance is established by the production receipt above, not by mocked-provider tests. New external call artifacts remain uncertified. Prior organisation AI/call settings were restored off. The ten-person pilot uses synthetic people in disposable test storage; it does not represent a client rollout or an employment decision.

Production acceptance used synthetic content and an existing smoke identity, not a real employee decision. Official service launch created no ordinary appraisal or email; production Start appraisal reached confirmation/preflight only and its launch button was not clicked. Full linked launch was separately verified locally. Three real scanned role-intake formats are actual end-to-end UI evidence; actual personal AI and report history passed on final3095926a. Published images remain synthetic localhost captures; actual production screenshots stay private. Remaining uncertified paths are new external calendar/native recording/transcript artifacts, actual client pilot and full production restore. A later actual UI cohort check after v2 still showed one assessment/one final/score80/Suitable without double counting; the new one-page cohort PDF also passed content verification.

Published examples use synthetic people. Three actual-account baseline images were previously published and then removed from the feature branch tree and rewritten programme history. GitHub may retain cached old revisions; current-history correction does not certify cache erasure.

Safe aggregate receipts: [earlier merged-main CI](evidence/merged-main-performance-ci.json), [runtime-guard exact-head CI](evidence/runtime-guard-performance-ci.json), [Core Performance job](evidence/core-release-performance-qa.json), [unchanged Experience baseline](evidence/unchanged-experience-ci-baseline.json). Raw logs and actual-account screenshots remain private. The unchanged Experience baseline has 57 failed/cancelled cases; no whole-repository-green claim is made.

## Final-main retry disclosure

Final-main39195119875 passed106 browser cases directly and one on retry, unlike reviewed PR f4367713 which passed107 directly. The retried existing team-member OKR navigation exceeded a five-second URL assertion while the correct RSC navigation remained pending and Fast Refresh cold compilation was recorded; preceding mocked API responses succeeded. No returned API/product error was observed in that trace, but this does not prove absence of every possible product issue. The first retry passed. The separate29-case production-mode real-API browser suite passed without retries. No failing assertion or authority check was removed.

## Earlier release and acceptance verdict

Application3095926a is live and verified. Final-main CI and Core deployment passed; all thirteen running Core revisions, eighteen models and32 indexes matched the intended release. Actual authenticated manual assessment, three-format real-scanner role intake, actual personal ChatGPT analysis, human-only rating/final classification, unchanged historical-v1 report/hash and new-v2 report/PDF passed. [Final deployed/runtime receipt](evidence/final-core-release.json) and [actual AI/history/restoration receipt](evidence/production-ai-history-acceptance.json) are distinct proof layers.

All prior user-editable settings were restored exactly, with AI/call evidence off and normal policy history retained. Optional provider metadata remains truthfully Not recorded. Production Start appraisal was exercised only through confirmation/preflight; its launch button was not clicked, and the complete linked launch was separately verified locally. Remaining uncertified paths are new external calendar/native recording/transcript artifacts, actual client pilot and full production restore. Unchanged Experience baseline failures are separate. No real employee decision or whole-repository-green claim is made.

Final illustrated handover: eight pages, all25 story identifiers, rendered/visually inspected by the coordinator and an independent reviewer. [Document verification](evidence/final-document-verification.json) records the delivered artifact hash and preserved unrelated-file fingerprints.

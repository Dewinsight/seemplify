# Competency assessment release evidence

Status: authenticated production manual acceptance passed at `e2e57a51`; the current organisation's manual competency feature is enabled. Real scanned role intake, UI assessment/finalisation and participant/cohort PDFs passed. Production Start appraisal was verified only through final confirmation/preflight, without clicking launch. Runtime-guard PR137 is merged as3095926a; exact reviewed PR CI passed, merged-main CI is running and final Core deployment is queued. AI and recorded-call evidence remain off; final guarded-runtime, actual provider and client-pilot acceptance remain open.

## Reviewed source

- Feature PR: [135](https://github.com/Dewinsight/seemplify/pull/135).
- Reviewed feature head: `b8a6ff1ef658d87d8499c335e28992c4b0180c82`.
- Merged application revision: `cbc547f0f75ea14052dd1adc9be01d7a1b7aa9c7`. Its complete tree matches the reviewed feature head.
- Deployment correction PR [136](https://github.com/Dewinsight/seemplify/pull/136) merged as `e2e57a51e8e8f39f3d68dde3dce5e05ce62ea97f`; this earlier revision is the verified healthy running Core release.
- Runtime guard PR [137](https://github.com/Dewinsight/seemplify/pull/137), reviewed head `f43677131a6cd42c6cb88e77cc8ee9f7033aed1b`, merged at 03:31:48 UTC as `3095926ae41bf31e7b883c1e8a83044e1b97c272`. Final deployment of this revision is not established yet.
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
| Final merged-main CI | [39195119875](https://github.com/Dewinsight/seemplify/actions/runs/39195119875) is running at `3095926a`; not reported passed |
| Final Core rollout | [39195119921](https://github.com/Dewinsight/seemplify/actions/runs/39195119921) is queued at `3095926a`; final running revision and live acceptance remain open |
| Experience baseline | Separate job failed with the same 57 failed/cancelled titles as the earlier baseline; Experience source and workflow are unchanged; Node 20/22 SDK checks passed |

The earlier PR run's two retry-passed browser cases exposed test interaction limits: a cold development-route navigation exceeded a five-second assertion, and a forced rating click occurred during smooth scrolling. Trace review demonstrated neither a production API error nor a returned application error. The later merged-main repeat passed all 107 cases without retries; the earlier history is retained rather than erased.

## Production gate and verified maintenance

Historical setup failure: the initial [Core deployment](https://github.com/Dewinsight/seemplify/actions/runs/39186949445) passed twelve prerequisites and failed while installing an unlocked backend with `npm ci`. PR 136 corrected that one workflow command. The corrected [Core deployment](https://github.com/Dewinsight/seemplify/actions/runs/39190929695) subsequently succeeded with all thirteen prerequisites; actual healthy running revisions were verified at `e2e57a51`.

The coordinator verified production policy schema 5 and seven built-in role rows: staff 26 grants, manager 54, department head 56, and HR/admin/owner 87. Exactly 65 old Performance login sessions were expired with controlled backend handling; the backend is healthy. This refresh retains business records, saved drafts and IdP sessions; normal SSO restores Performance access. The live backup-service lock was applied and verified, with the existing timer retained; no full production backup or restore was certified. Safe receipts: [default-role migration](evidence/default-role-migration.json) and [production operations](evidence/production-operations.json). These completed maintenance checks do not establish the later guard deployment or authenticated live feature acceptance.

Runtime/model readiness has now passed: eighteen models and32 declared indexes verified after exactly one optional projection collection and one unique index were created. No TTL index or application business-document initialization occurred. The current organisation's manual feature is enabled and [authenticated production manual acceptance](evidence/production-manual-acceptance.json) passed at e2e57a51. Runtime-guard final [Core deployment39195119921](https://github.com/Dewinsight/seemplify/actions/runs/39195119921) remains queued. Verify the final running guard revision and post-deployment role/report-history behavior; earlier manual acceptance does not establish those later results.

## Additional application gate

Final independent review found that the competency AI route bypassed Performance's global ChatGPT off switch. PR 137 implements a strict, fresh persisted-policy check before provider dispatch and before ready-draft publication. Saved ChatGPT-off or unavailable-policy states fail closed with no local fallback; a successful query with no saved row uses the documented environment default. Personal identity, source consent, citations and human decisions remain intact; manual assessment remains available. Exact reviewed PR CI passed; merged-main CI and final deployment remain pending as listed above. Optional assessment AI stays off and actual personal-provider acceptance remains a separate gate.

## Boundaries

Personal AI inference and new external call artifacts are not certified by mocked-provider tests. Optional assessment AI and call reuse default off. The ten-person pilot uses synthetic people in disposable test storage; it does not represent a client rollout or an employment decision.

Production acceptance used synthetic assessment content and an existing smoke identity, not a real employee decision. Official service launch created no ordinary appraisal or email; current production Start appraisal reached confirmation only. Three real scanned role-intake formats are now end-to-end UI evidence, superseding the earlier helper-only limitation. Published images remain synthetic localhost captures; actual production screenshots stay private. Participant/cohort PDF strict content checks are recorded; a full production linked-appraisal launch, final-runtime AI acceptance and actual new recording/transcript artifacts remain uncertified.

Published examples use synthetic people. Three actual-account baseline images were previously published and then removed from the feature branch tree and rewritten programme history. GitHub may retain cached old revisions; current-history correction does not certify cache erasure.

Safe aggregate receipts: [earlier merged-main CI](evidence/merged-main-performance-ci.json), [runtime-guard exact-head CI](evidence/runtime-guard-performance-ci.json), [Core Performance job](evidence/core-release-performance-qa.json), [unchanged Experience baseline](evidence/unchanged-experience-ci-baseline.json). Raw logs and actual-account screenshots remain private. The unchanged Experience baseline has 57 failed/cancelled cases; no whole-repository-green claim is made.

# Independent implementation QA — competency assessments

Reviewer: retained Solution Architect A / QA. Date: 19 October 2026. Repository: `E:/GitHub/C-drive/seemplify`; branch `main`; inspected HEAD `b401f1b1583be5875cc02462122c83ec9e7311d2` with uncommitted competency work. **This is local source/test evidence, not a merged or deployed revision.** Existing unrelated appraisal lifecycle changes remain in the checkout and must be excluded from release staging unless their owner separately hands them off.

## Release verdict

**Not certified for production yet.** Domain/API persistence and deterministic scoring have substantial passing evidence. Independent review found privacy, retention and concurrency defects; fixes and regression evidence are tracked below. The actual app browser, final rendered PDFs, complete role/source launch integration and separately enabled personal AI/call consent paths still require their recorded acceptance gates. The rollout feature remains independently switchable and manual assessment must work with integrations disabled.

The reviewer initially inspected another team's implementation. Root explicitly assigned subsequent narrow IdP migration and final-outcome atomicity fixes to this reviewer; the coordinating SA independently reviewed those fixes. Author-written tests for those changes are labelled regression evidence rather than an independent second code review by the same author.

## Executed checks at the first independent checkpoint

| Command / environment | Result | What it establishes / limits |
|---|---|---|
| Backend `npx jest --runInBand tests/competencyAuthorization.integration.test.js tests/competencyProgramme.integration.test.js tests/competencyLibrary.integration.test.js tests/competencyAssessment.integration.test.js` | **63 passed**, 4 suites, ~30s | Real disposable Mongo persistence and request/service behavior; context fixtures, not actual OIDC sessions. Later fixes require rerun. |
| Backend `node --test tests/competencyScoring.test.js tests/competencyFileSafety.test.js` | **20 passed** | Golden arithmetic/source combinations/ties + upload/parser/scanner protocol boundaries; fake scanner protocol cases explicitly simulated. |
| IdP `node --test tests/access-control-migration.test.mjs tests/access-control.test.mjs` | **24 passed** | Catalog defaults/denies and bounded migration race regression; five new migration tests use controlled model boundary. |
| `node .local-runtime/competency-qa/access-policy-migration.mjs` | **32 concurrent requests, 0 failures** | Actual disposable Mongo with real IdP models:16 upgrade +16 initial creation requests; exactly one global policy, schema4, one revision increase, custom role preserved. No local/live user DB touched. |
| Backend `npx jest --runInBand tests/competencyAppraisalAtomic.integration.test.js` | **8 passed** | Real replica-set finalization/reopen/source-amendment races, first-link parent-version fence, real standalone linked503 and ordinary standalone save, tenant guard. Authored by reviewer, peer-reviewed by coordinator. |
| `python -m unittest discover -s deploy/hostinger/tests -v` | **9 passed, 4 skipped**,13 total | Release orchestration contracts; Linux process/flock/shell cases correctly skipped on Windows, not counted passed. |
| PyYAML parse of Core workflow and both Compose files | **Passed** | YAML syntax only, not GitHub expression semantics or container activation. `actionlint` was not installed. Existing `queue:max` was not flagged; coordinator verified current GitHub documentation supports it with cancel-in-progress false. |
| `node --check` atomic helper and ordinary appraisal routes; `git diff --check` | **Passed** | JavaScript syntax and whitespace; not route acceptance. |

Actual scanner evidence already recorded separately in `evidence/actual-clamav-source-intake.json`: an isolated helper copy inside the existing backend container sent synthetic TXT/PDF/DOCX to the actual private ClamAV daemon, clean extraction succeeded, safe antivirus test fixture returned422 UNSAFE_FILE. **This is real scanner/helper evidence, not a deployed competency API or local authenticated upload journey.** Files were not published.

## Defects found and dispositions

| ID / severity | Concrete finding | Owner / disposition | Required regression |
|---|---|---|---|
| QA-01 / high | Employee own-assessment GET returned assessor draft ratings/rationale/items; filtering evidence IDs alone did not hide manager drafts | B backend notified; source patch now gates non-assessor draft fields. Await final rerun. | Staff own draft raw GET/list/evidence/oral paths contain no private assessor sentinel; final permitted report still works. |
| QA-02 / high | Final result could copy legacy `oral.source.text` / provider URL into immutable result, surviving source expiry and replaying in PDF | B backend replaced source snapshot with strict reference allowlist and removed PDF raw-transcript branch; regression added. | Inject legacy raw-transcript/provider sentinel before finalise; absent in stored final result, report JSON and PDF. |
| QA-03 / high | Ready evidence past retention expiry remained readable/AI-usable/completion-qualifying until eventual cleanup ran | B backend added central retained/effective policy checks; final rerun pending. | Expired-but-ready source denied before sweep for bytes/AI/findings; no completion credit; null expiry remains valid; hold preserves storage without authorizing expired processing. |
| QA-04 / high | Core `/finalize` middleware checked linked publication/hash, then legacy handler later saved without cross-record fence. Concurrent reopen/source change could invalidate the precheck | Root assigned fix to QA reviewer; `saveFinalOutcome` rechecks and fences Assessment + Appraisal save transactionally; coordinating SA peer-reviewed. | Real replica-set simultaneous reopen and source amendment yield409 and leave parent unfinalized.8 targeted tests passed. |
| QA-05 / high | First new linked assessment could be created after a no-link ordinary finalization read; bridge-only closed-status check did not protect direct launch with appraisalId | Parent no-link version CAS added/tested; B backend owns direct linked-launch parent/open/reviewer/participant transaction and parent version touch. Final linked-launch regression pending. | If parent save wins, new link rejects closed state; if link fence wins, stale ordinary finalize conflicts. Direct launch and bridge both covered. |
| QA-06 / high | Concurrent fresh IdP claims during schema3→4 migration threw Mongoose VersionError; retrying stale role content risked custom policy loss | Root assigned narrow service fix to reviewer; bounded reload/remerge only on VersionError, duplicate-create reread and explicit503 on exhausted contention; root peer-reviewed. | Five controlled regression cases plus32 real concurrent Mongo requests passed; only winning migration bumps auth revision. |
| QA-07 / medium | Switching assessed finding to insufficient/not-started could retain old observed level/rating, later displayed in unscored report | B backend/frontend notified; drop/reject non-assessed measure fields and clear UI choice with notice. Pending confirmation. | Assess → insufficient → permitted exception finalise: no old observed level/rating in report, unscored remains distinct from zero. |
| QA-08 / medium | Criterion `effectiveWeight` used raw relative input weight instead of normalized composite weight, while overall total was correct | B backend notified. | Mixed-source input weights3:1 produce composite effective weights0.75/0.25 and sum1; report uses same breakdown. |
| QA-09 / medium UX | Library conflict “Copy my changes” used main.innerText, which omits input/textarea values, risking loss of actual unsaved requirements/expectations | Root/A notified; must serialize current draft fields for explicit copy and retain edits until confirmed reload. | Stale draft changes in responsibility/criterion copied, not just labels; latest reload warns and does not overwrite automatically. |
| QA-10 / low UX | CompetencyPage override used saturated accent primary buttons despite approved neutral suite-action/action-ink specification | Root notified; scoped correction only, no shell redesign. | Both themes actual screenshot/contrast checks with neutral primary action. |

These are actionable implementation findings. A passing existing test suite did not establish these missing negative paths. Do not remove findings merely because their owner reports a fix; append exact rerun/source evidence below.

## All25 story acceptance coverage and remaining proof

`Foundation present` means source and at least focused tests exist; it does not mean all acceptance clauses passed in browser/production. Exact test IDs in current code sometimes use a neighboring CA number; final traceability must map to the PM clause, not infer completeness from test title alone.

| Story | Observed implementation / test foundation | Remaining acceptance before full claim |
|---|---|---|
| CA-001 role create/upload | Manual role drafts, reviewed import confirm, safe file adapter, duplicate warning and retry identity | Actual authenticated app create/upload/review/edit/confirm with configured scanner; recovery and input-preserving UX; helper scanner proof alone insufficient |
| CA-002 immutable role versions | Draft-only PATCH, publish/head version, archive, snapshots, CAS tests | Browser conflict and complete draft-copy comparison, v1→v2 report/PDF invariance rendered |
| CA-003 frameworks/levels | Source-specific IDs/descriptors, internal/SFIA distinction, licence provenance guard, version tests | Full library editor/published picker flow both themes; lawful tenant-supplied SFIA data separately configured |
| CA-004 seven input sets | Parameterized persisted API launch/assess/publish/report tests cover all7; zero/unknown rejected | Browser/source-removal/roundtrip journeys across all7; no hidden residual rules/weights |
| CA-005 strategy | Manual versioned criteria and authorized OKR link adapter; numeric scale target | Authenticated objective search/select scope and changed-source UX; strategy-only browser role/cycle path |
| CA-006 role expectations | Native source FK validation and role-target mapping; published snapshots | Native-level and numeric target picker recovery/mixed versions, per-role differences and invalid-mapping jump UX |
| CA-007 people/role/reviewer | Current directory adapter, explicit reviewer, role selector in existing Start appraisal, preflight and retry receipt | Direct link first-insert race regression QA-05, real OIDC role matrix/current wizard persistence, refresh after partial link failure |
| CA-008 role comparison | Frozen role/expected-observed workspace and source-labelled findings | QA-01 draft privacy, QA-07 stale measure, actual linked appraisal/read-only employee view and restricted evidence |
| CA-009 optional role AI | Requester identity, gateway activity/consent, cited draft output and human review | New activity allowed and actual personal-account provider success + denied second user's account path; no-AI complete path separate |
| CA-101 evidence | Participant/criterion/org binding, private file stream, ready/deleted states, consent-independent manual source, retries | QA-01/03, authenticated real scanner upload API, view/download/action negative cases and revoked source |
| CA-102 manual oral | Prompt/answer/notes, date/timezone/participants, draft/submitted versioning, oral-to-evidence link | Complete browser manual flow and no-provider pilot; field failure/conflict/history authorship and source withdrawal |
| CA-103 recorded oral | Existing completed Nylas/native call references, source and per-assessment participant consent, fresh transcript endpoint | Actual new competency consent UI with both participants, recorded Nylas/native artifacts linked/displayed; earlier call feature evidence is insufficient |
| CA-104 AI drafts | Exact span citations checked, optional personal service, accept/edit/dismiss provenance, no automatic final decision | Actual provider request with authorized permitted evidence, stale/expired source race; review UI cannot turn acceptance into score |
| CA-105 assessor draft | Current expected/observed/rationale/evidence CAS save and browser fixtures | QA-01/07, source restrictions, keyboard/mobile/zoom/both themes and actual refresh/conflict reconciliation |
| CA-106 scoring | Rational deterministic decimal weighted mean, native mappings/direct scales, golden75 and strategy80, denominator/coverage | QA-08 effective-weight display, all policy/missing/threshold/reordering fixtures and screen/PDF parity |
| CA-107 final classification | Suggested separate from human result, reason, atomic published assessment CAS, no second approval queue | QA-04/05 ordinary linked outcome integration, finalise deny/duplicate/conflict browser proof; no employment action |
| CA-108 rankings | Competition/dense ties, scopes, disabled mode and strict compatibility grouping | Browser/API clarity for incompatible groups and scope-denied totals; all configured precision boundaries |
| CA-109 separate actions | Central catalog defaults/exclusions, explicit manager grants, own/assigned/managed/org access, custom deny tests | Fresh IdP schema4 actual roles, revoked membership, export/view/finalise/reopen/exception matrix through real middleware |
| CA-110 completion/exception | Server findings/evidence/rationale readiness, explicit reasoned exceptions, default unscored | QA-03/07 and every missing-item UX jump; no exception bypass of structural/security invariants |
| CA-111 full feedback | Submitted overall/competency/goal/custom mapping, actual audit actor/time, source hash freeze and changed notice | Ordinary outcome atomic integration QA-04/05; manager sentinel all fields screen/PDF; missing/disabled/amended source branches |
| CA-112 participant PDF | Canonical permission-filtered immutable DTO, PDFKit export/private download with view/export split | Render every generated page for long comments/chart clipping; exact role/native descriptors/values/source labels web/PDF parity |
| CA-113 cohort | Scope before filtering/aggregation, completion denominator, gaps, ranks and PDF export | Ten-person and managed subset reconciliation, filter/empty/error behavior, no hidden counts; PDF render/parity |
| CA-114 history/reopen | Immutable embedded result versions, CAS reopen, audit, old hashes | QA-04/05 races, prior/current version browser selection and later source edit/export stability; action revoke direct API |
| CA-115 consent/retention | Purpose-specific settings, actual participant-owned call consent, retention worker, holds/deletion states and source tombstones | QA-02/03, provider deletion/backup limits, actual consent/revocation and source expiry playback; no universal erasure claim |
| CA-116 pilot/release | Synthetic fixtures and separate UI/API/provider proof layers; ten-person API pilot being extended | All25 clauses signed off with final source snapshot, complete browser + PDF renders, required CI and exact-main deployment/OIDC/authenticated live checks |

## Scope and ownership of QA changes

Root-authorized narrow fixes by this reviewer: `Identityprovider/src/services/accessControlService.js`, new `Identityprovider/tests/access-control-migration.test.mjs`, `performance/backend/services/competency/appraisalBridgeService.js`, new `performance/backend/tests/competencyAppraisalAtomic.integration.test.js`, and exactly two owned hunks inside existing `performance/backend/routes/appraisals.js` (finalized audit's subsequent save and finalizer DomainError response). **The earlier lifecycle/remove/restore changes in that same route are unrelated and were not authored or approved in this review.** Use patch staging; never stage the whole dirty file without owning-workstream release approval.

No plaintext credential extraction, password migration, production employee mutation, real classification or new provider call was performed by this QA reviewer. The disposable databases and synthetic records are separate from local app/runtime data. Root's earlier automatic approval rejection on credential-preserving startup was not worked around by this reviewer.

## Final rerun and release updates

### Final independent local rerun — passed

After B backend handoff froze the relevant code and the coordinator reviewed the QA-authored critical fixes:

| Check | Final result | Artifact |
|---|---|---|
| `npx jest --runInBand competency` | **81 passed**,5 real Mongo suites, ~39s | `.local-runtime/competency-qa/final-mongo-rerun.log` |
| `node --test tests/competencyScoring.test.js tests/competencyFileSafety.test.js` | **21 passed** | `.local-runtime/competency-qa/final-pure.log` |
| IdP catalog + migration tests | **24 passed** | `.local-runtime/competency-qa/final-idp.log` |
| Atomic parent/first-link races | **10 passed**, included in81 | `.local-runtime/competency-qa/final-atomic.log` |
| New Chrome `e2e/competency-draft-backup.spec.ts` | **1 passed**, isolated port5035 test copy; no user5005 server touched | New committed-intent test source; runner output in task trace |

The atomic suite now exercises actual `assessmentService.launch` against the ordinary parent-save helper in both winner orders with real replica-set persistence. Only the published library definition is a controlled fixture for those two tests. If ordinary finalization wins, linked launch retries and sees closed state, with no assessment insert; if the new link wins, stale no-link parent save conflicts. The other tests cover already-linked reopen/source amendment races, tenant rejection, transaction rollback, and actual standalone unsupported-transaction failure with ordinary save still working.

The first wider rerun had78 passes and1 audit-rollback assertion failure because the test compared the old pre-link parent version0 after a newly correct initial-link transaction legitimately incremented it to1. B changed the baseline to capture the parent version after link, before attempted final publication. Focused current rollback test passed, then all81 passed together. This was not evidence of a rolled-back write leaking through; the complete fresh suite proves the post-link version remains unchanged on the injected final-audit failure. Error logs in injected-failure tests are intentional and contain safe route/action identifiers, not source text.

### Finding disposition after independent rerun

| Finding | Current disposition |
|---|---|
| QA-01 draft privacy | **Resolved locally**: non-assessor raw detail has no assessor findings/feedback/oral drafts; own source visibility and published result remain distinct. Direct/private-source regression in81. |
| QA-02 raw transcript snapshot | **Resolved locally**: strict safe reference projection, no raw transcript/provider URL in result; raw PDF branch removed; sentinel test in81. Actual provider still separately unverified. |
| QA-03 expired-ready evidence | **Resolved locally**: retained/effective checks apply before cleanup to bytes/AI/use/completion. Expired source remains visible only as unavailable metadata, not text; before-sweep regression in81. |
| QA-04 stale ordinary finalization | **Resolved locally**: transactional shared fence, source/version match and root-reviewed exact route hunk; race regressions pass. |
| QA-05 first-link race | **Resolved locally**: direct launch transaction validates fresh open parent/participant/reviewer and touches version with creation; no-link ordinary save uses version CAS; actual two-order race tests pass. |
| QA-06 IdP migration concurrency | **Resolved locally**: bounded reload/remerge, five regression cases and32 real Mongo concurrent requests; root independently reviewed. |
| QA-07 stale insufficient measure | **Resolved locally**: non-assessed findings clear old measure values; final unscored report has no old observed level; regression in81. |
| QA-08 composite effective weights | **Resolved locally**: divide input weight by configured input total; mixed-source contribution sum1 tested in21. |
| QA-09 draft backup loss | **Resolved in focused browser**: current draft serialization includes unsaved responsibility/summary, hidden requirement, criterion weight3 and native IDs; copied/downloaded JSON equal; compare-cancel preserves edits. |
| QA-10 neutral primary actions | Coordinator changed scoped action override to suite-action/action-ink. **Source correction inspected**; actual both-theme visual/contrast acceptance remains required. |

B's updated persistence suite additionally completed every source-set journey through PDF text parsing, and a10-person internal-only manual oral cohort through score/human finalization/scoped subset/rank ties/cohort PDF. These are strong **API/persistence** pilot proofs with controlled identity; they do not substitute for actual client onboarding, browser accessibility, new provider consent or deployment proof.

### Additional coordinator findings and remaining boundaries

- **QA-11 / real cross-origin CORS:** coordinator's authenticated local app caught missing `If-Match` in API CORS allowed headers, which same-origin mocked UI and Supertest could not expose. Root added `If-Match` plus exposed `ETag`/`Content-Disposition`. Real browser OPTIONS/PATCH retry must be recorded by coordinator; source correction is present. This was a browser transport block, not proof of an unknown backend500. Keep a real cross-origin preflight check in acceptance.
- **QA-12 / AI model provenance:** B added actual returned model/provider and generation timestamp to suggestions instead of guessing a model. New personal AI activity is registered in the gateway. Provider/account/consent acceptance is still outstanding; mock response success is not a live inference claim.
- **QA-13 / authority during long AI inference:** `auth.context(ctx.req)` reuses its per-request cache. Current new requests refresh directory, and AI rechecks sources/settings after inference, but that cached call is not a fresh mid-generation IdP membership/action check. Before claiming revoked-mid-job authority acceptance, implement/test a fresh-authority path or document the remaining enabled-AI limitation; manual path is unaffected.
- **QA-14 / upload capacity:** per-file10MiB, parser8s and per-worker128MiB bounds are present, but inspected extraction starts a worker per request without a global/tenant concurrency semaphore. No load/stress proof was run. A bounded extractor/scanner slot or documented rate/resource control is needed before claiming architecture's global workload bound.
- Coordinator verified production Mongo `hello` is a replica set/primary without reading employee records. This clears environment suitability for linked transactions only; it does not establish deployed competency behavior. Local named fixture Mongo was standalone at this checkpoint; coordinator owns any safe replica-set upgrade and authenticated linked-flow test.

**Current QA verdict:** no remaining known high-severity defect among QA-01–08 after the passing final local regressions. Continue coordinated acceptance; **not yet production-certified** because final actual browser/PDF/theme/accessibility, enabled AI/call/retention-provider, workload and exact revision CI/deployment/live evidence remain separate gates. CI/deployment evidence must identify the eventual commit, since current base HEAD does not identify uncommitted file contents.

## Final source-consent and processing review — 19 October 2026

Coordinator moved the shared checkout to `codex/competency-assessment` from `b401f1b1`; the following is local uncommitted/index review evidence, not deployed-revision proof.

| Finding | Resolution and evidence |
| --- | --- |
| QA-13 fresh authority during AI | Reviewed coordinator's fresh OIDC-userinfo subject/org verification, current principal sanitization and forced separate IdP directory lookup. Both AI dispatch and publication use it. Production IdP disables process-local claims caching; development cache keys include account authorization revision, which policy updates increment. Coordinator's two authority tests and B's provider-in-flight revocation test cover this boundary. No remaining known source-level blocker. |
| QA-14 upload capacity | Reviewed pre-Multer organization/actor rate budget and four active uploads; independent process-wide caps of two scanners and two parser workers release in finally paths. Actual HTTP/worker tests distinguish protocol adapters from a real scanner. Actual private ClamAV intake proof remains separately documented. |
| QA-15 future calendar consent | Previous calendar flow relied on organizer promise; it could never establish the actual two-party source consent required by CA-103. New future recorded calendar calls create the event with recording deferred. Only the actual manager and employee sessions can separately acknowledge recording and transcription. Both valid acknowledgements are required before the existing Nylas bot is scheduled. Source acknowledgements never replace separate assessment-purpose acknowledgements. Legacy calls are not retroactively upgraded. |
| QA-16 recording/withdrawal races | Gateway claims recording creation once; ambiguous creation never repeats a bot. Revocation during the external response cancels the returned bot. An unknown bot reference remains an explicit cancellation-pending state, rather than claiming cancellation succeeded. Gateway and Performance media synchronization use current revocation predicates before returning/persisting media; no stale whole-object overwrite. Ordinary meeting summaries and analysis also recheck/fence source authority after AI response. |
| QA-17 revoked source alternate entry points | One-on-one detail projection suppresses top-level raw transcript, generated analysis/scoring/prep, AI-derived actions and call media after source revocation. Ordinary analysis rejects before dispatch and fences its save. History/preparation exclude revoked source inputs. Competency evidence GET/detail/oral list redact current still-linked oral answers, AI rechecks before/after dispatch, and suggestion review/findings reauthorize linked evidence. Explicit manual detach remains available. Immutable published human findings remain historical records under the existing report contract. |
| QA-18 report context parity | Participant PDF now prints oral occurrence/time zone, participants, submitted actor/time and revision, and criterion description plus human framework version. A generated PDF is parsed and asserted for these exact values. This supplements the coordinator's rendered visual PDF check; it does not replace it. |

Final focused verification performed by this reviewer:

| Command / environment | Result | Artifact |
| --- | --- | --- |
| `npx jest --runInBand competency` in Performance backend; disposable real Mongo/ReplSet | **96/96**, six suites, 40.775s; checkpoint before the final additional one-on-one route projection tests | `.local-runtime/competency-qa/final-consent-mongo.log` |
| `npx jest --runInBand competencyCalendarConsent.integration.test.js oneOnOneCalls.integration.test.js` after final edits | **20/20**, two suites; actual synthetic authenticated route sessions, real persistence, PDF text parse; external calendar/AI operations explicitly mocked | `.local-runtime/competency-qa/final-consent-focused.log` |
| `node --test test/performance-meetings.test.js` in Recruiter | **13/13**; real disposable Mongo; provider SDK/HTTP explicitly mocked, no real invitations | `.local-runtime/competency-qa/final-consent-gateway.log` |

The one-on-one baseline recording test was updated to obtain both participants' acknowledgements through the actual new REST route before advancing its synthetic clock to process media. Its earlier failure correctly showed that the new consent gate denied an unacknowledged recording; no source gate was weakened to satisfy the test.

Additional owned source files for coordinator staging/review:

- New `performance/backend/services/calendarRecordingConsentService.js`, `routes/calendarRecordingConsent.js`, `services/competency/callEvidencePolicy.js`, `tests/competencyCalendarConsent.integration.test.js`.
- Narrow existing call extensions: `services/meetingCallService.js`, `services/appraisalMeetingMediaService.js`, `routes/oneOnOneCalls.js`, `routes/oneOnOnes.js`, `tests/oneOnOneCalls.integration.test.js`.
- Narrow current-source guard/report additions in team-owned `services/competency/{oralService,aiService,evidenceService,assessmentService,reportService}.js`.
- Recruiter `models/PerformanceMeeting.js`, `services/performanceMeetingService.js`, `routes/internalAI.js`, `test/performance-meetings.test.js`.
- Coordinator separately owns exact new calendar hooks in the otherwise dirty `routes/appraisalMeetings.js` and all new consent UI integration. Do not stage unrelated lifecycle changes in that file.

**Release boundary:** the new source-consent behavior is implemented and passes local persistence/route/protocol tests, with coordinator peer review of critical paths. Real future Nylas scheduling, actual participant browser consent, an admitted bot, retained recording/transcript, personal AI and exact-deployed-main acceptance still require separate recorded proof. No real provider sends or employee classifications were performed by this reviewer. The main coordinator owns clean-index regression, commit/CI/deployment/live verification and the final illustrated delivery PDF.

### PR #135 first CI run: published-manager fixture correction

Performance CI run `39177699818` at head `419fbf98508665bfcb8cbaf0c02b03800aec02fe` completed **191 passed / 1 failed**. The failing historical-report journey seeded manager competency ratings on a completed appraisal without a manager submission timestamp, then expected those draft ratings in the published report. The current report contract deliberately requires `managerReview.submittedAt`; a completed parent can coexist with an unsubmitted or disabled manager stage.

The correction changes **only the test fixture and assertions**, preserving the source privacy guard. The intended published manager review now records a fixed submission timestamp and actual `manager_review_submitted` audit actor. Assertions cover the complete published manager summary, rating, goal feedback, actual author and submission time for employee, manager and HR. The same completed record is then tested with its submission timestamp unset: every actor still sees the published final rating and employee reflection, while manager summary/feedback are null and competency ratings are empty. A fresh passing focused journey run is recorded in `.local-runtime/competency-release-qa-20261019/journey-fixture-regression.log`; coordinator owns the new-head push and CI replay. The failed first run must not be represented as passing or bypassed as a quality gate.

### Coordinator final clean-index verification

Before release, the coordinator copied only indexed sources into `.local-runtime/competency-release-qa-20261019`, with dependency junctions. The snapshot excludes all pre-existing dirty lifecycle code. Current source manifest is retained there. Two unchanged product adapter files were added to the snapshot because IdP catalog tests read their permission definitions.

- Full Performance Mongo regression: **118/118**, nine suites,48.179s. This includes the96 competency cases plus existing appraisal/colleague/call regressions. Initial failure was an old recording fixture without the now-required participant consents; only its test setup was updated to use both actual participant REST acknowledgements, then the entire suite passed.
- Existing Performance legacy **83/83**, unit **38/38**; gateway **13/13**; IdP access/migration/directory **35/35**.
- Scoring/file/budget **25/25**; deployment Python **9 passed,4 Windows-specific skips**; three deployment YAML documents parsed. This is not an actionlint result.
- Final indexed frontend production `next build --webpack` passed, including the last source-withdrawal UI guard. Browser reports31 B cases plus9 library and1 backup case; contracts/controlled identity are distinguished from the earlier actual local IdP walkthrough. Participant PDF regenerated, both A4 pages parsed and visually inspected, with full oral/source metadata.

**Coordinator verdict:** local manual/default feature and regression gates pass for the indexed source. Release may proceed behind default-off optional AI/call settings. Exact CI/main deployment, fresh authenticated live journey, live personal AI/call artifacts and real-client policy configuration remain separate acceptance gates; do not label those complete from local tests.

### QA-20 capped cohort metadata

The coordinator found the truncated flag was computed after authorization filtering. A2,000-candidate scan containing stale assigned reviewers could therefore incorrectly claim a complete result. Pair B now captures scan saturation before filtering, while every visible count/name/filter still uses currently authorized rows. The real-Mongo regression inserts2,001 candidates and verifies only one accessible result, no hidden sentinels, and an explicit incomplete flag. B44/44 focused checks passed.

Coordinator refreshed only the staged changed source/tests into the clean snapshot and ran **all193 integration cases in18 suites: passed in75.65s**. This is the final wider local regression, replacing the earlier118-case subset as the complete backend checkpoint. The unchanged Experience baseline remains failing and is explicitly outside the competency release claim.

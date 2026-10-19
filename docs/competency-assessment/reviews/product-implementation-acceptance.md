# Product implementation acceptance — competency assessments

Reviewer: retained PM A. Date: 19 October 2026. Repository verified: `E:/GitHub/C-drive/seemplify`, branch `main`, HEAD `b401f1b1583be5875cc02462122c83ec9e7311d2`. Competency implementation is **uncommitted working-tree content**; that base SHA does not uniquely identify the inspected files. Unrelated existing appraisal lifecycle work remains dirty and is outside this review's release scope.

**Verdict at this checkpoint: substantial local implementation, conditional product acceptance; not yet ready for an “all features complete/live” claim.** Two concrete product gaps are being returned to implementation owners below. Current automated and authenticated-local evidence is strong for the manual workflow; actual scanner-through-browser, enabled call/AI paths, final PDF rendering and exact committed CI/deployment/live proof remain separate gates.

## Review method and evidence boundaries

Applied the installed competency product and QA skills; used PDF skill for read-only PDF inspection. Revisited all25 story contracts (CA-001–009 and CA-101–116), original PRD and user clarifications, approved UXA/UXB specifications, final architecture/development contract, current implementation and independent QA review. Inspected the existing Start appraisal role-selection integration, role/frame/cycle controls, source feedback projection, frozen report DTO, PDF serializer, oral and AI paths.

Visually inspected recorded synthetic/local artifacts:

- `evidence/screenshots/local-authenticated-overview.jpg` and `local-authenticated-final-report.jpg`: coordinator's actual authenticated local app, published result visible. The screenshots establish only what is visible; the final-report image is above the detailed finding/feedback sections.
- `.local-runtime/competency-browser/evidence-b/complete-manager-feedback-report.png`: light-theme ordinary appraisal report with distinct actual reviewer, goal comment sentinel and overall manager rating.
- `assessor-mobile-dark.png`: 390px compact assessment with named numeric scale/target, manual feedback and AI-disabled recovery, no obvious page overflow in the captured state.
- `final-pdf-1.png` through `final-pdf-3.png` and strict `pypdf` extraction of `real-api-final-report.pdf`: readable three-page recorded synthetic result, score80, target90, manual oral answers and manager sentinel. Older captured PDF has an integrity-only third page; current serializer was subsequently compacted, so final render acceptance must use a regenerated current artifact.

Browser inventory exposed only the existing production Edge dashboard/email tabs to this reviewer; no local authenticated tab was available in this agent's browser surface. This reviewer did not navigate or mutate production, sign in as another employee, finalise a real review, send AI data, initiate a provider call or independently rerun the coordinator's OIDC journey. Source inspection and recorded local evidence are explicitly distinguished from fresh independent browser execution.

Independent QA evidence reviewed:81 real-Mongo tests,21 pure/scanner tests,24 IdP tests,10 atomic races included in81,32 real concurrent IdP migration requests and1 draft-backup browser check. Broader B browser suites, coordinator's actual-local manual path and actual private ClamAV helper proof are additional recorded evidence. These counts are reviewed execution records from owners/QA, not new commands run by this PM. Later fixes must be rerun on the final file set.

## Feature acceptance table

`Local foundation accepted` means the requested behavior is visible in source and has meaningful recorded local evidence; it does not assert every acceptance clause or production behavior passed.

| Stories / feature | Current implementation and observed value | Product acceptance / remaining specific proof |
|---|---|---|
| CA-001 create/upload occupational roles | Manual role editor; reviewed PDF/DOCX/TXT imports; human confirmation; source safety service; recovery/manual path | Local foundation accepted. Actual signed-in app upload→real scanner→review/edit/confirm still required; simulated import UI and helper scanner are separate proofs. |
| CA-002 version/archive roles | Immutable published versions, draft CAS, archive and historical snapshot behavior; safe unsaved-draft backup | Local foundation accepted. Retest v1→v2 report rendering and archive/conflict UX against final file set. |
| CA-003 source-specific frameworks | Internal/SFIA source definitions, native levels, descriptors, versions and supplied-content provenance | Local foundation accepted. No bundled/proprietary SFIA catalogue promised; actual client definitions require configuration. |
| CA-004 seven input sets | Persisted seven-source combination journey tests and source-specific cycle UI; empty source rejected | Local API scope accepted. Full browser route/round-trip/source-removal matrix must be retained; one strategy browser journey alone is not seven browser journeys. |
| CA-005 strategy criteria | Manual strategy versions and authorised OKR references; numeric target/scale without SFIA | Local foundation accepted; source-search access/change UX and actual configured strategy mapping require browser proof. |
| CA-006 role expectations | Explicit source/version/criterion references, native expected levels or configured numeric target, role-specific mappings | Local foundation accepted. No silent cross-source equivalence; final report descriptors/version presentation needs PM-I1 below. |
| CA-007 existing people/role/reviewer setup | Existing `app/appraisals/start/page.tsx` contains opt-in occupational-role assessment, explicit cycle and per-person role version, preflight, check answers and retry of existing IDs | **User's current-appraisal setup requirement present.** Mocked bridge retry tests and real-Mongo race tests are distinct. Final real authenticated current-wizard launch/link/reload must be recorded. |
| CA-008 same-role human comparison | Frozen expected/observed workspace, source labels, insufficient evidence, attributed findings and saved drafts | Local foundation accepted; final source descriptors/report parity under PM-I1. |
| CA-009 role-aware optional AI | Same frozen role sent with allowed evidence, personal gateway identity, citations and human review | Source/contract foundation only. Enabled personal-account provider success, consent/account denial and fresh-authority race regression remain required. |
| CA-101 criterion evidence | Participant/tenant/criterion bindings, private source streams, scanning, provenance, retained/effective checks | Local API foundation accepted after QA privacy/retention fixes. Real authenticated scanned-upload/API path and denial need final proof. |
| CA-102 manual oral | Structured prompts/answers/notes, participants, occurrence time/timezone, submission and draft versioning | Manual path locally evidenced. Report occurrence/submission timing presentation included in PM-I1. |
| CA-103 recorded oral | Existing completed-call source list, participant-owned assessment-purpose consent, authorised transcript linking/read | **Conditional: PM-I2 schedule/start entry from assessment missing in inspected OralPanel.** Actual new Nylas/native capture/link/transcript/consent proof separately pending. |
| CA-104 cited AI review | Exact evidence-span validation, editable reviewed draft, explicit non-decision behavior; no automatic rating/finalise | Local deterministic tests accepted as simulation. Actual provider and final authority-refresh regression remain separate. |
| CA-105 assessor workspace | Native versus numeric control, rationale/evidence and draft save/reload; stale-save/concurrent review fixes | Local foundation accepted; final browser rerun after peer fixes, keyboard/zoom/both themes still required. |
| CA-106 reproducible scores | Exact rational weighted mean, explicit mappings, scale target90/observed80→score80, golden75, corrected effective weights | Local scoring foundation accepted. Display/PDF all selected source definitions, measure names and formula parity remain required. |
| CA-107 human suitability | Calculated suggestion separate; explicit category/override reason; durable immediate published result; ordinary-appraisal transactional fence | Local foundation accepted after independent atomic tests. No approval queue or employment action introduced. |
| CA-108 optional rankings | Strict comparable groups, scoped role/department/org, dense/competition ties, configured precision and disabled mode | Local API foundation accepted. Actual scoped cohort filters/exclusion labels and rendered export need final UI proof. |
| CA-109 separated actions | IdP permission catalog/default exclusions/current directory, edit/finalise/reopen/exception/view/export separation; bounded migration | Local foundation accepted after migration/race tests. Fresh real role matrix/revocation and committed IdP deployment remain release gates. |
| CA-110 completion/exception | Actionable server blockers, reasoned independent exception grants, no silent zero/missing reweighting | Local foundation accepted; UI must preserve each exact gap/permission case and final state recheck. |
| CA-111 complete manager feedback | Source projector freezes overall/competency/goal/custom entries, recorded submitter/time/rating and source hash; ordinary report now includes goal comments | **Core user request present**, but PM-I1 custom-question labels/context omitted in inspected competency projector. Missing/disabled/amended reviewer branches and history are locally tested. |
| CA-112 participant report/PDF | Canonical permission-filtered frozen DTO, independent export grant, actual private generated PDF | Conditional on PM-I1 and regenerated current PDF page inspection/parity. No report/provider/live completion claim from old screenshots. |
| CA-113 cohort report | Scope before aggregation, counts/gaps, compatible ranks, ten-person API fixture and cohort PDF | Local API pilot foundation accepted. Actual client cohort and final browser/PDF proof separate. Large-cohort bounded limits are disclosed, not tested as unlimited scale. |
| CA-114 history/reopen | Immutable old results, source hashes, new reopened working revision and historical report/PDF | Local foundation accepted including atomic races. Current browser old/new version selector and source-change notice should be rerun. |
| CA-115 consent/retention | Purpose settings, participant-owned assessment consent, expiry-before-sweep denial, holds/tombstones and cleanup | Local domain controls evidenced. Original shared-call/provider retention/deletion remains source-owner responsibility; no universal erasure claim. Actual provider policy/expiry proof pending. |
| CA-116 pilot/release | Seven API combinations, ten synthetic manual participants, safe local browser and layered evidence | **Not yet final accepted:** final fixes/test manifest, committed exact revision, required CI, deployment and authenticated live proof absent; actual MoMo staging onboarding distinct from synthetic testing. |

## Concrete product findings returned to implementation owners

### PM-I1 — final report loses meaningful source/feedback context

Priority: medium, must resolve before claiming CA-111/112 fully accepted. Sent to coordinator and both B implementation owners; PM does not own their code.

1. `services/competency/reportService.js` PDF prints expected/observed native labels but not their descriptors; web `CompetencyReportSection.tsx` also omits criterion definition/native descriptions. Both need the original native source context, not just a level number/name.
2. The frozen criterion's `sourceName` is the framework/strategy name only. Web prints that name, PDF prints name plus opaque `sourceVersionId`; neither provides the human framework/strategy version in the inspected renderer. Source versions must be readable; IDs belong in optional integrity details, not as the user's version label. Numeric expected/observed measures must display their configured human scale name/units rather than bare90/80 or internal `pct` key.
3. `assessmentService.sourceFeedback` copies submitted custom response values but does not resolve frozen section/question prompt. Multiple entries render simply “Custom”, losing the meaning of each answer. Freeze section and question text from the appraisal's own design snapshot, show that title with the value, and use “Not recorded” for genuinely unknown legacy prompts. Do not infer today's question text.
4. Frozen oral results already store `occurredAt`, `timeZone` and `submittedAt`, but the report currently displays creation time only. Show session occurrence separately from recording/submission dates so users cannot confuse when the conversation happened with when notes were entered.

Required regression: sentinel native descriptors/source versions/custom prompts, numeric measurement label, distinct oral occurrence versus submission; all present in JSON/web/PDF from the same frozen record; a later library/question edit leaves old report unchanged. Render the updated PDF and inspect all pages. Formatting should avoid an otherwise-empty integrity-only final page where possible, but content correctness takes priority over arbitrary page count.

### PM-I2 — recorded assessment flow links old calls but has no schedule/start entry

Priority: medium. `assessment/OralPanel.tsx` currently selects manual evidence or an authorised **completed** Nylas/native call from `available-calls`, plus transcript reading. It does not present existing schedule/start controls or a contextual navigation entry preserving the assessment/subject. CA-103/1 and approved UXB §7 require scheduling/starting from the oral workflow, reusing existing call services.

Resolution: reuse the existing calendar/native call entry points in the assessment context; a safe contextual link may be appropriate if it preserves the selected subject, meeting mode and return path, explains completion/linking, and works for standalone assessments as well as linked appraisals. Do not build a competing call stack or imply historical completed-call linking proves new capture. If scheduling/starting cannot be delivered, explicitly mark this part of CA-103 outstanding instead of silently reducing scope.

Required regression: each permitted mode has an accessible schedule/start entry; denied/unconfigured mode explains manual alternative; subject/assessment context is retained; resulting completed source can link exactly once. Actual recording/transcript acceptance remains a separately authorised staging provider test.

## Release and provider gates

- Re-run the focused and full required tests after current fresh-AI-authority, upload-budget and report/call changes. Latest `aiService` source now calls `refreshAuthority` before dispatch and before publishing a returned draft; source presence alone does not prove the new revocation tests pass.
- Verify the new upload global/tenant bound through meaningful contention/release tests; a per-file10MiB cap and a worker128MiB limit are not a global concurrency limit.
- Actual signed-in role upload must traverse the deployed/local scanner-backed API and show reviewed human confirmation. Actual helper daemon proof remains useful but separate.
- New competency-enabled Nylas/native call paths need actual consented returned recording/transcript artifacts. Previous generic call-feature acceptance and synthetic call fixtures do not establish new assessment-purpose permissions.
- Actual requesting-user AI account, new allow-listed activity and per-purpose sharing consent require enabled-path staging smoke. Never borrow an owner's account to turn that test green. Manual no-AI/no-call path must stay independently usable.
- Use latest actual synthetic participant/cohort PDFs for text/value comparison and visual inspection, including long custom/goal comments and native descriptors. Existing rendered artifacts do not cover newly fixed serializer fields.
- Freeze exact release paths and exclude unrelated lifecycle changes; commit identifies the real tested source, then required CI/security scan, exact image deployment, health/OIDC and authenticated live read-only acceptance. Nothing in this review authorises bypassing failing QA.
- Actual MoMo organisation participants/roles/framework/scoring setup is client staging acceptance, not established by a ten-person synthetic fixture. Keep its status explicit.

The final user PDF should say what was implemented and where, backed by real screenshots and current revision evidence; provider paths and remaining pilot work must stay labelled. Product review does not convert an uncommitted local build into a live release.

## Final receipt audit — 19 October 2026

Reconfirmed `main` HEAD remains `b401f1b1583be5875cc02462122c83ec9e7311d2`. Many competency files are now staged and some have further unstaged changes; **no programme commit or deployed application revision exists yet**. Staged file existence is not an accepted release snapshot. This section supersedes earlier open-item statements only as explicitly resolved below.

### Latest local receipts and limits

| Receipt | Current evidence meaning |
|---|---|
| Pair B browser runs: **29 unique passing tests** | Coordinator's consolidated receipt for assessor/report/current-appraisal/recording-consent UI and real API journey coverage. Do not sum repeated reruns into a larger total or call fixture requests real providers. |
| Pair A browser: **9 passing tests**, plus independent draft-backup **1 passing test** | Library/setup/import review/configuration/recovery contracts; draft backup proves actual unsaved values survive/copy. These are separate from the authenticated real-scanner upload journey. |
| Backend B final focused rerun: **43/43 passing** | Updated owner handoff includes final report-context and fresh-authority regression. Earlier independent whole-domain81, pure21, IdP24 and10atomic are historical checkpoints; rerun final changed source set rather than pretending old counts certify later edits. |
| Existing authenticated local manual journey | Previously passed real local IdP session→frontend5005→API5004→database with synthetic evidence, finding, submitted oral notes/feedback, score80, human finalisation and report. Preserve that evidence as an earlier actual-app run. |
| Fresh local sign-in **currently blocked** | After API restart with public configuration, the original OIDC client secret was absent, so a fresh login cannot currently complete. Earlier screenshots do not prove fresh login works now. This is a local runtime/configuration acceptance blocker, not evidence that production login is broken. Do not print/extract secrets or work around rejected credential actions. |
| Real scanner **three formats + safe AV rejection passed** | Actual private ClamAV intake helper accepted/extracted synthetic TXT/PDF/DOCX and rejected the safe antivirus test pattern. This proves actual scanner/helper operation; it still does not prove the entire signed-in browser upload route. |
| New actual AI/call provider proof | **None added by these receipts.** Contract fixtures and actual source/consent wiring are useful but do not certify personal inference, newly scheduled recording/transcript or provider deletion. |
| Programme release | **Uncommitted / not released.** No new CI/deployment/image/OIDC/authenticated live acceptance may be inferred. |

Receipts are reviewed owner/QA records, not tests rerun by this PM. Final counts and commands should come from the frozen-source run manifest. `STATUS.md` still has older20/suite and running-state wording; the integration owner should update it from the final receipt set before delivering the PDF.

### Prior product findings after current-source inspection

- **PM-I2 resolved at implementation/contract level.** `OralPanel.tsx` now invokes the existing `OneOnOneSchedule`, prefills the assessed participant, passes an assessment return path and refreshes the source list after creation. It works as an entry from the assessment rather than requiring an old completed call first. Provider capture acceptance is still separate. Current call-consent changes include actual participant source consent and assessment-use consent; they must remain disabled when policy/source consent is missing.
- **PM-I1 native/source/custom-feedback context resolved at source level.** `reportService.buildReportDTO` projects human source definitions/versions and scale labels; web/PDF render native expected/observed definitions and named numeric scales. `sourceFeedback` now freezes section title, question prompt/type and submitted answer from the original appraisal design, and both report surfaces show prompt context. The focused CA-111 test asserts frozen question/section sentinels and preserved source hash.
- **PM-I1 oral date PDF parity remains a narrow observed omission at this audit.** Web report now shows actual session occurrence/timezone, participants, submitted-by/time and created-by/time separately. Inspected `reportService.pdfBuffer` oral section still outputs title/type, prompts/answers/notes and creator/time only; it does not print `occurredAt/timeZone/submittedAt/submittedBy/participants`. Return this exact field-level discrepancy to the report owner; it is not a request for new scope. After correction, run text parity and inspect regenerated PDF pages before closing it.

### Prioritised remaining items

**Product implementation:**

1. Close the narrow oral-session web/PDF timing/participants parity discrepancy above, with distinct occurrence and submission fixtures. It is the only newly retained concrete field-level product gap in this final review; no broad wishlist is added.
2. Keep actual client configuration/onboarding separate from code completeness: MoMo's approximately10 staging participants, assigned roles, lawful framework content, scoring and scoped access need client-specific acceptance. The reusable engine's synthetic cohort is not proof this data setup exists.

**Acceptance / release / external proof:**

1. Restore a working fresh local OIDC configuration by an authorised supported route, then repeat actual signed-in upload/manual/current-appraisal role-link and report acceptance. Existing-session success remains valid historical evidence but is insufficient to assert the current local startup works for all users.
2. Freeze/stage exact programme hunks, rerun required tests on that actual snapshot including new consent/authority/workload changes, then get CI/security/deployment and authenticated live proof for the exact committed revision. Preserve unrelated lifecycle changes.
3. Prove the enabled requesting-user AI and both new call modes with actual consented return artifacts; record provider/retention limitations. Optional settings may remain off while manual workflows are evaluated, but do not call these enabled paths fully accepted.
4. Generate latest participant/cohort PDFs and final illustrated delivery PDF, render and inspect every page. Earlier images cannot close later serializer/layout edits.

### Review of illustrated-report generator

Read `report/build_report.py` as source only; did not author or run it. Its eight-page structure covers all25 story IDs, screenshot labels, actual versus fixture/local/provider/release distinctions, manual-first workflow and independent permission boundaries. It is an appropriate concise delivery-record structure **provided the final metadata is populated from real receipts and every page is rendered/checked**.

Required evidence-label corrections before final delivery:

- Page8 “Authenticated local app” must explicitly say **earlier existing-session run passed; fresh sign-in currently blocked after restart** until a fresh run actually succeeds.
- Do not leave “Implementation complete in core areas” as a blanket headline if oral PDF parity or enabled-provider paths remain open. Use “Implemented locally; release and provider acceptance pending” or an equally precise final status.
- Populate browser proof with **29 unique B +9 A +1 backup**, with fixture/real API boundary. Do not add repeated runs or label them all actual authenticated end-to-end tests.
- CA-103 may say scheduler/source/consent wiring implemented and contract-tested; it must retain **actual new recording/transcript acceptance pending**. AI rows similarly remain provider-gated.
- “Actual scanner” stays **private helper/intake proof**, not full authenticated upload-route acceptance. Current source labels should explain this at the test table, not only in hidden metadata.
- Include final exact commit/CI/deployment identity only when it exists. Until then footer/headline remain local/unreleased. Page5 earlier screenshots must stay attributed to their actual run/environment; generated concepts never substitute for implementation proof.

**Current verdict:** conditionally accepted local implementation with the narrow PM-I1 PDF omission awaiting closure; no “all done” or production-ready approval. Fresh-login, final snapshot/CI/live and real optional provider gates remain open. Once the product omission is fixed, local product scope can be accepted subject to executed acceptance; that still does not certify deployment or providers.

## Coordinator verification after final PM audit

The residual oral PDF parity omission was fixed and covered by generated-PDF text assertions. Pair B regenerated the real API/Mongo participant PDF and visually inspected both final A4 pages; occurrence/time zone, participants, actual submitter, revision, native descriptions and human source version are present. PM-I1 andPM-I2 now have implementation and local verification receipts. Final clean-index backend regression is193/193. Current fresh-login/provider/client-pilot and deployed-revision gates remain distinct; the unrelated Experience CI baseline is not certified by this programme.

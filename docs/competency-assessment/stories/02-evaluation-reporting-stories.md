# Competency assessment: evaluation and reporting stories

Owner: Product Manager B. Status: planning / ready for architecture review; no product implementation claimed. Baseline inspected: Seemplify main `b401f1b1` (18 October 2026). Uncommitted lifecycle work is outside this plan and must remain untouched.

Sources: original **Seemplify Competency Assessment PRD**, pages 1–3; the user's explicit role creation/upload and complete manager-feedback clarifications; current source evidence below. Story acceptance clauses are proposed build contracts, not evidence of passing tests.

## Shared contracts

- All reads, writes, downloads, AI jobs and aggregate queries are scoped to IdP-authorised organisation and resource scope. IDs supplied by a client never expand scope.
- The participant's **assessment role** is a versioned competency profile, distinct from an IdP access role such as HR/admin. Expected levels stay linked to their framework source/version.
- Existing appraisal/call/document/AI services are foundations to extend, not an alternative identity authority or a second recruitment assessment product.
- No separate mandatory approval queue. An authorised finaliser is responsible for the final classification. AI suggestions are drafts and are never independent evidence.
- Proposed navigation names require UX validation; implementation must reuse the existing Performance shell, workspace permissions and visual system.
- Every story includes an API denial test and a second-tenant test; hiding a button is insufficient. Test datasets use synthetic people/documents and never assess live employees for convenience.

## Story index and handoff order

| ID | Story | Dependency / architecture packet | UX surface |
|---|---|---|---|
| CA-101 | Criterion-linked evidence intake | Participant, role and criterion snapshot contracts from setup stories | Appraisal → Evidence |
| CA-102 | Manual structured oral assessment | CA-101 | Appraisal → Oral assessment |
| CA-103 | Optional recorded oral evidence | CA-102, existing meeting/media services | Oral assessment → Session |
| CA-104 | Cited AI drafts and human review | CA-101/102/103, shared gateway | Evidence / AI review panel |
| CA-105 | Expected-versus-observed assessor workspace | Role/framework setup, CA-101/102 | Reviewer assessment |
| CA-106 | Versioned scoring and explicit conversions | Setup snapshots, CA-105 | Cycle scoring / Score breakdown |
| CA-107 | Thresholds and human final suitability | CA-106, CA-109/110 | Final outcome |
| CA-108 | Optional comparable rankings | CA-106/107, CA-109 | Cycle rankings / Cohort report |
| CA-109 | Action-specific permission enforcement | IdP permission catalogue / directory | Identity permissions / all protected surfaces |
| CA-110 | Completion checks and reasoned exceptions | CA-101/105/109 | Checklist / Final outcome |
| CA-111 | Complete manager feedback in the final record | CA-105, existing reviewer form | Reviewer assessment / Report |
| CA-112 | Participant report and PDF parity | CA-106/107/109/111/114 | Participant report |
| CA-113 | Scoped cohort reporting | CA-108/109/112 | Admin reports |
| CA-114 | Historical records, audit and reopen | All snapshot contracts, CA-109 | Activity / Version history |
| CA-115 | Retention and processing consent | CA-101/103/104/109/114 | Admin assessment settings / media |
| CA-116 | Full pilot acceptance and release proof | All setup and evaluation stories | Staging journey / release evidence |

## CA-101 — Attach evidence to the participant and criteria

**As an authorised assessor**, I want CVs, uploaded role descriptions, strategy references and supporting evidence linked to the correct participant and criterion, so that each finding has inspectable provenance.

**Priority:** pilot must-have. **PRD:** Evidence management, role mapping, strategy criteria (pp. 1–3). **Status:** partial foundation.

**Acceptance criteria**

1. Given a launched appraisal with a frozen assessment role and criteria, when I upload a permitted CV or role-description file, then the evidence stores tenant, appraisal, participant, category, original source, uploader, upload time, content version/hash and visibility; it can link to one or several criteria of that appraisal.
2. Given an uploaded role description, when I attach it as evidence, then it does not silently replace the selected role profile or its expected levels. Creating/updating a reusable role is an explicit role-library operation with confirmation and versioning.
3. Given a strategy-only cycle, when I attach a strategic reference, then I can link it to the selected strategy criterion without requiring SFIA or an internal framework.
4. Given a required criterion without linked qualifying evidence, when I open evidence coverage, then it is labelled **Evidence missing**, distinct from a deliberate insufficient-evidence finding and from a failed upload.
5. Given an oversized, disallowed, mismatched-signature or unscanned/quarantined file, when submitted, then the server rejects or quarantines it before parsing/AI use; the UI explains a recoverable next step and never displays active document content unsafely.
6. Given another participant's evidence or a tenant B attachment ID, when a tenant A user links, downloads or guesses its URL, then the server denies it without revealing document metadata or returning a storage URL.
7. Given evidence was revoked or superseded, when a finding references it, then the UI shows that state and finalisation reevaluates required evidence; it does not quietly substitute a newer file.

**UX handoff:** file list with source/category, uploaded-by/date, criterion tags and access label; upload progress/retry; preview unavailable state; missing coverage summary; keyboard-operable criterion picker. Empty copy: “Add evidence or record why evidence is insufficient.”

**Architecture handoff:** extend `AppraisalDocument` via criterion references/provenance or a typed `AssessmentEvidence` link; enforce composite tenant/appraisal/participant lookup on every mutation and signed-download issuance. Distinguish evidence file from role-library source document. Define antivirus/quarantine, parser limits and link deletion semantics.

**Code evidence:** `performance/backend/models/AppraisalDocument.js:15,52,70,149` already stores org/category/uploader/visibility; `performance/backend/routes/appraisals.js` owns document endpoints. No first-class source-specific criterion-evidence contract was found in inspected baseline.

**QA evidence required:** API fixture with two tenants/two participants, valid CV/role/strategy samples, hostile file fixtures, UI upload/retry screenshots, persisted metadata assertions and signed-download denial proof. Depends on setup participant/criterion/role version contracts.

## CA-102 — Complete oral evidence without a call integration

**As an assessor**, I want to enter structured prompts, answers and my notes manually, so that oral assessment works when calls, recording, transcription and AI are off.

**Priority:** pilot must-have. **PRD:** Oral assessment and evaluation workspace (pp. 1–3). **Status:** related manual discussion notes exist; criterion structure missing.

**Acceptance criteria**

1. Given all integrations are disabled, when I create a manual oral session, then I can record session date/time/timezone, participants, prompt, answer, assessor notes and criterion links, save a draft, leave and resume.
2. Given three role criteria, when prompts address multiple criteria, then the evidence viewer groups the same source session without duplicating independent evidence or falsely increasing coverage.
3. Given participant and assessor notes differ, when I save them, then the source/author is distinct; manual notes are not labelled a verbatim transcript or an AI summary.
4. Given required oral responses are missing, when I submit the session, then specific prompts are highlighted; draft saving remains possible and no score is fabricated.
5. Given a session is submitted, when a concurrent stale editor saves, then it receives a conflict/reload choice without overwriting newer notes. Authorised amendments preserve prior versions.
6. Given a staff user lacking assessor edit rights or an unrelated tenant's session ID, when it attempts to update/view the session through API or URL, then access is denied and the protected content is absent.
7. Given no call credentials exist, when the full assessment completes with manual oral evidence, then finalisation and reporting still work without an integration warning being treated as a mandatory blocker.

**UX handoff:** “Manual assessment” is a first-class session option alongside calendar/native calls; repeatable question cards show prompt, answer, notes and criterion chips; explicit draft/saved/submitted timestamps; accessible unsaved-change and network-error states.

**Architecture handoff:** typed oral-session model with source `manual`, evidence IDs, authorship, timestamps, version/optimistic concurrency and submission state; reuse common evidence access checks. Scheduling/provider IDs are optional, never required for manual submission.

**Code evidence:** existing `performance/backend/routes/appraisalMeetings.js` and `performance/backend/models/Appraisal.js` discussion notes provide reusable foundations; generic discussion does not establish criterion-level structured oral capture.

**QA evidence required:** one complete internal-only assessment with provider traffic blocked, draft/resume and stale-save test, report showing correctly attributed manual oral evidence, denied role/tenant tests. Depends on CA-101 and role/criteria snapshots.

## CA-103 — Link consented recorded calls to oral criteria

**As an assessor**, I want existing Nylas calendar and in-app Workspace call recordings/transcripts linked to the oral session, so that I can inspect the source for a finding without reimplementing calls.

**Priority:** pilot must-have when integration enabled; manual path is independently releasable. **PRD:** Oral assessment/consent (pp. 1–3). **Status:** call foundation exists; competency linkage remains.

**Acceptance criteria**

1. Given a calendar or native call is configured, when an authorised assessor schedules/starts it from oral assessment, then the session retains the correct participant/appraisal/tenant and provider reference, with visible scheduled/join/recording/processing states.
2. Given recording, transcription or AI processing requires notice/consent, when consent is absent or revoked before processing, then that processing cannot begin; manual notes remain available and no hidden fallback uses another person's AI account.
3. Given a valid provider completion callback, when handled repeatedly or out of order, then one source recording/transcript is linked without duplicates or reverting a newer state.
4. Given a transcript span supports a criterion, when linked, then the reference preserves source session, timestamp/span, original transcript version and speaker labels where supplied; edits to meeting notes do not mutate the source transcript.
5. Given capture/transcription fails, when the assessor opens the session, then the UI distinguishes unavailable media from empty notes and permits retry or manual capture; failure does not masquerade as assessed evidence.
6. Given a user lacks media rights or supplies another tenant's session/callback resource ID, when requesting playback, download or linking, then the server denies access; provider webhooks require their existing authentication/integrity checks.

**UX handoff:** shared call widgets, visible consent state, source-linked timestamp playback, failure/retry/manual fallback; no new competing call UI. **Architecture:** reuse `appraisalMeetings.js`, `appraisalNativeCalls.js`, `appraisalMeetingMediaService.js`, `appraisalNativeMediaService.js`; define evidence adapter and callback idempotency. **Dependencies:** CA-101/102/109/115. **QA:** provider-contract fixtures plus separately labelled authorised staging real-call proof for each enabled transport; synthetic audio is labelled synthetic, never a real employee interview.

## CA-104 — Review role-aware AI drafts with citations

**As an assessor**, I want optional AI observations against the selected role and criteria with verifiable sources, so that I can use assistance while retaining responsibility for every finding.

**Priority:** pilot must-have optional capability. **PRD:** AI-assisted analysis and rules (pp. 1–3); user role-analysis clarification. **Status:** advisory AI suggestions and shared gateway exist.

**Acceptance criteria**

1. Given AI is enabled, consented and connected for the requesting user, when analysis runs, then only currently authorised evidence and the frozen role/framework/strategy criteria enter the central app-scoped gateway; the request records actor, source versions and processing status without copying credentials into records.
2. Given a generated observation, when displayed, then it is explicitly **AI draft**, names the assessment criterion/role requirement and links to actual evidence page, text span or transcript time. Unresolvable references are visibly unverified and cannot count as source evidence.
3. Given a suggestion, when I accept, edit or dismiss it, then my decision, edited text, original draft, actor and timestamp persist. Acceptance may copy reviewed text into a draft finding but does not silently assign observed levels, scores or final classification.
4. Given uploaded content contains instructions to ignore policies or disclose another employee's records, when analysed, then it is treated as untrusted evidence; the gateway cannot perform resource actions or broaden its evidence set.
5. Given AI is disabled/unavailable, consent is missing, connection is absent, or sources were revoked during a queued job, when analysis is requested/completed, then it fails safely with an actionable state; all manual assessment functions remain usable and no other account is borrowed.
6. Given another tenant or a user without evidence rights requests analysis or guesses a suggestion ID, then both source extraction and suggestion retrieval are denied; partial AI text never leaks inaccessible evidence.

**UX:** side-by-side source/draft review, accept/edit/dismiss, source unavailable and retry states, loading/cancel affordance; optional, no forced chat. **Architecture:** existing central HMAC gateway and personal-account authorization; immutable source manifest, job cancellation/revalidation, structured citation validation and isolated prompt context. **Evidence:** `Appraisal.js` AI review/audit structures, `appraisals.js` AI suggestion routes; no proof of complete role-specific citation contract. **Dependencies:** CA-101/102/103/105/109/115. **QA:** deterministic gateway stub for text/citation/error/unauthorised cases; separate approved live personal-account test. No AI output becomes independent evidence.

## CA-105 — Assess expected versus observed levels and resume drafts

**As an assigned assessor**, I want each criterion's role expectation, source definitions and evidence beside my observed finding, so that I can assess consistently and return to unfinished work.

**Priority:** pilot must-have. **PRD:** Evaluation workspace and assessment rules (pp. 1–3). **Status:** generic reviewer form exists.

**Acceptance criteria**

1. Given a participant has a frozen role, when I open assessment, then each criterion shows source/version, expected level and definition, available evidence, observed level/rating, rationale and assessor identity. SFIA level 4 and internal level 4 are never presented as equivalent by matching their number.
2. Given I save some criteria, when I leave and resume, then persisted values, evidence references, draft state and last-saved time remain; unsaved/network failures are explicit and do not produce a false saved message.
3. Given insufficient evidence, when I choose that status and supply rationale, then the criterion has no invented zero/rating; the completion and scoring systems use the configured missing-evidence rule.
4. Given invalid source-level IDs, a role expectation from another version, or evidence not linked to this participant, when saving, then the server rejects specific fields and leaves existing valid draft intact.
5. Given two authorised assessors edit the same revision, when the second saves stale data, then optimistic concurrency prevents lost work and offers reload/reconcile.
6. Given a finalised record, when an ordinary editor attempts mutation, then it remains read-only unless the authorised reopen process creates an auditable revision. Another tenant or nonassigned staff user receives no draft content.

**UX:** criterion list with completion filters; desktop evidence/work panel, mobile stacked layout; keyboard navigation and labelled controls, save status, expected/observed explanatory copy. **Architecture:** typed `AssessmentItem` linked to immutable criterion and role snapshot, explicit draft/submitted/insufficient state, concurrency revision. **Evidence:** `Appraisal.js` managerReview and `frontend/app/appraisals/[appraisalId]/manager-review/page.tsx` are reusable but generic. **Dependencies:** setup role/framework stories, CA-101/102/109. **QA:** source-mixed fixture, reload/concurrency and insufficient evidence flows, keyboard/mobile screenshots.

## CA-106 — Configure reproducible scoring with explicit conversions

**As a cycle administrator**, I want documented weights, scales, conversions and aggregation rules, so that an assessor can explain and reproduce a score.

**Priority:** pilot must-have. **PRD:** Scoring configuration/rules (pp. 2–3). **Status:** weighted scoring/snapshots exist; source-aware rules incomplete.

**Acceptance criteria**

1. Given selected criteria/inputs, when configuration is saved, then every scored criterion has a valid finite scale, nonnegative weight, defined aggregation/normalisation rule and version. For a percentage weight group, values sum to 100; for relative weights, the UI explicitly states normalisation and requires a positive total. Empty, negative, NaN and zero-total groups are rejected.
2. Given distinct framework sources, when an aggregate needs a common measure, then the configured mapping/conversion identifies source version/level and target measure. No implicit arithmetic treats framework level numbers as interchangeable; unmapped values block the affected aggregate with a visible explanation.
3. Given configured normalised criterion scores 80 and 60 with relative weights 3 and 1, when aggregated under weighted mean, then the visible calculation is `(80×3 + 60×1) / 4 = 75`, using the specified precision/rounding rule. Boundary rounding is defined once and reused in reports/rankings.
4. Given required missing findings or insufficient evidence, when recalculated, then the score shows coverage and the configured missing-data treatment; no silent renormalisation removes a required weak/missing criterion and presents a complete score.
5. Given configuration v1 was launched, when an admin edits a library/rule to v2, then v1 results remain unchanged; any allowed draft migration is explicit, versioned and recalculates with a preview.
6. Given a client posts a precomputed total or a tenant B conversion ID, when saving/recalculating, then the server uses authorised frozen rules and rejects foreign references rather than trusting the supplied score.

**UX:** builder with scale/weight/conversion validation, live worked example, accessible score breakdown and coverage denominator. **Architecture:** deterministic pure scoring engine; no arbitrary eval/script formulas; explicit schema/version, decimal/rounding policy, frozen inputs + result explanation. **Evidence:** `AppraisalCycle.js:109` rating scales; `appraisalAIService.js` weighted score calculation omits missing components in current generic flow and must not be blindly reused. **Dependencies:** setup snapshots and CA-105/110. **QA:** table-driven golden values, conversion coverage, scale extremes, rounding, permutation order, missing data and cross-tenant tests; same result across UI/API/report.

## CA-107 — Confirm or override proposed suitability

**As an authorised finaliser**, I want the calculated proposal separate from my final suitability decision, so that the assessment records accountable human judgement.

**Priority:** pilot must-have. **PRD:** Thresholds/suitability and direct finalisation (pp. 1–3). **Status:** numeric final ratings/override reason exist; suitability model missing.

**Acceptance criteria**

1. Given versioned suitability bands, when configured, then labels, threshold boundaries and inclusive/exclusive semantics are explicit; overlaps, undefined scored ranges and invalid pass marks are rejected.
2. Given a score exactly on a boundary, when evaluated, then one configured proposed category is shown with its rule and score version; an incomplete calculation has no falsely definitive proposal.
3. Given all completion gates pass and I hold finalise permission, when I confirm the proposal, then my chosen category, actor, time, role/criterion/scoring versions and score snapshot persist directly without an approval queue.
4. Given I change the proposed category, when finalising without a meaningful reason, then the server blocks with a field-level error; with a reason it stores both proposal and final category plus the override reason. It never overwrites the proposed result with the override.
5. Given an AI job finishes or a malicious client sends final classification without finalise permission, then no final result is created. Repeated submissions are idempotent or safely conflict, not duplicate decisions.
6. Given a final assessment, when read, then it is an assessment outcome only: no employee dismissal, promotion, pay change or other employment action is triggered. Another tenant cannot read or finalise it.

**UX:** two clearly labelled proposal/final fields, preview of consequences, missing-item links, concise final confirmation and immutable completed view. **Architecture:** transaction/compare-and-set finalisation, versioned threshold evaluation, audit/event outbox; no automatic employment integration. **Evidence:** `appraisals.js:4258` already has numeric finalise and override audit foundations. **Dependencies:** CA-106/109/110/114. **QA:** exact boundaries, blank/changed reason, forged writes, repeat submit and concurrent finalize; verify no approval task/employment mutation.

## CA-108 — Rank only configured comparable results

**As an authorised report viewer**, I want optional role/department/organisation rankings using explicit comparable measures and ties, so that comparisons are intelligible and not misleading.

**Priority:** pilot must-have configurable feature. **PRD:** Ranking configuration (pp. 2–3). **Status:** generic Recruiter ranking is not this contract.

**Acceptance criteria**

1. Given ranking is disabled, when reports load/export, then no rank, hidden leaderboard request or implied ordering by score is exposed.
2. Given ranking enabled with role/department/organisation scope, direction and a documented tie policy, when final comparable results load, then only permitted records enter the permitted scope; drafts are excluded and counts disclose the inclusion rule.
3. Given two identical rounded display scores but distinct raw values, when ordering, then the configured precision/tie rule determines the result consistently; dense/competition ranking choices are labelled and stable secondary ordering does not secretly break a declared tie.
4. Given different role expectations, selected sources, scale/scoring versions or conversion mappings, when no explicit compatible-measure rule exists, then results are labelled **Not comparable** with reason and excluded from that rank. Shared numeric range alone is insufficient.
5. Given a manager can view only team A, when filtering organisation scope or changing query parameters, then the API denies broader scope or returns only authorised scope with an accurate label; out-of-scope names, counts, positions and exports are not leaked.

**UX:** ranking off/on, scope/measure/tie configuration; report inclusion/exclusion explanation and accessible ordered table. **Architecture:** compatibility fingerprint and permission-filter-before-aggregate pipeline; preserve ranking-config version; rank outcomes are derived from fixed report version. **Dependencies:** CA-106/107/109/113. **QA:** tie fixtures, incomparable source/version fixture, all three scopes, disabled mode and unauthorised query/export tests.

## CA-109 — Enforce separate action permissions and audit denial

**As an organisation owner**, I want distinct assessment actions, so that an assessor can edit without automatically acquiring finalise, reopen, report or export rights.

**Priority:** pilot must-have / security prerequisite. **PRD:** Permissions/finalisation/reports (pp. 1–3). **Status:** existing broad appraisal permissions require extension.

**Acceptance criteria**

1. Given IdP-managed organisation grants and current team/directory scope, when any action executes, then the backend checks resource organisation, action and allowed participant scope. Proposed logical actions are edit, finalise, reopen, report-view and export; SA maps these to the canonical IdP catalogue without inventing downstream identity roles.
2. Given a user can edit but not finalise, when accessing the UI, then finalise is unavailable with helpful explanation; posting directly is denied. Report view does not imply export, and finalise does not imply reopen or access to unrelated participants.
3. Given permission revoked or membership removed during a session/job, when a protected action/download/job publication occurs, then authority is reevaluated; stale claims/cache do not retain the grant indefinitely.
4. Given an unauthorised finalise/report/export attempt, when rejected, then a security audit event records actor (where authenticated), action, resource reference, org, time, correlation ID and denial category without storing evidence content, tokens or sensitive guessed-resource metadata.
5. Given tenant B IDs in nested evidence, criteria, role, result or export references, when tenant A requests them, then all are denied at the server before state change or storage-link issuance; UI success cannot override API denial.
6. Given owner/admin/HR/line-manager/employee roles, when seeded permission scenarios run, then access follows explicit grants and current organisation/hierarchy scope, not the person's display job title or a role-library name.

**UX:** permission matrix and clear read-only states, distinct “view report”/“export” buttons; no dead controls. **Architecture:** central IdP authority, shared assessment authorization helpers, policy tests, safe denial logging and export recheck. **Evidence:** `Identityprovider/src/config/accessControlCatalog.js:84–153`; `appraisalAccessService.js` and current directory integration. **Dependencies:** foundation identity and every protected story. **QA:** positive/negative matrix for all five actions, actor change, hierarchy removal and tenants; inspect no mutation/download/PII leak.

## CA-110 — Explain completion gaps and authorised exceptions

**As an assessor**, I want a checklist explaining missing findings/evidence/rationale and a controlled exception path, so that I know what prevents finalisation.

**Priority:** pilot must-have. **PRD:** Completion checks and assessment rules (p. 2). **Status:** generic required response checks exist.

**Acceptance criteria**

1. Given a selected required criterion, when findings, evidence or required rationale are absent, then finalisation lists the exact missing items with links and the API independently rejects bypass attempts.
2. Given a deliberate insufficient-evidence status with explanation, then it remains distinct from an untouched criterion; configuration defines whether it requires exception before finalisation and how it affects scoring/coverage.
3. Given an authorised exception grant, when I select specific missing items and enter a meaningful reason, then the exception records scope, actor, time, affected items and snapshot version. Ordinary editing/finalise rights alone do not imply exception rights.
4. Given no exception permission or a blank reason, when attempted by API/UI, then it is rejected and logged; an exception cannot waive identity/tenant access, required assessment role, invalid scoring configuration or finaliser permission.
5. Given evidence is revoked or draft findings change after checklist preview, when finalising, then the current server state is checked atomically; a stale green checklist cannot certify incomplete data.
6. Given an exception-backed final result, when viewed/exported, then it clearly shows incomplete coverage and the permitted exception reason, without converting absent evidence into a passing rating.

**UX:** actionable checklist grouped by criterion, “insufficient evidence” explanation, scoped exception dialog and final warnings; no generic toast as the sole error. **Architecture:** deterministic validator result codes shared by preview and finalise; version-bound exception objects; exception cannot bypass structural/security invariants. **Evidence:** `appraisalCustomResponseService.js` checks required custom responses; criterion-level gate is new. **Dependencies:** CA-101/105/106/109/114. **QA:** missing-item matrix, allowed/disallowed waiver, stale preview, report representation.

## CA-111 — Preserve complete manager/assessor feedback

**As an employee or authorised report viewer**, I want the full submitted manager assessment alongside role comparisons and oral findings, so that the report reflects the actual review rather than only the call or overall score.

**Priority:** pilot must-have and explicit user clarification. **Status:** partly implemented; specific payload gap verified.

**Acceptance criteria**

1. Given a submitted manager review, when assembled into the final result, then it retains overall strengths/improvements/development narrative, every competency rating/comment, every goal review rating/comment, required custom question answers and recommendations present in the submitted form.
2. Given reviewer identity differs from appraisal creator or line manager, when displayed, then **Assessed by** identifies the actual submitting reviewer, role/context and submission timestamp/timezone; creator and call participants are labelled separately.
3. Given feedback comments on a role requirement, when shown in report, then the role/version, expected/observed comparison and evidence references remain attached; discussion notes, manual oral answers and AI drafts remain distinct sections with source labels.
4. Given a manager draft or unaccepted AI suggestion exists, when the participant report is published, then it is not represented as submitted manager judgement. Restricted assessor notes obey explicit report visibility rules, not raw object spreading.
5. Given no legacy goal-review comments or unknown historical reviewer metadata exists, when viewing an older report, then show **Not recorded** where appropriate; do not infer missing comments, authors or dates from the current manager.
6. Given an unauthorised participant/tenant tries to retrieve draft/private feedback or manipulate report field filters, then the server denies it and never includes disallowed fields in JSON, CSV or PDF.

**UX:** “Manager / assessor feedback” with identity/date; individual goal comments visible beneath goal outcome, not collapsed into summary; explicit separation of employee, assessor, discussion and AI sources. **Architecture:** explicit report DTO/schema, stable goal/criterion IDs and visibility allow-list; snapshot submitted feedback at finalisation. **Code evidence:** `Appraisal.js:308` managerReview/submittedAt; `appraisalResultReport.js:16` emits managerSummary/competency comments, but `goals` emits title/score only; report page `:17,54` similarly omits manager goal comments. **Dependencies:** CA-105/109/112/114. **QA:** sentinel text in every review field and goal comment; compare submitted record/report/API/PDF, confirm drafts absent and identity differs from creator.

## CA-112 — Publish a complete participant report and matching PDF

**As an authorised viewer**, I want a readable, source-complete report and permitted PDF export of the same final record, so that I can inspect and share an accurate assessment.

**Priority:** pilot must-have. **PRD:** Reports/export, historical rules (pp. 2–3). **Status:** report/CSV/print foundation exists.

**Acceptance criteria**

1. Given a finalised record, when report opens, then it shows participant/assessment role/version, assessment dates, selected sources/versions, expected/observed findings, criterion evidence references, complete submitted feedback, scoring formula/coverage/breakdown, proposed and final classification, override/exception information, assessor/finaliser identity/times and enabled ranking context.
2. Given a permitted PDF export, when generated, then visible text/values/source references match the same versioned report payload, pagination clips no content, headings/table headers repeat appropriately and charts have readable labels plus accessible data tables. Sensitive media/storage URLs and raw internal/debug fields are absent.
3. Given a user has view but lacks export, when pressing a forged export URL or requesting alternate formats, then export is denied. Every evidence link still enforces its own access policy after a PDF has been generated.
4. Given draft data, when a report preview is allowed, then it is visibly **Draft / not finalised**, unavailable under final-export routes and excluded from final cohort results. Preview permission never implies finalisation.
5. Given libraries or role/scoring rules change later, when an old report/PDF is regenerated, then it uses the original finalised version and indicates its report version; legacy missing values are explicit.
6. Given the record contains no SFIA, no recording or no AI content by choice, when reported, then it accurately reflects the selected sources/path and does not display misleading failed mandatory sections.

**UX:** concise outcome summary followed by evidence-backed detail; source labels and accessible expected/observed charts; print preview, paper-safe colours and export progress/error. **Architecture:** one canonical permission-filtered immutable report DTO used for web/export; deterministic assets and escaped content; report version/hash and export audit. **Evidence:** `appraisalResultReport.js` and `frontend/app/appraisals/[appraisalId]/report/page.tsx` current simple CSV/window.print base. **Dependencies:** CA-106/107/109/111/114. **QA:** golden payload-to-PDF text/number parity plus rendered-page inspection at long comments/mixed frameworks; no screenshot-only score assertion.

## CA-113 — Report scoped cohort completion and gaps

**As an authorised HR administrator or scoped manager**, I want cohort completion, role/competency gaps and optional comparable rankings, so that I can act on permitted aggregate results without exposing other participants.

**Priority:** pilot must-have. **PRD:** Cohort reporting (p. 2). **Status:** generic performance analytics exist.

**Acceptance criteria**

1. Given a selected cycle/cohort, when opened, then counts distinguish not started, draft, evidence incomplete, ready, finalised and reopened states with an explicit denominator and selected source/version context.
2. Given finalised comparable findings, when gap charts/tables render, then they show expected-versus-observed gaps per role/source/criterion; missing evidence is separately counted and never mapped to a zero level or omitted without disclosure.
3. Given scope filters for role, team, department or organisation, when queried, then allowed filters come from current directory/permissions and the backend applies scope before aggregation, totals, ranking and export. Hidden names cannot be inferred through unauthorised filters or global totals.
4. Given ranking is disabled or records incompatible, when loading cohort report, then disabled ranks are absent and incompatible records have explained exclusions without fabricated relative position.
5. Given no accessible records, loading error, partial provider availability or a small cohort, when displayed, then explicit empty/error states replace misleading zero-performance charts; any privacy suppression rule is documented and applied consistently to tables/exports.
6. Given permission revoked or tenant B cycle ID supplied, when report/export is requested, then no aggregate or names leak and denial is logged under CA-109.

**UX:** filter bar with current scope, completion funnel/status chart and accessible tables; drill-down limited to permitted participants; no unlabelled global totals. **Architecture:** server aggregation on frozen result versions, directory scopes, pagination, async export recheck, matching aggregate definitions. **Evidence:** `appraisals.js` generic analytics endpoints need competency/source-aware contracts. **Dependencies:** CA-108/109/112/114. **QA:** ten-person cohort totals reconcile to participant records, scoped subset fixture, cross-tenant filter/count leakage and no-results tests.

## CA-114 — Preserve audit versions and controlled reopening

**As an authorised auditor or finaliser**, I want an immutable explanation of what was assessed and who changed it, so that later library changes or reopened reviews do not rewrite history.

**Priority:** pilot must-have. **PRD:** Audit/historical records (pp. 2–3). **Status:** audit and frozen cycle foundations exist.

**Acceptance criteria**

1. Given a launched/finalised assessment, when inspected, then it retains the exact role/framework/source/criterion definitions, scoring/conversions/threshold/ranking configuration versions and evidence references used, together with creator, assessor, finaliser and timestamps.
2. Given configuration or role version changes, when another assessment is launched, then only the newly selected version applies; old findings, proposal, final classification and report remain stable.
3. Given a user with reopen permission supplies a reason, when reopening a finalised assessment, then a new working revision is created or derived while the previous final result/report stays retained and identifiable. The UI distinguishes superseded from current, and refinalisation creates a new result version.
4. Given no reopen permission, a missing reason or a stale revision, when reopening/editing a final result, then the server denies/conflicts without altering history. A broad update endpoint cannot bypass this.
5. Given findings, weights, permissions, evidence access, AI decisions, exceptions or finalisation change, then actor, action, time, resource/version references and safe before/after change metadata are auditable; tokens, full CVs and private transcript text are excluded from logs.
6. Given tenant B attempts audit/report version reads, then scope checks deny them. Retention deletion preserves permissible tombstones and calculation snapshots without resurrecting deleted source media.

**UX:** activity timeline, version badge and “view previous final version”; reopen explanation/reason and explicit preserved-history notice. **Architecture:** append-only audit events and immutable final result versions, optimistic concurrency, result publication transaction/outbox; distinguish lifecycle cancellation/removal work occurring concurrently from assessment reopening. **Evidence:** `Appraisal.js` cycleConfigurationSnapshot/auditLog, current existing audit helpers. **Dependencies:** shared snapshot architecture, CA-109/112/115. **QA:** v1/v2 regression, reopen-refinalise history, API overwrite denial, permission event and no-secret audit check.

## CA-115 — Apply recording, transcript and AI retention controls

**As an organisation administrator and participant**, I want explicit processing consent and retention/deletion rules, so that recordings/transcripts and derived content are handled as configured.

**Priority:** pilot must-have for enabled processing. **PRD:** consent/retention rules (p. 2); data model (p. 3). **Status:** call controls exist; end-to-end retention acceptance remains unverified.

**Acceptance criteria**

1. Given configured retention periods by evidence/media type, when an oral session is created, then notices show enabled recording/transcription/AI processing and applicable retention; consent records purpose/version/time/actor, without assuming one consent authorises every processing purpose.
2. Given consent absent or revoked before a new processing action, when recording/transcription/AI extraction is requested, then it is stopped according to policy; manual assessment remains available and source restrictions propagate to queued jobs.
3. Given retention expiry or an authorised deletion request, when cleanup runs, then source media, transcript copies, derived indexes/caches and permitted provider copies are removed or tracked pending with retries. The record shows deletion status; stale URLs and resumed AI jobs cannot retrieve deleted data.
4. Given historical final reports cite expired evidence, when viewed, then they retain permitted finding/calculation/audit snapshots and indicate **Source no longer retained**; they do not silently recreate or claim the file is available.
5. Given legal/organisation hold is configured, when cleanup evaluates the item, then the explicit hold policy applies with an auditable reason and restricted access; the UI does not promise deletion while a provider deletion is pending.
6. Given an unauthorised user or tenant B requests consent/retention changes or media deletion, then it is denied without broadening source access. Logs omit keys, full consent documents and transcript content.

**UX:** clear per-purpose notices, status indicators, retention settings validation, deletion pending/complete/failure states; no vague “consent accepted” for all processing. **Architecture:** policy/version refs, scheduled idempotent cleanup, encrypted storage/provider deletion adapter and revocation/job invalidation; SA documents exact backup/provider limitations rather than claiming instantaneous universal erasure. **Dependencies:** CA-101/103/104/109/114. **QA:** accelerated test clock, revocation race, source/cached URL denial, retry/idempotency and provider deletion contract; real provider proof separately logged.

## CA-116 — Prove the pilot and exact release end to end

**As the delivery owner**, I want a traceable acceptance pack for the entire configured workflow, so that “implemented” means verified behavior on the intended revision, not a list of merged files.

**Priority:** release gate. **PRD:** pilot-ready criteria and QA scenarios (pp. 1–3). **Status:** new scope not yet proven; previous call/general appraisal tests are reusable but not sufficient.

**Acceptance criteria**

1. Given an isolated staging organisation, when approximately ten synthetic pilot participants are mapped to roles/assessors, then each can complete the configured workflow and authorised users can inspect the correct result. Pilot organisation naming/configuration is data, not hard-coded behaviour.
2. Given the source matrix, when tests run, then all seven nonempty combinations complete evidence → assessment → scoring → human finalisation → report/PDF. The internal-only manual/no-AI/no-call case is an explicit independent test; empty selection is rejected.
3. Given scoring/ranking fixtures, when executed, then golden totals, threshold boundaries, ties, incompatible measures, version retention and reopen outcomes match documented expectations.
4. Given the action/tenant matrix, when tested, then edit/finalise/reopen/report/export and exception actions have both allow/deny cases, direct API attempts, safe denial audit, revoked membership and second-tenant coverage.
5. Given the integrated call/AI stories, when enabled, then deterministic contract tests run first and separately authorised staging live-provider tests prove capture/transcript and cited draft review. Mock success is never labelled real-provider success; unavailable providers block certification of that path, not the manual path.
6. Given development complete, when release is proposed, then QA reports source revision, test commands/results, screenshots/PDF page renders, known limitations and story-to-evidence traceability. Critical security/data/score defects block release; flaky retry is disclosed and investigated.
7. Given the exact tested main commit is deployed, when production acceptance runs, then running image/revision, OIDC start, health and authenticated non-destructive UI smoke are verified. No real employee classification, invitation, call or provider charge is created merely to claim a green production test.

**UX handoff:** required screenshot states by story and one readable before/after/example per major surface, synthetic data labels. **Architecture/QA handoff:** risk-based test pyramid, isolated environments, migration/backfill rollback proof, source/merge/CI/deploy/live/provider evidence separately tracked; root SA/QA owns release, not developer self-approval. **Dependencies:** all stories and setup contracts. **Deliverable:** concise numbered implementation PDF after real implementation, each item linked to story/commit/test and screenshot, with planned/not-tested items explicitly marked.

## Definition of ready and definition of done

**Ready for development:** PM acceptance criteria approved; SA packet specifies model/API/version/permission/migration/test contracts; UX includes current screenshot references and proposed states; dependencies expose agreed contracts; no unresolved ambiguity changes an employment outcome or source access rule.

**Done:** code reviewed by counterpart developer, QA evidence satisfies each clause, no regression in existing appraisal/call/IdP paths, source versions preserved, required accessibility/denial/PDF checks passed, reviewed exact-path commit includes no concurrent unrelated work. “Live” requires exact tested main deployment plus current production smoke; external provider completion is a separate proof layer.

## Source evidence map

| Inspected source | Existing foundation / gap |
|---|---|
| `performance/backend/models/Appraisal.js` | Generic reviewer submissions, frozen cycle configuration, AI suggestion and audit structures. Current unrelated lifecycle edits are excluded from this story scope. |
| `performance/backend/models/AppraisalCycle.js` | Generic scales/competencies/weights; no full source-versioned framework/role scoring contract. |
| `performance/backend/models/AppraisalDocument.js` | Tenant, upload provenance, document categories/visibility; needs criterion/source/version linkage. |
| `performance/backend/services/appraisalAIService.js` | Generic weighted scores with omitted-component rebalancing; required missing-evidence policy must be explicit for this domain. |
| `performance/backend/services/appraisalCustomResponseService.js` | Generic required questions/document checks; not full criterion completion and exception rules. |
| `performance/backend/services/appraisalResultReport.js` | Submitted manager summary/competency comments/custom answers; goal report currently title/score only. |
| `performance/frontend/app/appraisals/[appraisalId]/report/page.tsx` | General report/CSV/browser print; not full competency report or proven PDF parity. |
| `performance/backend/routes/appraisalMeetings.js`, `appraisalNativeCalls.js` and media services | Reuse calendar/native calls, media and consent mechanisms; connect via evidence adapter. |
| `Identityprovider/src/config/accessControlCatalog.js` and `performance/backend/services/appraisalAccessService.js` | Existing central permission/scope foundations; split assessment actions and explicit deny audit required. |

The earlier `.local-runtime/prd-audit/competency-prd-gap-analysis.md` was used as an audit map, then checked against current source. It records an older baseline and is not current test/deployment proof.

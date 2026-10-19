# Architecture and design readiness review

Reviewer: retained Solution Architect A, 18 October 2026. Baseline `b401f1b1583be5875cc02462122c83ec9e7311d2`. Applied `seemplify-competency-architecture` and `seemplify-competency-qa`. Scope is independent review of UX handoff against the shared contracts; this reviewer authored architecture01, so architecture critical decisions additionally require retained PM/coordinating SA review. **No application code, test run, commit, push, deployment or feature acceptance is claimed.**

## Decision

The proposed configuration/setup UX fits the existing Performance product, preserves identity boundaries and has enough interaction detail for bounded implementation. **Approve P1/P2 manual/library/config foundation for implementation after verified coordinating-SA fixes described in the disposition below. Scanner-dependent paths may be implemented to fail closed but cannot be accepted as enabled uploads without an actual configured scanner. P3–P5 frontend remains pending the completed Designer B handoff.** Missing prerequisites are package gates, not a reason to silently shrink the agreed scope.

Inputs: PM stories CA-001–009/CA-101–116; current architecture01/02 and development contract including PM-R2 numeric scales, PM-R3 atomic finalise/publication and PM-R4 manager-feedback freeze clarifications; full `design/01-roles-and-setup.md`; current IdP grant source and Performance CSS/MUI sources; retained PM review. Designer B's completed assessment/report specification was not on disk at this review checkpoint; do not treat its concept image as approved interactions.

## Verified coherence

| Concern | Design / contract alignment | Implementation gate |
|---|---|---|
| Occupational role vs permission role | UX explicitly explains expectations do not change access; IdP remains authority | A role named Administrator must grant no privilege |
| Existing appraisal journey | Current Start appraisal/People step gains required role/version and explicit reviewer; detail/report read same frozen role; dedicated library does not replace the flow | Coordinator owns bridge and existing shared paths, including retry-safe launch receipt |
| Seven sources | Independent selectors preserve all7 sets; internal/strategy-only have no SFIA dependency | Full journey tests, not just toggle save |
| Source-specific levels | Native source/version badges and descriptors; explicit scale/conversion editor | Cross-source same-number levels never inferred equal; strategy numeric golden fixture from PM review |
| Snapshot and history | Published versions read-only; new version/archive preserve prior appraisals | Pinned version in launch confirmation, CAS on drafts and stable final JSON/PDF |
| Action/scoped directory | Current directory and allowed actions power UI; owner/HR vs managed-team vs self scope explicit | Current claims AND scope on every API/job/download, no client-only filter |
| Manager feedback | Same appraisal reviewer form retained; finalization captures submitted feedback/hash, goal comments and overall rating | Enabled-but-unsubmitted blocks, disabled step labelled, source amendment forces new result revision |
| Human finalisation | Finalise atomically publishes permission-restricted result; no second publish button/approval | Single durable CAS/outbox, failed write cannot show success |
| Draft recovery | Inline issue links, preserved edits, stale409 compare/reload, retry-safe partial receipts | Actual draft PATCH/source-preview routes must exist |
| Manual path | Manual role/oral/evaluation remains complete without AI/calls | No background provider call from disabled settings |
| Themes | UXA uses existing `--suite-*` light/dark tokens, neutral primary actions; MUI control override acknowledged | Actual controls must use tokens, not legacy teal MUI main defaults; contrast and screenshots both themes |
| Accessibility | Keyboard actions, semantic source controls, dialog focus, mobile stacked rows and200% zoom stated | Browser QA at390/1440 plus320 edge, keyboard/zoom, text alternatives for charts |

The CSS token values in UXA match the inspected `app/globals.css`. Current `app/theme.ts` still has teal/orange MUI defaults, so simply placing a new MUI form inside the existing shell will not produce the agreed design. Use scoped theme/component overrides for new surfaces; avoid a broad application theme rewrite.

## Concrete package blockers / resolutions required

| ID | Finding | Exact resolution before affected implementation | Owner / affected package |
|---|---|---|---|
| SA-R1 | New role/framework draft versions need editing, but freeze supplies POST versions and metadata-only PATCH aggregate, with no exact version-content PATCH | Add `PATCH /roles/:id/versions/:versionId` and `PATCH /frameworks/:id/versions/:versionId`, If-Match, tenant+parent+draft-state check; return updated version revision. Published version PATCH409. Document equivalent strategy draft-edit route or replace draft atomically through declared version operation. | Coordinator SA; P1 editors |
| SA-R2 | UX promises original import/source preview, but API only returns import state/extracted draft | Freeze `GET /imports/:id/source` (and role-source resolution via authorized import reference) or remove unavailable original-preview promise. Route must reauthorize import/current source visibility and clean scan state, return safe attachment stream or sanitized viewer with `nosniff`, never a public/local storage path. Source unavailable still allows human manual fields. | Coordinator SA / Pair A; P1 upload preview |
| SA-R3 | No malware/quarantine service found in inspected Performance/Recruiter JS; UX phrase “existing upload policy controls quarantine” is unsupported by source | Specify scanner adapter/configuration, clean/infected/unavailable result and fail-closed state. Extension/MIME/signature checks are not a malware scan. File cannot be parsed, sent to AI or previewed before clean. Scanner absent gives explicit unavailable/manual route; uploads cannot be accepted as fully implemented until configured scanner/EICAR-style integration proof. No scanner key/socket details in screenshots or logs. | Coordinator SA; upload/evidence packages CA-001/101 |
| SA-R4 | Completed Designer B interactive specification missing at checkpoint | Deliver full evidence/oral/AI/assessment/checklist/final-outcome/report/cohort/history states, both themes, source restrictions and CA-101–116 mapping; retained PM/SA review before frontend development | Designer B; P3–P5 frontend |
| SA-R5 | Shared contract types/validators and scoped authorization service are coordinator-owned but not yet implemented | Freeze concrete validators/exports and test fixtures before both pairs consume them. Each pair acknowledges no competing variants; endpoint routing order preserves `/cycles/:id/report`. | Coordinator; both lanes |

SA-R1–R3 are newly identified implementation-readiness findings, not user permission requests. The coordinating SA may resolve them in the frozen contract and append explicit disposition; this reviewer is not altering frozen architecture in this pass.

## Security release gates that must survive implementation

1. **Default staff grant expansion:** inspected IdP `accessControlCatalog.js` uses `allExcept` for memberGrants. Registering a new action without matching exclusion automatically exposes it. Add all privileged competency actions to `MEMBER_RESTRICTED_PERMISSION_EXCLUSIONS` in the same change; test staff/recruiter/interviewer denial, explicit scoped manager grants and custom edit/no-finalise + view/no-export. An HR label is not an alternative enforcement layer.
2. **Scope is server data:** bootstrap may expose only authorized people/library metadata. Reject foreign IDs and same-tenant wrong participant evidence. Recheck membership and source visibility after job queueing, at finalization and at export/download. Avoid aggregate counts/tooltips/filter options leaking hidden people.
3. **Personal AI:** requester stable OIDC subject through HMAC proxy, new allowed activity and consent; no tenant-owner fallback. Uploaded instructions are data; fabricated/stale citations do not become evidence, ratings or final classifications.
4. **Immutable publication:** snapshot selected role/source/criteria/scoring, submitted actual manager feedback and source hash. No later live joins silently change a final result. UI/PDF derive the same filtered immutable payload; old report stable after reopen.
5. **Exception and score safety:** structural/auth invariants cannot be waived. Missing evidence remains visible; default exception leaves no comparable numeric total. Exact decimal rounding, explicit native conversion, tie precision and strict compatibility key apply consistently.
6. **Existing work:** current Appraisal lifecycle files remain dirty from another workstream. Coordinator must reconcile owned hooks without overwriting or staging unrelated changes. No independent competency lifecycle may bypass mandatory existing appraisal stages.

## Package readiness at this checkpoint

| Package | Decision | Evidence still needed before developer start / acceptance |
|---|---|---|
| P1A manual role/version library | Conditional ready | SA-R1 exact draft-version mutation + shared validators; then create/version/archive tests |
| P1B internal/source framework and strategy configuration | Conditional ready | SA-R1 strategy edit semantics + rating-scale fixture, lawful supplied source provenance |
| P1 uploads and source preview | Not ready for enabled processing | SA-R2/SA-R3 scanner and source-stream contract; manual role creation may proceed independently |
| P2 cycle sources/role mappings | Conditional ready | Shared DTOs, scale methods/weights validation, source-set fixtures; all7 end-to-end acceptance later |
| P2 current-appraisal people/role bridge | Conditional ready | Coordinator-owned existing route/component hook, current identity action/scope and partial retry/reconciliation contract tests |
| P3–P5 evaluation/report frontend | Pending review | SA-R4 completed design plus independent PM/SA acceptance; existing stories/contracts already specify required behavior |
| P3–P5 pure backend scoring/immutable result foundation | Conditional ready | Shared golden fixtures and validators; no provider or report completeness claim from this alone |
| Calls/AI/retention | Integration prerequisites | Configured purposes/notices, personal gateway allowlist and actual returned provider artifacts; manual path cannot be blocked |
| P6 pilot/release | Not ready | All story clauses traced to passing persistence/browser/PDF tests and exact deployed revision; no actual client classification as a fixture |

Design acceptance is not development acceptance. Before “done,” attach each PM clause to test name/command/result, source revision and appropriate screenshot/report artifact. Record concepts/local/live/provider evidence separately. This review deliberately does not certify missing implementation or claim execution of the proposed QA matrix.

## Coordinating-SA resolution verified in the current freeze

Re-read the updated `DEVELOPMENT-CONTRACT.md` and architecture01 endpoint table after the coordinator's response:

- **SA-R1 resolved for role/framework:** exact draft-version PATCH routes now include If-Match and draft-only content; aggregate PATCH remains metadata-only. P1 manual role/framework editors may proceed. Strategy draft save semantics remain a small explicit gate before that editor: declare new immutable full-content version per POST save, or add equivalent draft-version PATCH; both lanes must use the same policy.
- **SA-R2 resolved:** `GET /imports/:id/source` reauthorizes clean original bytes as attachment/nosniff; bounded escaped extracted text/spans are the in-app preview. This is safer and implementable without an active-document iframe. UX source panel should use that text contract and offer permitted original download.
- **SA-R3 resolved at architecture level:** Pair A owns `fileSafetyService.inspectAndScan`; configurable private ClamAV INSTREAM, bounded stream/socket lifetime, explicit `SCAN_UNAVAILABLE`503 and `UNSAFE_FILE`422, no parser/AI/preview before clean. No existing antivirus is assumed. Actual scanner configuration/acceptance is still unexecuted and must not be labelled done from mocked adapter tests.
- **SA-R5 remains an execution prerequisite, not architecture ambiguity:** coordinator owns shared DTO validators/auth/operations; initialize these before dependent lane code and require contract tests. IdP defaults/exclusion tests are mandatory.
- **SA-R4 unchanged at checkpoint:** no completed Designer B spec on disk; P3–P5 frontend approval deferred until its review. Backend pure deterministic scoring/result foundation can proceed against the frozen shape and PM golden fixtures.

Final checkpoint decision: **manual/common P1/P2 foundations approved to build; no implementation, release or provider certification.** The root coordinator owns integration and documents these scoped prerequisites in developer assignments.

## Final UX-B review — P3–P5 implementation gate

Designer B's `design/02-assessor-and-reports.md` is now available and was read in full. Visually inspected `design/concepts/assessor-workspace-light-concept.png`. **SA-R4 resolved: P3–P5 frontend design is approved for implementation against the frozen API and PM acceptance clauses.** This supersedes the earlier missing-design checkpoint, not any unexecuted QA/provider gate.

The handoff provides source-grouped criteria, native expected/observed controls, insufficient-evidence distinction, draft save/CAS reconciliation, private evidence linkage, manual structured oral capture, reuse of calendar/native controls, personal optional cited AI, completion/exception gates, deterministic score breakdown, human final classification with atomic restricted publication, complete submitted manager feedback, PDF parity, scoped cohort/ranking/history and consent/retention states. It also defines mobile/drawer behavior, keyboard/focus/error/empty states, both theme tokens and per-story tests.

| Reviewed design concern | SA decision / implementation constraint |
|---|---|
| Generated concept | Layout hierarchy is useful and labelled fictional/not implemented. Spec explicitly corrects generated strategy `Level4`, illustration counter and any implied source equivalence. Do not copy these artifacts as hardcoded behavior. |
| AI Accept as draft finding | Approved only as explicit narrative append/replace with retained provenance. It must not choose observed level/rating, mark criterion assessed/complete, submit or finalise. Source citation review and subsequent human save remain independent. |
| Native comparison charts | Source-specific labelled paired markers/bars and accessible tables are appropriate; numeric strategy units explicit. Never use a radar chart to imply shared native scales. |
| Manual/oral source attribution | Manual typed participant answers are labelled recorded-by assessor; original transcript and corrected notes remain distinct. Provider call end is not transcript readiness. |
| Manager report completeness | Every submitted overall/competency/goal/custom field and actual recorded reviewer/time included; private drafts excluded server-side. The PM-R4 source-content hash, enabled-but-unsubmitted checklist link, disabled-step label and amendment/reopen notices remain normative even where UXB describes them more generally. |
| Atomic finalise | No automatic category selection/assent, meaningful override reason, rerun readiness and durable result before receipt. No second Publish/approval screen. |
| Scope and ranking | Server-scoped filters before totals, disabled ranking absent, incomparable results explained, no hidden global rank or denominator. Current-directory revocation applies on refresh/next action. |
| Final report/PDF | One filtered immutable DTO; light paper palette, readable tables/headers/pagination and long goal comments. Separate view/export authorization and fresh download access check. |
| Light/dark continuity | UXA/B tokens agree with current suite CSS and neutral primary actions. Current legacy MUI colors require scoped override; actual dark/light screenshots and contrast tests still required. No global shell redesign approved. |

Root additionally approved strategy draft-version PATCH/publish and cycle publish endpoints to close the remaining setup save/publish semantics. Their exact frozen route registration must be present before those implementation paths start; no parallel endpoint variants. This does not block the P3–P5 assessment/evaluation/report lane.

**Final design-readiness disposition:** P1/P2 and P3–P5 implementation may proceed in the reserved areas using shared validators/current IdP action scopes and root-owned existing appraisal hooks. Scanner/call/AI/retention operational prerequisites remain explicit; passing mock tests cannot certify them. All implementation, browser/PDF, pilot, CI/deployment and live acceptance gates remain unexecuted. No new code or production state was changed by this review.

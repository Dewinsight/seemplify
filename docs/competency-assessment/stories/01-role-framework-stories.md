# Role, framework and setup stories

Owner: Product Manager A. Baseline inspected: `b401f1b1583be5875cc02462122c83ec9e7311d2`, 18 October 2026. Status: **product handoff for architecture/design; implementation not claimed**. Current lifecycle edits in the shared checkout are unrelated and must be preserved.

## Scope and traceability

Source requirements: original `C:/Users/User/Downloads/Seemplify Competency Assessment PRD.pdf`, pages 1–3: tenant/people/role setup, input selection, frameworks, strategy, role mapping, evaluation and AI rules. User clarification adds manual/uploaded reusable roles and explicit role-based human/AI assessment. Method: [product practice research](../research/product-practice.md).

All proposed entries below belong to **Performance**, not CRM or Recruiter's hiring job builder. Existing Identity remains authoritative for accounts, organisations, members and team hierarchy. Here, **assessment role** means occupational expectations (for example, Head of Technology), never an access role such as HR manager.

| ID | User outcome | Order / dependency | PRD / user source |
|---|---|---|---|
| CA-001 | Create or upload a reusable assessment role | First; IdP auth and secure upload reuse | p1 role definitions/evidence; user's role-upload clarification |
| CA-002 | Revise/archive roles without rewriting assessments | CA-001 | p2 historical records; user's preserved role-version requirement |
| CA-003 | Maintain source-specific framework versions and levels | Parallel with CA-001 | p1 framework library; p2 no assumed equivalence |
| CA-004 | Select any of seven non-empty source combinations | CA-003; strategy contracts CA-005 | p1 input selection; p3 QA |
| CA-005 | Create/link strategy assessment criteria | Parallel with CA-003; existing OKR access | p1 strategy criteria |
| CA-006 | Map role expectations to source-specific criteria | CA-001/003/005 | p1 role mapping; p2 assessment rules |
| CA-007 | Assign existing organisation participants, roles and assessors | CA-002/004/006 | p1 tenant/roles; p2 participant role rule |
| CA-008 | Compare expected versus observed role requirements | CA-007; PM B evidence/scoring stories | p2 workspace; user's role-comparison clarification |
| CA-009 | Generate optional source-referenced AI role comparisons | CA-008; consent/evidence/AI review contracts | p1 AI; user's AI role-comparison clarification |

Readiness: CA-001 and CA-002 are first architect queue items. Other stories are ready for architecture refinement and may proceed as their dependencies stabilize. None is developer-ready until architecture, UX and QA contracts are jointly reviewed.

## Shared acceptance and security contract

- **TENANT:** The server resolves organisation, actor and permissions from verified IdP/session context. Forged organisation IDs, parent IDs, role version IDs and source IDs cannot expose or mutate another tenant; deny without revealing private contents. Inactive memberships are rechecked.
- **PERMISSION:** Assessment-role edit does not change access roles. Owner/admin/HR abilities and manager hierarchy use current scoped permissions; direct URL/API access must match UI visibility. Participant access never grants access to another participant's appraisal.
- **VERSION:** Records reference immutable role/framework/configuration versions; launch captures the version actually shown in confirmation. Editing source records cannot silently change launched or finalised assessments. Stale-save conflicts preserve user input and require refresh/review.
- **ACCESSIBILITY:** Every action is keyboard usable and visibly focused; field labels and errors are programmatically associated; status is text as well as colour. Empty/loading/error/permission-denied states expose a useful next action.
- **AUDIT:** Record actor, tenant, time, action and previous/new version references for creation, changes, archival and launch; avoid full confidential document bodies in general logs.
- **NO INVENTION:** Legacy appraisals without role/source versions show “Not recorded”; do not infer historical versions from today's library or job-title text.

## CA-001 — Create or upload a reusable assessment role

**Story.** As an authorised HR administrator, I want to create a role manually or upload a role description and confirm its extracted contents, so employees can be assessed against a consistent reusable expectation profile.

**Evidence / gap.** `performance/backend/models/Appraisal.js:114–133` stores employee/manager `jobTitle` strings. `performance/backend/models/AppraisalDocument.js:1–84` has appraisal-bound uploads and extraction, not a reusable role library. Reuse storage/extraction services after architecture review; do not create Recruiter Job/Candidate records as a side effect.

**Acceptance criteria.**

- **001-A:** Given authorised organisation scope, when I enter a role name, summary and responsibilities and save, then a tenant-owned draft role is created and can be reopened. Blank required name is rejected at its field; whitespace-only values do not pass.
- **001-B:** Given a supported role document, when upload/extraction completes, then I see the original filename plus a draft preview of extracted name, responsibilities and requirements, with source page/section references where available. Nothing is published or assigned until I explicitly confirm the reviewed contents.
- **001-C:** Given AI is off/unavailable or the document is unparseable, when extraction cannot populate the form, then I can continue manually, preserve permitted attachment metadata and retry; no invented levels or requirements are silently saved.
- **001-D:** Given an unsupported, oversize, deceptive MIME/extension, malicious or cross-tenant storage reference, when upload is attempted, then it is rejected under the secure-upload policy and no executable/public evidence object is exposed. Exact allowed type/size are architect decisions documented before implementation.
- **001-E:** Given an uploaded document contains prompt instructions, when analysed, then content is treated as data; it cannot grant access, run instructions, fetch private external URLs or auto-publish a role.
- **001-F:** Given a matching role name already exists, when I save, then I receive an existing-role warning and can intentionally create a distinct profile or open the existing one; a network retry cannot create duplicate copies of the same request.

**UX.** Proposed entry: Admin → Role library → New role. Present “Create manually” and “Upload role description” at the same level. Success opens role profile with Draft badge and next action “Define expectations”; error retains edits and attachment progress. Explain that a role profile does not change employee permissions. Do not use recruitment “job vacancy” language.

**Test contract.** API tenant/action authorization, upload validation and idempotent create; browser manual create and upload-preview-edit-confirm; extraction failure/manual completion; staff/cross-tenant denial; source text prompt-injection fixture. Demonstration may use a synthetic role document, never real confidential CV content in screenshots.

**SA handoff.** Define Role/Profile identity, versions, draft/publish boundary, ownership, secure source attachment reuse, async extraction/retry states and conflict/error payloads. AI extraction must be optional and use central shared gateway only.

## CA-002 — Revise/archive roles without rewriting assessments

**Story.** As an HR administrator, I want to revise or retire a role while preserving its earlier definitions, so new appraisals use current expectations and old results remain explainable.

**Evidence / gap.** `performance/backend/models/Appraisal.js:34–82` already freezes goal and cycle configuration snapshots. Extend the same historical guarantee to occupational roles rather than reading live profile fields during reporting.

**Acceptance criteria.**

- **002-A:** Given a published role version, when I edit its description or expectations, then changes create a new draft/version without mutating an earlier published definition; actor, timestamp and changed fields are visible in history.
- **002-B:** Given one appraisal launched against v1 and a later role v2, when I reopen the appraisal or export it, then it still shows v1 and its original requirements. New launch confirmation shows the exact chosen version.
- **002-C:** Given an archived role, when starting a new assessment, then it is absent from normal selection or clearly unavailable, while previous assessments and audit references remain readable to permitted users.
- **002-D:** Given another editor saved a newer draft version, when my stale editor submits, then the server rejects the stale write with a recoverable conflict rather than overwriting it; my unsaved text remains available for reconciliation.
- **002-E:** Given a legacy appraisal with only a job-title string, when displayed, then its role comparison is marked unavailable/not recorded, not retrospectively mapped to a new same-named role.

**UX.** Role profile → Edit / Versions / Archive. Compare changed requirements, clearly distinguish draft/latest/pinned versions, and state existing assessments are preserved. Archive confirmation lists future selection impact, not a destructive historical-delete claim.

**Test contract.** Create v1 → launch synthetic appraisal → create v2 → assert v1 detail/report/PDF unchanged; stale ETag/version conflict; archive/select denial and historical read; cross-tenant version guessing.

**SA handoff.** Immutable published version schema, optimistic concurrency, archived selection policy, snapshot/fingerprint and backward compatible serializers; explicit decision on whether active assessments can ever be reconfigured, never silently.

## CA-003 — Maintain source-specific framework versions and levels

**Story.** As an assessment administrator, I want to maintain competency definitions and proficiency levels for each framework/version, so an internal framework works independently and mixed assessments retain each source's meaning.

**Evidence / gap.** `performance/backend/models/AppraisalCycle.js:109–139` provides a generic rating scale and competency list; it has no framework-version/level relationship. Reuse generic design controls where suitable, but add a typed source-aware domain contract.

**Acceptance criteria.**

- **003-A:** Given an internal framework, when I define its name, version, competencies and ordered levels with descriptions, then it can be published and used without any SFIA entry.
- **003-B:** Given selected SFIA and internal versions, when similarly named skills or numeric levels coexist, then identifiers, labels and sources remain distinct. Displaying internal level3 beside SFIA level3 never implies equivalence.
- **003-C:** Given a published version already used in an assessment, when a competency/level changes, then a new version is required; old findings and exports retain the prior descriptors.
- **003-D:** Given duplicate level keys, missing descriptions/invalid references, or a criterion referencing a level from another framework/version, when saved, then actionable validation prevents publication.
- **003-E:** Given SFIA content is not configured or rights have not been established, then the app does not invent/copy a built-in full SFIA library. Architecture records lawful configuration/import provenance; internal-only remains usable.

**UX.** Admin → Competency frameworks → framework/version editor. Show source badges, version status and level ladder with textual descriptions. Empty state offers “Create internal framework”; source availability never traps the user.

**Test contract.** Internal-only lifecycle; equal labels across sources retain separate IDs; invalid/cross-tenant FK rejection; snapshot after level changes; deletion/archive blocked or version-preserved for used records.

**SA handoff.** Framework/version/criterion/level identities, import provenance/rights metadata, uniqueness and immutable use constraints. Do not embed proprietary third-party catalogues without established rights.

## CA-004 — Select any of the seven non-empty assessment input combinations

**Story.** As a cycle administrator, I want to choose SFIA, internal competencies, strategy, or any combination, so the assessment reflects our organisation's actual evaluation approach.

**Evidence / gap.** `performance/backend/models/AppraisalCycle.js:146–170` has workflow definition and flags; there is no typed `selected_input_types` contract. The seven-combination requirement is explicit on PRD p1 and QA p3.

**Acceptance criteria.**

- **004-A:** Given available configuration, when I choose one of `{SFIA}`, `{internal}`, `{strategy}`, `{SFIA,internal}`, `{SFIA,strategy}`, `{internal,strategy}`, `{SFIA,internal,strategy}`, then draft save, launch, assessment and report preserve exactly that selection.
- **004-B:** Given no selected source, when publishing/launching, then the system rejects it with “Choose at least one assessment input.” A draft may remain incomplete only if explicitly marked not launchable.
- **004-C:** Given strategy-only or internal-only, then SFIA controls, evidence requirements and scoring denominators are not silently introduced by default.
- **004-D:** Given I remove a source from an unlaunched draft, when dependent mappings exist, then I see impacted criteria/weights and explicitly resolve them; the server rejects dangling criteria. No hidden destructive deletion.
- **004-E:** Given unknown/duplicated source names, disabled source configurations or foreign-tenant versions, when sent directly to the API, then validation rejects the payload rather than accepting an unrenderable design.

**UX.** Create/edit cycle → Assessment inputs. Three labelled multi-select cards/checkboxes, source versions visible, plain-language explanation, preview criteria count. All source choices keyboard operable. Validation states which selected source lacks configuration.

**Test contract.** Parameterized seven-case API/browser/end-to-end/report matrix; empty/unknown source; source removal with mappings; no SFIA fixtures required for internal-only; snapshots preserve old selection.

**SA handoff.** Canonical source enum, selected version references, draft completeness versus launch validation and adapters into design/scoring/reporting without altering general legacy appraisals.

## CA-005 — Create/link strategy assessment criteria

**Story.** As a cycle administrator, I want to create strategy objectives or select authorised existing objectives and map them to roles, so strategic expectations can be assessed alone or alongside competencies.

**Evidence / gap.** `performance/backend/models/OKR.js:68` is organisation-scoped; `Appraisal.js:34–69` freezes goal evidence. Existing goals are foundations, not automatic strategy criteria.

**Acceptance criteria.**

- **005-A:** Given strategy is selected, when I create a named objective with assessment criterion/outcome expectations or explicitly link an authorised existing OKR, then the assessment stores its source, version and evidence references.
- **005-B:** Given a linked live objective changes after launch, then existing appraisal strategy text/expectations remain the captured version; a permitted link can open current source with a clear changed-since-capture label.
- **005-C:** Given an objective lies outside my organisation/allowed scope, when I search/select or forge its ID, then it does not appear or leak its details. Ordinary goal-view permission does not automatically grant criterion-edit permission.
- **005-D:** Given strategy is not selected, then no strategy criterion or mandatory strategy score is imposed. Strategy-only assessments can launch without SFIA/internal competencies.
- **005-E:** Given the objective is not naturally a proficiency ladder, then the administrator must choose a valid source-specific evaluation rule/scale; the app must not pretend an arbitrary OKR percentage equals an SFIA level.

**UX.** Cycle → Assessment inputs → Strategy. “Create criterion” / “Link existing objective”; show captured date, source, role links and evidence coverage. Empty state explains strategy is optional and offers a way back to inputs.

**Test contract.** Standalone and linked objective; source changes after launch; filtered search and forged ID; strategy-only evaluation; unsupported conversion rejection.

**SA handoff.** Decide minimal strategy entity versus explicit OKR adapter; immutable capture, source permission policy, scoped search and evaluation type contract.

## CA-006 — Map role expectations to source-specific criteria

**Story.** As an assessment designer, I want to define which criteria and expected levels apply to each role, so employees are compared with relevant role requirements rather than one universal standard.

**Evidence / gap.** Generic cycle competencies in `AppraisalCycle.js:126–139` have names/weights, but no role criterion/source-level link. Role mapping and level provenance are explicit PRD p1 requirements.

**Acceptance criteria.**

- **006-A:** Given a role version and selected source versions, when I add criteria, then each row retains its source/version, criterion, expected source level or declared evaluation target, required/optional status and configured weight reference.
- **006-B:** Given a mixed-source mapping, when displaying or saving expectations, then levels can only be selected from the correct source version; any conversion is a separate explicit scoring rule, never an inferred equality.
- **006-C:** Given required criteria lack an expectation, or a role maps only to deselected/archived inputs, then launch is blocked with a resolvable mapping list.
- **006-D:** Given two role profiles share a competency but have different expected levels, then each assessment uses its own pinned expectation; editing one role does not change the other.
- **006-E:** Given strategy-only mapping, then its expected outcomes and relevant scale work without competency levels being fabricated. Same-named criteria retain stable separate source IDs.

**UX.** Role profile → Expectations, with source groups and add/remove criterion controls; cycle setup preview shows included/excluded mappings. Show unresolved items and jump to exact row. Never hide required mappings behind silent defaults.

**Test contract.** Mixed sources/wrong level FK; two roles different expectation; removed source/criterion; role-version historical snapshot; source-specific expected-level rendering and accessibility.

**SA handoff.** RoleCriterion cardinality, cycle overrides policy, required marker semantics, weight reference ownership, immutable mapping snapshot and overlap/duplicate criteria rules.

## CA-007 — Assign existing organisation participants, roles and assessors

**Story.** As an authorised launch coordinator, I want to select existing organisation employees, an assessment role/version and an eligible assessor for each, so the correct people receive the correct scoped assessment.

**Evidence / foundation.** `Identityprovider/src/utils/performanceDirectory.js:1–56` defines organisation/managed-team/self scope and eligible reviewers; `Identityprovider/src/routes/members.js:188–194` serves that directory. `performance/backend/models/Appraisal.js:114–142` holds subject and reviewers. Extend this flow; do not duplicate identities.

**Acceptance criteria.**

- **007-A:** Given an HR/owner/admin user with organisation scope, when opening setup, then all active authorised participants including never-signed-in members are selectable; eligible line managers/team leads see their managed hierarchy only.
- **007-B:** Given approximately ten selected pilot members, when assigning roles and assessors, then each row has a required role/version and eligible assessor; summary shows all assignments before launch. A missing role or assessor blocks only actionable unresolved rows and launch.
- **007-C:** Given the role name is “Administrator” but the subject is a staff member, then assigning that assessment profile changes no access permissions. Employment role labels and application permissions are visibly distinguished.
- **007-D:** Given a staff/recruiter/interviewer without launch authority or an out-of-scope member/assessor ID, when launching directly, then the server denies it. Revoked/inactive membership or reviewer eligibility is revalidated at launch.
- **007-E:** Given I submit a launch and retry following a timeout, then one assessment per intended subject/cycle is created and the receipt identifies existing versus newly created records; no duplicate emails from retry.
- **007-F:** Given role/framework versions changed after my setup preview, then launch either pins the explicitly reviewed versions or returns a conflict requiring review; it must not silently adopt new requirements.

**UX.** Start appraisal → People & roles. Filter by team; show person, occupational profile/version and assessor in each row; bulk assign with per-person review. Confirmation gives count, role versions and scope. Preserve previous assignments when navigating back.

**Test contract.** Owner/HR/manager/staff matrix; 10-participant fixture including never-signed-in member; role completeness; revoked eligibility; invalid tenant IDs; idempotent retry; no new IdP account or privilege change.

**SA handoff.** Reuse directory service and existing eligible-reviewer checks, participant snapshot contracts, role version pinning, transaction/idempotency and notification/outbox behavior.

## CA-008 — Compare expected versus observed role requirements

**Story.** As an assigned assessor, I want to see the selected role's requirements alongside each criterion's evidence and my findings, so feedback explains how performance meets or falls short of that role.

**Evidence / foundation.** `performance/backend/models/Appraisal.js:325` has manager competency ratings; the report service `performance/backend/services/appraisalResultReport.js` serializes generic findings. Neither establishes the full role/source comparison contract.

**Acceptance criteria.**

- **008-A:** Given a launched assessment, when the assessor opens a criterion, then its pinned role/version, responsibility, source/version, expected level/target and descriptors appear alongside permitted evidence and observed level/rating/rationale fields.
- **008-B:** Given findings exist, then the UI can label expected/observed differences within the same declared level system; it cannot subtract unrelated framework numbers or label an unconfigured cross-source gap as comparable.
- **008-C:** Given insufficient evidence, when recorded, then it is a distinct visible status with rationale/missing evidence, not zero ability, a fabricated rating or a passing criterion. Completion/exception behavior follows the separate finalisation story.
- **008-D:** Given assessor draft comments and employee self-assessment, then each author's feedback is retained distinctly with saved/submitted timestamps; draft resume restores all criterion references. Complete submitted manager feedback, including goal comments, is included in the permitted final report.
- **008-E:** Given a user cannot view an evidence item, then comparison/AI/report APIs do not leak its body, filename or inaccessible excerpts. Authorized provenance can show a neutral restricted marker only if policy permits.
- **008-F:** Given a legacy record has no role snapshot, then existing appraisal remains usable and explicitly says role comparison is unavailable, with no fabricated historical mapping.

**UX.** Appraisal → Reviewer assessment. Persistent “Assessing against [role] · vX”; criterion navigation, source badge, expected/observed columns, evidence drawer, save status and missing-findings filter. Narrow screens stack expected then observed while retaining criterion context. No solely red/green suitability signals.

**Test contract.** Source-level comparison; strategy target evaluation; draft round-trip; missing evidence; restricted attachments; manager goal-comment report parity; no new role version changing existing findings.

**SA handoff.** Coordinate evidence, scoring and reporting owners; define comparison DTO, sufficient/insufficient status, granular permission filtering and version-safe report snapshot.

## CA-009 — Generate optional source-referenced AI role comparisons

**Story.** As an assessor who has permission and consent to use AI, I want editable draft comparisons of permitted evidence against the selected role, so I can review useful observations while retaining responsibility for all findings and outcomes.

**Evidence / foundation.** `performance/backend/models/Appraisal.js` contains reviewed AI suggestion records; `performance/backend/services/appraisalAIService.js` supplies shared scoring/AI foundations. Repo AGENTS requires the Recruiter-hosted shared gateway, app HMAC and scoped activity allow-list. Reuse personal connected ChatGPT identity rules, never an owner's connection shared across tenants.

**Acceptance criteria.**

- **009-A:** Given AI is enabled, permitted and consented, when generating a comparison, then input includes only the pinned role/source definitions and evidence the requesting actor may process. Generated observations carry source reference, generation time/model metadata and Draft status.
- **009-B:** Given consent or AI availability is absent, then manual assessment remains fully completable. Disabled AI must not trigger background gateway calls or block saving a human assessment.
- **009-C:** Given a draft observation, when accepted/edited/dismissed, then the decision and reviewer are saved. Acceptance alone does not set a rating, final classification, completion status or employment decision.
- **009-D:** Given evidence has no support for a role requirement, then the suggestion states insufficient evidence rather than inventing capability. AI text is never treated as an additional independent evidence item.
- **009-E:** Given a source reference points outside the actor's scope or evidence is removed/restricted before generation/acceptance, then the server rechecks and excludes/blocks the invalid reference. Prompt instructions in source files cannot override role/tenant/access constraints.
- **009-F:** Given role/framework/evidence versions differ from the AI draft's input snapshot, then the suggestion is marked stale and must be reviewed/regenerated rather than silently applied to the new definition.

**UX.** Reviewer assessment → Optional “Suggest comparison”. Explain exactly which permitted evidence is used; show cancellable loading, retryable provider errors and manual path; render citations beside editable draft observations with explicit Accept / Edit / Dismiss. Clear drafts-versus-assessor-findings distinction.

**Test contract.** Stubbed gateway request contracts and allow-list; real provider smoke separately labelled; AI-disabled zero-request assertion; tenant/evidence filtering; malicious source text; stale suggestion; accept does not mutate ratings/final status; manual completion with provider down.

**SA handoff.** Consent/permission/identity propagation; gateway activity contract; prompt/schema validation; source allow-list and replay/staleness policy; job idempotency, timeout/retry/cancel and redacted error observability. No secret values or assessment bodies in test logs.

## Handoff checklist for architecture and UI/UX

Each architect document must map CA acceptance IDs to entity/API/permission/state/error/test decisions. UI/UX must map those IDs to existing-screen captures plus proposed wireframes, layout, copy, empty/loading/error/permission/mobile/keyboard states. Image generation may illustrate visual direction; editable screen specifications remain authoritative. PM and architect jointly record ready/revise decisions before development starts.

Required integration agreements with PM B: criterion/evidence IDs and snapshots; source-specific scoring/conversion; manager feedback and report parity; insufficient-evidence/finalisation gates; rankings compatibility; report/export permission filtering. These are shared contracts, not a reason for two teams to concurrently edit the same schema or route file.

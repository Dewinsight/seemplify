# Delivery, security and QA architecture

Owner: SA-B / coordinator. Baseline: b401f1b1. Status: specification for independent review, not implemented evidence. Domain/API contract is defined in `01-domain-and-api.md`; this document constrains its integration and verification.

## Boundaries and threat assumptions

Verified IdP membership is authoritative. An occupational assessment role never grants app permissions. Every persisted competency record carries `organizationId`; every service lookup combines that organisation with the referenced identity, version, cycle and participant. A supplied Mongo ID is a reference, not authority.

Protect against IDOR across tenants/participants, mass assignment, stale authorisation, evidence URL guessing, malicious documents, prompt injection in evidence, arbitrary formula execution, duplicate finalisation/provider jobs, stale edits, report-filter leaks and historical-result drift.

| Requirement | Enforcement | Negative proof |
|---|---|---|
| Tenant isolation | Server-derived current organisation; compound scoped lookups and indexes | Tenant B IDs in every tenant A read/write/report/export/link operation |
| Current actor scope | Verified IdP principal and authoritative directory; explicit action capability plus resource scope | Removed membership, unrelated manager/team, inactive assessor, forged actor/body role |
| Action separation | Independently grant/edit/finalise/reopen/view/export through shared permission catalogue | Edit-only assessor denied finalise; view-only denied export; permission revocation invalidates next request |
| Source integrity | Immutable framework/role versions; role pin during launch; selected sources snapshot | Edit current library after launch/finalisation; old results unchanged |
| Evidence protection | Authenticated source resolution/playback/download; ownership and participant checks; no raw provider URLs | Another participant file/session link, hidden document, deleted media, public storage guess |
| Secure files | Bounded types/bytes, MIME/signature checks, parser limits, quarantine/scan state before AI | Polyglot/mismatched MIME, oversized/compressed/malformed document, active content |
| AI authority | Central personal gateway, activity scope, consent and approved evidence only | Shared organiser identity substitution, hidden evidence, prompt instruction, invented citation, direct rating write |
| Scoring safety | Validated numeric rules and explicit conversions, deterministic rounding/version | NaN/infinity/negative weights, malformed bands, incompatible levels, injected expression |
| Concurrency | Revision-checked drafts; idempotent launches/finalise; unique indexes/atomic conditional updates | Stale save and parallel duplicate requests preserve latest state/history |
| Report privacy | Scoped rows before aggregation; permission-checked PDF; no-store responses | Forbidden filters/participant IDs, report denied but export succeeds, aggregates leaking hidden rows |
| Retention | Organisation policy, consent state, authorised deletion workflow, inaccessible expired media | Expired content still downloadable/processed; deletion erases final decision/audit |

New permissions require IdP catalogue and app mapping contract tests; do not replace them with product-local role overrides. A limited pilot rollout may use existing HR-plus gates only if explicitly documented as a remaining action-permission gap, never marked CA-109 complete.

## Integration with existing appraisals

The coordinator owns shared bridge hooks. Ordinary appraisal setup can select an assessment cycle and published role version for each participant. Launch validates the same employee and assessor context and persists a stable relation to the competency assessment. Failed linked launch must return a recoverable state; no orphan silently presented as complete. Design the linked operation to be retryable with one request key and expose incomplete/reconciliation state explicitly if atomic cross-record creation is unavailable.

Appraisal details load competency data through its own scoped endpoint/component; existing lifecycle remains canonical for ordinary reviews. Competency completion cannot secretly bypass required ordinary stages or an appraisal's access policy. Appraisals with no competency link continue unchanged. The role snapshot and complete manager feedback must reach the combined report under the same authorisation.

Existing manager goal comments and overall rating are not currently fully represented in `appraisalResultReport.js`. Extend the final report serializer/UI/export consistently, including source reviewer and submitted date. Keep private drafts and raw recordings out of a published report unless visibility permits. Use a deliberate publication snapshot rather than automatically exposing draft fields.

## Developer pairs and integration owner

| Owner | Reserved area | Must request handoff for |
|---|---|---|
| Pair A | `models/CompetencyRole*`, `CompetencyFramework*`, dedicated library/config routes/services/tests; frontend library/setup components | Any shared schema change after freeze |
| Pair B | `models/CompetencyAssessment*`, dedicated evidence/evaluation/results/scoring services/routes/tests; frontend assessor/report components | Role/config contract change |
| Coordinator / retained SA | `app.js`, navigation, shared permissions, appraisal setup/detail/report bridges, CI registration, documentation integration | Existing unrelated lifecycle paths owned by another task |

Implementation paths are provisional until SA-A publishes exact ownership. Do not create two competing routers/services for the same resource. A pair sends its peer-review notes and tests, then yields to independent QA. Each shared file has one writer at a time.

## Contract and persistence tests

1. Use MongoMemoryServer + Supertest, existing Jest integration naming, actual Mongoose validation and query behaviour. Do not mock the persistence layer for invariants.
2. Run role/framework/config service tests before UI starts so exact schema fixtures can be shared.
3. Create tenant A/B, HR, line manager, employee, outside manager, revoked member, assigned assessor with restricted action grants and teamless member. Confirm both scope and action restrictions.
4. Test seven source sets plus empty/unknown/duplicate sources, unknown levels, versions from wrong framework and missing role for a participant.
5. Test deterministic scores at boundaries, zero/missing/incompatible components, required missing findings, authorised exception, tie policy, disabled ranking and noncomparable exclusions.
6. Test launch/finalise retries in parallel and stale save after newer edits. Validate audit/history and report values after changing live definitions.
7. Test secure source adapters and failure/retry paths separately from real providers. No mock provider success is labelled actual Nylas/AI acceptance.

## Browser and usability test matrix

Use the existing Playwright runner with semantic locators, isolated sessions and web-first assertions. Extend real-API fullstack fixtures for persistence proof; mocked browser scenarios supplement state/error coverage.

| Journey | Essential assertions |
|---|---|
| Role manual/upload | Create, extraction preview, amend, confirm, failed parse/manual fallback, publish/version/archive, stale edit |
| Configure and launch | Input combinations, source-linked expectations, invalid weights, explicit assessor, pinned role, check answers, receipt and duplicate retry |
| Evidence/oral | Upload permitted source, criterion coverage, manual prompts/answers save/resume, insufficient evidence, call unavailable fallback |
| Human/AI review | Expected/observed comparison, manager goal comments, AI optional and cited, accept/edit/dismiss without score change |
| Outcome/report | Missing checklist, exception permissions/reason, calculated vs final, finalise direct, report only after publication, screen/PDF parity |
| Cohort/history | Scope filters, gaps/rankings/ties/incompatible rows, role edit preserves old result, authorised reopen audited |
| Recovery/accessibility | Loading/empty/denied/error, refresh, failed save retains input, keyboard/focus, mobile primary action, long text and themes |

Minimum visual widths: 390 and 1440 CSS px, plus 200% zoom manual inspection. WCAG target AA. Colour cannot be the only status signal. Keep tables readable and provide compact list/detail alternatives. No fixed sleeps for eventual rendering.

## Pilot and release proof

Synthetic pilot: ten participants, assigned roles and controlled sources; verify all seven source configurations plus a fully manual internal-only route. Record exact data fixtures and distinguish from actual MoMo onboarding. Manual assessment remains possible without paid provider credentials.

Required CI suites include IdP auth/permission contracts, backend legacy/unit/integration, frontend type/build, focused and regression browser plus real-API journeys, secret/security scan. Do not bypass tests under the user's admin authorisation. A flaky retry is reported and investigated when it indicates an unresolved race.

Release one reviewed batch from canonical main using exact-path staging. Before commit, compare staged diff to ownership and baseline. Preserve unrelated working changes. Admin merge bypass is available only as needed for branch rules; no force-push/protection toggles. Verify pushed commit, required CI, deployment, running image revision, public health, OIDC-start redirect and authenticated browser behaviour as distinct records.

Roll back application images or hide newly added entry points if critical live smoke fails. Preserve persistent Mongo and media volumes, immutable completed results and known-good image aliases. Use existing deploy lock/bounded cleanup. Never delete production data to make tests pass.

## Evidence contract for the final document

Each story row: ID; current phase; owner; acceptance criteria passed/failed/not run; source commit; exact test command and log; screenshot environment/revision; CI/deploy URLs; live revision; limitations. Screenshots are annotated baseline/concept/local/live. Final PDF uses numbered feature summaries and real implementation images, while planning concepts remain visibly labelled. Unimplemented or externally unverified requirements remain listed.

## Research

- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) supplies testable security controls.
- [Playwright best practices](https://playwright.dev/docs/best-practices) supports isolated user-facing browser assertions.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) supplies accessibility criteria.
- [C4](https://c4model.com/) informs architecture boundaries and targeted diagrams.

These are applied selectively to this product. This document does not claim a security certification or completed acceptance test.

# Product readiness review

Reviewer: retained Product Manager A. Date: 18 October 2026. Reviewed baseline: `b401f1b1583be5875cc02462122c83ec9e7311d2`; planning artifacts as present at review. Applied installed `seemplify-competency-product` skill. **Decision: product scope is substantially covered; full developer handoff is conditional, not approved yet. No implementation or acceptance pass is claimed.**

## Inputs reviewed

- Original three-page `C:/Users/User/Downloads/Seemplify Competency Assessment PRD.pdf`, previously read in full from the source PDF.
- User clarifications on role creation/upload, role comparison, complete manager feedback, current appraisal integration and requested agent/QA/release pipeline.
- `stories/01-role-framework-stories.md` and `02-evaluation-reporting-stories.md`: all25 stories, CA-001–009 and CA-101–116.
- `architecture/01-domain-and-api.md`, `02-delivery-security-qa.md`, `DEVELOPMENT-CONTRACT.md` and master `IMPLEMENTATION-PLAN.md`.
- Available design inventory at this point: privately retained actual-account baseline captures and `design/concepts/role-editor-dark-concept.png` (synthetic). No completed design/state specification file existed at review; this inventory is not a claim of visual approval. Actual-account captures are excluded from published artifacts.

## Requirement coverage

| PRD / explicit clarification | Story coverage | Architecture / handoff coverage | Product verdict |
|---|---|---|---|
| Existing employees; tenant and team boundaries; approximately10 MoMo participants | CA-007,109,116 | Current IdP directory, action+relationship scopes, launch snapshots, pilot matrix | Covered in plan; actual client staging cohort remains unproven |
| Manually create a reusable role or upload a role description | CA-001,002 | Role/import/version collections; human confirm; PDF/DOCX/TXT policy; archive/history | Covered; uploaded role evidence is not silently a new profile |
| Select assessment role during current appraisal setup | CA-007 | Architecture §7 and development appraisal bridge; coordinator owns current wizard hook | Covered; dedicated competency area cannot replace this integration |
| Human/AI comparison against same role | CA-006,008,009,104,105 | Frozen definition role and criteria, source manifests, cited draft review | Covered; no lookup of mutable job title as historical expectations |
| Seven nonempty source combinations, internal-only without SFIA | CA-003,004,005,116 | Source enum, config validation, seven-case full journey matrix | Covered; strategy and SFIA remain optional |
| Framework source/version/levels and role expectation links | CA-002,003,006,114 | Immutable versions, exact source/criterion/level references and readable snapshots | Covered; no assumed equivalence or invented catalogue |
| Strategy objectives alone or mixed with competencies | CA-005,006,106 | Strategy version/OKR adapter; explicit evaluation target | Covered in prose; direct numeric scale shape unresolved below |
| CV/role/strategy evidence, criterion ownership and missing evidence | CA-101,110 | Evidence links, scoped storage/download, content hashes, completion check | Covered |
| Manual oral assessment independent of integrations | CA-102 | Structured prompts/answers/notes; manual provider-free path | Covered; never mark an ordinary note a transcript |
| Nylas/native recording/transcript and optional AI | CA-103,104,115 | Existing adapters, consent/retention, personal shared gateway and allow-list | Covered; actual provider proof separately required |
| Expected/observed workspace; drafts and rationale | CA-008,105,110 | Finding statuses, CAS saves, role comparison and gaps | Covered |
| Scales, weights, normalization and configurable aggregation rules | CA-106 | Weighted mean, native-level score maps, three weight modes and fixed rounding | Mostly covered; numeric scales need concrete schema; weighted-mean-only is an explicit initial rule-set decision, not a promise of arbitrary formulas |
| Threshold proposal separate from final human suitability | CA-107 | Threshold bands; human final classification; override reason; no employment actions | Covered |
| Optional rankings by role/department/org; ties and comparability | CA-108,113 | Strict configuration compatibility, dense/competition ties, exclusions and cohort timestamp | Covered; incompatible results cannot be assigned misleading ranks |
| Separate edit/finalise/reopen/view/export; no second approval queue | CA-109,107,114 | Canonical IdP grants, default-deny/resource scope; no awaiting-approval state | Covered; publication state semantics need explicit resolution below |
| Missing findings/evidence and authorised reasoned exceptions | CA-110,106 | Server atomic check, separate exception grant, missing-as-unscored default | Covered; exception cannot waive role/identity or invalid scoring |
| Full submitted manager feedback independent of call notes | CA-111,112 | Explicit overall/competency/goal/custom/recommendation mapping and actual reviewer/time; appraisal report bridge | Covered, including goal comments and overall manager rating; freeze timing needs integration verification |
| Participant report/PDF and scoped cohort reporting | CA-112,113 | Shared filtered report DTO, immutable result, scope before totals and export recheck | Covered; generated design images are not report parity proof |
| History, audit and reopen without rewriting old results | CA-002,114 | Immutable result revisions, append-only safe audit, old definition/score/report hashes | Covered |
| Recording/transcription/AI consent and retention | CA-115 | Per-purpose policy version, jobs recheck, source deletion/tombstones/provider pending | Covered in contract; configured periods/notice and provider capabilities remain prerequisites |

No original PRD module was intentionally dropped. The expanded full manager-feedback and occupational-role requirements are now explicit. Ordinary appraisals remain usable without a competency link. The term “role” must remain consistent in user-facing design and must never mean permission escalation.

## Concrete blockers before the affected developer handoff

| ID / priority | Finding | Required resolution and owner | Affected work |
|---|---|---|---|
| PM-R1 / high | UX handoff currently consists only of image files. No complete current-screen audit, field/state spec, interaction/recovery/mobile/keyboard behavior or recorded PM+SA design approval is available. | UX-A/B deliver per-surface specs tied to CA clauses, baseline screenshot provenance and labelled concepts; PM and SA review the actual handoff. This is already the master plan's ready gate. | Frontend implementation and any API behavior whose exact UX state remains undefined |
| PM-R2 / high | `DEVELOPMENT-CONTRACT.md` freezes `RoleCriterion.evaluationTarget.scaleId/value` and architecture supports direct numeric scales, but `ScoringConfig` has no scale registry or criterion `min/max`/transform/measurement selector. A developer cannot resolve `scaleId`, validate a numeric strategy target or know whether level mapping versus rating is authoritative from the frozen shape alone. | SA freezes the direct-scale representation, ID ownership, criterion scoring measure and valid target/rating mapping; add one strategy-only numeric example and boundary test fixture; notify both pairs/UX. Do not invent it independently in each lane. | Strategy-only/rating-based role mappings, scoring, assessor controls and reports |
| PM-R3 / high | Lifecycle includes `finalised -> published`, and participant reports require a published result, while endpoint freeze has no publish action/route or explicit automatic-publication policy. If implemented inconsistently this creates a hidden approval step or prevents employees seeing a completed result. | SA specifies whether finalise atomically publishes under policy, or a separate authorised publication operation is optional. Identify permission, endpoint/state, visibility, notifications/retry and history semantics. PM verifies no mandatory second approval queue. | Final outcome, participant report and current-appraisal bridge |
| PM-R4 / medium | Combined report promises a frozen copy of **all submitted manager feedback**, while competency and ordinary appraisal lifecycles can finish/reopen separately. The precise capture point and behavior when manager feedback is submitted/changed after competency finalisation require a deliberate integration test. | Coordinator specifies snapshot timing/version association and shows draft manager feedback never published as submitted, subsequent authorised submission is not silently lost, and old report versions remain stable. Can be resolved in report/appraisal integration packet before P5. | Full manager feedback/report parity; not a blocker for role-library backend work |

These are readiness defects in the specification, not claims of production bugs. They do not prohibit researching, drafting tests or refining additive contracts. They prohibit marking the affected package development-ready until the contracts/designs are resolved and reviewed.

## Named prerequisites / certification limits

1. **Actual MoMo pilot:** The PRD's staging acceptance is the approximately10-person configured client cohort. Synthetic ten-person staging tests are the safe engineering baseline and do not establish that actual client participant mappings, permission assignments or source definitions are configured. Track client onboarding as pending unless its data and permission acceptance are independently evidenced. Do not import or assess live employees merely to produce tests.
2. **Framework content:** The organisation supplies lawful SFIA/internal definitions and native levels; the team must not invent equivalence, scrape a proprietary catalogue or claim SFIA support was tested using internal labels alone. Internal-only remains an independent end-to-end release criterion.
3. **Aggregation policy:** Weighted mean with configurable source/criterion weights is the architecture's initial constrained aggregation rule. Label that capability honestly. Any requested alternative needs a versioned method and golden tests; arbitrary formula execution is excluded for clear security reasons.
4. **Providers and retention:** Deterministic mocks do not prove Nylas/native capture, transcription, personal AI, provider deletion or purpose consent. Retention periods/notice must be configured before enabling those paths. The manual/no-AI path must remain complete when providers are unavailable.
5. **Concurrent repository work:** Existing dirty appraisal lifecycle changes are outside this programme. No exact-path commit may accidentally include them. Coordinator-owned bridge edits require explicit file ownership handoff.

## Acceptance decision and next review

**Stories:** accepted as a complete product scope for architecture/design. **Architecture:** conditionally accepted pending PM-R2/R3 and the P5 PM-R4 integration decision. **UI/UX:** not yet reviewed/approved; PM-R1 open. **Developer implementation:** no blanket approval from this review. **Feature completion/live:** not assessed and not claimed.

The next review should identify resolved PM-R IDs, changed contract revision, UI specification and screen evidence; record accepted/revise for each affected package. Tests must reference exact acceptance clauses (`CA-001/001-A`, `CA-111/1`, etc.). After development, acceptance still requires persistence/API negative cases, seven full journeys, no-provider internal-only flow, full feedback/PDF parity, history and deployed-revision proof.

## Follow-up review — updated contracts and configuration design

This section supersedes the initial decision for the specific items below. Re-read current architecture §6/7/9 and the updated development contract, plus `design/01-roles-and-setup.md` in full. Visually inspected `design/concepts/role-editor-dark-concept.png`. Designer A's specified corrections override concept-only inconsistencies (neutral primary buttons, simplified narrow-screen navigation). No new code or test pass is claimed.

| Review item | Updated evidence | Current decision |
|---|---|---|
| PM-R1: configuration/setup design | UXA specifies current routes/baseline limits, manual/upload/import review, roles/version/history, framework/strategy mappings, all7 inputs, scoring methods, current wizard assignment and receipt, permission/failure/conflict/mobile/keyboard states, and CA-001–009 mapping | **Product approved for P1/P2 configuration/setup design.** SA must still resolve API questions recorded by UXA before each dependent implementation path starts. |
| PM-R1: assessor/report design | At this follow-up inventory, no `02-assessor-and-reports.md` or equivalent completed designer B specification exists on disk; a concept PNG exists | **Not approved yet for P3–P5 frontend.** A generated concept does not replace the missing interaction/state document. |
| PM-R2: numeric scoring representation | Contract now has `ratingScales` with unique IDs and finite min/max, strictly discriminated `level_map` versus `rating_scale`, bounded target/rating validation and historical/comparability inclusion | **Resolved at contract level.** Golden strategy-only numeric fixture below is mandatory for the first scoring implementation and must be shared by both lanes; no full scoring acceptance until run. |
| PM-R3: finalise/publication | Successful finalise atomically stores durable immutable result and sets published; report is immediately available only under existing report-view rights; no second publish operation/approval | **Resolved.** New UI must not strand a user in `finalised` pending another approval. Historical/internal state compatibility is acceptable. |
| PM-R4: complete feedback timing | Finalise captures current submitted appraisal manager payload/hash/reviewer/time. Enabled-but-unsubmitted step blocks with link to review; explicitly disabled step is labelled not configured. Later source changes require authorised reopen/refinalise; old report/PDF stays unchanged | **Resolved in architecture.** Integration tests must prove every branch, particularly source-hash mismatch and historical PDF stability. This is a data-completeness gate, not another person's approval. |

### Required golden strategy-only numeric fixture

This fixture closes the concrete test example gap without inventing implicit scale conversion. It is an acceptance input for the agreed contract and must be copied into shared test fixtures before the scoring package is marked ready:

- Selected inputs: `['strategy']`; one published strategy version with criterion `handover-timeliness`; sole source/criterion weight1 under relative weights. No SFIA/internal framework records are required.
- Declared scale `{id:'percent-target',label:'Percent achieved',min:0,max:100}`. Role criterion binds `evaluationTarget:{scaleId:'percent-target',value:90}`. Normalization entry uses `method:'rating_scale'` and `ratingScaleId:'percent-target'`; it must not also include `levelScores`.
- Human observed rating80 with permitted criterion evidence and required rationale. Normalization `(80-0)/(100-0)*100 = 80`; source and overall scores80; coverage1/1. UI shows expected90 and observed80 on the **same** percent scale, a gap of10 percentage points, with no invented proficiency level.
- Threshold bands follow the now-authoritative strategy golden example in `DEVELOPMENT-CONTRACT.md`: [0,75) “Development needed”; [75,100] “Suitable”. Calculated proposal for80 is Suitable, distinct from the authorised finaliser's separately confirmed classification. Rating75 is the explicit lower Suitable boundary.
- Boundary ratings0 and100 yield0 and100; targets/ratings below0/above100, unknown scale ID, max==min and both normalization methods are rejected. Expected target90 is not a denominator: observed80 must not silently become88.89 by dividing by target90.
- Snapshot/export assertion: changing today's scale/target after launch/finalisation does not change the report's original target90, observed80, score80 or classification rule. No-AI/no-call completion succeeds.

### Package-specific product gate

| Packages | Product decision | Remaining non-product gate |
|---|---|---|
| P1A Role library, P1B frameworks/strategy | **Product scope and UXA design accepted.** May enter development once SA confirms exact mutation/source-preview contracts and shared validators/test fixtures. | SA schema/API freeze, both lanes' acknowledgement, path reservations and independent reviewer assignment |
| P2A Cycle configuration, P2B people/role/current-appraisal setup | **Product scope and UXA design accepted.** Required golden strategy fixture applies when scoring is wired; current appraisal bridge cannot be omitted. | SA bridge/current-directory permissions and API decisions; shared-path owner handoff |
| P3–P5 evaluation, AI, outcomes and reports | **Stories/updated architecture product accepted; frontend handoff pending Designer B specification review.** | Missing UXB full handoff; actual implementation/QA and API consistency review |
| P6 pilot/release | **Not ready / no implementation evidence.** | All story tests, real provider checks for enabled paths, actual client staging mapping acceptance separately from synthetic tests, CI/deployment/live proofs |

No further product scope reduction is authorised by these package approvals. In particular, include the role selector in existing Start appraisal, manager goal comments in the report, all seven complete source journeys, and the integration-off internal-only path. Proposed standalone competency navigation is an addition to those journeys, not a substitute.

## Final design gate — P3–P5 review complete

Re-reviewed `design/02-assessor-and-reports.md` in full after it was saved, visually inspected `design/concepts/assessor-workspace-light-concept.png`, and checked the latest `DEVELOPMENT-CONTRACT.md` additions. This supersedes the earlier statement that the UXB specification was missing. The final contract now also specifies draft version PATCH, reauthorised clean-scan source viewing, an actual scanner adapter and the strategy-only golden fixture. The golden example above has been aligned to the canonical threshold75 to avoid contradictory fixtures.

| Product check | Inspected design/contract evidence | Result |
|---|---|---|
| Same occupational role throughout current appraisal, assessment, AI and report | UXB §4/5/8/10: role/version header, frozen-role preview, shared linked workspace, expected/observed and source labels | Approved |
| Native levels versus strategy targets | UXB §3 explicitly corrects concept's strategy “Level4”; §5 uses numeric target/named scale where configured and no fabricated quantitative target for qualitative expectations | Approved; the concept's strategy level label must not be implemented literally |
| Manual integration-off completion | UXB §7/8: first-class manual session, structured prompts/answers/notes, absent AI account/provider not a blocker | Approved |
| Evidence access and cited AI drafts | UXB §6/8: scan-ready states, participant-filtered sources, accepted text remains draft narrative, source refs do not become independent evidence | Approved |
| Full manager/assessor feedback | UXB §10 explicitly includes every submitted goal and competency rating/comment, custom answers, strengths/development/recommendations, actual reviewer identity/date; employee/oral/AI sections distinct | Approved under canonical submitted-feedback hash/freeze contract; draft/private feedback remains excluded |
| Completion, scoring and human classification | UXB §9: actionable checklist, nonwaivable structural/security items, distinct missing evidence and coverage, formula breakdown, final classification unselected until human choice | Approved |
| Finalise directly makes restricted report available | UXB §9/14: durable finalise result followed by report, no second publish/approval, retry identity and current revision validation | Approved |
| Scoped reports, PDF, rankings and history | UXB §10/11: shared report DTO, separate export rights, charts+tables, scope before totals, tie/compatibility exclusions, old final retained on reopen | Approved |
| Permission/recovery/mobile/accessibility | UXB §12/13: denied/expired/conflict/failure states, preserved edits, keyboard/source navigation, compact screens and 200%zoom, both themes, per-story QA mapping | Approved as a specification; rendered app remains unverified |

**Current product gate:** P1–P5 story scope and both UX handoffs are approved for implementation against the current frozen architecture/development contract. No unresolved product-design blocker remains in this review. SA contract review, shared fixture validation, owner path reservations and implementation QA remain independently required. This is not approval of any uninspected code, provider behavior, deployed feature or report PDF.

Implementation acceptance must explicitly test enabled-but-unsubmitted reviewer blocks, explicitly disabled reviewer label, source-hash change and authorised reopen/refinalise, stable old PDF, score80 versus target90 without accidental88.89 normalization, and the concept's corrected strategy measurement. These checks preserve the resolved PM-R2/R3/R4 rather than treating the contract text as proof they work.

Documentation tidy-up, nonblocking: UXA's opening relative cross-link names `02-assessment-and-reporting.md`; the actual final UXB filename is `02-assessor-and-reports.md`. Integration owner may correct that link. Concepts remain labelled synthetic/not implemented, with written field/state specifications authoritative. P6/client pilot/release approval remains pending actual implementation and executed evidence as previously recorded.

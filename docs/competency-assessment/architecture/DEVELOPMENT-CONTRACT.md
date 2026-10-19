# Development contract v1 — frozen handoff

Owner: coordinating SA. Freeze: 18 October 2026. Implement the full story acceptance clauses; this contract resolves naming/ownership, not a claim of completion. Normative detail: `01-domain-and-api.md`; enforcement/release: `02-delivery-security-qa.md`; product: CA-001–009 and CA-101–116. Any change to this contract must notify both developer pairs and UX owners before writing code.

## One writer per path

| Owner | Exact new area | Interface |
|---|---|---|
| Pair A — library/config | Models `CompetencyRole`, `CompetencyRoleVersion`, `CompetencyFramework`, `CompetencyFrameworkVersion`, `CompetencyStrategyVersion`, `CompetencyImport`, `CompetencyCycle`; `routes/competency/library.js`; `services/competency/libraryService.js`; `tests/competencyLibrary.integration.test.js` | Export Express router; service exposes `getPublishedDefinition({organizationId,cycleId,cycleRevision,roleVersionId})`; returns validated readable frozen definition, never foreign objects |
| Pair A — frontend | `components/competency/library/**`, `components/competency/setup/**`; routes `app/competency/roles/**`, `frameworks/**`, `cycles/**` | Setup exports assignment/role-selection component usable inside existing launch wizard |
| Pair B — assessments | Models `CompetencyAssessment`, `CompetencyEvidence`, `CompetencyOralSession`, `CompetencyAISuggestion`, `CompetencyResultRevision`; `routes/competency/assessments.js`; services `services/competency/assessmentService.js`, `scoringService.js`, `reportService.js`, `evidenceService.js`, `oralService.js`; focused `tests/competencyAssessment*.test.js` | Export Express router; assessment service consumes A's published-definition function; report service exports `buildReportDTO({assessment,resultVersion,viewer})` |
| Pair B — frontend | `components/competency/assessment/**`, `components/competency/reports/**`; routes `app/competency/assessments/**`, `reports/**` | Export linked assessment panel and report section for existing appraisal detail/report |
| Coordinator only | `routes/competency/index.js`, `services/competency/authorizationService.js`, `contracts/competency.js`, `models/CompetencyAuditEvent.js`, `CompetencyOperation.js`, `frontend/lib/competency-api.ts`, `app.js`, navigation, IdP catalog/app grant mapping, current appraisal setup/detail/report hooks, CI | Shared validators/types/auth/operations. Neither pair writes existing dirty appraisal lifecycle files. |

Do not create competing `competency.js` monolith routers or a second scoring implementation. Each pair has one implementer and one independent reviewer/tester when four development workers fit capacity; otherwise queue the reviewer pass. At most six workers including PM and SA/QA; respect runtime capacity if lower.

## Common invariants

- Prefix `/api/competency`; one authenticated, current-organization middleware boundary. Derive actor/org from verified session. Compound org+ID lookups everywhere, including workers, source references and exports. OIDC `userId` identifies people.
- Success `{data,meta:{schemaVersion:"1",revision?,nextCursor?,requestId}}`; failure `{error:{code,message,fields?:[{path,code,message}],requestId}}`. 404 for foreign resources, 403 for denied action, 409 stale/status conflict, 422 valid JSON failing domain/completion validation.
- Resource IDs/version IDs are strings of Mongo IDs, person IDs are OIDC subjects. `revision` integer; `version` human-visible positive version number. Published library contents immutable. Mutable draft writes require `If-Match: "<revision>"`; CAS includes org/id/status/revision.
- POST create/confirm/launch/finalise/reopen/export has `Idempotency-Key`. Same actor/org/action/key+same payload replays outcome; different payload409. No UI retry can duplicate records/provider work.
- File allowlist PDF/DOCX/TXT, max10MiB, MIME/signature check, bounded parser, quarantine scan required before extraction/AI. Unsupported/failed file supports manual continuation. Imports do not auto-publish.
- Bounded in-process task loop plus Mongo lease is enough initially; no new queue/server required. Persist pending/running/ready/failed status, tenant/actor/permission/consent version, attempts<=3, lease and safe errors. Recheck before processing and download.

## Exact shared shapes

```ts
type SourceType = 'sfia' | 'internal' | 'strategy';
type Actor = { userId: string; name: string };
type Level = { id: string; label: string; description: string; order: number };
type Criterion = { id: string; code: string; name: string; description: string; levelIds: string[] };
type RoleCriterion = {
  id: string; sourceType: SourceType;
  frameworkVersionId?: string; strategyVersionId?: string; // exactly one
  criterionId: string; expectedLevelId?: string;
  evaluationTarget?: { scaleId: string; value: number }; // explicit strategy/rating target
  weight: number; required: boolean; evidenceRequired: boolean; rationaleRequired: boolean;
  responsibilityIds: string[]; requirementIds: string[];
};
type RoleDraft = {
  name: string; description: string;
  responsibilities: {id:string;text:string}[];
  requirements: {id:string;text:string;required:boolean}[];
  criteria: RoleCriterion[];
};
type FrameworkVersion = {
  id:string; frameworkId:string; sourceType:'sfia'|'internal'; name:string; version:number;
  criteria:Criterion[]; levels:Level[]; status:'draft'|'published'; contentHash:string;
};
type ScoringConfig = {
  version:number; method:'weighted_mean'; weightMode:'fraction'|'percentage'|'relative';
  inputWeights:Partial<Record<SourceType,number>>;
  ratingScales:{id:string;label:string;min:number;max:number}[];
  normalization:({sourceVersionId:string;criterionId:string} & (
    {method:'level_map';levelScores:Record<string,number>;ratingScaleId?:never} |
    {method:'rating_scale';ratingScaleId:string;levelScores?:never}
  ))[];
  thresholds:{id:string;label:string;minInclusive:number;maxExclusive?:number;maxInclusive?:number}[];
  missingPolicy:'block_unless_authorised_exception';
  exceptionPolicy:'retain_as_unscored'|'exclude_and_renormalize';
};
type RankingConfig = {
  enabled:boolean;scope:'role'|'department'|'organization';direction:'asc'|'desc';
  tieRule:'competition'|'dense';decimalPlaces:number;measure:'overallScore';
};
type CycleDraft = {
  name:string; period:{start:string;end:string}; selectedInputTypes:SourceType[];
  frameworkVersionIds:string[];strategyVersionIds:string[];roleVersionIds:string[];
  scoringConfig:ScoringConfig;rankingConfig:RankingConfig;
};
type Assignment = {participantId:string;roleVersionId:string;assessorIds:string[];appraisalId?:string|null};
type Finding = {
  criterionId:string;status:'not_started'|'assessed'|'insufficient_evidence';
  observedLevelId?:string;rating?:number;rationale:string;evidenceIds:string[];reviewedSuggestionIds:string[];
};
type Feedback = {
  id:string;section:'overall'|'competency'|'goal'|'custom'|'recommendation';
  criterionId?:string|null;goalId?:string|null;text:string;submitted:boolean;
  author?:Actor;submittedAt?:string; // server writes attribution, not client
};
```

Role version response adds `{id,roleId,versionId,version,revision,status,contentHash,createdAt,updatedAt}` to RoleDraft. `id` identifies role aggregate; `versionId` identifies pinned content. Framework IDs above identify the version and distinguish frameworkId. Do not substitute role name/job title for version ID.

Assessment detail: `{id,revision,status,cycleId,cycleVersion,appraisalId,participant:{userId,name,departmentId,teamIds},assessors:Actor[],definitionSnapshot:{role,selectedInputTypes,frameworks,strategies,criteria,scoringConfig,rankingConfig,definitionHash},items:Finding[],managerFeedback:Feedback[],allowedActions:string[],createdAt,updatedAt,result?:ResultDTO}`. Status enum is `draft|in_progress|finalised|published|reopened`; readiness is computed, not an approval state. Frozen criteria have `id` unique within assessment; persist their source IDs and native expected-level descriptors.

ResultDTO: `{id,number,status:'current'|'superseded',definitionHash,scoreHash,score:{overallScore:number|null,sourceScores,criterionScores,coverage,formula,exclusions},suggestedOutcome:{id,label}|null,finalClassification:{id,label,reason,finalisedBy:Actor,finalisedAt},exceptions:[],ranking:null|{rank,tieRule,precision,scope,cohortTimestamp,compatibilityKey},reportHash}`. Never accept score totals/finalizer from browser.

ReportDTO extends ResultDTO with `{assessmentId,participant,role,selectedSources,findings,evidenceReferences,managerFeedback,oralFindings,dates,visibilityScope,reportVersion}`. The same permission-filtered frozen DTO drives UI and PDF. Real media URLs and raw internal objects are not report fields. Final snapshot includes submitted existing manager overall/competency/goal feedback and custom answers; managerReview.overallManagerRating and goal managerComments must not be lost.

## Endpoint freeze

Pair A: `GET/POST /roles`, `GET/PATCH /roles/:id`, `POST /roles/:id/versions`, `POST /roles/:id/versions/:versionId/publish`, `POST /roles/:id/archive`; `POST /imports`, `GET /imports/:id`, `POST /imports/:id/confirm`; `GET/POST /frameworks`, `GET/PATCH /frameworks/:id`, `POST /frameworks/:id/versions`, `POST /frameworks/:id/versions/:versionId/publish`; `GET/POST /strategies`, `POST /strategies/:id/versions`; `GET/POST /cycles`, `GET/PATCH /cycles/:id`, `POST /cycles/:id/validate`.

SA review additions: `PATCH /roles/:id/versions/:versionId` accepts RoleDraft content only for a draft version with If-Match. `PATCH /frameworks/:id/versions/:versionId` accepts source-native criteria/levels only for a draft version with If-Match. Role/framework aggregate PATCH changes head metadata only and never published contents. `GET /imports/:id/source` provides a reauthorised, clean-scan-only original download with Content-Disposition attachment and nosniff. GET import detail exposes bounded escaped extracted source text/spans for the in-app review panel; no raw active document iframe is required. Original download is optional to preview, never a public storage URL.

Configuration publication additions: `POST /cycles/:id/publish` validates references, source mappings, scoring and role readiness then freezes that cycle revision (If-Match and Idempotency-Key required). `PATCH /strategies/:id/versions/:versionId` edits draft contents with If-Match; `POST /strategies/:id/versions/:versionId/publish` freezes a valid strategy version. New strategy POST creates draft only. These configuration publishing actions are distinct from assessment finalisation and are not a second review/approval step for participant results.

Scanner freeze: Pair A owns `services/competency/fileSafetyService.js` exposing `inspectAndScan({buffer,originalName,mimeType,purpose}) -> {status:'clean',sha256,mimeType,size,scanner:{provider,version,scannedAt}}`. Signature/type/size/ZIP/parser validation is a separate stage and must not be called malware scanning. Production scanner transport is configurable ClamAV INSTREAM using `COMPETENCY_CLAMAV_HOST`/`COMPETENCY_CLAMAV_PORT` on the private network; socket timeout and max10MiB stream limit are enforced. Missing/unavailable scanner returns503 `SCAN_UNAVAILABLE`, rejected/malicious content422 `UNSAFE_FILE`, with no extraction/AI/preview until clean. Raw bytes are held only in bounded request memory until clean (or a private quarantined temporary object with automatic cleanup if asynchronous); never public. Test injection uses a named scanner adapter and is explicitly mocked evidence. Local/live upload acceptance requires an actual configured scanner, clean synthetic PDF/DOCX/TXT and a safe antivirus test fixture, with deployment proof. Add a private ClamAV service to the existing compose deployment only after checking host resources; no new public port or secret. Manual role creation remains usable during scanner outage and is tested independently. No existing antivirus service is assumed.

Pair B: `POST /assessments/launch` body `{cycleId,cycleRevision,assignments:Assignment[]}`; `GET /assessments`, `GET/PATCH /assessments/:id` body `{items?:Finding[],managerFeedback?:Feedback[]}`; `POST /assessments/:id/evidence`, `GET/DELETE /assessments/:id/evidence/:evidenceId`; `GET/POST /assessments/:id/oral-sessions`, `PATCH /assessments/:id/oral-sessions/:sessionId`; `POST /assessments/:id/ai-suggestions`, `PATCH /assessments/:id/ai-suggestions/:suggestionId`; `POST /assessments/:id/calculate`, `/completion-check`, `/finalise`, `/reopen`; `GET /assessments/:id/report`; `POST /assessments/:id/exports`, `GET /exports/:id`, `GET /cycles/:id/report`.

Coordinator: `GET /bootstrap`, `GET /appraisal-links/:appraisalId`, `POST /appraisal-links`, `GET /audit`. Bootstrap contains scoped people/library summaries and allowed capability booleans; sensitive full evidence/results never bundled. Route order must put static paths before parameter paths; index delegates `/cycles/:id/report` to B without hiding A's `/cycles/:id`.

## Permission and integration freeze

Canonical IdP permissions: `competency.role.manage`, `competency.framework.manage`, `competency.cycle.manage`, `competency.assessment.launch`, `competency.assessment.view`, `competency.assessment.edit`, `competency.assessment.finalise`, `competency.assessment.reopen`, `competency.assessment.exception`, `competency.evidence.view`, `competency.evidence.create`, `competency.evidence.delete`, `competency.report.view`, `competency.report.export`, `competency.report.cohort`, `competency.audit.view`, `competency.ai.use`, `competency.retention.manage`. Scope is own/assigned/team/organization according to central grants and current resource relationship. No HR-only fallback can stand in for separated grants. Coordinator builds test principals with edit-but-no-finalise and view-but-no-export to prove separation.

**Catalog expansion hazard:** current IdP member grants use `allExcept`. Add every privileged competency action to `MEMBER_RESTRICTED_PERMISSION_EXCLUSIONS` in the same catalog change, otherwise merely registering the action could grant staff organization powers. Manager/team-lead privileges must be explicitly scoped in manager grants, not inherited from a new unrestricted member action. Test default staff/recruiter/interviewer deny before testing custom allow. Bootstrap capability is the intersection of current claims and current directory/resource scope, not a role-label-only switch. HR/owner grant defaults still need separate custom-action denial/revocation tests.

Appraisal hook uses existing successful launch result IDs then idempotently links matching participant/cycle/role assessment. Expose pending failed bridge and safe retry; do not claim atomic success without backing transaction/reconciliation proof. Role selector appears in current setup; linked evaluation and result appear in current detail/report, alongside a dedicated competency library/workspace. No duplicate identity, recruitment job creation, or replacement of current appraisal lifecycle. Current dirty lifecycle files require explicit owning-workstream integration before modification.

Scoring normalization supports fraction sum1, percent sum100 or positive relative total. Native framework levels require explicit mapping. Golden `(80×3+60×1)/4=75`. Decimal inputs<=6 places, final calculation half-up12 places, display half-up2, threshold evaluates stored calculation. Rank tie precision explicitly configurable0–6. Required missing evidence blocks unless authorized reasoned exception; default retain-as-unscored gives no comparable total. Human outcome remains separate from proposed; no second approval queue or employment action. Strict compatibility hash includes role expectations, source/conversion/weights/measure versions; shared range alone is insufficient.

Readiness clarification (PM review): direct rating scales require unique IDs, finite min/max with max>min, at most6 decimal places, and every rating/expected evaluationTarget must lie inside its referenced scale. A criterion uses exactly one declared normalization method, never both its native level and numeric rating as independent scored measures. Rating normalization is `(rating-min)/(max-min)*100`; level normalization reads the exact configured levelScores. Include ratingScales in frozen definitions and compatibility hashes. Missing or incompatible scale references block configuration/launch.

Strategy-only golden example: source `strategy`, criterion `delivery`, scale `{id:"percentage",label:"Completion percentage",min:0,max:100}`, role expected target `{scaleId:"percentage",value:90}`, observed finding `rating:80`, normalization `{sourceVersionId:"strategy-v1",criterionId:"delivery",method:"rating_scale",ratingScaleId:"percentage"}`, relative source/criterion weights1. Result80/100; gap to role target=-10 percentage points; no SFIA/internal mapping required. With thresholds Development needed[0,75) and Suitable[75,100], proposed outcome Suitable; human may choose Development needed with a recorded reason. Boundary fixtures rating0→score0, rating75→Suitable, rating100→score100; rating-1/101, unknown scale, min=max, NaN/Infinity all invalid. Scale describes the measure, not an automatic performance judgement.

Publication clarification (PM review): `/assessments/:id/finalise` atomically persists the immutable result and sets the new assessment state to `published`; the permission-restricted report is available immediately to permitted viewers. There is no second publish endpoint, approval task or broader report-access grant. `finalised` can be read as a compatible historical/internal transition but must not leave new users in an unfinishable intermediate state. A failed finalise persists neither a published marker nor a success receipt. Reopen preserves the previously published immutable result, creates the next editable revision, and clearly labels the prior report as historical.

Manager-feedback freeze clarification (PM-R4): finalise captures the submitted manager payload from the linked appraisal into the immutable result, including goal comments, overall rating, actual recorded reviewer and submittedAt. Store a canonical source-content hash/submission reference. If that appraisal's configured reviewer step is enabled but not submitted, completion-check blocks finalise and links the assessor to the existing review form; do not freeze draft feedback as final. If the step is explicitly disabled, the report states `Reviewer step not configured`, not an invented empty submission. Later authorised reviewer amendments/submissions never mutate an earlier result; the current report UI shows a source-changed notice and offers authorised reopen/re-finalise to publish a new revision. Keep old report/PDF hashes stable. Existing appraisal final outcome with an enabled linked competency assessment must check that its published assessment matches the current submitted reviewer source hash; report assembly must not silently mix old frozen role findings with newer unreviewed feedback. Legacy missing author/submission provenance is `Not recorded`, never guessed from the current line manager. Test early finalise, enabled-but-missing feedback, disabled reviewer, changed submission and stable historical export separately.

New AI activity `performance.competency.analysis` must exist in gateway allowlist and data-sharing consent. Requester account from server OIDC identity, never tenant owner's login; no Standard fallback. Before implementation of live capture, retention notices/policy must be configured; manual/no-AI assessment always remains usable. Provider tests require actual returned artifacts, not mock status.

## Definition of ready/done

Ready: PM clauses + architecture + reviewed UX; exact shared type tests authored; both lanes acknowledge freeze. Done per story: independent paired review, allowed/denied action tests with tenantB, persistence tests, draft/version/retry tests, browser/accessibility and PDF checks where relevant. Done release: QA manifest all25 stories, exact-path staging, main/CI/deploy/current image/OIDC/authenticated UI proof, separately evidenced provider paths. Unimplemented/blocked items remain explicit; a screenshot or a router name is not acceptance.

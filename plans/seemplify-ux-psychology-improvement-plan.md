# Seemplify Trust-Centred UX Improvement Plan

**Status:** Proposed  
**Prepared:** 25 July 2026  
**Initial scope:** Marketing, Identity Provider, Recruiter, public candidate application, AI Interview, candidate transition portal, and subscription surfaces  
**Source reviewed:** [The UX Psychology Behind Apps People Can't Stop Using](https://www.youtube.com/watch?v=2TlIg3VokY8) and its [companion transcript](https://sozai.app/transcript/ux-psychology-behind-addictive-apps/)

## Executive summary

The source video explains six useful behaviour-design principles:

1. Smart defaults reduce decision fatigue.
2. Endowed progress makes an already-started journey feel easier to finish.
3. Reciprocity means delivering useful value before asking for effort or data.
4. The IKEA and endowment effects increase commitment when people help create something.
5. Loss aversion makes real consequences more salient.
6. Contrast and anchoring change how choices are understood.

Seemplify should use these principles to make valuable work easier, clearer, and safer—not to maximise time in the product or create compulsive use. The target is faster time-to-value, better completion, better-quality data, and more trust.

The highest-value opportunities are:

- Replace fragmented tours and equal-weight dashboard actions with a durable, role-aware “next best action”.
- Turn job creation into a shorter, autosaved workflow with organisation defaults, templates, and a truthful preview.
- Make the public application flow resumable, transparent, and private while showing real CV processing progress.
- Give candidates useful job/process information and a correctable CV-derived profile before asking for more effort.
- Add a real device rehearsal and practice step before a live AI interview.
- Unify inconsistent billing surfaces and explain plans using transparent, relevant comparisons.
- Add product analytics and controlled experiments separately from security audits, AI audits, and operational logs.

Before experimenting, Seemplify should fix correctness and trust issues in the current candidate journey: application eligibility differs between CTAs, name/email appear in a success URL, “drag and drop” is not actually implemented, CV queue state is not recoverable after leaving the page, and a candidate record can be created before final application confirmation.

## Product standard

Every change in this plan must pass these tests:

- **Truthful:** Progress, deadlines, availability, savings, and consequences come from real persisted data.
- **User-serving:** Optimise successful task completion, accuracy, and confidence—not clicks, screen time, or habit formation.
- **Reversible:** People can edit, dismiss, undo, export, or delete where appropriate.
- **Accessible:** Keyboard, screen-reader, contrast, reduced-motion, mobile, low-bandwidth, and accommodation paths are first-class.
- **Private by design:** Product telemetry never contains CV text, interview answers, names, emails, phone numbers, or sensitive form values.
- **Fair:** Candidate-facing experiments never change hiring scores, selection thresholds, or access to an opportunity.
- **Explainable:** AI-derived data shows its source, can be corrected, and is never silently submitted.

Seemplify must not introduce fake progress, fake urgency, fabricated applicant counts, coercive loss wording, decoy pricing, hidden fees, preselected marketing consent, or misleading “unlock” claims.

## Current Seemplify baseline

### Strong foundations to retain

- Job creation already supplies defaults for employment type, level, experience, education, openings, and organisation currency in `recruiter/frontend/app/jobs/new/page.tsx`.
- CV parsing already extracts structured data and prefills candidate fields.
- Candidate transition forms autosave, and the candidate portal has progress and a primary next action.
- AI Interview already presents timing, question progress, and interview rules.
- Recruiter profile completion and IDP profile completion already calculate real persisted completion.
- Marketing attribution already connects anonymous visits, campaigns, CTAs, signup, and demo activity.
- Recruiter activity auditing already supports organisation/person drill-down.
- Platform feature flags already provide global operational kill switches.

### Important gaps

| Journey | Current evidence | User or business cost |
|---|---|---|
| Signup and organisation setup | Recruiter signup redirects into IDP, then organisation setup can redirect again and ask the user to return or refresh. `/organization/check` adds timed delays and a looping five-stage animation unrelated to backend state. | Handoffs obscure progress, while simulated progress undermines trust. |
| Recruiter dashboard | Six equally prominent quick actions compete for attention. A separate static tutorial and multiple tour systems offer overlapping guidance. | New users must decide what to do before they understand the product. Guidance is not reliably durable across devices. |
| Job creation | A large four-tab form exposes many decisions at once despite some useful defaults. | Slow first-job creation and avoidable abandonment or low-quality drafts. |
| Public application | CV parsing blocks the UI in a polling loop and tells the candidate to keep the page open. Draft/status data is not durably resumed by the browser. | A durable backend job still feels fragile to the candidate. |
| Candidate privacy | The success route places candidate name and email in query parameters. | PII can leak into history, logs, referrers, screenshots, and analytics. |
| Application availability | The hero CTA checks the application cap, while a sticky CTA can remain active; deadline presentation does not consistently disable application. | Candidates see contradictory availability and may hit preventable errors. |
| CV review | A candidate record may be created after parsing but before the person confirms and submits the application. | Premature records, ambiguous consent, and possible duplicates. |
| Candidate value | Job facts are spread across a long page; review-time copy is hardcoded; “secure your spot” overstates the result of applying. | Lower trust and harder opportunity comparison. |
| AI Interview setup | “Detect” is not a real microphone/speaker rehearsal, and accommodation or appeal paths are not sufficiently visible before proctoring consequences. | Preventable technical failure and accessibility risk. |
| Candidate portal | Dashboard progress and packet progress use different denominators; the canonical candidate profile is read-only. | Confusing progress and repeated data entry. |
| Pipeline movement | Moving a candidate can immediately trigger an email, but the board does not disclose the message, recipient, or side effect before the move. | Recruiters can send unintended communications with no review or undo window. |
| Candidate list | The UI changes sort state, but the request does not send sorting and no client sort is applied. | A control appears to work while results remain unchanged. |
| Bulk CV upload | Copy promises up to 10,000 files “in parallel”, while real dispatch is capacity-bounded and batch state disappears on reload. | Misleading throughput expectations and poor recovery. |
| Recruiter AI Interview setup | The five-step wizard starts with 13 voice choices, labels the choice “AI Model”, and delays job/context selection. | High decision load before the recruiter has supplied the information that should drive a recommendation. |
| Subscription | A hardcoded billing page and a separate API-backed subscription page can show inconsistent facts. | Pricing distrust and maintenance risk. |
| Analytics | Request audit, AI audit, CV audit, and marketing attribution exist, but there is no dedicated product-event or experiment system. | Seemplify cannot reliably measure UI abandonment, exposure, or causal improvement. |

## Outcomes and metrics

### North-star metric

**Weekly active hiring organisations:** organisations that complete at least one meaningful hiring workflow action during a rolling seven-day period, such as reviewing/advancing a candidate, scheduling an interview, or submitting interview feedback.

This is preferable to logins, clicks, or time in app because it represents actual customer value.

### Primary journey metrics

- New organisation activation: organisation ready to first successful candidate review or advancement within seven days.
- Median time from signup to organisation ready.
- Median time from organisation ready to first published job.
- Median time from first job to first successful CV processing.
- Public job detail-to-application-start and application completion rates.
- Median candidate application time and resumable-draft recovery rate.
- AI Interview device-check pass, interview start, and interview completion rates.
- Candidate transition packet completion and time-to-completion.
- Trial-to-activated-organisation and activated-to-paid conversion.

### Guardrails

- Frontend/API error rate.
- CV failure rate, queue wait, retry rate, and duplicate candidate rate.
- AI malformed-output rate, latency, token cost, and provider availability.
- Candidate correction, deletion, withdrawal, and support-contact rates.
- Interview technical failure and proctoring appeal/reversal rates.
- Accessibility task completion and keyboard/screen-reader defects.
- No material degradation by role, organisation size, device class, bandwidth class, or declared accessibility preference.
- Trust or customer-effort score must not decline.

Numeric targets should be set only after two to four weeks of clean baseline data. Each experiment should declare a minimum practical effect and non-inferiority thresholds for its guardrails before launch.

## Principle-to-product map

| Principle | Where to apply it | Seemplify implementation | Success signal | Ethical boundary |
|---|---|---|---|---|
| Smart defaults | Organisation setup, dashboard, job creation, candidate application, AI Interview | Derive currency, location, department, role template, and next action from persisted organisation/user state; prefill CV-derived fields with provenance; choose detected devices while allowing manual change. | Faster completion with equal or better accuracy. | Never infer protected traits, consent, or hiring decisions. Never auto-publish or auto-submit. |
| Endowed progress | Signup-to-first-value, application, interview setup, candidate transition | Count only completed persisted milestones such as account created, role selected, CV processed, details reviewed, or required documents completed. | More return/resume completion and less step abandonment. | No arbitrary starting percentage and no progress for work the user has not done. |
| Reciprocity | Marketing, job detail, CV review, interview preparation | Show an interactive sample workflow, transparent job/process information, a correctable parsed profile, private application receipt, and an unrecorded practice question before asking for more data or commitment. | Higher qualified conversion and trust with fewer support contacts. | Useful value must not be conditional on marketing consent. Do not create pseudo-precise candidate “match” scores. |
| IKEA/endowment | Job drafting, candidate profile, transition forms | Let recruiters shape a reusable job template; let candidates approve and improve a reusable profile; preserve autosaved work and make ownership clear. | Higher draft-resume and reuse rates; shorter repeat workflows. | Investment must not be used to pressure publication or submission. Provide reset, export, and delete controls. |
| Ethical loss framing | Deadlines, unsaved work, queue/runtime outages, plan limits | State real closing dates, explain what will be lost when discarding an unsaved draft, and show factual effects of a plan/queue state. | Fewer avoidable errors and abandoned drafts. | No fake scarcity, threatening employment copy, or manufactured urgency. |
| Contrast/anchoring | Job facts, interview stages, pricing, next action | Standardise “At a glance” information, distinguish setup/practice/live interview states, show one primary next action, and compare plans using total cost and real limits. | Faster, better-informed choices with fewer reversals. | No decoy plans, hidden totals, or visually suppressing a valid option. |

## Delivery roadmap

### Phase 0 — Measurement contract and baseline

**Goal:** Make product improvement measurable without contaminating operational audit records.

1. Publish an allowlisted product-event catalog and privacy contract.
2. Add idempotent client event ingestion and authoritative server-side business facts.
3. Add durable role-aware activation state.
4. Add sticky experiment assignment and exposure recording.
5. Build an administrator Product Insights view.
6. Instrument current flows without changing their UI.
7. Validate event totals against MongoDB business records and existing audit ledgers.
8. Collect a clean baseline before evaluating treatments.

Proposed backend files:

- `recruiter/backend/config/productEventCatalog.js`
- `recruiter/backend/models/ProductEvent.js`
- `recruiter/backend/models/ProductActivationProgress.js`
- `recruiter/backend/models/ProductExperiment.js`
- `recruiter/backend/models/ProductExperimentAssignment.js`
- `recruiter/backend/services/productAnalyticsService.js`
- `recruiter/backend/services/productExperimentService.js`
- `recruiter/backend/routes/productEvents.js`
- `recruiter/backend/routes/adminProductAnalytics.js`

Proposed frontend files:

- `recruiter/frontend/services/productAnalytics.ts`
- `recruiter/frontend/context/ProductAnalyticsContext.tsx`
- `recruiter/frontend/components/onboarding/ActivationChecklist.tsx`
- `recruiter/frontend/app/admin/product-analytics/page.tsx`

Keep these systems separate:

- `UserActivityEvent`: security and operational request audit.
- `AIAuditEvent`, `AIUsageEvent`, and `CVProcessingAudit`: AI/queue operations and cost.
- `OnboardingAuditEvent`: regulated workflow history.
- `MarketingVisit`: acquisition attribution.
- `ProductEvent`: behaviour and journey measurement.

### Phase 1 — Trust and correctness fixes

**Goal:** Remove known friction and privacy problems before attempting behavioural optimisation.

Public application:

- Use one server-derived `applicationAvailability` response for the hero CTA, sticky CTA, deadline state, capacity state, and API submission check.
- Remove candidate PII from success-page URLs. Navigate with an opaque application receipt token or server session.
- Do not create the canonical candidate/application record until the candidate confirms submission. If an intermediate entity is required, name and model it as an expiring draft.
- Persist the opaque CV `jobId`, status token, application draft, and consent version so the application can resume after reload or on another device.
- Replace the blocking polling loop with event-driven or backoff-based background status updates and a durable status page.
- Implement real drag/drop handlers or remove the claim.
- Replace “secure your spot” with factual copy explaining that submission does not guarantee progression.
- Replace the hardcoded 3–5 business-day promise with organisation-configured response policy or neutral copy.

Signup and organisation setup:

- Remove artificial delays and timer-driven progress from `recruiter/frontend/app/organization/check/page.tsx`.
- Consolidate `/signup/success`, `/organization/check`, legacy `/organization/setup` redirects, and candidate-service fallbacks into one callback-safe organisation journey.
- Credit only verified account and persisted organisation milestones.
- Return the user to the correct recruiter route without requiring a manual refresh or unnecessary re-login.
- Remove stale “Smart HR” copy from the tutorial, Settings Getting Started, and organisation setup modal.

Recruiter workflow integrity:

- Fix candidate sorting so the selected key/direction is sent to and honoured by the backend, with an accessible active-sort indicator.
- Add a review sheet before a pipeline move: destination stage, resulting status, exact email/template, recipient, and an explicit send control.
- Delay outbound stage-change communication through an outbox long enough to support Undo.
- Audit the pipeline progression service’s previous-stage context before relying on it in email copy.
- Replace the “10,000 in parallel” bulk-upload claim with factual queued/capacity language.
- Persist and restore bulk batch IDs and recent batch history.

AI Interview:

- Add a visible accommodation/help route before live interview start.
- Separate connectivity or device failure from suspicious behaviour.
- Provide a clear review/appeal path for automated proctoring termination.

Subscription:

- Retire or refactor the hardcoded billing page so every price, renewal date, limit, and credit amount comes from the same plan/subscription APIs.

Acceptance criteria:

- No name/email appears in application URL, browser history, referrer, or analytics payload.
- Every public Apply control agrees with the server and submission endpoint.
- Reloading after CV upload resumes the same draft and job without duplicate candidate or credit creation.
- No candidate is persisted as submitted before explicit confirmation.
- A candidate can leave the page while local CV inference is queued or processing and return safely.
- All user-facing deadlines and review-time statements are backed by configuration or real data.
- Organisation progress changes only when a corresponding persisted state changes.
- Candidate sorting changes the returned order and survives paging.
- No pipeline move sends an undisclosed message; the recruiter can review it and use Undo during the outbox window.
- Bulk upload history survives navigation and reload, and capacity copy matches runtime behaviour.

### Phase 2 — Recruiter activation and dashboard

**Goal:** Take each role to the next valuable outcome with fewer decisions.

Replace the current equal-weight quick-action layout for new users with:

- One prominent, server-derived next action.
- A compact activation checklist with real completed milestones.
- Secondary actions available but visually quieter.
- “Remind me later” and dismiss controls.
- Contextual help at the point of action instead of long compulsory tours.

Suggested role journeys:

- **Owner/admin:** organisation ready → invite team → create first job → review first candidate.
- **Recruiter:** create first job → process first CV → review candidate → advance candidate.
- **Hiring manager/interviewer:** review assigned candidate → submit feedback.

The checklist must:

- Derive completion from real domain facts where possible.
- Persist across browsers/devices.
- Handle role and organisation changes.
- Never force irrelevant milestones on a user.
- Use browser storage only as a cache.
- Replace duplicated tutorial state in `recruiter/frontend/context/TutorialContext.tsx`, Reactour state in Jobs/Candidates, and static Getting Started content with one coherent system.

Primary surfaces:

- `recruiter/frontend/app/dashboard/page.tsx`
- `recruiter/frontend/components/ui/metro-quick-actions.tsx`
- `recruiter/frontend/app/signup/success/page.tsx`
- `recruiter/frontend/app/organization/check/page.tsx`
- `recruiter/frontend/app/organization/setup/page.tsx`
- `recruiter/frontend/app/tutorial/page.tsx`
- `recruiter/frontend/app/settings/page.tsx`
- `recruiter/frontend/context/TutorialContext.tsx`
- `recruiter/frontend/components/tutorial/TutorialWizard.tsx`

Do not treat personal profile completion as product activation. Update unsupported copy such as “unlock premium features” unless a real entitlement depends on those fields.

### Phase 3 — Faster, higher-quality job creation

**Goal:** Let a new recruiter publish a good first job without facing every possible setting at once.

Changes:

- Keep existing defaults but label organisation-derived values and make them easy to change.
- Use organisation currency, office/remote policy, common departments, brand, hiring stages, and response policy as defaults.
- Add “start from template”, “clone a role”, and a small role-family template library.
- Make only the minimum information required for a useful public job mandatory initially.
- Reveal advanced requirements, benefits, screening, and automation progressively.
- Autosave a server-side draft and show “Saved just now”.
- Show a real public-job preview next to or immediately after the core fields.
- Offer AI drafting as an explicit assistant: show proposed text, sources/inputs, and accept/edit controls; never auto-publish.
- Provide inclusive-language and missing-information checks as correctable suggestions, not blockers.
- Render the existing tab-completion state as truthful progress instead of leaving `completedTabs` unused.
- Support an explicit Save draft action; do not hardcode every newly created job to active.

Primary surface:

- `recruiter/frontend/app/jobs/new/page.tsx`

Truthful progress example:

1. Basics saved.
2. Description reviewed.
3. Application process configured.
4. Preview ready.
5. Published.

The UI may credit a completed step only after its data is valid and persisted.

### Phase 4 — Candidate application and CV value exchange

**Goal:** Make applying feel safe, useful, and resumable while preserving durable local CV inference.

Before asking for CV or PII, add a consistent “At a glance” block:

- Compensation, currency, and period.
- Location and remote/hybrid policy.
- Employment type and seniority.
- Essential versus desirable criteria.
- Application deadline and availability.
- Hiring stages and interview format.
- Organisation-configured response policy.
- Concise AI/data-use and retention summary.

After CV processing:

- Show a structured, editable preview with “From your CV” provenance.
- Allow candidates to correct fields before final submission.
- Do not expose internal confidence as a misleading ranking.
- Show real states: queued, waiting for ChatGPT gateway, processing, ready to review, submitted, or actionable failure.
- Provide a private receipt/status link backed by an opaque token.
- Allow “save and continue later”.
- Let a signed-in candidate reuse the approved profile on a later application.
- Provide clear reset, export, and delete controls.

Truthful application progress:

1. Role selected.
2. CV processed.
3. Details reviewed.
4. Application submitted.

Primary surfaces:

- `recruiter/frontend/app/public/jobs/[jobId]/page.tsx`
- `recruiter/frontend/components/ui/public-job-application-form.tsx`
- `recruiter/frontend/app/public/jobs/application-success/page.tsx`
- `recruiter/frontend/app/candidates/new/page.tsx`
- `recruiter/frontend/app/bulk-upload/page.tsx`
- `recruiter/frontend/services/candidateService.ts`
- `recruiter/candidates/app/profile/page.tsx`

This phase must build on the durable CV queue. Every CV, including a single upload, should create a durable job; UI presentation may be brief when capacity is free, but the queue/audit record must still exist.

For authenticated recruiters, add a persistent CV Activity Center:

- Replace inconsistent candidate-entry CTAs with one “Add candidates” menu: Upload one, Bulk upload, or Manual entry.
- Single and bulk upload jobs appear immediately with real queue state.
- Recruiters may navigate away and later resume review.
- Batch history and the latest single jobs survive reload.
- Queue position, runtime-offline waiting, processing, retry, completion, and actionable failure are distinguishable.
- ETA is shown only as a range when enough observed throughput data makes it credible.
- Before bulk start, show candidate/duplicate estimates, credit forecast, configured capacity, and that work will be queued rather than all run simultaneously.

### Phase 5 — AI Interview readiness and confidence

**Goal:** Reduce technical failure and uncertainty before the live interview begins.

Create three unambiguous states:

- **Setup:** permissions, input/output selection, network check, accessibility needs.
- **Practice:** record and play back an unscored sample response; explain what the system does and does not assess.
- **Live interview:** explicit start confirmation, recording/proctoring notice, question progress, and recovery/support rules.

Changes:

- Replace “Detect” with a real microphone capture and speaker playback test.
- Show the selected STT, TTS, and LLM service only where operationally useful to administrators; candidates need a plain-language data-use explanation.
- Save setup completion separately from live-question progress.
- Add a practice question that is never scored, retained as an interview answer, or shown to the employer.
- Explain focus-loss, connectivity, retry, and appeal behaviour before consent.
- Support keyboard-only operation, captions where relevant, reduced motion, and an accommodation contact path.

Improve the recruiter-side interview wizard as well:

- Start with the job and interview context, not a long voice list.
- Label the selection “Interview voice”, not “AI Model”.
- Choose one clearly labelled, editable recommended voice and place the remaining options under “Change voice”.
- Recommend job-shortlisted recipients without silently selecting them.
- Show total and per-candidate credit cost before the final send action.
- Autosave the setup as a draft/template.

Primary surface:

- `recruiter/frontend/app/public/ai-interview/[token]/page.tsx`
- `recruiter/frontend/app/ai-interviews/page.tsx`
- `recruiter/backend/config/aiInterviewVoiceOptions.js`

### Phase 6 — Pipeline clarity and reversible action

**Goal:** Make the fastest path through daily recruiting work also the safest.

Changes:

- Add a default “Needs action” view for overdue candidates, interviews due, and missing feedback before the full pipeline board.
- Let recruiters save personal or team views.
- Preview all stage-transition effects before committing.
- Queue candidate communications through a visible outbox with Undo, delivery state, and audit link.
- Make stage, status, and communication changes idempotent and recoverable.
- Retain the full board for expert use rather than replacing it.

Primary surfaces:

- `recruiter/frontend/components/ui/improved-pipeline-board-fixed.tsx`
- `recruiter/backend/services/pipelineProgressionService.js`
- `recruiter/frontend/app/candidates/page.tsx`

### Phase 7 — Candidate transition portal

**Goal:** Give candidates one trusted record of what they have completed and what is next.

Changes:

- Calculate dashboard and packet progress from one backend workflow denominator.
- Separate candidate-required, employer-required, optional, waiting, and completed states.
- Make the candidate profile editable and reusable, with explicit field provenance.
- Continue autosave and show exact save/recovery status.
- Present one primary next action.
- Allow export and deletion subject to legal retention rules.
- Do not penalise a candidate’s visible completion score for steps controlled by the employer.

Primary surfaces:

- `recruiter/candidates/app/dashboard/page.tsx`
- `recruiter/candidates/app/onboarding/[id]/page.tsx`
- `recruiter/candidates/app/profile/page.tsx`
- `recruiter/candidates/app/forms/[id]/page.tsx`

### Phase 8 — Marketing, demo, and pricing

**Goal:** Demonstrate value before asking for a lead or payment decision.

Marketing:

- Add a sample-data “Hiring workflow health check” or guided interactive recruiter preview.
- Return a useful result before asking the visitor to save/email it or book a demo.
- Never request a real candidate CV for an anonymous marketing demo.
- Keep “Book demo” available without forcing the interactive path.
- Connect the anonymous marketing visitor to signup using the existing attribution flow.

Primary surfaces:

- `marketing-site/app/page.tsx`
- `marketing-site/components/BookDemoModal.tsx`
- `marketing-site/lib/marketingAttribution.ts`
- `Identityprovider/src/models/MarketingVisit.js`

Pricing:

- Use one API-backed source for plan cards, current subscription, usage, renewal, and credit economics.
- State monthly and annual totals, what is included, overage/credit behaviour, and cancellation effects.
- Use role-relevant comparison rows instead of artificial “best value” anchors.
- Show factual current usage against a limit.
- Translate remaining credits into an explicitly estimated workload runway based on the organisation’s observed CV/interview mix, list queued work that could be affected, and show the exact reset date.
- Avoid crossed-out prices unless there is a real, time-bounded, auditable previous price.
- Use “Change plan” when both upgrades and downgrades are possible; do not label every non-current choice “Upgrade”.

Primary surfaces:

- `recruiter/frontend/app/settings/billing/page.tsx`
- `recruiter/frontend/app/settings/subscription/page.tsx`
- `recruiter/frontend/components/plan-comparison.tsx`

### Phase 9 — Cross-suite pattern rollout

**Goal:** Reuse proven patterns across Seemplify without imposing one journey on every module.

After recruiter experiments show a clear benefit:

- Extract a shared activation milestone contract.
- Reuse the next-action/checklist pattern for Leave, Time & Attendance, Payroll, LMS, Performance, and IDP onboarding.
- Give each module role-specific, server-derived milestones.
- Keep domain audits and permissions independent.
- Share presentation components only after the interaction and accessibility contract is stable.
- Do not copy a winning recruiter variant into another module without re-baselining its task and users.

## Data and interface design

### `ProductEvent`

Suggested allowlisted envelope:

```json
{
  "eventId": "uuid",
  "eventName": "cv_upload_completed",
  "schemaVersion": 1,
  "occurredAt": "ISO-8601",
  "source": "recruiter-web",
  "kind": "interaction_or_business_fact",
  "sessionId": "opaque-session-id",
  "organizationId": "derived-server-side",
  "actorType": "recruiter",
  "actorId": "derived-or-opaque",
  "route": "/bulk-upload",
  "objectType": "cv_processing_job",
  "objectId": "opaque-id",
  "journey": {
    "key": "recruiter_activation",
    "version": 1,
    "step": "first_cv"
  },
  "experiment": {
    "key": "activation_checklist_v1",
    "variant": "treatment",
    "assignmentId": "opaque-id"
  },
  "outcome": {
    "status": "success",
    "durationMs": 1200,
    "errorCode": null
  },
  "properties": {
    "uploadMode": "single"
  }
}
```

Rules:

- Client records views, starts, dismissals, corrections, and clicks.
- Server records job creation, CV queue/completion, submission, advancement, interview scheduling, and feedback as authoritative business facts.
- Accept small batches of at most 25–50 events.
- Use `eventId` as a unique idempotency key.
- Validate every event and property against a versioned catalog.
- Derive authenticated actor and organisation server-side.
- Prohibit arbitrary free-text metadata.
- Never include CV contents, filenames, job descriptions, interview answers/transcripts, names, emails, phone numbers, signatures, or protected characteristics.
- Raw product events: retain for 180 days initially.
- Experiment assignments/results: experiment lifetime plus 90 days.
- Long-term reporting: aggregated, non-PII rollups.
- Keep security IP/user-agent retention separate.

### `ProductActivationProgress`

Key by:

- User.
- Organisation.
- Role.
- Journey key.
- Journey version.

Persist:

- Milestone state and its source of truth.
- First-started and first-completed timestamps.
- Current recommended step.
- Dismiss/snooze state.
- Last viewed step.

Prefer derived state from domain records. A stored milestone is a cache or explicit user preference, not an alternative source of truth.

### `ProductExperiment` and assignment

Definitions should include:

- Key, owner, status, hypothesis, audience, and exclusion criteria.
- Randomisation unit.
- Variants and weights.
- Primary metric and guardrails.
- Minimum practical effect.
- Start/end dates.
- Stable salt and assignment version.
- Kill switch and result summary.

Rules:

- Randomise collaborative recruiter workflows at organisation level so colleagues see the same experience.
- Persist sticky assignments.
- Record exposure only when the changed experience is actually rendered.
- Evaluate variants server-side when behaviour or permissions change.
- Test staff and test organisations first.
- Platform feature flags remain operational kill switches, not experiment assignment.

### Public application draft

Add an expiring `ApplicationDraft` or equivalent with:

- Opaque draft token.
- Job and organisation references.
- CV processing job reference.
- Status-token hash.
- Consent and privacy-notice version.
- Sanitised structured extracted fields.
- Candidate corrections.
- State and timestamps.
- Idempotency key.
- Expiry and deletion state.

The draft becomes a submitted application only after explicit confirmation in a single idempotent transaction.

### Single application availability contract

The public job API should return:

```json
{
  "canApply": true,
  "state": "open",
  "reasonCode": null,
  "closesAt": "ISO-8601-or-null",
  "remainingCapacity": null,
  "serverTime": "ISO-8601"
}
```

The UI must not independently reconstruct deadline or capacity eligibility.

## Initial event catalog

### Acquisition

- `marketing_page_viewed`
- `marketing_cta_clicked`
- `value_preview_started`
- `value_preview_completed`
- `demo_form_opened`
- `demo_submitted`
- `signup_started`
- `signup_completed`

### Recruiter activation

- `activation_checklist_viewed`
- `activation_step_started`
- `activation_step_completed`
- `activation_step_dismissed`
- `organization_ready`
- `team_invitation_sent`
- `job_creation_started`
- `job_draft_saved`
- `job_created`
- `job_published`
- `candidate_reviewed`
- `candidate_advanced`
- `pipeline_move_reviewed`
- `pipeline_move_committed`
- `pipeline_move_undone`
- `candidate_communication_queued`
- `candidate_communication_sent`

### Candidate application and CV

- `job_viewed`
- `apply_opened`
- `cv_upload_started`
- `cv_upload_queued`
- `cv_queue_state_seen`
- `cv_parse_completed`
- `parsed_field_corrected`
- `application_draft_saved`
- `application_draft_resumed`
- `application_submitted`
- `application_withdrawn`

### AI Interview

- `interview_invite_opened`
- `device_check_started`
- `device_check_passed`
- `practice_started`
- `practice_completed`
- `interview_started`
- `answer_confirmed`
- `interview_completed`
- `interview_support_requested`

### Candidate transition

- `portal_account_created`
- `transition_step_viewed`
- `transition_form_draft_saved`
- `transition_step_completed`
- `transition_packet_completed`

Every catalog entry must define owner, purpose, allowed producers, allowed properties, retention, and whether it is an interaction or authoritative business fact.

## Experiment backlog

Experiments begin only after Phase 0 and relevant Phase 1 fixes.

| Priority | Experiment | Hypothesis | Randomisation | Primary metric | Guardrails |
|---|---|---|---|---|---|
| 1 | Role-aware next action and activation checklist vs current dashboard | Reducing initial choices and crediting real completed setup will increase first valuable action. | Organisation | Seven-day activation | Error rate, dismissals, support, no slower expert workflows |
| 2 | Autosaved template-first job creation vs current form | Defaults, templates, and progressive disclosure will reduce time-to-publish without lowering job completeness. | Organisation | First-job publish rate/time | Required-field accuracy, edits after publish, withdrawal rate |
| 3 | Resumable CV-review application vs current modal | Durable recovery plus a correctable preview will improve completion and data accuracy. | Candidate session/job | Application completion | Corrections, duplicate records, queue failure, privacy incidents |
| 4 | At-a-glance job/process block vs current long-form placement | Giving decision-critical value before CV upload will increase qualified starts and reduce mistaken applications. | Public job/session | Detail-to-qualified-apply conversion | Withdrawal, support, accessibility, no hidden requirements |
| 5 | Real device rehearsal and practice vs information-only setup | Experiencing a safe practice response will reduce live technical failures and increase completion. | Invitation | Live interview completion | Time to start, accessibility, support, no practice retention |
| 6 | Value-first marketing preview vs immediate lead form | Useful sample output before the form will increase qualified demo/signup conversion. | Anonymous visitor | Qualified signup/demo | Privacy, bounce, lead quality, unsubscribe |
| 7 | Transparent contextual plan comparison vs card-only comparison | Relevant usage/cost contrast will improve confident plan choice. | Organisation | Activated-to-paid conversion | Refunds, downgrade/cancel, support, comprehension |
| 8 | Needs-action worklist vs board-first default | A focused action queue will reduce overdue workflow age without slowing expert recruiters. | Organisation | Median age of actionable items | Mis-sends, Undo rate, missed candidates, expert task time |

Decision rules:

1. Pre-register hypothesis, primary metric, guardrails, minimum effect, sample estimate, and stop date.
2. Run one major experiment per funnel stage at a time.
3. Record assignment and actual exposure separately.
4. Do not call a winner based on clicks if task completion or trust declines.
5. Roll back immediately for privacy, fairness, accessibility, or material reliability regression.
6. Publish the result and remove the losing implementation after a decision.

## Administrator Product Insights

Add a distinct product-insights page instead of overloading the operational Activity page.

It should show:

- Acquisition-to-activation funnel.
- Time-to-value by cohort.
- Journey abandonment by step.
- Return/resume completion.
- Experiment exposure, conversion, lift, sample health, and guardrails.
- Organisation, role, and device-class segments.
- CV queue wait/failure as an activation dependency.
- AI latency, reliability, usage, and cost as operational guardrails.
- Event quality: unknown schema, invalid, late, duplicate, and dropped events.

Named operational investigation should continue in existing audit pages. Product Insights should default to aggregates and pseudonymous drill-down; access requires an explicit analytics permission.

The current 60-second activity refresh is adequate for historical audit browsing but not live operations. AI and CV operational views should use server-sent events, WebSocket, or short bounded polling with a visible “live/paused/stale” state. Product experiment reporting does not need sub-second updates.

## UI and content direction

- Use the established Seemplify design system with restrained hierarchy, not decorative dashboard clutter.
- One obvious primary action per journey state.
- Use compact text, inline help, and progressive disclosure instead of large instructional panels.
- Do not rely on colour alone for status or selection.
- Show explicit enabled/disabled labels on switches and operational controls.
- Preserve dense expert workflows after activation; do not force experienced recruiters through beginner steps.
- Show why a field was prefilled and where a recommendation came from.
- Use plain factual language for queues, deadlines, plan limits, AI use, and proctoring.
- Apply the repository’s `uncodixfy` frontend conventions when implementation begins.

## Verification strategy

### Unit and contract tests

- Event catalog validation and prohibited-property rejection.
- Event idempotency and batch size.
- Server-derived actor/organisation.
- Stable experiment assignment and versioning.
- Exposure recorded only after render.
- Activation milestones derived from real records.
- Application availability time/capacity edge cases.
- Draft-to-application idempotency.
- Status-token isolation and expiry.
- Progress denominator consistency.
- No PII in URLs, logs, analytics, or referrers.

### Integration tests

- Marketing visitor → signup → organisation attribution.
- Signup → organisation ready → first-job activation.
- Job template/default → autosave → preview → publish.
- Single and bulk CV uploads both create durable jobs.
- Hosted ChatGPT offline waiting → resume → correctable preview → submit.
- Reload/cross-device application draft recovery.
- Candidate withdrawal/delete/export.
- AI Interview device check → practice → live → recoverable device failure.
- Candidate transition completion from one workflow state.
- Subscription facts consistent across all surfaces.

### Browser and accessibility tests

- Desktop, mobile, slow network, reload, back/forward, and expired token.
- Keyboard-only and screen-reader journey.
- Focus visibility, semantic status announcements, contrast, and reduced motion.
- Apply CTA consistency in hero and sticky layouts.
- No practice response retained or exposed to the employer.
- Experiment assignment remains stable across navigation and teammate sessions where organisation-randomised.

### Analytics validation

- Compare server business-fact totals to MongoDB source records.
- Confirm no duplicates during retry/reload.
- Confirm dropped/invalid events are visible.
- Verify raw payloads against the prohibited-data test corpus.
- Confirm opt-out/deletion and retention expiry.
- Run experiments first on staff/test organisations, then 5%, then the planned sample.

Likely existing verification commands to retain:

```powershell
npm --prefix recruiter/backend run test:admin-activity
npm --prefix recruiter/backend run test:admin-activity-integration
npm --prefix recruiter/backend run test:platform-features
pnpm --dir recruiter/frontend test:admin-activity
pnpm --dir recruiter/frontend test:platform-features
pnpm --dir recruiter/frontend build
npm --prefix marketing-site run build
```

Add focused suites for product analytics, activation state, experiments, application drafts, public availability, candidate privacy, and the AI Interview preflight.

## Rollout sequence

1. **Instrumentation only:** approve schemas and collect a baseline without UX changes.
2. **Correctness release:** ship Phase 1 behind operational flags; no A/B test is needed for privacy and correctness fixes.
3. **Internal validation:** enable activation and journey changes for staff/test organisations.
4. **Health ramp:** 5% of eligible organisations/sessions with live error and guardrail monitoring.
5. **Controlled evaluation:** run the pre-registered allocation to its decision point.
6. **Decision:** ship, revise, or remove; record rationale and result.
7. **Pattern extraction:** only after a stable win, create reusable components/contracts for other Seemplify modules.

Every release needs:

- Named owner.
- Feature kill switch.
- Rollback steps.
- Event/schema version.
- Accessibility acceptance.
- Privacy review.
- Support and operational runbook.

## Recommended implementation order

1. Fix public-application privacy, availability, draft recovery, and candidate-creation timing.
2. Remove false organisation progress, stale redirects, non-working sorting, misleading bulk copy, and mock billing facts.
3. Make pipeline communications reviewable, delayed, reversible, and auditable.
4. Add the separate product-event contract and baseline instrumentation.
5. Add durable role-aware activation state and one dashboard next action.
6. Simplify and autosave first-job creation.
7. Add a persistent CV Activity Center, value-first job facts, and correctable CV review.
8. Simplify recruiter interview setup and add candidate device rehearsal, practice, accommodation, and appeal handling.
9. Unify candidate transition progress and editable profile reuse.
10. Unify plan/subscription facts and test transparent comparison.
11. Add value-first marketing preview.
12. Roll proven patterns into the broader Seemplify suite.

## Definition of done

The programme is complete when:

- Seemplify can measure the full marketing → signup → organisation → job → CV → candidate review → interview funnel without storing PII in product events.
- New users see a role-relevant next action backed by real persisted progress.
- Job creation is resumable and uses transparent defaults/templates.
- Every CV application is durable, resumable, correctable, and private.
- AI Interview includes a real, unscored technical rehearsal and clear support/accommodation path.
- Candidate transition progress has one source of truth.
- Every pricing fact has one API-backed source.
- Experiments have sticky assignment, actual exposure, declared metrics, guardrails, rollback, and documented results.
- No released behaviour relies on fake urgency, fake progress, deceptive contrast, or pressure generated from sunk effort.

## Open decisions

- Which event/aggregate storage should serve Product Insights at expected volume: MongoDB initially or a dedicated analytics store?
- What is the legally approved retention period for anonymous candidate drafts and raw product events?
- Which organisation settings should define hiring stages and response-time policy?
- Should a reusable candidate profile span organisations, or remain isolated per employer until candidate-controlled identity/consent is designed?
- Which roles receive each activation journey, and who can dismiss it for an organisation?
- Which accessibility/accommodation escalation team owns AI Interview exceptions?
- What baseline volume is available for candidate-side experiments without extending tests for impractical periods?

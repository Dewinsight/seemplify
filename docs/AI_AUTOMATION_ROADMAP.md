# Seemplify AI and Automation Roadmap

## Runtime contract

Seemplify supports two deliberately separate inference runtimes:

1. **Local Inference** uses the engine and model currently selected in the independent Control Center. The product never pins Claude, Codex, Ollama, or vLLM itself.
2. **ChatGPT Connect** uses an explicitly connected ChatGPT account through the signed gateway. It is not an OpenAI API-key fallback and it must not silently fall back to another provider.

Platform policy is consistent across products:

- One enabled runtime: every request uses it automatically.
- Both enabled: the administrator chooses the default and each user may override it.
- No enabled runtime: rejected by administration APIs.
- A ChatGPT choice without a connected, consented subject fails clearly; it never sends the task to local inference without the user's knowledge.
- Provider choice, activity, organization, actor, latency, outcome, and token counts are metered. Prompt and HR document content are not telemetry.

The connected-ChatGPT/Codex gateway is a shared Seemplify platform service for Identity Provider, Leave Management, Payroll, Performance Management, Recruiter, and Time & Attendance. It owns its sessions, execution receipts, scheduling, and sanitized telemetry independently of every consumer application. Experience Management is deliberately excluded until its later migration is designed and implemented.

## Delivery status

### Implemented foundation

- Independent local gateway and Control Center-owned model selection, concurrency, queue history, and telemetry.
- Recruiter runtime policy for local-only, ChatGPT-only, and both-enabled modes.
- Recruiter per-user runtime preference and administrator default.
- Performance Management signed-gateway adapter replacing direct Azure/OpenAI calls.
- Performance policy and preference endpoints.
- Performance activity telemetry categories for OKRs, reviews, appraisals, meetings, calibration, and development.
- Durable signed metering identities and strict no-silent-fallback behavior.
- Platform-owned connected-ChatGPT gateway consumer registry and telemetry ledger, with no Recruiter availability dependency.

### Required deployment configuration

- Both backends need `LOCAL_LLM_BASE_URL` and `LOCAL_LLM_SHARED_SECRET` for local inference.
- ChatGPT requires `CHATGPT_GATEWAY_BASE_URL` and `CHATGPT_GATEWAY_SHARED_SECRET`.
- Performance enables runtimes with `PERFORMANCE_AI_LOCAL_ENABLED`, `PERFORMANCE_AI_CHATGPT_ENABLED`, and `PERFORMANCE_AI_DEFAULT_RUNTIME` until its persisted administrator setting is saved.
- The gateway's `CODEX_SUBJECT_SOURCE_APPS` must include `recruiter,performance-management` before Performance ChatGPT connections are accepted.

## IDP: identity, people, and structure

### Near term

- **Organization data-quality assistant:** find members with missing departments, orphaned teams, conflicting line managers, duplicate employee IDs, inactive managers, or branch/location mismatches. Present a review queue; never mutate identity data without confirmation.
- **Role and access review:** explain why a person has each application role, highlight unusual privilege combinations, and produce quarterly attestation lists for owners.
- **Onboarding workflow builder:** turn a plain-language onboarding policy into a draft checklist with owners, due dates, branch-specific steps, and application access. Require an admin to publish it.
- **People search:** natural-language queries over authorized metadata, such as “engineering contractors in Lagos without a line manager.” Enforce the same department/team/member scope as the normal UI.
- **SSO launch health:** detect repeated launch failures and expired authorization requests, then offer a safe retry, sign-in, or return-to-IDP route.

### Later machine learning

- Predict onboarding delays from incomplete tasks, without using protected characteristics.
- Recommend likely department/team placement from role and reporting metadata as a suggestion only.
- Detect abnormal access changes and impossible organization-graph states.

### Measures

- Time to resolve missing hierarchy data, access-review completion, onboarding completion time, false-positive rate, and percentage of recommendations explicitly accepted.

## Leave Management

### Near term

- **Policy assistant:** answer entitlement and carry-over questions using the employee's branch, contract type, tenure, and approved policy version. Show the cited rule and calculation.
- **Request impact summary:** show the approver overlapping absences, remaining coverage, critical roles, holidays, and pending requests.
- **Approval brief:** summarize the request and relevant facts, but leave approve/decline decisions to the manager.
- **Reminder automation:** configurable reminders for pending approval, upcoming leave, handover completion, and return-to-work actions.
- **Natural-language reporting:** generate saved, permission-scoped reports such as monthly absence by department and branch.

### Later machine learning

- Forecast team capacity and expected leave demand by week.
- Detect balance/calculation anomalies and repeated leave-pattern outliers for review; do not label fraud.
- Recommend low-impact alternative dates when a requested period creates a coverage gap.

### Guardrails and measures

- No automated rejection, health inference, or protected-characteristic scoring.
- Measure approval time, uncovered shifts, calculation corrections, reminder effectiveness, and recommendation acceptance.

## Performance Management

### Near term

- **Cycle setup copilot:** convert dates, populations, rating scales, stages, reminders, and calibration rules into a reviewable cycle draft.
- **Goal alignment:** draft measurable OKRs, map them to team/company objectives, identify duplicate or conflicting goals, and show weak metrics.
- **Employee reflection coach:** ask evidence-seeking questions, summarize achievements and challenges, and keep the employee in control of the submitted wording.
- **Manager review coach:** summarize evidence, highlight missing examples, compare manager/self ratings, and suggest constructive questions—not final ratings.
- **Bias and language review:** flag vague, personality-based, recency-heavy, or potentially biased wording with an explanation and optional rewrite.
- **Calibration brief:** aggregate authorized evidence, rating distributions, and disagreements while hiding identity where the calibration design permits.
- **Development planning:** turn agreed growth areas into draft actions, milestones, learning options, and check-in dates.

### Later machine learning

- Cycle completion-risk prediction and reminder timing.
- Rating-distribution anomaly detection by team and cycle.
- Goal-progress forecasting from explicitly connected work evidence.
- Skill-gap clustering using approved competency taxonomies.

### Guardrails and measures

- Never generate an undisclosed final rating or use protected characteristics.
- Store the provider, prompt-template version, input evidence references, and acceptance/edit history.
- Measure cycle setup time, completion, edit distance from AI drafts, manager/employee usefulness ratings, and bias-flag precision.

## Payroll

### Near term

- **Pre-run validator:** detect missing bank/tax fields, duplicate payments, impossible dates, negative net pay, contract end-date violations, and unapproved time or leave dependencies.
- **Variance explanation:** compare the current run with prior periods and explain changes by joiners, leavers, contract hours, overtime, bonuses, deductions, and corrections.
- **Contract-worker preparation:** validate rate type, approved units/hours, service period, purchase-order cap, tax treatment, and contract expiry before including a worker.
- **Reconciliation assistant:** match payroll totals to accounting/export totals and produce an exception list.
- **Report builder:** permission-scoped monthly payroll, department/branch cost, statutory deduction, contract workforce, and variance exports.
- **Close checklist automation:** route exceptions to owners and block finalization until required approvals are recorded.

### Later machine learning

- Anomaly detection per earning/deduction category using the employee's own history and peer group only where legally appropriate.
- Cash-requirement and workforce-cost forecasting.
- Timesheet-to-payroll mismatch prediction for contract and hourly staff.

### Guardrails and measures

- No autonomous payout, bank change, employee classification, or tax decision.
- Every generated adjustment remains a draft with actor, evidence, and approval history.
- Measure pre-run exceptions found, correction time, post-run corrections, reconciliation time, and false positives.

## Time and Attendance

### Near term

- **Rule engine:** explicit clock-in, approved auto-clock rules, breaks, grace periods, overnight shifts, overtime, rounding, branch/location, remote-work, and missed-clock handling.
- **IDP clock widget:** use the Time & Attendance API as the single source of truth for clock-in, break, resume, clock-out, elapsed time, and current state.
- **Real-time synchronization:** publish attendance-state events so the IDP and attendance app update immediately. Use WebSockets or server-sent events; retain REST reconciliation after reconnect.
- **Reminder automation:** in-product and email reminders for missed clock-in/out, break limits, approaching overtime, unsubmitted timesheets, and manager approvals.
- **Exception inbox:** group missing punches, overlapping sessions, excessive duration, schedule variance, and location-rule issues with bulk-safe resolution tools.
- **Reporting:** lateness, overtime, absence, utilization, exception aging, branch/department/team comparison, and payroll-ready approved hours.

### Later machine learning

- Forecast staffing coverage and overtime risk.
- Detect anomalous sessions using the person's schedule and history without covert productivity scoring.
- Optimize reminder timing and predict missing-punch likelihood.

### Guardrails and measures

- Logging into the IDP must not clock a person in unless an administrator has published an explicit, visible rule and local law permits it.
- Location/device signals require notice, minimization, retention limits, and role-scoped access.
- Measure missed punches, approval time, overtime accuracy, synchronization lag, and reminder effectiveness.

## Cross-product implementation sequence

### Phase 1: runtime and governance

- Finish shared connection UX for Performance ChatGPT subjects.
- Add the provider selector to Performance settings and surface active runtime on AI actions.
- Standardize activity schemas, signed transport, timeouts, cancellation, idempotency, and error pages.
- Add prompt-template versioning, evaluation fixtures, redaction, retention controls, and audit export.

### Phase 2: deterministic automation first

- Build rule engines, reminders, validation, exception queues, and reports before predictive models.
- Publish organization, leave, attendance, performance, and payroll domain events through an outbox pattern.
- Use human approval gates for identity changes, leave decisions, ratings, payroll adjustments, and finalization.

### Phase 3: copilots

- Ship one bounded assistant per domain with permission-filtered retrieval and cited source records.
- Run offline quality, schema, privacy, authorization, and adversarial tests for every prompt version.
- Release behind organization feature flags and compare completion time, corrections, and user acceptance.

### Phase 4: predictive ML

- Start with explainable forecasting and anomaly detection on minimized, organization-isolated features.
- Establish drift monitoring, false-positive review, retraining approval, and model retirement.
- Complete legal/privacy review before any model influences employment decisions.

## Definition of done for every AI feature

- Correct authorization and tenant isolation tests.
- Local and ChatGPT provider contract tests where both are supported.
- Deterministic fallback or clear error; never silent provider switching.
- Cancellation, timeout, retry, idempotency, and concurrency tests.
- Structured-output validation and repair limits.
- No prompt/document text in telemetry.
- Human review for consequential actions.
- Accessibility and light/dark UI verification.
- Product metric, quality metric, and rollback switch defined before release.

# Frozen repair packet — after PR #148 rollout

20 October 2026, source baseline `0246fbcf`. This tranche closes development/support lifecycle and 360 request/privacy gaps found during production acceptance. It is separate from D9/D10 release/replay. No passed production journey is implied by this packet. Succession maintenance gaps remain recorded separately.

## A. Development plan: editable progress and human completion

Existing `/development` already creates/activates plans, completes manual learning activities and saves check-ins. Career-goal and skill progress are display-only; there is no plan Complete control. Overall progress averages each populated category (skills, learning, career goals), so one complete activity alongside untouched goal/skill categories correctly yields 33%.

Frozen contracts:

- `GET /development-plans/:id`: employee owner, assigned plan manager or HR; exact organization. Unrelated denied 403, foreign ID absent 404.
- `PUT /development-plans/:id`: accepts `careerGoals` array; each row preserves existing identity/definition and updates progress 0–100. Preserve every untouched row/field. Do not invent a progress-only endpoint or overwrite unrelated plan sections.
- `PUT /development-plans/:id/skills/:skillIndex`: `{progress,currentLevel,notes}`; progress 0–100; currentLevel beginner/intermediate/advanced/expert. Same plan access. Use the saved row index and reload authoritative result.
- `POST /development-plans/:id/complete`: assigned manager/HR only, manager middleware plus exact plan ownership. Server marks status completed. Completion is a human decision; do not automatically complete at 100%, force progress to 100%, or alter appraisal ratings.
- Learning-owned activities remain read-only; manual activity completion continues through existing activity endpoint. Check-in percentage is a log entry, not a replacement for category progress.

UI: View Details → career goal **Update progress** and skill **Update skill** dialogs with current values → save → authoritative refresh; failed save retains draft and offers retry. Manager/HR sees **Complete plan** with confirmation; employee cannot complete. Completed outcome and actual calculated progress remain distinct. No new post-completion backend locking policy is introduced by this minimal UI tranche.

Acceptance: real API + browser employee saves goal/skill progress, learning activity reaches 1/1, calculated aggregate updates/reloads; manager completes and both roles reopen same completed record. Employee completion and unrelated/foreign reads/writes denied by server. Inject one failed save in browser only, retain values, retry once and confirm no sibling field loss. Explicit denied grants hide controls and preserve server denial. No AI or LMS dependency needed for manual case.

## B. Support plan: milestone and outcome

Retain existing draft → HR/change request → employee acknowledgement flow and current refreshed-record handoffs.

- `PATCH /support-plans/:id/milestones/:milestoneId`: employee supplies `{employeeUpdate,status}`; authorized manager supplies `{managerResponse,status}`. Status upcoming/due/completed/missed; server records actor-specific comment, update time and audit. Same-org employee/manager/HR scope remains authoritative. Missing milestone 404, unauthorized 403.
- `POST /support-plans/:id/outcome`: `{decision,reason,nextReviewDate?}` from active/review_due/extended; decision completed/extended/escalated/cancelled, nonempty reason. Requires `support_plan:manage:direct_reports` and actual plan management. Formal-plan escalation/cancellation is HR-only; employee cannot decide outcome. Invalid state 409; validation 400; denial 403. Server records outcome/actor/time/audit, stops prior actions and emits scoped notification.
- Existing `/check-ins` supports active/review_due/extended. Show the existing progress form for all three states. Preserve reason/date and actual state; do not turn extension into completion or an employment decision.

UI: Open plan → milestone **Update milestone** with role-appropriate comment/status → save/reload. Manager/HR **Record outcome** → allowed decision/reason/optional next date → confirmation → returned outcome/history. Formal manager cannot select HR-only outcomes; direct request remains denied. Terminal outcomes are displayed without another ordinary outcome button. Failure retains dialog inputs; Retry does not reset comments.

Acceptance: employee milestone update + manager response persist independently; extended-state check-in works; manager informal completion and HR formal outcome each have separate synthetic records. Empty reason/illegal state, employee outcome, denied grant, unrelated/foreign and formal-manager escalation negatives leave outcome/audit unchanged. Browser save failure/retry retains draft; reopen shows outcome and history. No automatic appraisal score change.

## C. Feedback/360 request and safe reporting

Current Requests UI only receives reviewer tasks. Add **Request feedback** on `/feedback` using existing `feedback:request` grant: employee requests for self, manager/head/lead for permitted reports, HR for organization. Subject and reviewer pickers use authoritative scoped IdP colleagues; exclude subject, deduplicate reviewers, await actual option selection. Do not infer wider appraisal authority from colleague discovery.

- `POST /feedback/requests`: `{subjectId,reviewerIds,dueDate,questions,contextType,contextLabel,visibility,anonymity}`. Future due date; ≥1 distinct reviewer after subject exclusion. Context general/goal/project/peer/upward/360; named/confidential/anonymous. Anonymous requires context360 and ≥5 reviewers, fixed minimum 5. All contacts validated before creation. Existing project request UI stays private+named/project.
- `GET /feedback/requests?view=reviewer|requested|subject`; reviewer-owned Accept/Decline and Give feedback continue through decision endpoint and ordinary feedback POST with requestId. Response must come from assigned reviewer to matching subject while requested/accepted, then becomes fulfilled. It inherits request audience/context/anonymity.
- **Privacy repair required before exposing reports:** raw request DTOs currently reveal reviewerInfo/reviewerId and fulfilledByFeedbackId, undoing anonymous response redaction. Anonymous non-reviewer-own creation/requested/subject results become cohort summaries: `kind:'cohort',cohortId,subjectId,subjectInfo,contextType,contextLabel,questions,dueDate,visibility,anonymity,minimumCohortSize:5,reviewerCount,reportable,responseCount:null-until-reportable,state:collecting|reportable`. No per-reviewer request IDs, identity, decision comments/state, response links or precise activity timestamps. Reviewer-own actionable rows remain private to that reviewer.
- Anonymous content remains suppressed until ≥5 nondeleted cohort responses, including HR; no deanonymization grant. Nonauthor feedback DTO omits requestId and exact response date as well as sender identity. Author may retain own correlation. Confidential subject non-HR also receives sanitized summary without identity/link/timing; no five-response requirement, only real cohortId where one exists. Existing HR confidential exception remains; named/project behavior unchanged.
- Cohort report uses existing response reads and sanitized summary, respecting private/public/manager-only visibility. Requester-manager may see progress but cannot read private content solely because they requested it. Ordinary organization feedback analytics is not a 360 cohort report. Anonymous responses cannot be attached to an individual appraisal; named/confidential 360 appraisal evidence still requires cycle setting enable360Feedback.

UI: request dialog → review exact recipients/audience → Send → **Requested by me** progress; subject **About me** safe cohort status/report; reviewer **Requests** accept/decline/respond → subject sees collecting state until threshold, then permitted Anonymous response content. Do not show per-reviewer response progress or fabricate an aggregate report from organization totals. Failure preserves request draft; prevent double submission and reconcile requested list before retry after ambiguous transport failure.

Acceptance: five synthetic reviewers, first four responses invisible/no correlation even by direct subject/HR reads; fifth unlocks permitted content, with identities/IDs/timing still redacted. Test fewer than five, subject included twice, past due, revoked colleague, denied grant, unrelated subject, foreign tenant, requester-private-content denial, author-own view, confidential subject redaction and named/project compatibility. Reviewer decisions/response and requester/subject reloads must use real API browser sessions. Keep failed proof and do not label provider email delivery passed from in-app request success.

## Handoff and release gate

Architect owns feedback DTO/privacy and contracts; design owns feedback/navigation; product/developer owns development/support pages and focused browser tests. No conflicting file edits. QA requires focused backend scope/privacy tests plus real-API browser persistence/recovery before combining the tranche. Root owns exact-scope commit, full hosted checks/scan, tested-main deployment and production replay. Keep this work uncommitted until the current PR #148 rollout is complete and the next tranche is reviewed.

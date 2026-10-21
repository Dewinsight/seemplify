# Existing Performance surface catalog

Source inspected: `52920b936d988e7252f69c993ccd32d8e52bd092` (20 October 2026). This is an inventory of implemented routes and controls, not an all-feature completion certificate. API-only means an existing backend route has no matching rendered control in the inspected frontend. It does not invent a new UI requirement or certify that transition in a browser.

| Surface | Existing UI entry points | Rendered controls | API-only / exact boundary |
|---|---|---|---|
| Identity / access | /login; workspace/organization controls in the shell | Normal IdP OIDC login, organization selection and role-scoped navigation. | No product-local password/login authority; accounts/memberships are IdP-owned. |
| Dashboard / people | /dashboard; /team; /team/[userId] | Summary cards; team/employee filters; staff detail; Start appraisal and linked actions. | GET dashboard/summary, user/context, user/direct-reports and user/:id/stats. No generic dashboard mutation feature. |
| Goals / periods | /okrs; /team/okrs; /okrs/alignment | Current/Past/Upcoming and period picker; My/organization/team/department/approvals; create/edit, submit, decision with reason, acknowledge, progress, suggest change; alignment tree expand/collapse. | API-only: PUT okrs/:id status=closed; DELETE okrs/:id cancellation; GET version/check-in/change-request history; POST change-requests/:id/decision. Period create/PUT/open/close are API-only; empty-period initialization calls generate-fiscal from existing UI. |
| Appraisal start / cycles | /appraisals/start; /admin/appraisal-cycles and its new/detail/edit routes | Scoped people/reviewer selection, period/workflow, launch; cycle create/edit/template/settings and launch controls. | Canonical appraisals/cycles/templates APIs. No assumption of additional unrendered controls. |
| Appraisal participant workflow | /appraisals/[id] and self-assessment, manager-review, goal-setting, discussion, calibration, final-review children | Manual/optional AI assessment, evidence, drafts/submissions; configured-step discussion; human calibration/final publish; employee acknowledgement. | Existing configured steps govern visible actions; dormant optional steps are not certified by a basic-cycle pass. |
| Appraisal history / removed / reports | /appraisals; /appraisals/removed; /appraisals/[id]/report | Current/history filters/search, results/CSV/print, recoverable remove/restore; readonly supporting downloads in new source. | Published report/content access remains actor-scoped. Native print output remains separate from downloaded CSV/PDF API exports. |
| Legacy reviews | /reviews; /reviews/[id]; /team/reviews; /team/appraisals | Existing bookmarks/list/detail preserve published historical view and unfinished reviewer privacy. | Legacy review/cycle DTOs remain separate from canonical appraisal endpoints. |
| Check-ins | /check-ins | Create/save/edit own draft; submit; cadence/time filters and scoped employee picker. | PATCH draft and submit APIs; submitted records are not editable through draft controls. |
| Development / learning | /development | Plan creation/detail; activation/check-ins; goal/skill progress; activity completion; Complete plan; linked LMS records/course link-to-plan and external course link. | Learning record link-plan requires an actual assigned LMS record; no in-Performance LMS enrollment/admin control is assumed. |
| Feedback / 360 | /feedback; /feedback/new; /team/feedback | Give feedback; All/Received/Sent/Requests; accept/decline/respond; acknowledge; chosen appraisal evidence; new scoped 360 request/progress. | API-only DELETE feedback/:id withdrawal. Anonymous reporting threshold is five distinct nonblank authors, not five rows. Final released five-reviewer production replay remains separate. |
| Recognition | /recognition | Give recognition with private/team/organization audience; feed/received/sent; recipient acknowledgement; directory search/retry. | DELETE recognition/:id withdrawal exists in API; no withdrawal control is rendered on this page. |
| Project feedback | /project-feedback | Add active project with scoped participants; active-project Request feedback; state badge and member list; response occurs in Feedback. | PATCH performance-projects/:id supports metadata/member/state edits including closed; current UI has no edit/close button. Closed state suppresses Request feedback. |
| One-to-ones | /one-on-ones; /one-on-ones/new; /one-on-ones/[meetingId] | Schedule integrated/manual meetings; upcoming/history filters; agenda/actions/notes; join/leave, microphone/camera; optional consent/recording controls when configured. | Native room join/state/signal/leave control-plane tested independently; control-plane receipts do not certify media. A later independent generated-audio script proves bidirectional RTP through configured TURN; browser media/video/recording remains separate. |
| Support | /support-plans | Create/edit/submit; HR approve/changes/reject reason; employee response; active check-in; new milestone progress/manager response and legal outcome/extension controls. | Formal escalation/cancellation remains HR-scoped; no automatic appraisal rating change. |
| Action centre / notifications | /action-centre; shell notification panel/preferences | Read/read-all; action filter/open/snooze/dismiss/complete; notification channel/timezone preferences. | In-app state changes are distinct from external email/chat delivery. |
| Analytics / coaching | /analytics; /coaching; /admin; /admin/departments/[department] | Analytics tabs/filters/clear/refresh/team and department drill-down; coaching employee/priority filters and Open action; admin workflow funnel and department navigation. | D22 null/zero/funnel/UTC repairs are source-tested; exact live replay is separate. No write-back of analytics scores is implemented. |
| Administrative reports | /admin/reports | Report tabs and cycle selection; Export OKRs / Export Reviews CSV. | Existing reports/export contracts only; no invented custom report builder. |
| Competency libraries / strategy | /competency; /competency/frameworks; /competency/roles; /competency/strategies; detail/new child routes | Programme enable confirmation; definition create/edit/import review/publish/new versions/archive; existing published/archived filters. | Archive is retained history; no restore endpoint/control is assumed. |
| Competency cycles / assessments | /competency/cycles and children; /competency/assessments and detail | Configure/publish/launch; participant/assessor view; findings/evidence/manual oral; drafts/submission/completion; human finalize/reopen with reason. | Oral participant visibility follows saved audience; manual oral does not require recorded call evidence. |
| Competency reports / settings | /competency/reports; /competency/reports/[assessmentId]; /competency/settings | Published participant/cohort reports, version selection, permitted PDF export and retained evidence; actual configured settings controls. | AI account/provider settings require a connected account for execution; settings reads do not certify provider generation. |
| Talent / succession | /talent | Review create/open/propose/calibrate/close; frozen evidence; new closed readonly gates. Critical-role create/deep read/candidate nominate; new confirm/remove/coverage date/criticality/state maintenance. | Explicit human decisions and audit; no automatic talent decision or employee rating mutation. |
| AI / tutorial | /ai-account; /settings/ai; /tutorial | Shared AI account connection/status/error/retry controls and guided navigation. | Connection/consent/generation are external-account workflows, not certified by disconnected synthetic accounts. |
| Storage / presence | Embedded supporting-document and competency evidence controls; automatic web presence reporter | Permitted upload/download/removal before finalization; readonly historical content; browser presence events. | Authenticated Cloudinary/private source URLs and Time presence APIs are dependencies, not independent navigation pages. |

## Remaining independently testable script branches

1. **Done in this pass:** a new employee-owned goal was closed via PUT; unrelated/foreign closure denied; subsequent edit denied. A new manager-led project was closed via PATCH; nonlead/foreign closure denied, membership-filtered lists retained the closed record, and a feedback invitation after closure was denied409. These are API positives; root can read the Closed badges in the existing UI.
2. **API-only passed:** new custom goal-period create/update/open/close and role/tenant denials; existing fiscal periods untouched.
3. **API-only passed:** new assigned-goal employee proposals, manager approve/reject, retained audit and owner/foreign denials. The current UI can suggest a change but has no proposal decision/list control.
4. **API-only passed:** new private recognition/feedback sender withdrawal and recoverable new assigned-goal cancellation; prior acceptance records preserved. Anonymous feedback withdrawal must re-evaluate distinct-author privacy thresholds.
5. **Existing UI, pending final release replay:** development completion, support milestone/outcome, succession maintenance, 360 five-author cohort/privacy and each released D15-D23 repaired path. The plan names these actual controls, rather than unbounded hypothetical edge cases.
6. **Requires genuine provider prerequisites:** assigned LMS course linking, connected AI/calendar execution, external email/chat delivery, two-browser audio/video and optional recording/transcription. Manual oral, one-party microphone and room signaling have separate positive receipts.

## Exact page-route inventory

The following files exist at the inspected revision; dynamic segments denote existing routes. Query filters and embedded controls are described above.

- `/action-centre`
- `/admin/appraisal-cycles/[id]/edit`
- `/admin/appraisal-cycles/[id]`
- `/admin/appraisal-cycles/new`
- `/admin/appraisal-cycles`
- `/admin/calibration`
- `/admin/departments/[department]`
- `/admin`
- `/admin/reports`
- `/admin/review-cycles`
- `/ai-account`
- `/analytics`
- `/appraisals/[appraisalId]/calibration`
- `/appraisals/[appraisalId]/discussion`
- `/appraisals/[appraisalId]/final-review`
- `/appraisals/[appraisalId]/goal-setting`
- `/appraisals/[appraisalId]/manager-review`
- `/appraisals/[appraisalId]`
- `/appraisals/[appraisalId]/report`
- `/appraisals/[appraisalId]/self-assessment`
- `/appraisals`
- `/appraisals/removed`
- `/appraisals/start`
- `/check-ins`
- `/coaching`
- `/competency/assessments/[assessmentId]`
- `/competency/assessments`
- `/competency/cycles/[id]`
- `/competency/cycles/new`
- `/competency/cycles`
- `/competency/frameworks/[id]`
- `/competency/frameworks/new`
- `/competency/frameworks`
- `/competency`
- `/competency/reports/[assessmentId]`
- `/competency/reports`
- `/competency/roles/[id]`
- `/competency/roles/new`
- `/competency/roles`
- `/competency/settings`
- `/competency/strategies/[id]`
- `/competency/strategies/new`
- `/competency/strategies`
- `/dashboard`
- `/development`
- `/feedback/new`
- `/feedback`
- `/login`
- `/okrs/alignment`
- `/okrs`
- `/one-on-ones/[meetingId]`
- `/one-on-ones/new`
- `/one-on-ones`
- `/`
- `/project-feedback`
- `/recognition`
- `/reviews/[id]`
- `/reviews`
- `/settings/ai`
- `/support-plans`
- `/talent`
- `/team/[userId]`
- `/team/appraisals`
- `/team/feedback`
- `/team/okrs`
- `/team`
- `/team/reviews`
- `/tutorial`

## Closed-state policy verified in API and browser

The new closed individual goal disables structural Edit; progress check-ins remain permitted for its owner during the open period, matching assertCheckInWindow accepting active/closed. Root opened then cancelled the progress dialog without saving. Do not label every goal write immutable. The new closed project is visible to its lead and participant; Request feedback remains on the active project only. API closure and browser state/action visibility are separately receipted.

## Script-only generated-audio relay receipt

Using the documented [aiortc peer and media APIs](https://aiortc.readthedocs.io/en/latest/api.html), an isolated private1.15.0 harness generated tones entirely in memory. Both genuine OIDC room participants signaled actual audio SDP through product routes with only relay candidates, connected in11.84 seconds, selected relay-to-relay nominated pairs and received34 RTP packets each, decoding29/30 frames.16/16 safe auth/HTTP checks passed; no background errors. Both peers closed/left and meeting returned Scheduled, recording off. No devices, browser media, recording/transcription or provider-setting mutation was used. Selected-pair TYPES only were collected through a version-pinned diagnostic; no IPs/SDP/provider credentials in output. Two-browser audio/video remains unverified.

Later optional AV relay script also passed: changing nonblank generated video14/15frames with simultaneous valid-sample nonzero audio21/22, both peers Connected11.64s, selected relay-to-relay pairs,42 RTP packets received each;16 safe auth/HTTP checks,0background errors, both clean leaves. No devices/browser capture/recording. Independent CUA two-browser acceptance remains open.

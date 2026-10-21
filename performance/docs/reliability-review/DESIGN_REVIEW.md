# Performance reliability and navigation — UI/UX review

**Later local verification:** the opening source-only review below is a historical checkpoint. The same reviewer subsequently implemented and personally ran the focused mobile navigation, discussion, 360 request and hierarchical check-in repairs. See [20 October navigation/360/check-in local receipt](NAV_360_CHECKIN_LOCAL_RECEIPT.md) for exact proof boundaries, 21 distinct focused browser cases, 47 targeted independent backend cases, inspected screenshots and the source-only manual-document production replay guide. These working-tree results do not replace the release owner's exact-commit hosted/live receipts.

Reviewed 20 October 2026 (Europe/London). Source: `main` at `f846ef5459dc170d1552ecd720c1aff9a7d7a92f`. Review method: source inspection, existing delivery/acceptance documents, two existing images, and primary accessibility/design guidance. **No browser interaction or test execution was performed by this reviewer.** Current browser acceptance and release evidence belong to the coordinating QA/release owner.

Final checkpoint: tested source `069a20b01f21741400484639f257dd043aea3ea0`, released main `da2e03c3c1c90c0297c7539abbc642d58a823264` (PR #147), identical application tree `833cf30e15ec1d318a09adaf0f1047fca37ea8a7`. [Hosted CI 39379560998](https://github.com/Dewinsight/seemplify/actions/runs/39379560998) passed 452 backend, 709 HTTP/zero, 151 first-attempt UI/zero flaky or skipped, 31 real-API Chrome and build; [fresh scan 39379559294](https://github.com/Dewinsight/seemplify/actions/runs/39379559294) passed. The earlier `545803da` UI run had 150 clean and one retry-pass; a dedicated worker fixed fixture module-cache isolation, then three repeats/eight combined cases and final 151 UI cases passed without retries. Five clean report-recovery cases are supporting proof, not additional distinct totals. See [final acceptance receipt](ACCEPTANCE_RECEIPT.md) and [22-group/eight-role coverage](ROLE_COVERAGE.md).

## 1. Review decision

Retain the existing Performance navigation, MUI controls, three-stage appraisal start flow, and Current / History & results separation. These address the user's actual tasks without another application redesign. Recognition, OKR navigation, appraisal reports, and calibration now contain the intended completion/recovery paths in source. Accept their interaction direction; final acceptance requires the screenshots and behavioral checks below.

Two error-state gaps were found at the reviewed base revision: Recognition hid colleague-search failure, and Calibration hid session/cycle-load failure. Follow-up source changes show separate failure/retry states, preserve drafts, block invalid creation while cycles are unavailable, and reserve empty messages for successful empty responses. Six targeted browser contracts in `frontend/e2e/reliability-recovery.spec.ts` are included in the implemented checkpoint. Their execution belongs to the coordinator's browser receipts; this reviewer has not personally run them. Source/fixture acceptance is not proof of a production incident or deployed repair.

## 2. Product cognition and scope

| Decision | Review position |
| --- | --- |
| Product / stage | Existing employee-performance product; improve reliability and task discovery. |
| Core users | Employees, scoped team leads/managers/department heads, HR managers, organization admins/owners. Authority still comes from current Identity permissions and resource scope. |
| Main objects | Goal/period, assigned appraisal/cycle, published result, recognition, calibration session/decision. |
| Main tasks | Set organizational direction, start an authorized staff appraisal, complete assigned work, find a historical outcome, recognize a colleague, review ratings. |
| Entry / first decision | Choose the correct workspace and task; distinguish personal work, staff reviews and organization administration. |
| Success | The action persists; the resulting record is visible; the person knows the next actor/action. |
| Recovery | Preserve a draft, describe the failure where the person is working, offer a relevant retry or clear next step. |
| Mobile priority | Complete one action at a time; reach Continue, Save, Send and Retry without horizontal page scrolling or hidden dialog actions. |
| Vocabulary | Start appraisal; reviewer; assessment period; response deadlines; History & results; organization goals; calibration reason. |
| Foundation | Keep the running suite shell, theme tokens, spacing and MUI interaction behavior. No new font, palette or dashboard composition. |
| Keep out of primary UI | API paths, internal IDs, raw provider errors, hashes, schema versions and deployment details. |

This is a reliability handoff, not a replacement competency-assessment programme. Optional role-linked appraisal content must remain compatible with the approved programme.

## 3. Primary research applied

| Source | Application to this review |
| --- | --- |
| [W3C APG: Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) | Check arrow-key movement, selection, a named tab list and associated panels. A tab click must reveal its content rather than immediately reset. |
| [W3C WAI: Form notifications](https://www.w3.org/WAI/tutorials/forms/notifications/) | Use clear errors beside the active task; connect field errors to fields where appropriate. A failed submission needs visible feedback. |
| [W3C APG: Modal dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) | Verify a visible title, accessible name, contained keyboard focus, close action and useful focus return. Nested calibration dialogs need particular care. |
| [W3C WCAG: Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) | Check ordinary content at 320 CSS px / equivalent zoom. Data-table scrolling can be local; the entire form/page should not require two-dimensional reading. |
| [GOV.UK: Complete multiple tasks](https://design-system.service.gov.uk/patterns/complete-multiple-tasks/) | Make tasks, order and completion explicit; simplify the process before adding more navigation. This supports the short start wizard and explicit launch receipt. |

These are interaction/accessibility references. They do not require replacing Seemplify's visual design with a government design system and do not establish WCAG conformance by themselves.

## 4. Source acceptance by journey

### 4.1 Recognition: find → choose audience → send → confirm

Source: `frontend/app/recognition/page.tsx`; search hook: `frontend/lib/hooks.ts`.

- The form sends the selected colleague's canonical `id` as `recipient.userId`. This resolves the original picker/submission shape mismatch in the interface.
- Selection defaults to **Recipient only**. The minimal colleague result intentionally contains no team/role authority. Team availability is checked on send; a rejected team audience must retain the selected person, message and audience controls so the sender can choose private visibility and retry.
- Send failure is inside the still-open dialog. Success closes the form and announces audience-aware completion. Received recognition provides an Acknowledge action.
- Organization feed / Received / Sent are scrollable tabs, including mobile scroll buttons. Long recognition text preserves line breaks.
- **Implemented; coordinator browser checkpoint recorded:** directory failure displays an in-dialog search error and Retry search. The failed query no longer displays **No colleagues found.** The draft remains in place; retry is disabled and labeled while pending. A successful empty search retains the true empty message. Final release/live results remain separate.
- **Verification needed:** keyboard selection and focus return, loading announcements, private-recipient outcome after reload, mobile dialog footer, long names/messages and both themes. Source alone does not prove these rendered states.

### 4.2 Start appraisal: people → details → confirmation → receipt

Source: `frontend/app/appraisals/page.tsx`, `frontend/app/appraisals/start/page.tsx`.

- Managers/HR have **Start appraisal** and **Reviews I'm conducting** actions. An employee denied the launch task receives a path back to My Appraisals.
- The start flow exposes staff search/refresh, availability reasons, explicit reviewer selection and the selected staff scope. Lack of an eligible reviewer points to the authoritative Identity relationships.
- Assessment period and employee/reviewer response deadlines are distinct. New reviews explain the start date and quarterly context; the normal flow does not require editing the full assessment design.
- Existing-cycle load failure has Retry and an explained one-off alternative. Staff failure has Retry. The launch receipt distinguishes started, already in progress and blocked people, rather than treating HTTP success as universal success.
- Optional occupational-role linking reuses the existing flow. A failed link explains that the ordinary appraisal exists and offers retry against that existing record.
- **Verification needed:** reviewer dropdown labeling per employee; disabled/blocked-row explanations; keyboard step progression and back navigation; date text at local boundaries; partial receipt; no accidental duplicate launch on retry. Confirm positive and negative authority through API tests, not hidden buttons alone.

### 4.3 History and result report: find → inspect → export → return

Source: `frontend/components/appraisals/AppraisalHistory.tsx`, `frontend/app/appraisals/[appraisalId]/report/page.tsx`.

- **History & results** is a peer of Current. History supplies search, year, order, CSV and print actions. It separates no historical records from no filter matches and provides Clear filters.
- Rows identify the cycle/period, reviewer, outcome and acknowledgement state; cancelled work is labeled as cancelled and opens its retained appraisal rather than inventing a published result.
- The report has Back to history, Open appraisal, CSV and Print / save PDF. Submitted reviewer feedback and provenance are explicit; absent narrative/evidence has readable text.
- Ordinary report loading and failure have an independent named spinner, Retry and return path. The linked competency check has its own pending/failure/retry state while preserving the ordinary appraisal result. Successful feature disablement stays quiet.
- **Coordinator-verified checkpoint:** five clean report-recovery cases passed separately; final hosted UI also passed without retries. The pre-existing local edit to the embedded-recovery spec remains outside this release. Record actual delayed/repeated failure and pending-state evidence rather than treating test presence as a pass.
- **Follow-up usability observation:** history filter state is local component state. Returning from a result link can reset a person's search/year/order. This is not classified as data loss; if measured navigation friction persists, preserve query state in the URL in a separate small change.
- **Verification needed:** print preview with several pages and long comments; CSV equality with the visible filtered records; employee privacy; readable text and footer/buttons at narrow widths. Existing screenshots of a standalone competency result do not establish ordinary appraisal-report recovery.

### 4.4 Calibration: create → start → record decisions → complete → export

Source: `frontend/app/admin/calibration/page.tsx`.

- HR-visible creation, session start, rating review, completion and CSV download are represented in the interface. Rating review names the staff member, displays the manager rating and asks for a reason when adjusted.
- The decision modal prevents save while working or while required information is missing. Save errors remain in the active modal. Session completion errors are visible in the details view.
- The page explains the empty state rather than showing a blank table. AI failure offers an AI settings path; it must not silently replace a human decision.
- **Implemented; coordinator browser checkpoint recorded:** session failure has Retry sessions and suppresses invented empty totals/messages, while retained records remain visible. The creation dialog exposes cycle failure with Retry cycles, retains typed session details, and blocks creation until loading recovers. A successful empty cycle response explains that no active cycles are available. Existing HR gating remains in place. Final release/live results remain separate.
- **Verification needed:** creation/outer-details dialog accessible names and nested-dialog focus; no duplicate create/start/complete submission while a request is pending; correct cycle rating bounds/help; completion rejection with unresolved decisions; long names and locally scrollable tables on mobile. The current decision number input does not visibly explain the cycle's allowed range; confirm server validation is intelligible in the modal.

### 4.5 Goals: choose workspace/period → create → see saved record → align/approve

Source: `frontend/app/okrs/page.tsx`.

- Admin organization workspace exposes **Organization Goals**; manager workspace exposes team/department work. Organization Alignment and Approvals are distinct views. Organization-wide creation remains a permission-controlled action, not something granted by renaming a tab.
- Workspace tab changes update the URL and local state. Source no longer unconditionally resets the user's chosen tab whenever goal counts change.
- A created goal selects its resulting period/band and workspace so it can be found immediately. Goal loading provides Retry and alignment has a named empty state/full-alignment path.
- **Verification needed:** tab click/keyboard/reload/back behavior; two ordinary saves in the same organization; creating in another period; manager versus HR creation options; empty alignment; progress/approval path; mobile tab access.
- **Accessibility source gap:** the period and workspace tab lists do not explicitly declare accessible names, and custom `TabPanel` does not provide the APG tab/panel linkage. MUI tab defaults alone do not establish complete labeling. Inspect the rendered accessibility tree and add the required associations as a scoped follow-up if absent.

## 5. Shared loading, error, empty, mobile and accessibility contract

| State | Acceptance condition |
| --- | --- |
| Initial loading | Name the task being loaded; do not show an authoritative zero/no-results state before a successful response. |
| Refresh | Preserve readable existing content where possible; distinguish checking again from a lost result. |
| Submit pending | A visible action label changes to Saving/Sending/Starting; avoid duplicate requests; keep relevant context. |
| Validation error | Identify the field/problem, describe correction, retain input and show the error inside the active dialog/step. |
| Service unavailable | Explain that data could not be loaded, retain useful content/drafts, offer a relevant Retry. Do not substitute no records or no permission. |
| Access denied | Clear capability-specific message and a safe return path; no leaked records, totals, selectors or drafts. |
| Empty result | Explain whether nothing exists or filters exclude it; offer Create, change period or Clear filters where authorized. |
| Success | Identify the persisted outcome and route to the record/next actor. A success toast alone is insufficient if the record is hidden by filters. |
| Keyboard | Reach every action without a pointer; visible focus; tab selection/panels and dialog focus behave coherently; errors/success are announced without rereading the whole page. |
| Mobile / zoom | Check 390 × 844 and 320 CSS px. Fields and actions remain reachable; long names/reasons wrap; the page does not scroll sideways. Tables may have their own scroll container. |
| Visual accessibility | Check light and dark actual rendering, text/control/focus contrast, status text in addition to color, and zoom. This review does not claim measured contrast results. |
| Export | Compare permitted content with the displayed report; open the downloaded file. A click or browser download event alone does not establish correct file contents. |

## 6. Exact screenshot and evidence checklist for the coordinator

Use synthetic staff and a clearly identified test organization. Keep actual staff/ratings/contact addresses private. For each screenshot record revision, environment, role, route, viewport, theme, scenario and related test/receipt. The filename suggestions below are new captures to obtain, **not existing evidence**. Store only privacy-reviewed synthetic images in tracked documentation.

| ID / suggested filename | Capture | Required visible evidence |
| --- | --- | --- |
| UX-01 `01-organization-goal-saved.png` | HR/admin, organization Goals, desktop | Selected Organization Goals, period, two independently saved goals and the current user's allowed Create action. |
| UX-02 `02-goal-alignment-tab.png` | Same organization, Organization Alignment | Selected tab and actual alignment/empty response; label the scenario so an empty response is not mistaken for a failed request. |
| UX-03 `03-recognition-private-sent.png` | Synthetic employee, Sent | Actual saved synthetic recognition and Private audience after reload. Pair with HTTP/database proof. |
| UX-04 `04-recognition-audience-recovery-mobile.png` | 390 × 844, recognition modal after rejected team sharing | Named recipient, retained draft, in-dialog error, audience selector and reachable Send/Cancel. Do not create real praise for a real colleague. |
| UX-05 `05-start-appraisal-people.png` | Manager, first start step | Scoped staff, selected person and explicit reviewer; unavailable rows show a useful reason. |
| UX-06 `06-start-appraisal-confirmation.png` | Same run, confirmation | Staff/reviewer, assessed period, response deadlines and final start action. No launch implied from this screenshot alone. |
| UX-07 `07-appraisal-launch-receipt.png` | Synthetic completed launch | Started/existing/blocked counts and direct record links. Pair with persisted IDs and negative-scope tests. |
| UX-08 `08-history-filtered-result.png` | Employee, History & results | Filled search, selected year/order, matching completed outcome, reviewer and View result report. |
| UX-09 `09-result-recovery-desktop.png` | Ordinary report with failed linked competency check | Ordinary final result/narrative remains visible; separate warning and Retry competency report are readable. |
| UX-10 `10-result-retry-mobile.png` | 390 × 844, linked check retry held pending | Retained ordinary content; Retrying state disabled, no clipped warning/action. Also check at 320 CSS px. |
| UX-11 `11-calibration-decision.png` | HR, synthetic in-progress calibration | Staff-specific review dialog, original/adjusted rating, reason, visible validation and Save decision. |
| UX-12 `12-calibration-completed.png` | Same session after persisted completion | Completed state and final decisions/export action. Open CSV and compare outcome/reason separately. |
| UX-13 `13-empty-and-outage.png` | A small paired image, same feature | Genuine successful empty state versus a simulated load failure with Retry; neither labelled production unless run there. |
| UX-14 `14-print-result-page.png` | Rendered PDF/page image, synthetic result | Readable result, reviewer feedback, dates and page breaks without navigation chrome or clipped text. |

The accepted Cloudinary story adds **UX-15: private attachment upload/download**. Capture a synthetic file saved through the appraisal UI, its authorized download after reload, and recoverable upload failure. Pair the screen with provider byte/expiry/unsigned-denial receipts; a screenshot alone cannot prove privacy. Existing Azure and separate competency evidence need compatibility checks rather than migration screenshots.

For the concise illustrated PDF, use seven numbered proof panels: **1 Organizational goals, 2 Recognition, 3 Start appraisal, 4 Historical results, 5 Report recovery, 6 Calibration, 7 Private Cloudinary attachments**. Each panel needs a screenshot or explanatory diagram, a two-line behavior description and one evidence label: Implemented/source-reviewed, Local tested, Production verified, or Pending. Combine companion images as a small before/after or task/recovery pair; do not shrink a full screen until labels are unreadable.

## 7. Existing design/evidence reuse and boundaries

- Existing approved competency handoffs: `docs/competency-assessment/design/01-roles-and-setup.md`, `02-assessor-and-reports.md`, and approval recorded in `reviews/architecture-design-readiness.md`. Their opening design-status/date text is historical; the later approval/release ledger provides subsequent context. Do not relabel the original concept as a delivered screen.
- Existing image-generated concepts: `design/concepts/role-editor-dark-concept.png` and `assessor-workspace-light-concept.png`. This reviewer visually inspected the assessor concept. It is explicitly fictional and not implemented. It is relevant to optional role-linked assessments; it is not proof of recognition, ordinary history or calibration reliability. No duplicate concept was generated.
- This reviewer also visually inspected `docs/competency-assessment/evidence/screenshots/local-authenticated-final-report.jpg`. It shows a synthetic Local Employee published competency report in the dark suite shell. It demonstrates the historical visual direction and a local published-state capture; it does not certify today's source, deployment, report contents or recovery path.
- `performance/FEATURE_ACCEPTANCE_REVIEW.md` and `APPRAISAL_FLOW_REVIEW.md` contain earlier findings and test/deployment statements. Later `REMAINING-CHANGES-RELEASE.md` and competency STATUS contain subsequent changes. Earlier text claiming a picker reveals team data or that an external service is blocked must not be copied as a current fact without rechecking.
- Existing test definitions include real-API recognition audience recovery and page access; organization-goal creation/alignment; appraisal launch, history/CSV and calibration; separate UI contracts cover report recovery and mobile workflow. This reviewer inspected test definitions but did not run them. The release owner must supply the exact-head results and authenticated live evidence.

## 8. Handoff / exit decision

The implemented journey structure and final hosted 151-UI/31-real-browser verification passed for this repair. Same-file attachment selection now resets before upload, allowing a retry of that file; stale upload errors clear on recovery. Actual targeted backend/frontend release `da2e03c3`, runtime health, 20 static assets, current retry bundle, no mock API and OIDC redirect passed. Central Performance now selects Cloudinary revision 4; other defaults/keys and existing files were unchanged. At 2026-10-20T06:42:00Z the deployed adapter passed synthetic TXT/PDF/DOCX authenticated raw uploads, signed exact-byte 200 downloads, unsigned 401, expired denial and cleanup. Existing-employee production browser smoke subsequently passed History/Current navigation, My OKRs/period switching, and recognition recipient-only modal/search. The safe synthetic search returned empty without an outage; the form closed without sending. No new 5xx appeared in the inspected console since 06:42 UTC, and no real appraisal/recognition was created. Preserve any unmeasured keyboard/tab/contrast and full-provider-call limits in the receipt. One employee's live navigation smoke does not certify all live roles or a production UI attachment write. Existing concepts retain concept labels; actual new screenshots illustrate delivered behavior.

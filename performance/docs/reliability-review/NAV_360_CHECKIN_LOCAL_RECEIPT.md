# Navigation, feedback requests and hierarchical check-ins — local receipt

20 October 2026. Reviewer: `design_review`. This receipt covers the frozen working-tree changes coordinated with the release owner; it does not describe a deployed revision. Production authentication, live role/provider acceptance, hosted CI, scans, commit and deployment remain separate release receipts.

## Delivered interactions

| Area | Behavior verified locally |
| --- | --- |
| Appraisal navigation | Reviewer/cycle/default detail progress fits 390px; Final Rating is keyboard reachable; conversational OKR cards respond to Enter and Space through the existing callbacks. |
| Tutorial | Manager/HR scoped Start appraisal, HR organization goals, manual assessment with optional AI, and History & results use the current destinations. Unsupported automatic AI scoring language removed. |
| D15 discussion action | The action follows the actual configured discussion stage instead of a fixed legacy index. Future/omitted discussion is hidden; completed discussion remains readable as View Discussion during final review. |
| 360 request creation | Effective server capability gates creation. Subject choices use self/authorized staff scope; exact distinct reviewers exclude the subject. Anonymous 360 requires five reviewers. Review step shows the actual reviewed payload. |
| Request recovery | Unknown/lost responses replay the same immutable payload and Idempotency-Key. Status-list matches do not claim operation success. Recovery conflicts and later permission denial retain the unknown operation. Search/status failures have explicit retry and retain selected people. |
| 360 privacy | Nonreviewer views render safe cohort summaries. Four responses remain unavailable, including HR; five distinct reviewers release anonymous content to permitted readers. Hidden dates and request correlations are not reconstructed by the UI. |
| Invitation response | The authorized invitation fixes recipient, context and audience. An employee can answer its manager-audience invitation while standalone manager-only sending remains forbidden. |
| D17 check-ins | Employee selector has an accessible name. Denied load is distinct from an actual empty list, with retry of the same employee/deep link. Parent-manager directory scope can read/respond to a child-team lead; private/unmanaged/foreign records remain protected. Existing draft editing is preserved. |

## Focused browser proof

All tests use synthetic identities and disposable local data. Mocked recovery tests explicitly substitute the named UI transport. Real-API cases use the actual Express application, Mongo replica set, canonical Identity role/directory builder and database persistence. They do not prove production OIDC, real mail delivery, AI providers or Cloudinary delivery.

| Suite | Final passing coverage | Execution mode |
| --- | ---: | --- |
| `e2e/appraisal-navigation-accessibility.spec.ts` | 7 | Chrome, UI transport substitutes; mobile geometry, keyboard, tutorial, custom discussion variants |
| `e2e/feedback-360-recovery.spec.ts` | 6 | Chrome, named transport failures, same-key request replay, capability denial, search/status recovery |
| `e2e/check-in-scope-recovery.spec.ts` | 1 | Chrome, named 403 then recovery for the selected child-team lead |
| Existing `phase2-continuous-performance.spec.ts`, two check-in cases | 2 | Chrome, unchanged draft edit/retry/submit and manager-cannot-edit-other-draft regressions |
| `e2e-live/appraisal-discussion-navigation.spec.ts` | 1 | Production frontend build, actual API/Mongo: required stages, employee/reviewer reading, stage/tenant denial |
| `e2e-live/feedback-360-lifecycle.spec.ts` | 2 | Production frontend build, actual API/Mongo: five-reviewer cohort and authorized manager-audience invitation |
| Existing `e2e-live/feature-actions.spec.ts`, check-in draft case | 1 | Production frontend build, actual API/Mongo: same-ID draft save/reload/edit/submit |
| `e2e-live/check-in-hierarchy.spec.ts` | 1 | Production frontend build, actual API/Mongo: parent/child response, reload/employee read, privacy/scope/owner-only submission negatives |

**21 distinct focused browser cases passed across focused runs; this is not a claim that one 21-case command ran.** The initial combined production selection passed four cases and failed the new hierarchy test's assumption that a selected employee survives reload. Its subsequent focused replay corrected that interaction, then corrected the test's foreign-status expectation to the existing `assertResourceTenant` 403 contract. Final hierarchy replay passed 1/1 in 14.2 seconds. The product was not changed to satisfy those test assumptions. An earlier dev-server replay retained a transient Next “Manifest file is empty” failure; final affected live cases passed against production builds.

Key commands (run from `performance/frontend`):

```powershell
npx playwright test --config playwright.config.ts e2e/appraisal-navigation-accessibility.spec.ts e2e/feedback-360-recovery.spec.ts
npx playwright test --config playwright.config.ts e2e/feedback-360-recovery.spec.ts e2e/check-in-scope-recovery.spec.ts
npx playwright test --config playwright.config.ts e2e/check-in-scope-recovery.spec.ts e2e/phase2-continuous-performance.spec.ts --grep 'named employee selection|employee resumes a check-in draft|manager viewing another employee check-in'
$env:PERFORMANCE_E2E_PRODUCTION='1'
npx playwright test --config playwright.live.config.ts e2e-live/appraisal-discussion-navigation.spec.ts e2e-live/feedback-360-lifecycle.spec.ts e2e-live/check-in-hierarchy.spec.ts e2e-live/feature-actions.spec.ts --grep 'custom manual appraisal|employee requests anonymous|an employee can answer|a parent manager reads|employee saves, reloads, edits'
npx playwright test --config playwright.live.config.ts e2e-live/check-in-hierarchy.spec.ts
npx tsc --noEmit
```

Actual commands also supplied private absolute `--output` directories below. Production mode runs the configured frontend build before starting Next. No custom config or weakened application authorization was introduced. All owned local servers on ports 5014/5015 were stopped at handoff.

## Independent backend and source review

- `feedbackRequestIdempotency`, `feedbackCrossViewPrivacy`, `feedbackRequestPrivacy`: **30/30**, 10.761 seconds, final distinct-author/response-claim guards.
- `checkInHierarchy`: **10/10**, 2.002 seconds, hierarchy/private/central-denial/tenant/outage and closed-slate contracts.
- `feedbackAppraisalEvidence`: **7/7**, 3.257 seconds, including confidential selection not restoring its hidden source timestamp.
- Total: **47 independent targeted backend cases** across five suites. The architect's full backend run is separate.
- TypeScript and `git diff --check`: passed; the latter emitted a nonblocking existing LF/CRLF conversion notice for the architect-owned evidence test.
- Architecture independently accepted navigation/tutorial, D15, 360 recovery/permission boundaries and D17 UI; product independently accepted final 360 UI. This reviewer accepted the matching privacy/idempotency/hierarchy backend changes and final conditional timestamp omission. The reviewer context already treats `receivedAt` as optional.

## Private artifact locations and visual review

Runtime evidence is untracked under `.local-runtime/performance-reliability-20261020/`:

| Directory | Evidence |
| --- | --- |
| `nav-360-final` | Seven navigation cases; reviewer labels and keyboard-selected Final Rating screenshots inspected at 390px |
| `360-checkin-recovery-final` | Final six 360 recovery cases plus check-in 403/retry case, 7/7 in 28.7 seconds |
| `checkin-regressions-final` | New check-in recovery plus two unchanged D4 mocked regressions, 3/3 in 16.1 seconds |
| `checkin-recovery-capture` | Clean transition-disabled 390px error/retry capture; 1/1 in 11.9 seconds; inspected |
| `final-navigation-360-checkin-production` | Production-build D15, 360 and D4 passing cases; retained first hierarchy-test failure trace |
| `checkin-hierarchy-production-verified` | Final hierarchy case 1/1, 14.2 seconds; shared response/private own note visible to child lead, screenshot inspected |
| `discussion-feedback360-real-final` | Earlier 3/3 actual-API replay; created cohort, released anonymous responses and completed discussion screenshots inspected |

Only synthetic content appears in these inspected images. Screenshots prove visible state; request/database assertions establish persistence and negative-scope results. Do not commit runtime traces, signed provider URLs, or screenshots containing real staff data.

## D10 manual document replay guide — source contract only

The existing Supporting documents panel accepts PDF, DOCX, TXT and PPTX up to 10 MB. Upload includes `assessmentMode: form`, shares with the employee/reviewer, and does not require ChatGPT. Download first checks safe metadata, then clicks an anchor with `target=_blank` to the authorized content endpoint. The endpoint rechecks actor, organization, appraisal and document visibility before redirecting. New Cloudinary documents are authenticated raw assets; the signed attachment delivery expires after five minutes. Historical providers keep their captured delivery behavior.

For production acceptance, use one small valid known fixture per format, including actual PDF and OOXML DOCX/PPTX containers rather than renamed text. Manual mode still performs ordinary text extraction while skipping optional AI analysis. Upload/reload and verify the named row plus retained assessment answers. Click Download document and inspect browser-level download completion; a parent-page download event or persistent popup is not required. Compare the saved artifact's exact bytes/SHA256 and extension with the input; provider-generated basenames are possible. Keep the appraisal tab for screenshots. Do not print popup URLs, Location headers or all-tab URL inventory, and do not capture the provider address bar. Record only synthetic filename/format, byte count, expected/download SHA256, actor and pass/fail. A click or popup by itself is not byte proof. The panel catches metadata/preflight errors; a later provider/navigation failure may appear only in the browser download surface, so the busy state clearing does not confirm delivery.

After downloading all four, remove the documents, confirm the required-evidence submit gate returns, reupload one and confirm the gate clears without losing manual answers. Production browser/provider outcomes must be added by the release owner; this receipt does not claim they were performed here.

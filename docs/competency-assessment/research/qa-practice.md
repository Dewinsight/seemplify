# QA practice for competency assessment delivery

Research owner: Product Manager B / QA input. Researched 18 October 2026. This is a tailored delivery practice, not a claim of certification or completed testing. Story contracts are in [evaluation and reporting stories](../stories/02-evaluation-reporting-stories.md).

## Primary-source research and adopted practice

| Primary source | What it contributes | Application to this work |
|---|---|---|
| [Playwright best practices](https://playwright.dev/docs/best-practices) | User-visible tests, independent contexts/data, user-facing locators and auto-retrying assertions | Verify the assessor's actual task; use labelled controls/roles, isolated synthetic tenants and explicit saved/result assertions instead of fixed sleeps or CSS-dependent click scripts. |
| [Playwright assertions](https://playwright.dev/docs/test-assertions) | Built-in retriable web assertions | Await observable outcomes such as the persisted criterion and submitted report, with separate API state assertions. |
| [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer) | DOM/network/action diagnostics and CI trace options | Retain failed traces and approved screenshots; classify retry passes as flaky until reviewed. Store trace artifacts securely because DOM/network captures may contain assessment data. |
| [OWASP ASVS](https://owasp.org/projects/asvs) | A verification framework for application security requirements | SA/QA pins the applicable current release and control identifiers before implementation; trace controls to authorization, uploads, session, data protection and logging tests. Do not claim full ASVS compliance from a partial checklist. |
| [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) | Deny-by-default, least privilege and permission checks per request | Check organisation/resource/action on every route, download, AI job and report/export; test direct requests after permission removal as well as visible controls. |
| [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) | Layered file validation, safe storage and limits | Test extension/MIME/signature mismatch, oversize/decompression/parser limits, quarantine/scanning and authenticated downloads for CV/role uploads. |
| [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) | Useful security event fields and sensitive-data exclusion | Test denial events and correlation IDs; verify no tokens, full CVs or transcript content in security logs. |
| [W3C WCAG 2.2 quick reference](https://www.w3.org/WAI/WCAG22/quickref/) | Checkable accessibility criteria and supporting guidance | Test labels, keyboard/focus order, errors, status announcements, contrast and chart alternatives; automated checks supplement manual keyboard/screen-reader review. |
| [SFIA Foundation resources](https://sfia-online.org/en/tools-and-resources) | Authoritative framework/assessment resources | Use licensed/current source definitions with version references; validate source-specific levels and evidence-based assessment. Do not invent numerical equivalence across frameworks. |

These are source materials, not executable third-party skills. No remote code or skill was installed by this research task. Role skills should encode the agreed practice, cite these sources and stay within repo/security instructions; inspect licence and scripts before adopting an open-source skill.

## QA role and independence within the worker cap

The user permits a solution architect to double as QA. The retained **SA/QA** owns acceptance design, cross-story integration and release evidence. Developers supply automated checks, but do not approve their own product outcomes alone. The retained PM validates that the result satisfies the user story; UX validates interaction/screenshots. A developer pair works one nonconflicting feature packet; a second pair works a different owned packet. A worker may hold more than one role, but counts once toward the requested maximum of six. The current environment has four actual concurrency slots: use staged queues and never promise six simultaneous processes where only four exist.

When SA/QA authored a component, obtain the other architect's review before that person is retired, or a counterpart developer's independent verification plus PM acceptance. Do not label this an independent security audit. Review and release may wait for both feature teams to reach the integration barrier; neither force-merges to avoid waiting.

## Evidence levels: do not collapse them

| Level | Required proof | What it does not prove |
|---|---|---|
| Design ready | PRD → story → architecture → UX traceability, explicit gates | Working implementation |
| Local unit/contract | Versioned rules and endpoint tests against exact source | Browser usability or external provider success |
| Local real-stack E2E | Real IdP/API/database and synthetic people in isolated orgs | Deployed revision |
| CI | Required jobs passed on recorded SHA, build and browser results | Production image or live provider |
| Deployment | Running image/revision equals tested main SHA, health/OIDC smoke | Full authenticated user journey |
| Live acceptance | Authenticated non-destructive smoke on running revision | Real call capture/transcription if not exercised |
| Provider integration | Authorised test event/media/transcript/AI source evidence | Unrelated paths, other providers or every future call |

## Test design and fixtures

Use two synthetic organisations (A and B), at least two role versions, three source types, source-specific level IDs, distinct creators/reviewers/finalisers and current directory scopes. Seed owner/admin/HR, team manager, member, assessor-only, finaliser-only, report-only and export-enabled users with explicit grants. Avoid changing real employee reviews. Fixture and test cleanup targets only the named synthetic data, not shared local databases or another agent's work.

### Mandatory source matrix

Run the full assessment lifecycle for SFIA; internal; strategy; SFIA + internal; SFIA + strategy; internal + strategy; all three. The empty set fails. Each case verifies persisted selection, criterion source/version, role expectation, evidence, finding, scoring, final human category and report/PDF. The internal-only case must run with all call/AI providers disabled and manual oral capture; this is a complete successful path, not a skipped integration test.

### Deterministic calculation oracle

Define reviewed golden fixtures before implementation: source levels → explicit mapped scores → weights → aggregate → threshold proposal → human final outcome. Example normalised scores 80 and 60, relative weights 3 and 1 yield 75. Test values below/on/above every threshold, zero/negative/NaN weights, total-zero, missing/insufficient evidence, unmapped source levels and rounding. Record raw and display precision. Web, API, PDF and ranking must use the same frozen calculation version, not reimplement the formula independently.

### Scope and action matrix

For edit/finalise/reopen/report/export/exception/media/AI actions test: permitted actor, same-org actor without action grant, same-org out-of-team actor, other tenant, removed member, stale session and reassigned assessor. Assert HTTP result, no state change or storage URL, no private response fields, and safe denial audit. Cohort queries must be filtered before aggregation; names are not the only leak—counts, rank and filter options can disclose out-of-scope participation.

### Evidence and AI matrix

Test valid CV/role/strategy files, bad signatures, disallowed formats, oversize and parser failures; label manual notes separately from transcripts. Reject foreign participant/criterion links. For AI test source manifests, non-existent citations, source revocation during queued work, prompt-injection text in evidence, accept/edit/dismiss history and unchanged ratings after acceptance. No caller should be able to nominate another user's ChatGPT account. Stub providers for repeatability, then run separately authorised real-provider acceptance with synthetic audio/documents; mark the proof level accurately.

### Complete report coverage

Seed unique sentinel text in every submitted manager field, individual competency comment, **managerReview.okrAssessment[].managerComments**, custom answer and recommendation. Verify reviewer identity/submittedAt distinct from creator/line manager; draft/private content must stay out of participant payload. Compare frozen DTO against PDF-extracted text and numeric values, then render every PDF page for clipping/overlap/table/graph inspection. Include long notes, empty optional sections, mixed sources, missing legacy fields, superseded evidence and multi-page tables. Finalised report parity is a business assertion; pretty screenshots alone cannot establish it.

## Minimal required automated coverage by layer

| Layer | Coverage | Owner |
|---|---|---|
| Unit / pure domain | Score/normalisation/conversion, thresholds, ranking ties/compatibility, completion validator | Implementing pair; SA/QA reviews golden fixtures |
| API/database integration | Tenant/resource references, grants/revocation, transactional finalise, concurrency, reopen/history, uploads/downloads and audit | Implementing pair + SA/QA |
| Gateway/provider contract | HMAC/app scope, source manifest, callback idempotency, consent/revocation/deletion, failure states | Implementing pair; no production secrets in fixtures |
| Component/interaction | Form validation, draft state, missing evidence, source references, permission read-only and keyboard controls | UI developer + UX |
| Browser real-stack | Configure role/cycle, assign, evidence/manual oral, evaluate, score, finalise/report/export; all source combinations | SA/QA |
| Accessibility/visual | Desktop/mobile/dark theme, zoom, labels/focus/errors/status, charts with data tables, print pages | UX + SA/QA |
| Release smoke | Exact source/image SHA, IdP OIDC, API health and permitted authenticated pages | Release SA/QA |

Current repository has `performance/frontend/playwright.config.ts`, real-stack appraisal flow and colleague-review browser specs, and backend test suites. Reuse patterns after inspecting their isolation/configuration; do not assume their existing green result covers this new domain. Concurrent lifecycle specs/code currently dirty are outside our owned changes.

## Release blockers and defect handling

- Block release for tenant/privacy leaks, wrong scores/classifications, lost assessment evidence, unauthorised finalise/export, corrupted immutable history, missing mandatory input combinations, unreviewed schema/migration incompatibility or unusable core manual workflow.
- Record each failure with story/AC, expected/actual, exact SHA/environment, steps/fixture, safe screenshot/trace and severity. Developer fixes; SA/QA reruns the failing case plus affected regression scope; PM rechecks changed acceptance.
- Do not silently retry away a failure. A retry pass is reported as flaky; investigate whether it is environmental timing, fixture isolation or actual product race. Do not repeatedly broaden tests after all required checks pass without new risk evidence.
- Migration/backfill must dry-run counts, preserve legacy records, be idempotent and have a reversible/deferred activation strategy. Unknown historical role/source/creator data is **Not recorded**, not guessed.
- Commit exact owned paths only. Two teams integrate after a shared reviewed contract; the SA verifies both packets and the clean staged diff before the approved push/PR merge. Admin bypass does not waive failed QA or permit secret/tenant exposure.

## Story evidence record template

```text
Story / AC: CA-___ / clause __
Status: planned | implemented-local | QA-passed | merged | deployed | live-verified
Source SHA / environment / fixture IDs:
Automated commands and result counts:
API/state assertions:
Screenshot / PDF page / trace paths:
Security/action/tenant denial evidence:
Actual provider used or stubbed:
Reviewer / accepted date:
Known limitation or blocked path:
```

## PDF completion report rule

The final implementation PDF should be short and numbered, with each delivered feature's user outcome, one real screenshot or explanatory graphic, story IDs and compact test evidence. Put full traces/commands in linked appendices. Design-generation images are labelled **concept**, current-app screenshots **baseline**, deployed screenshots **implemented**. Do not illustrate unbuilt work as shipped, use generated fake test results or turn plans into an implementation claim. Until development is complete, publish a clearly titled **delivery plan / design pack**, not a completion report.

# Competency assessment delivery plan

Status: specification/design approved; core implementation and local acceptance complete. Final staged-source release checks are in progress. Product code has not yet been released. See [STATUS.md](STATUS.md) for current verification and release evidence and [USER-GUIDE.md](USER-GUIDE.md) for the operating steps.

Owner: Seemplify delivery coordinator. Baseline reviewed: `b401f1b1583be5875cc02462122c83ec9e7311d2`, 18 October 2026. Repository: `E:/GitHub/C-drive/seemplify`.

## 1. Outcome and scope

Deliver the Leadership Competency Assessment PRD for existing employees as part of Performance. Preserve the existing appraisal journeys. Support the MoMo PSB pilot and reusable configuration for every organisation, without client-specific code.

Authoritative inputs:

- Original three-page document: `C:/Users/User/Downloads/Seemplify Competency Assessment PRD.pdf`.
- User clarification: create a role manually or upload a role description; select the role in appraisal setup; compare employee evidence against that same role in AI analysis, human feedback and the final report.
- User clarification: include complete submitted manager feedback independently of one-on-one notes, including goal comments, reviewer identity and submission dates.
- User clarification: owner/admin/HR have organisation scope; team leaders/managers have their authorised hierarchy; employees see permitted personal results. Assessment roles are separate from identity/access roles.

The programme includes role/framework libraries, source-aware cycles, participant-role assignment, criterion evidence, oral assessment, optional AI drafts, assessor workspace, scoring, classification, ranking, permissions, historical snapshots, participant/cohort reports, export, retention and acceptance testing.

No automatic employment decision is made. AI cannot finalise scores or suitability. The authorised assessor finalises directly; no mandatory second approval queue.

## 2. Current solution and change boundaries

| Reuse | Extend or add | Do not replace |
|---|---|---|
| IdP organisations, membership and team hierarchy | Assessment-specific action permissions | IdP as sole identity authority |
| Performance appraisal/cycle workflow and reviewer selection | Versioned role/framework and assessment domain | Existing appraisal lifecycle and historical records |
| Document intake, calendar/native calls, transcripts and notes | Criterion links, provenance, missing-evidence checks | Existing Nylas/native-call services |
| Personal ChatGPT gateway and human-reviewed suggestions | Role-aware, cited competency observations | Central shared AI routing/account ownership |
| Ratings, custom questions, result report and analytics | Source-aware scoring, suitability, rankings and reports | Existing employee and manager submissions |

Baseline gap, now resolved in this programme: the result builder omitted individual goal-review comments. Submitted overall, goal, competency and custom answers now retain their actual author and submission dates. A job title alone is not a versioned role assessment profile; the new role library supplies that assessment definition.

Unrelated appraisal lifecycle work is already dirty in the shared checkout. Record the baseline status before every integration; never stage/reset another task's changes. Additive competency files belong to this programme. Shared hooks, navigation, auth and app registration have one integration owner.

## 3. Team, capacity and queue operation

Requested logical roles: PM-A, PM-B; SA-A, SA-B; UX-A, UX-B (UX-C only if capacity permits); developer pairs A and B; one QA function. SA can double as QA. Retain one PM and one SA for verification after their drafting queues finish.

Actual tooling permits four concurrent agents including the coordinator, below the user's six-worker ceiling. Roles are scheduled across those slots; do not claim six agents are running or invent a third UX worker. A finished agent returns a written handoff and can take a different named role in a later turn.

| Phase | Active slots, maximum four | Work and handoff |
|---|---|---|
| Discovery | Coordinator/SA-B + PM-A + PM-B + SA-A | Two PM streams; SA-A consumes each ready story immediately; coordinator owns research, delivery architecture and QA contracts |
| Design | Coordinator/PM verifier + SA-A + UX-A + UX-B | Two UX streams consume architected stories; SA-A reviews designs and answers API questions |
| Implementation | Pair A: coordinator + developer A; pair B: developer B + developer C | Separate owned surfaces, two agents collaborate on each work package; QA/PM/SA review occurs after a pair yields slots |
| Verification | Coordinator/release SA + QA/SA + PM verifier + UX verifier | Behaviour, security, usability and traceability reviewed; fixes return to owning pair |
| Release | Coordinator/release SA + independent QA as needed | One writer performs exact-path commit, push/merge, deployment and live revision verification |

Queue states: `discovery -> story-ready -> architecture-ready -> design-ready -> building -> qa -> release-ready -> deployed -> live-verified`. Rejected work returns with a concrete defect and acceptance criterion. A story can advance while other stories remain in discovery. Work-in-progress limit: two implementation packages, one release batch.

No team waits idle for unrelated work. A faster pair can prepare tests/designs for the next ready package but cannot commit a partial release batch. Both pairs must reach the QA gate before their shared batch is integrated. Never promise there can be no conflicts: reduce them through file ownership and reconcile contract/integration conflicts before release.

## 4. Role skills

Use existing installed `ui-ux`, `frontend-design`, `imagegen`, `pdf` and `skill-creator` skills. Research open-source PM, architect and QA skills; inspect their instructions and licences before selection. Prefer small project-specific role skills over blindly executing third-party setup scripts. Each role skill defines its inputs, output contract, validation and handoff.

Role skills created for this programme are stored in `team/skills/` and copied into the user's Codex skills directory under names beginning `seemplify-competency-`. They must remain usable without hidden conversation history. Installing a skill makes it discoverable next turn; current agents receive its path and read it explicitly now.

| Role | Required output | Review responsibility |
|---|---|---|
| Product manager | User need, current-state evidence, story, GWT acceptance, exclusions, dependencies, success/error journey | Confirm implemented behaviour satisfies the original need, not just the technical design |
| Solution architect | Per-story functional/nonfunctional requirements, data/API/auth contracts, diagrams, decisions, migration and rollout | Contract compatibility, tenant boundaries, history, integration and release |
| UI/UX designer | Existing screenshots, journey map, screen/state specs, accessible interaction, generated concept and implementation handoff | Actual rendered app compared with approved screen design |
| Developer pair | Owned-file implementation, meaningful tests, handoff and known limits | Peer review within pair and contract discussion with other pair |
| QA / architect verifier | AC-based tests, negative tests, evidence, defect severity, release decision | Separate code/local/CI/deploy/live/provider proof; do not self-certify another layer |

## 5. Story and architecture handoff contract

Each story has a stable `CA-###` identifier and includes:

1. Persona, need and outcome; original PRD section and user clarification.
2. What exists today with source paths; the exact gap.
3. Positive and negative Given/When/Then acceptance criteria; permission, tenant and invalid-input cases.
4. Inputs/outputs, scope exclusions, dependencies and implementation owner.
5. UI entry, first decision, primary action, success, empty/loading/error/recovery states and mobile task.
6. Required tests and evidence; product and architecture review state.

For every story the architecture provides an explicit requirements-to-model-to-endpoint-to-permission-to-screen-to-test mapping. Shared schema version is `1`. Include C4 context/container, domain relationships, assessment lifecycle and critical sequences. Architectural decisions must explain rejected alternatives and the consequences for existing appraisals.

Primary domain direction: additive `/api/competency` namespace, versioned roles/frameworks, competency cycles and competency assessments. Link assessments to ordinary appraisals through an owned bridge; do not create a disconnected second appraisal product. Select the role during appraisal setup and display the same frozen role, observations and results inside the appraisal and its report.

## 6. Delivery packages and dependencies

| Package | Deliverable | Main dependencies | Acceptance checkpoint |
|---|---|---|---|
| P0 | Research, stories, per-story architecture, team skills, baseline screenshots | Original PRD and code audit | All requirements mapped; discrepancies explicit |
| P1A | Role library: manual/upload/review/version/archive; expectations | Shared identity and version contract | Uploaded text never silently becomes an approved role; edits preserve history |
| P1B | Framework library and strategy criteria | Source/level contract | Internal-only works; SFIA/internal levels remain distinct |
| P2A | Cycle setup: seven input combinations, scoring/threshold/ranking configuration | P1, validated common schema | Empty input set rejected; invalid weights/thresholds rejected |
| P2B | Participant and role assignment, assessor authority, appraisal bridge | P1, IdP directory | Select role at appraisal setup; no cross-tenant/self-authorised assignments |
| P3A | Criterion evidence and structured oral capture | P2, existing documents/calls | Manual completion works with all integrations disabled |
| P3B | Expected/observed assessor workspace and full manager feedback | P2, evidence contract | Save/resume, evidence references, role gaps and submission attribution |
| P4A | Scoring/classification/completion exceptions | P3 | Reproducible breakdown; proposed vs human final outcome; concurrent finalise safe |
| P4B | Optional AI role comparison and evidence suggestions | P3, personal gateway | Cited editable drafts; inaccessible sources excluded; AI cannot finalise |
| P5A | Participant report, complete manager feedback and PDF | P4, immutable final result | Screen/export parity and scoped access |
| P5B | Cohort gaps/rankings, audit, historical snapshots and retention | P4, P5A report contract | Comparable rankings, safe filters, historical integrity, controlled deletion |
| P6 | Full staging pilot, regression, live release verification, final visual PDF | All above | Every story has proof or a named unresolved gap; no unearned completion label |

Pairs may work on A/B packages together only after shared contracts freeze and path ownership is recorded. Package names are scheduling labels, not separate products or repositories.

## 7. Design process and artifacts

Before coding, designers inspect live/current Performance pages and capture representative appraisals, setup, reviewer workspace, report, admin configuration, people and call/evidence surfaces. Use synthetic employee data for new concepts/test screenshots. Baseline screenshots are read-only observations, not implementation proof.

Design to the existing suite language: neutral surfaces, existing typography/components/tokens, restrained accent, clear hierarchy, accessible contrast and both themes. No marketing hero or raw JSON editors for ordinary HR tasks. Preserve `role` as user-facing terminology; identity access roles must be explicitly distinguished from assessment roles.

Create generated high-fidelity concepts for the role builder and assessor workspace using image generation. Label them `Design concept - not a working screen`. Generated images do not replace interaction specifications or rendered-app QA. Never transmit real CVs, ratings or private meeting content to image generation.

Required design specification for every surface: entry/exit, purpose, information hierarchy, field labels/defaults/help, permissions, state matrix, keyboard/focus rules, compact/mobile task order, date/time language, destructive-action recovery, component reuse and screenshot reference. PM and SA review each package before development. Record approval/defects, not an implied blanket approval.

## 8. Implementation and file ownership

Use current `main` as required by repository instructions. Before each package, inspect HEAD/status and reserve its paths. No overlapping writes without explicit handoff. Add new files under the competency domain first. Coordinator alone integrates shared `app.js`, navigation, identity permission catalog, appraisal setup/detail/report bridges and CI changes.

Pair A owns configuration/role/framework surfaces and their dedicated endpoints/tests. Pair B owns assessor/evidence/result surfaces and their dedicated endpoints/tests. Shared schema/service names come from architecture. A peer inside each pair reviews changes; QA/SA validates cross-package behaviour when slots free.

Use current Next.js installed documentation before frontend edits. Reuse existing dependency versions and auth/context hooks. Keep tenant IDs/actor identity server-derived. Validate referenced objects against the current organisation and authorised participant scope. Do not copy provider tokens into competency records. Avoid arbitrary formula evaluation; use a constrained configured scoring engine.

## 9. QA strategy and release gates

QA is a role, not a claim that one script tests the whole system. The architect may run QA, but tests and failures must be documented. When a SA authored a component, have a different available worker review its security and acceptance evidence.

| Test layer | Required proof |
|---|---|
| Model/scoring | Seven source combinations; levels/conversions; weights/threshold boundaries; missing evidence; ties; incompatible comparisons; immutable versions |
| API integration | Real disposable Mongo; authenticated actors; tenant/resource permissions; concurrent retries; stale updates; finalise/reopen; file/media ownership |
| Browser journey | Create/upload role, configure, assign, assess, review AI draft, finalise, report/export; manual integration-off path; refresh/resume |
| Accessibility/visual | Keyboard completion, focus/error announcements, labels, contrast, compact layout, light/dark, long content, loading/empty/failure/denial |
| Existing app regression | IdP login, people/team scope, OKR alignment/reasons, ordinary appraisals, existing calls and reports |
| Provider acceptance | Actual configured personal AI and call integrations tested separately; simulated responses labelled; no real participant employment decisions used as test fixtures |
| Release | Required CI and scans, exact main revision deployed, public health/OIDC smoke, authenticated live read-only browser proof, rollback resources retained |

Minimum staging pilot: approximately ten synthetic participants assigned to roles; all seven input combinations; all ranking scopes/ties; no-AI/no-call path; role changes after completion; permission revocation, cross-tenant denial; report/PDF equivalence; consent/retention behaviour. Actual MoMo participant provisioning is a separate data operation and must not be claimed from synthetic pilot results.

Gate before commit: both package owners hand off; no unresolved release-blocking defects; product/architecture/UX review recorded; required tests pass; exact paths reviewed for secrets/unrelated changes. Admin bypass is authorised for branch protection when needed, not for ignoring failed tests, scans or changing security settings.

Default-role migration gate: canonical built-in Performance grants follow personal, managed hierarchy and organisation scopes. Preserve persisted rows belonging to other applications, separate custom roles, organisation overrides and member exceptions. A tightened default must also reach existing sessions: after the new IdP policy is verified, stop the exact Performance backend, expire only its session collection through its configured application connection, restart and verify health, then perform normal SSO sign-in. Business records, saved assessments and IdP sessions remain available. Record actual counts and execution status; a passing fresh-identity fixture alone cannot prove stale-session revocation.

Gate after push: confirm PR/merge and CI separately from deployment. Deploy exact tested main; confirm frontend/backend/IdP image revisions as applicable and public asset freshness. Run authenticated browser smoke against deployed app. Failed deployment or provider tests remain open; do not present a green local test as live acceptance.

## 10. Release and rollback

The retained SA coordinates exact-path commits and push/PR/admin merge. Do not disable branch protections or force-push. Preserve known-good running images and persistent volumes, use existing deployment locks and bounded cleanup, and keep rollback instructions with the batch.

Deploy schema changes additively. Existing appraisals without competency links continue normally and show no fabricated role/source data. Disable new entry points or roll back application images if acceptance fails; preserve completed assessment records. No destructive migration of historical reviews.

## 11. Evidence ledger and final PDF

Track each story's product, architecture, design, implementation, QA and release states in `STATUS.md`. Include commit, test command/result, CI/deploy URL, verified live revision and screenshot path where applicable. A file existing is not evidence that its feature works.

Final PDF is a concise implementation record, not the entire specification copied into print. Use numbered feature spreads: user-visible change, app location, real screenshot or diagram, tests actually run, and release state. Put unresolved items in a visible outstanding-work section. Distinguish `baseline`, `concept`, `local verified`, `CI passed`, `deployed` and `live verified` on every image/result. Include a compact traceability appendix and source links.

Render the PDF to page images, inspect every page for overflow/clipping/legibility, repair defects, then provide both the detailed Markdown plan and final PDF. Do not describe a planning PDF as an implementation completion report.

## 12. Research used to shape the workflow

Sources accessed 18 October 2026; these support delivery methods rather than overriding the user's product requirements.

- [GOV.UK: multidisciplinary teams](https://www.gov.uk/service-manual/service-standard/point-6-have-a-multidisciplinary-team): phase-appropriate expertise and accountable decisions.
- [GOV.UK: user needs and stories](https://www.gov.uk/service-manual/user-research/start-by-learning-user-needs): trace user stories to needs and acceptance criteria.
- [C4 model: system context](https://c4model.com/diagrams/system-context): clear boundaries and actors before lower-level design.
- [GOV.UK: check answers](https://design-system.service.gov.uk/patterns/check-answers/): editable confirmation before consequential submission.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/): accessibility baseline for keyboard, focus, labels and errors.
- [Playwright best practices](https://playwright.dev/docs/best-practices): user-visible assertions, isolation and resilient locators.
- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/): testable access-control and application security requirements.
- [Anthropic open-source skills](https://github.com/anthropics/skills): reviewed design/testing skill patterns; existing installed product-specific skills take precedence.
- [Open-source role skill catalogue](https://github.com/alirezarezvani/claude-skills): evaluated PM/architecture/QA role coverage; no whole-repository install or execution is required.

Research notes, detailed stories, architecture, design reviews and QA evidence live alongside this plan. Keep large artifacts out of the product UI.

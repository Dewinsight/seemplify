# Performance Management: Apple design delivery programme

21 October 2026. Owner: coordinating architect. Checkout: `E:\GitHub\C-drive\seemplify`, canonical `main`. Scope: Performance Management presentation, navigation and accessibility, its documentation and reusable team skills. This is the detailed working plan; [DELIVERY-RECEIPT.md](DELIVERY-RECEIPT.md) records the verified outcome.

## 1. Outcome and product boundaries

Apply [Emil Kowalski's Apple design skill](https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md) across every existing Performance Management screen. Preserve current tasks, organization boundaries, role permissions, historical reports, central Identity login and shared AI gateway contracts. Provide coherent desktop/mobile and light/dark behavior, actual before/final evidence for all 68 page templates and an illustrated PDF.

The supplied competency PRD remains authoritative for competency. Product analysis directly read its three pages and recorded SHA-256 `6e39179f51bf7202cdd57fdddefe06c9bea07579f7a1c4db29587ea49870976f`. It maps to AD-11; it is not a whole-Performance PRD. Other stories derive from the user's redesign brief, current source and existing acceptance requirements. Do not invent HR policy, permissions, API fields, user interviews or provider capabilities.

## 2. Research and skills

Read primary sources before implementation and record how each affects decisions. Inspect third-party instructions before installing or executing them. Detailed findings and links are in [research-product.md](research-product.md) and [research-design-qa.md](research-design-qa.md).

| Role / source | Operating decision |
| --- | --- |
| Product: [Scrum Guide](https://scrumguides.org/scrum-guide.html), [GOV.UK user stories](https://www.gov.uk/service-manual/agile-delivery/writing-user-stories) | Ordered backlog, explicit user needs and testable acceptance; one retained product owner verifies the finished work |
| Architecture: [C4 context](https://c4model.com/diagrams/system-context) | Identify people, system and dependency boundaries before component contracts; specify every story's requirements, ownership and tests |
| UI/UX: [Apple design skill](https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md), [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | Immediate feedback, restrained materials, readable hierarchy, keyboard operation, reflow and explicit accessibility preferences |
| QA: [Playwright](https://playwright.dev/docs/intro), ISTQB guidance linked in the research | Risk-based acceptance, reproducible failures, actual browser journeys and independent retests |
| Agents: [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), [skills](https://learn.chatgpt.com/docs/build-skills) | Bounded role handoffs and reviewable artifacts; runtime capacity determines concurrency |

Five original role skills were authored, validated and installed: `performance-apple-product`, `performance-apple-architecture`, `performance-apple-design`, `performance-apple-qa`, `performance-apple-development`. The requested upstream `apple-design` skill was installed separately. New installations are available on the next turn. Repository copies and installation evidence are in `team/skills` and `evidence/skills-installed.json`.

## 3. Team, concurrency and role rotation

The user's maximum is six workers; this session supports four concurrent agents including the coordinator. Four actual agents rotate through the requested roles. A role assignment does not imply an additional simultaneous worker.

| Stage | Coordinator | Worker 1 | Worker 2 | Worker 3 |
| --- | --- | --- | --- | --- |
| Discovery | Architect 2 / orchestration | PM1: core, retained acceptance owner | PM2: growth/competency | Architect 1: requirements, retained QA/release |
| Design | UI/UX1: shared foundation and snapshots | PM1 reviews each story | UI/UX2: families, concepts and snapshots | Architect 1 reviews contracts |
| Development | Team A implementer | Team A reviewer | Team B implementer | Team B reviewer |
| QA/release | Integration, comparison gallery and report | Retained product acceptance | Independent design verification | Retained architect: QA, sole committer/releaser |

PMs send completed stories immediately to architecture and continue their next story. Two architecture assignments process queued stories. Once analysis finishes, PM2's slot becomes designer/developer; Architect 2 becomes UI/UX1/developer. PM1 and Architect 1 retain verification responsibility. A third designer is optional only when capacity permits.

Two teams work on two nonconflicting packages within Performance Management. This does not expand scope into another application. Each pair exchanges findings; shared files have one owner. Developers do not commit. A faster team waits at the integration barrier until both packages and their reviews are ready.

## 4. Incremental pipeline and handoff records

`Research → Story ready → Architecture ready → UX ready → Product + architecture approved → Development → Pair review → QA → Integration barrier → Release → Live verification → Report`

1. **Product:** persona, source/PRD mapping, observed problem, exact routes/embedded controls, acceptance criteria, role/data boundaries, dependencies and story owner. Stories enter architecture individually while product analysis continues.
2. **Architecture:** requirements per acceptance criterion, relevant components/APIs, unchanged invariants, responsive/accessibility constraints, file ownership, integration risks and meaningful verification. Completed architecture packages enter the design queue immediately.
3. **UI/UX:** actual screen/state/viewport screenshots, hierarchy and control specification, loading/empty/error/denied/read-only/long-content states, mobile behavior and keyboard interaction. Generated concepts are explicitly labeled proposals.
4. **Approval:** product and architecture review each package and record a decision against its story ID. Design approval does not certify implementation.
5. **Paired development:** consume frozen contracts, preserve unrelated changes and return contract changes to architecture. Implementer and partner review separately.
6. **QA:** execute acceptance journeys, preserve initial failures, repair real defects and replay unchanged assertions. The retained architect can double as QA but must review the integrated work independently of its implementer.
7. **Integration:** freeze both lanes, verify exact combined source, stage only approved paths and publish the tested main commit. Release waits for all gates.

Every story record carries status, artifacts, review decision, tests and limits. A document's existence alone does not complete its story.

## 5. Packages and ownership

| IDs | Product coverage | Documents |
| --- | --- | --- |
| AD-01–06 | Shell/login/dashboard; goals/alignment; appraisals/histories; cycle administration; people/legacy reviews; analytics/reports | [product-01.md](product-01.md), [DESIGN.md](DESIGN.md) |
| AD-07–12 | Feedback/recognition/projects; check-ins/meetings; development/coaching/support; talent; competency; AI account/help | [product-02.md](product-02.md), [DESIGN-02.md](DESIGN-02.md) |

[architecture-01.md](architecture-01.md) specifies requirements and solution architecture for every story. The actual `app/**/page.tsx` inventory includes redirect entries, dynamic detail routes, child workflows and embedded controls. [SCREEN-COVERAGE.md](SCREEN-COVERAGE.md) maps the 68 exact templates to evidence.

**Lane A owns shared foundations:** `app/globals.css`, `app/theme.ts`, `app/layout.tsx`, `tailwind.config.js`, `components/Layout.tsx`, `components/ui/*`, `components/PageGuide.tsx`, shared palette and focused QA.

**Lane B owns feature presentation:** login/dashboard and agreed appraisals, reports, conversation, growth and competency surfaces. It consumes Lane A's palette and does not edit foundation files concurrently. Additional People and competency/conversation repairs are coalesced only after explicit ownership handoff and fresh combined QA.

Preserve pre-existing calendar, meeting, notetaker and other workstreams. `performance/docs/reliability-review` is excluded. Refresh Git status/diff/HEAD before integration because another agent may commit legitimate work during review. Concurrent committed AI assessment analytics `d1b0307c` is preserved and separately attributed.

## 6. Design contract

- Retain MUI and Tailwind; one deterministic semantic palette supplies both, including server-rendered CSS and portals. No framework migration.
- Use system typography, neutral canvas, readable grouped surfaces and blue task emphasis. Status colors retain meaning. Remove competing external font downloads and decorative lifts/gradients.
- Size, weight, leading and tracking establish hierarchy; comparative metrics use tabular numbers.
- Restrict translucency to functional chrome where it explains layering. Content and composers remain opaque. Reduced transparency gets solid materials; increased contrast adds boundaries.
- Press feedback begins immediately on `:active`; the action commits on click/release. Releasing away cancels. Preserve touch targets and visible keyboard focus.
- Preserve existing input/gesture behavior; do not introduce motion libraries or gestures merely to demonstrate the skill. Honor reduced motion globally and in portals.
- Make loading, empty, error, denied, read-only and long-content states clear where applicable. Mobile retains primary actions and constrains horizontal table scrolling within a named local region.
- Keep API fields truthful. Do not convert role revision/currentVersionId into an invented numeric version. Preserve actual permissions, drafts, privacy, historical reports and human decisions.

## 7. Evidence and verification gates

1. **Baseline:** resolved checkout, branch/HEAD/status, source inventory and actual before screenshots.
2. **Design:** route/story matrix, two generated concepts, concrete UX handoffs and product/architecture decisions.
3. **Implementation:** appropriate TypeScript/build/scoped lint plus meaningful goal, appraisal, feedback, growth, competency and administration journeys. Record whole-app lint debt separately.
4. **Visual:** desktop/mobile, light/dark, keyboard, reduced motion/transparency, increased contrast, long identities, dense tables and recovery. Do not infer readability from absence of overflow alone.
5. **All-page comparison requested by the user:** capture all 68 templates from matching sample records in pre-redesign and final production builds. Inspect actual images against the desired concept and record a per-route verdict. Authentication/error-to-populated differences are not design improvements. Reopen acceptance for genuine defects.
6. **Integration/release:** both lanes ready, exact source/build identity, fresh fetched refs, relevant recent task branches zero ahead of main, explicit staging and sanitized evidence. Never merge unrelated branches merely to clear a checklist.
7. **Production:** workflow success, exact running source revision, health, Identity OIDC start and authenticated employee/manager/HR read journeys. Real external providers require separate configured-account evidence.
8. **Report:** numbered delivered changes, selected actual screenshots, generated concepts labeled separately, precise test outcomes and practical limits. Render and inspect every PDF page.

The matched gallery uses baseline `a93ddbf9`, tree `8f97b7f88ded397c3d291158645b6fe138c3cad6`, and final tree `7eb9c096330d19b1a854c0f45fa15d0583f09c13`. It retains historical attempts separately. Controlled synthetic rendering, disposable real-API testing and authenticated production proof remain separate evidence sets.

## 8. Release authority, security and rollback

The user explicitly authorized the architect to commit, push and publish live, including an admin bypass if required. Prefer normal publication. If repository policy blocks it, snapshot the exact current protection, apply the narrowest authorized temporary exception, push without force, restore immediately and verify both ruleset and classic policy. Never disable protection pre-emptively or develop/deploy from legacy master.

Deploy the exact tested main source. The existing core workflow also rebuilds other suite services and serializes production releases; Performance-only source scope does not imply an isolated deployment job. Preserve already-active releases and do not cancel them mid-deployment.

Rollback retains the immediately prior healthy deployment/images, app data and secret files. Verify revision and Identity after rollback. Stop on an unresolved functional regression, missing required authority, conflicting unreviewed work or inability to identify the tested source.

No production plaintext credentials enter the repository, history, logs, screenshots or chat. Private sessions remain in sibling `../access`; production reads root-only secret files. Remove process-environment exports from generated test reports before publication, then scan the explicit documentation package without printing secret values. Do not rewrite unrelated files or mutate binary evidence.

## 9. Deliverable index

| Artifact | Purpose |
| --- | --- |
| This plan; product-01/02; research-product/design-qa | Researched operating model, stories, source mapping and role skills |
| architecture-01; QA-PLAN; RELEASE-PLAN | Per-story requirements, solution contracts, tests and release recovery |
| DESIGN; DESIGN-02; PRODUCT-DESIGN-REVIEW | UX handoffs, concepts and approval decisions |
| PAIR-REVIEW-A; CORE/GROWTH-VISUAL-REVIEW; PRODUCT-IMPLEMENTATION-ACCEPTANCE | Independent source, visual and retained product review |
| [VISUAL-COMPARISON.html](VISUAL-COMPARISON.html); VISUAL-COMPARISON-CORE/GROWTH | Searchable actual before/final images, shared concepts and every-route verdicts |
| SCREEN-COVERAGE; REVIEW-LOG; evidence | Exact route/state/source provenance, chronological failures/replays and sanitized receipts |
| team/skills | Five reusable role-specific operating skills |
| DELIVERY-RECEIPT; Performance-Management-Design-Delivery.pdf | Verified outcome and illustrated nine-page handover |

## 10. Current execution status

Research, twelve story packages, per-story architecture, both UX handoffs, implementation and pair reviews are complete. The additional all-page comparison reopened acceptance after intermediate source `81212b2a` and repaired People mobile layout, competency metadata/wayfinding and conversation contrast/materials.

Exact final tree `7eb9c096330d19b1a854c0f45fa15d0583f09c13` passed both default production builds, 25 browser checks and nine backend integration checks. Twenty distinct disposable real-API journeys recorded nineteen initial passes and one HR recipient-selection failure; the unchanged case passed three replays. Its cause is not established. Earlier regression evidence retains 104 initial passes from 105 cases and the repaired mobile Final Rating's unchanged replay. Fourteen independent partner checks passed.

All 68 templates have matched before/final screenshots and retained product acceptance passed all twelve stories. Reviewers recorded 29 visible hierarchy/readability gains and 39 modest refinements. The final seven-path follow-up is published as main `8ce5e4b447d2b070870bdf75154b46abde6b18a7`, preserving parent `d1b0307c`; the programme union is 41 source/test paths.

[Deployment run 39524124932](https://github.com/Dewinsight/seemplify/actions/runs/39524124932) succeeded. Both live Performance containers run the exact tested source; public frontend/API health and central Identity OIDC start passed. Fresh manager, HR and employee authentication and nineteen production captures passed, with zero browser errors, failed API reads or overflow and three mobile menu Escape checks. Retained product review accepted the production evidence. Prior healthy d1 rollback resources remain intact.

The illustrated nine-page PDF passed its final content checks and individual Poppler-rendered page inspection. Documentation is published separately from source so it does not trigger another core deployment. Exact results and practical provider/lint limits are in [DELIVERY-RECEIPT.md](DELIVERY-RECEIPT.md).

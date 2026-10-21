# Product practice and role-skill research

Research date: 21 October 2026. Owner: Product Manager 1. Sources below were opened during this task; their guidance supports the delivery method and does not replace Seemplify requirements.

## Decisions from primary sources

| Source | Practical decision for this programme |
|---|---|
| [GOV.UK - Writing user stories](https://www.gov.uk/service-manual/agile-delivery/writing-user-stories) | Describe actor, need and outcome; add inspectable acceptance and evidence. Split broad redesign work into stable numbered story packages with explicit dependencies. |
| [GOV.UK - Learning about users and their needs](https://www.gov.uk/service-manual/user-research/start-by-learning-user-needs) | Inspect existing task journeys and evidence first. Treat suggested layout changes as proposals until tested, and distinguish source observations from user research. No new interview findings are claimed. |
| [Scrum Guide 2020](https://scrumguides.org/scrum-guide.html) | Keep one transparent ordered backlog and a common definition of done. Two PM agents can prepare disjoint packages, while one retained PM remains accountable for the final priority and acceptance decision. This requested pipeline is not a claim of strict Scrum adoption. |
| [Emil Kowalski - Apple design skill](https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md) | Use system typography, direct feedback, spatially consistent interactions, adaptive materials and motion/accessibility preferences. Translate principles into measurable screen criteria rather than decorative motion. |

## Open-source role tooling considered

| Candidate | Current evidence | Selection decision |
|---|---|---|
| [BMAD Method](https://github.com/bmad-code-org/BMAD-METHOD) | Open-source multi-role method; this checkout already contains `_bmad/bmm/agents/pm.md`, `architect.md`, `ux-designer.md`, `tea.md` and story/readiness workflows. Local PM entrypoint is an interactive menu requiring its own config and user choices. | Reuse its role separation, story/readiness concepts as reference. Do not activate the interactive menu or install another copy for this autonomous delivery. Build small Performance-specific role skills around the already authorized pipeline. |
| Existing `docs/competency-assessment/team/skills/seemplify-competency-product/SKILL.md` | Repository already has focused product/story and acceptance practices tied to the competency PRD. The associated programme documents show story-by-story handoffs and retained PM review. | Reuse competency domain contracts; do not apply competency-only assumptions to every Performance screen. The redesign skill should point at the new AD story register and existing REL/CA requirements. |
| Existing `ui-ux` and `skill-creator` skills | Available local skills were read for cognition, source boundaries, shared-component review and narrow reusable skill design. | Use as quality/reference layers. The product role skill should stay short and describe inputs, output readiness, streaming handoff and acceptance evidence. |
| Product-manager-toolkit third-party link in the older competency skills research | The older URL shape `product-team/product-manager-toolkit/SKILL.md` returned 404 when opened in this task. | Do not install or claim verified availability from that stale path. BMAD and existing focused local skills are sufficient; no replacement dependency is needed. |

## Inputs found and gaps

1. **Current product direction:** user's 21 October request to redesign all existing Performance Management screens with the Apple design skill and run a role-based delivery team.
2. **Existing product acceptance:** `performance/docs/reliability-review/PRODUCT_STORIES.md` (REL-01..REL-13), `performance/APPRAISAL_FLOW_REVIEW.md`, `performance/FEATURE_ACCEPTANCE_REVIEW.md`, source routes/components and existing browser/real-API suites.
3. **Original PRD available:** `C:/Users/User/Downloads/Seemplify Competency Assessment PRD.pdf`; linked by the existing `docs/competency-assessment` programme. This is the competency subprogramme PRD. Its file presence was checked; this PM did not re-extract or certify all PRD contents in this task.
4. **Gap:** no separately named whole-app Performance PRD was located in the inspected repository/Downloads filenames. The AD backlog is therefore an existing-solution redesign addendum, not an invented replacement PRD. If another source document is supplied, the PM maps it to the existing AD acceptance register before expanding scope.
5. **Current source evidence:** inspected local `main` at `9e8fecc1`; existing uncommitted calendar/meeting/notetaker changes were present. Those changes remain protected and are not included in the design baseline as new work by this programme.

## Reusable PM role contract

**Inputs:** current user request, applicable PRD sections where actually available, existing REL/CA requirements, current source and route inventory, baseline screenshots supplied by UX.

**Ready for architecture:** stable AD identifier; actor/task/outcome; exact route and embedded-state scope; source/assumption boundary; observable positive, empty, error, denied and mobile criteria; dependencies; existing verification entrypoints; protected-file constraints. Send each ready item immediately while preparing the next.

**Ready for developers:** architecture requirements and data/permission invariants exist; UX includes actual-state screenshots and interaction/accessibility details; PM plus architect have reviewed the package. A generated image is a concept reference, not a tested UI.

**Acceptance:** compare the implemented user journey with the same numbered criteria and evidence. Distinguish local rendering, fixture browser success, real API tests, deployment and authenticated live acceptance. Never turn a planned state into a completion claim or infer backend enforcement from a screenshot.

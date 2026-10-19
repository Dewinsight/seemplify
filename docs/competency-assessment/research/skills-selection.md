# Role skills selection

Reviewed 18 October 2026. The user requested research and role skills for PM, architecture, UX, developers and QA. Existing skills were read; five project-specific skills were authored and validated using the installed skill-creator validator.

## Selected for this programme

| Role | Active skill | Why |
|---|---|---|
| PM | `seemplify-competency-product` | Direct traceability to this PRD, role-upload clarification, GWT and PM acceptance review |
| Architect | `seemplify-competency-architecture` | Existing IdP/gateway constraints, frozen versions, per-story API/auth contracts and controlled release |
| Designer | `seemplify-competency-design` + installed `ui-ux`, `frontend-design`, `imagegen` | Current-screen audit, accessible interaction, suite consistency and generated concepts |
| Developer pair | `seemplify-competency-development` | Non-overlapping ownership, shared contracts and peer verification |
| QA | `seemplify-competency-qa` | Dedicated acceptance/security/persistence/browser/release evidence |
| Final report | Installed `pdf` | Render-and-inspect artifact workflow |

Project copies are in `../team/skills/`. Discoverable copies are installed under `C:/Users/User/.codex/skills/seemplify-competency-*`. They are available to automatic discovery on the next turn; running workers read their exact paths now. Each of five passed `quick_validate.py`. They are original project-specific instructions; no upstream code or text was copied.

## Open-source alternatives inspected

- [Product manager toolkit](https://github.com/alirezarezvani/claude-skills/blob/main/product-team/skills/product-manager-toolkit/SKILL.md): PM workflow, discovery and prioritisation templates. Useful reference; existing PRD and explicit needs remove the need to invent RICE estimates or repeat discovery interviews.
- [Senior architect](https://github.com/alirezarezvani/claude-skills/blob/main/engineering-team/skills/senior-architect/SKILL.md): ADRs, diagramming and tradeoff guidance. Keep this programme's existing stack rather than a generic stack-selection exercise.
- [Senior QA](https://github.com/alirezarezvani/claude-skills/blob/main/engineering-team/skills/senior-qa/SKILL.md): test strategy coverage. Existing repository Playwright/Jest runners and actual data contracts are the execution baseline.
- [Anthropic webapp testing](https://github.com/anthropics/skills/blob/main/skills/webapp-testing/SKILL.md): reconnaissance, screenshots and local testing patterns. Reviewed as a reference; do not replace the existing JS Playwright harness with an additional Python framework or arbitrary sleeps.
- [Anthropic frontend design](https://github.com/anthropics/skills/tree/main/skills/frontend-design): visual craft reference. Installed frontend-design and ui-ux already supply the relevant workflow.

No full third-party plugin/repository was installed and no upstream helper script was executed. This avoids unrelated auto-memory/hooks/configuration changes while still supplying every requested role with a validated skill. The five project skills are reusable beyond this turn and remain reviewable in Git.

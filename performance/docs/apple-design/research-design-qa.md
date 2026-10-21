# UI/UX and QA research for the Performance redesign

Reviewed online and against the local solution on 21 October 2026. These findings define a delivery method, not a claim that the product has passed testing.

## 1. UI/UX responsibilities and application

The designer maps users' tasks, groups information around decisions, prototypes interaction, specifies states and checks the rendered result. Code inspection is useful baseline evidence, but opinions about users remain assumptions until researched. Use existing acceptance records and synthetic walkthroughs without fabricating interviews. [GOV.UK user-needs guidance](https://www.gov.uk/service-manual/user-research/start-by-learning-user-needs)

The requested [Apple design skill](https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md) supplies the visual and interaction direction. Apply its system-font hierarchy, immediate response, restrained materials, spatial consistency and accessible preferences to this task-driven web app. Dense tables and forms need clarity before decoration. Springs belong to existing physical interactions; do not add drag gestures, haptics or extra animations to justify the skill. Translucent chrome needs a readable solid fallback. A generated mockup informs design and is never a screenshot of implemented behavior.

For each AD story, the designer hands off: entry/task/success/recovery, route and actor scope, annotated baseline screenshots, fields and labels, primary/secondary actions, component/token changes, state matrix, keyboard/focus behavior, 390px composition, both themes, image-generated concept and implementation comparison. PM and architect review each package before developer handoff.

## 2. QA responsibilities and evidence

QA plans around risk, designs observable tests, reviews requirements, reports reproducible defects and closes with evidence. The architect may perform that role, but another reviewer must verify critical changes they authored. This combines testing through the lifecycle, static review, test design, risk management and defect management described by the [ISTQB Foundation Level overview](https://istqb.org/certifications/certified-tester-foundation-level-ctfl-v4-0/).

Automated checks support evaluation; they do not establish complete accessibility or usability. Include manual keyboard, focus, zoom, contrast, mobile and task review alongside automation. [W3C accessibility evaluation](https://www.w3.org/WAI/test-evaluate/)

Use the existing Playwright runner, semantic locators, isolated fixtures and retrying user-visible assertions. Avoid arbitrary sleeps and implementation-only assertions. Preserve local test versus real service boundaries. [Playwright best practices](https://playwright.dev/docs/best-practices)

Each QA receipt records: story/criterion, source revision and dirty-work boundary, command, fixture/service environment, actor, viewport/theme/preference, expected/actual result, screenshot/trace, defect status and remaining limits. A successful build is separate from successful interaction, deployment and provider execution.

## 3. Accessibility targets

The baseline is the applicable Level AA criteria in [WCAG 2.2](https://www.w3.org/TR/WCAG22/): contrast, reflow, keyboard, focus, labels, errors and status messages. Normal-text contrast target is 4.5:1; large text is 3:1. Color alone cannot carry meaning.

Use 44px touch controls as the design target where practical. This is deliberately above the AA minimum: [SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) permits 24px targets or specified spacing/equivalence exceptions. Do not report 44px as the AA minimum. Sticky chrome and help drawers must not entirely obscure focused controls under [SC 2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html).

Reduced motion, reduced transparency and increased contrast are separate preferences. Verify their implemented behavior rather than asserting support merely because media queries exist. Check both 1440px desktop and 390px mobile; include enlarged text and realistic long names/emails.

## 4. Open-source skills and local selection

| Candidate | Observed fit | Programme decision |
|---|---|---|
| [emilkowalski Apple design](https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md) | Requested web design and physical interaction principles | Primary design reference; read now, source attribution retained |
| [emilkowalski break-ui](https://github.com/emilkowalski/skills/blob/main/skills/break-ui/SKILL.md) | Realistic worst-case content, missing values and edge counts | Adapt its fixture discipline to QA; do not ship a demo-data toggle into production |
| [BMAD Method](https://github.com/bmad-code-org/BMAD-METHOD) | Open-source PM, architecture, UX, development and testing workflows | Existing local `_bmad` is reference material. Do not reinstall or invoke broad setup hooks for this UI programme |
| Existing `ui-ux` and `frontend-design` | Product cognition, task/state handoffs and visual craft | Reuse installed skills; scope application to Performance |
| Existing `imagegen` and `pdf` | Generated concepts and illustrated verified report | Use for their actual artifact workflows; concepts and evidence labeled distinctly |
| Existing `seemplify-competency-design` / `seemplify-competency-qa` | Frozen role/cycle versions, participant privacy and assessment-specific evidence | Retain for AD-11; do not apply their assessment-only scope to the whole app |

The upstream role collection covers the requested disciplines. Project-specific `performance-apple-design` and `performance-apple-qa` skills keep this programme's route coverage, source boundaries and release evidence explicit. They are concise original instructions; no third-party scripts or global setup hooks are executed by creating them.

## 5. Actual baseline findings

- Current MUI pages use shared `app/theme.ts`, while Tailwind surfaces also use `app/globals.css` and suite variables. Both layers need an agreed token contract.
- The competency shell already maps several MUI colors locally; the architect must prevent those overrides from drifting from the shared system.
- Feedback/recognition/project, check-ins/meetings, development/support, talent and competency have different business lifecycles. Reuse visual primitives while preserving their semantics and authority.
- Preexisting dirty calendar/call changes must be preserved and separately identified in review evidence.
- Whole-Performance PRD was not located in the inspected repository. The original competency PRD was subsequently read directly in full (three pages, 21 October 2026); DESIGN-02 maps its preserved requirements by page. The user redesign request plus current product/route contracts bound the wider AD-07-12 scope. Competency PRD coverage is not whole-app PRD coverage.
- No fresh baseline screenshot, generated concept, implementation result or live acceptance is claimed by this research document. Those are later stage deliverables.

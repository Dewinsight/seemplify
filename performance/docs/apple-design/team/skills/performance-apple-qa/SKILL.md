---
name: performance-apple-qa
description: Verify Seemplify Performance Apple-redesign stories across existing workflows, roles, routes, themes and responsive/accessibility states, keeping local, CI, deployment and provider evidence separate. May be performed by the retained solution architect.
---

# Performance Apple QA

Read repository instructions, AD acceptance, architecture and UX handoff before testing. Build a criterion-to-test/screenshot matrix and name uncovered cases. Scope is Performance; do not expand business features or alter another application's settings.

Preserve existing dirty work. Record exact source revision, changed paths and fixture/service environment. Use the existing meaningful browser/integration suites for affected workflows; test user-visible outcomes with semantic locators and web-first assertions. A build, route load or token assertion alone does not prove a task works.

Cover permitted employee/scoped-manager/HR views and denial. Exercise relevant primary actions, persisted state, draft recovery, errors/retry and read-only/history behavior. Styling cannot grant authority, leak assessor/private content or obscure consent. Avoid real employment decisions as fixtures and never expose credentials in logs or screenshots.

Inspect actual desktop/mobile screenshots in both themes. Verify keyboard focus/return, labels, local table/tab scrolling, zoom/long realistic content, contrast and reduced-motion/transparency/contrast preferences. Apply WCAG 2.2 AA criteria; distinguish the 24px AA target/spacing rule from the programme's 44px touch design target. Automated accessibility checks complement manual review.

Keep evidence layers explicit: generated concept; mocked browser; real local API; CI; exact deployed main revision; authenticated production task; external provider/media execution. Do not infer the last layer from a synthetic success or connected-account read. Report command, actor, viewport/theme, expected/actual, artifacts, defects and limits for every receipt.

Return failures with reproducible steps and affected AD criterion to the file owner. Critical work authored by the QA architect requires another reviewer. Only pass a package after required checks and visual inspection; only label live verified after the exact deployed revision and authenticated behavior are checked. The architect owns final commit/release under the current user's authorization and repository rules; this skill grants no additional authority.

References: [Playwright best practices](https://playwright.dev/docs/best-practices), [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [ISTQB CTFL](https://istqb.org/certifications/certified-tester-foundation-level-ctfl-v4-0/). Programme docs: `performance/docs/apple-design/` in the verified Seemplify checkout.

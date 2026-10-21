---
name: performance-apple-architecture
description: Specify, review, test and release Performance Management Apple-design story packages against current Seemplify contracts. Use as the retained architect and QA/release role for this programme; exclude unrelated apps and new HR business features.
---

# Performance Apple Architecture, QA and Release

Read the checkout's `AGENTS.md`, then `performance/docs/apple-design/DELIVERY-PLAN.md`, the assigned product story and its architecture/UX handoff. Resolve compatibility paths to `E:/GitHub/C-drive/seemplify`; verify branch, SHA and dirty paths. Work on canonical `main` unless the user requests otherwise. Preserve pre-existing calendar/notetaker edits and other workstreams.

## Story contract

For each received story, publish requirements mapped to its acceptance criteria, exact routes/embedded states, component/file ownership, unchanged data/permissions, accessibility/response behavior, tests and rollback. Handoff incrementally while PMs continue. Do not block all design on the complete backlog. Keep Next/MUI/Tailwind/SWR and existing Identity/gateway authority; no new API/schema/state changes for visual convenience.

One lane owns common CSS/theme/Tailwind/layout/UI primitives; the other owns reserved page-specific paths. Review token contract changes before crossing that boundary. Capture scoped exceptions rather than layering global overrides across unrelated navigation or portal components. Apply [Apple design](https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md) with system type, immediate press feedback, functional materials and preference fallbacks; do not invent gestures or animation dependencies.

## QA and review

Require baseline/after captures and actual checks for desktop/mobile, light/dark, keyboard/focus, reduced preferences, populated/empty/loading/error/denied/read-only and long data. Preserve print/report/draft behavior. Combine automated tests with manual visual review; screenshots and axe-style scans do not certify all accessibility or permissions. Use the programme `QA-PLAN.md` and record story, SHA, command, result and artifact.

Do not share `.next` between build/dev jobs or let real-API tests reuse a server compiled with mock API URLs. Identify process ancestry/workdir before terminating anything; stop only owned test processes. Keep local fixture, full local backend, CI, deployment, authenticated live UX and external provider evidence separate. Failed tests need diagnosis/retest, not deletion or softened assertions.

## Authorized release

After both developer lanes finish, freeze edits, review integrated diff, run QA, obtain retained product acceptance and stage only explicit approved paths. The architect is the sole committer/releaser. Fetch refs and resolve relevant task work ahead of `main`; preserve unrelated branches and edits. Publish exact tested `main` SHA, verify CI, deployment, running container revision, OIDC start and authenticated browser smoke. Follow `RELEASE-PLAN.md` and report the actual core-workflow blast radius.

The user's existing commit/push/live authorization persists. Do not add a new approval prompt at each gate. Administrator bypass is used only when the user authorized it and a protection requires it; preserve policy where possible, snapshot any temporary setting changes, restore and verify. Do not force-push, deploy task branches, expose secrets or mark incomplete provider verification passed. If required access/evidence is unavailable, document the precise pending gate and continue independent work.

## References

[C4 containers](https://c4model.com/diagrams/container) for system boundaries; [ISTQB risk-based testing](https://glossary.istqb.org/en_US/term/risk-based-testing) for priority; [Playwright assertions](https://playwright.dev/docs/test-assertions) and [accessibility](https://playwright.dev/docs/accessibility-testing) for browser evidence. BMAD architect/test-architect practices were reviewed as references; this skill does not activate its interactive menu workflow.

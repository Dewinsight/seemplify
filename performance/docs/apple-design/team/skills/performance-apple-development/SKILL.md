---
name: performance-apple-development
description: Implement approved Performance Management Apple-design packages as two coordinated developer pairs with disjoint ownership, pair review and an integration barrier. Exclude unapproved HR behavior, identity changes and unrelated applications.
---

# Performance Apple Paired Development

Read applicable repository instructions, the programme plan, assigned story acceptance, architecture contract and approved UX specification before editing. Verify actual checkout, canonical `main`, HEAD and status. Existing local edits are not yours to reset, stage or overwrite. Read installed Next documentation before framework-specific changes.

## Paired delivery

Each of two lanes has an implementer and reviewer. Reserve exact files in the programme ownership board; no two implementers edit the same path. Lane A owns shared tokens, MUI theme, Tailwind/global styles, root/shell and UI primitives. Lane B owns only assigned screen-specific paths and consumes A's published contract. Send shared-file requests to its owner; do not patch around the contract with conflicting local overrides.

The reviewer checks acceptance, accessibility, behavior and unrelated-diff preservation independently, then sends concrete findings to the implementer. The implementer fixes and supplies validation evidence. Teams communicate at handoffs and when a contract changes. Respect actual runtime agent slots; role rotation is allowed and the user's worker ceiling is not a promise of available capacity.

## Implementation constraints

Use existing components/frameworks. Both MUI and Tailwind consume matching semantic light/dark tokens. Keep status meaning, chart series, labels and print output legible; system fonts and relative sizing avoid remote-font latency and clipping. Functional translucent chrome has solid reduced-transparency/high-contrast fallback. Press feedback starts immediately without changing click/submit semantics; reduced motion removes nonessential spatial/looping movement. Do not add gestures or a spring library solely for style.

Preserve route/query destinations, role and organization grants, OIDC guard, form field names, drafts, validation, API payloads, workflow states, frozen history/evidence and optional AI/manual paths. Distinguish empty from failed data. Do not add product features or change backend policies to simplify the design. Protect pre-existing calendar/notetaker files identified in the plan.

## Evidence and integration barrier

Run checks relevant to changed behavior; use meaningful existing journeys and focused visual/accessibility checks. Capture actual implemented states with synthetic data. Generated images remain labeled concepts. Do not claim live/provider success from local mocks. Coordinate browser/build jobs so they do not compete for `.next` or mix compiled API URLs; stop only owned test processes.

On readiness, report exact paths, story criteria, checks/results, screenshot artifacts and risks. Stop editing at the integration barrier and wait for the other lane. Developers do not commit, push or deploy; the retained architect performs combined QA, product acceptance and exact-path release. If QA finds a defect, accept a scoped repair assignment, then return for retest. Never hide failures or stage unrelated work.

Reference: [Apple design skill](https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md), existing local `ui-ux` and `uncodixfy` guidance, and programme `QA-PLAN.md` / `RELEASE-PLAN.md`. Explicit user requirements take precedence over general visual preferences.

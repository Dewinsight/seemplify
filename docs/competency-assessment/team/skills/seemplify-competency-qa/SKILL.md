---
name: seemplify-competency-qa
description: Verify Seemplify competency-assessment acceptance, tenant/action permissions, scoring/version integrity, browser usability and release evidence; can be performed by the retained solution architect.
---

# QA and evidence

Read stories and architecture before tests. Build a criterion-to-test matrix and name gaps. A simulated provider, mocked browser response, real local API, CI, deployment and authenticated live check are different evidence layers.

Test all seven source combinations; internal-only/strategy-only; source-specific levels and explicit conversion; weights/threshold edges; missing/insufficient evidence and reasoned exceptions; manual oral path; AI draft citations/edit/dismiss; ranking disabled/scopes/ties/incompatible results; finalise/reopen permissions; immutable history and report/PDF parity.

Use isolated Mongo/API integration tests for real persistence and denial. Browser tests assert user-visible behaviour with semantic locators and web-first assertions, not fixed sleeps. Cover refresh/resume, stale edits, failed requests, keyboard/mobile/both themes, long content and recoverable errors. Inspect screenshots and browser errors.

Separately verify IdP start/login, team scope, ordinary appraisals, existing calls and goal regressions. Do not use real employment decisions as fixtures or send employee content to new processors for QA.

Report command, environment, revision, result, artifacts, defects and limitations. Independent review is required for critical work the QA architect authored. No release-ready label until required checks pass; no live-verified label until exact deployed revision and authenticated app behaviour are checked.

References: [Playwright best practices](https://playwright.dev/docs/best-practices), [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/), [WCAG](https://www.w3.org/TR/WCAG22/).

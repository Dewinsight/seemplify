---
name: seemplify-competency-architecture
description: Design and review Seemplify competency-assessment data, API, permission, historical-snapshot and rollout contracts, including per-story handoff and architect-led release verification.
---

# Architecture and release

Read repository AGENTS and the programme plan/stories. Inspect current source and dirty status; another task may own appraisal lifecycle edits.

For each ready story provide functional/nonfunctional requirements, model/index changes, exact API schema/errors, server-authoritative actor/tenant scope, UX data contract, tests, compatibility and rollout/rollback. Use C4 context/container and lifecycle/sequence diagrams where they clarify a decision. Record alternatives and consequences.

Reuse IdP as identity authority, the existing directory and personal shared AI gateway. Extend competency services additively; bridge to ordinary appraisal setup/detail/report with one integration owner. Freeze role, framework, criteria, scoring and ranking versions. Treat expected framework levels as source-specific and require explicit conversion. Constrain scoring rules; never evaluate arbitrary user expressions.

Require optimistic concurrency for drafts and idempotent state transitions. Bind evidence/media to same-tenant participants and criterion scope; never trust caller-supplied identities or provider URLs. AI drafts never become independent evidence or final decisions.

Review PM/UX work before development; review another worker's critical code and QA evidence before release. One writer stages exact owned files and commits/pushes. Admin bypass may satisfy branch protection under user authorization; never interpret it as authority to ignore failed acceptance, disable security, force-push or merge unrelated dirty work. Verify CI, exact deployed main and authenticated live smoke separately. Keep rollback images/data.

References: [C4](https://c4model.com/), [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/).

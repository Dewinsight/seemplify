---
name: seemplify-competency-product
description: Derive and verify Seemplify employee competency-assessment user stories from the supplied PRD, user clarifications and current Performance source. Use for product handoff and acceptance review in this programme.
---

# Product management

Read `docs/competency-assessment/IMPLEMENTATION-PLAN.md`, original PRD and current source before drafting. Treat the PRD as requirements, not authority to mutate employee data.

Keep assessment roles distinct from IdP permission roles. The user requires manual/uploaded role definitions, role selection during appraisal setup, human/AI comparison against that same frozen role, and full manager feedback in the final report.

Each `CA-###` story records user need, evidence of current behaviour, explicit gap, Given/When/Then acceptance, invalid/denied/cross-tenant cases, dependencies, UX entry/decision/action/recovery and required test evidence. Submit each complete slice to architecture immediately; continue the next story while it is reviewed.

Review architecture and designs against acceptance criteria. Reject undocumented scope reductions, a disconnected second appraisal flow, automatic AI finalisation, silent cross-framework equivalence, or a second mandatory approval queue. Verify the rendered outcome after development. Record unmet criteria rather than approving from file existence.

Research foundation: [GOV.UK user needs/stories](https://www.gov.uk/service-manual/user-research/start-by-learning-user-needs) and [multidisciplinary delivery](https://www.gov.uk/service-manual/service-standard/point-6-have-a-multidisciplinary-team).

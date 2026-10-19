# Product management practice applied to competency assessments

Research date: 18 October 2026. Owner: Product Manager A. This is a delivery method and evidence record, not a claim that product features have shipped.

## Decisions derived from primary guidance

| Source | Relevant practice | Application to this work |
|---|---|---|
| [GOV.UK: Writing user stories](https://www.gov.uk/service-manual/agile-delivery/writing-user-stories) | Describe actor, need and goal; make acceptance outcomes inspectable; refine large items into manageable increments. | Each CA story names its user, value, Given/When/Then criteria, dependencies, UX and test contract. A story is not finished because a document or screen exists. |
| [GOV.UK: Start by learning user needs](https://www.gov.uk/service-manual/user-research/start-by-learning-user-needs) | Research users and current tasks throughout delivery; distinguish observations from assumptions; maintain traceability from needs to stories. | Use the original PRD, explicit user clarifications and current app/code as evidence. Imported roles and manager-feedback requirements are explicit user additions. Proposed navigation and field defaults remain design proposals until reviewed. |
| [Scrum Guide 2020](https://scrumguides.org/scrum-guide.html) | Keep one ordered transparent backlog and a common quality definition; usable increments are verified together. | Two PM agents can refine different slices but share one CA identifier register and one accountable prioritisation decision. Two developer pairs share acceptance and integration checks. Release gates are common. |

This delivery uses the user's requested staged agent pipeline; it does not claim to implement Scrum unchanged. The local readiness checklist is a team policy, not a mandatory Scrum artifact.

## Evidence hierarchy

1. Original three-page `C:/Users/User/Downloads/Seemplify Competency Assessment PRD.pdf`.
2. User clarifications: reusable **roles**, create/upload role descriptions, role-based human/AI comparisons, complete manager feedback in final reports, six-worker ceiling and architect-led QA/release.
3. Current code baseline `b401f1b1583be5875cc02462122c83ec9e7311d2` plus explicitly labelled unrelated dirty lifecycle work; prior audit is a starting point, not current implementation proof.
4. Proposed design/architecture choices, labelled as such. A screenshot is evidence of visible behavior only, not backend enforcement or shipped acceptance.

## Story readiness contract

A PM may hand a slice to architecture when it has a stable identifier; PRD/user provenance; actor, task and outcome; positive, error and permission criteria; current source evidence; dependencies; expected entry/success/error UX; and a testable result. The architect resolves schema/API, authorization, versioning, recovery and performance details. UI/UX then designs those contracts against captured current screens. PM and architect review the completed design before developer assignment.

Apply INVEST as a review lens, not a checkbox ritual: independently demonstrable user value, negotiable implementation, explicit dependencies, bounded scope and observable tests. If a story cannot be completed within an iteration, split it into numbered implementation slices while preserving its CA parent and end-to-end acceptance.

## Handoff and feedback

- PM submits each completed story immediately; does not wait for the entire backlog.
- Architect records ambiguous domain/permission choices in its requirement/ADR document. PM answers against evidence before work is marked development-ready.
- UI/UX must return all states, readable copy, keyboard behavior and a screenshot/design comparison; image-generated visuals are concept references, never proof of usable controls.
- QA uses story acceptance identifiers for API/browser/security tests and records actual versus expected results. Missing tests or provider availability are named limitations, not a pass.
- After development, PM checks user outcomes and architect/QA checks contracts and integration. Only the architect/release owner commits the reviewed exact paths and releases the exact tested revision.

## Common product boundaries

- An assessment role is an occupational profile, not an IdP access role. Changing it must never grant permissions.
- IdP remains the identity, organisation and membership authority. Approximately ten pilot people are existing organisation members, not a second Performance person directory.
- AI is optional. AI suggestions are source-referenced drafts and never independent evidence or automatic employment decisions.
- SFIA and internal levels preserve their own meanings. Matching numbers are not equivalence; cross-source conversion belongs to explicit versioned scoring configuration.
- A document may contain instructions. Its content is assessment data, never authority to run tools, expose secrets, change privileges or bypass assessor confirmation.
- Do not mark planned work implemented in the final PDF. Each delivered feature needs revision, test and screenshot evidence; remaining scope is labelled planned/blocked.

# Unified appraisal cycles

## Requested outcome

Use the existing competency cycle as the single appraisal configuration. A manager or administrator chooses regular appraisal, role competency, or combined assessment; one-time or periodic; published roles/frameworks; and scoring. Launching creates the existing appraisal workflow and its role assessment together. Historical reviews retain their original snapshots.

## Contracts

- `CompetencyCycle` is the canonical configuration. Add `reviewMode`, `cadence`, `regularTemplateId`, and server-assigned `configurationScope`. Existing cycles mean competency / one-time.
- Regular mode does not require competency sources. Competency/combined modes require published roles, native levels and explicit scoring conversions. No implicit SFIA-to-appraisal rating conversion.
- An occurrence is identified by canonical cycle + reviewed start/end dates (one-time cycles have one fixed occurrence). A hidden `AppraisalCycle` stores the existing workflow's period state; it is an execution record, not a second setup.
- Atomic launch validates all participants and reviewers against the current IdP directory, then creates execution record, appraisals and linked assessments in one Mongo transaction. An occurrence/participant can launch only once, including retries/concurrency. Repeated periodic occurrences may assess the same employee.
- Freeze role/framework definitions and derived evidence questions in the appraisal snapshot. The existing AI conversation uses those questions. AI text remains a draft; the existing published competency result and human final outcome remain required.
- Managers receive the canonical IdP cycle-management grant, can configure their own team cycles and select published organisation roles/frameworks. Shared strategy/framework/role library editing remains organisation administration. Server scope checks precede writes.
- Keep legacy routes/history readable; direct new setup/navigation to the canonical cycle library. Do not rewrite finalised reviews.

## Acceptance and verification

1. Regular, competency and combined configurations validate conditionally; bad modes/cadences/stale revisions fail.
2. Manager can create/publish own configuration; cannot mutate another manager/admin configuration or shared strategy via the new grant. Members remain denied.
3. Launch is all-or-nothing, tenant scoped and idempotent. A periodic second occurrence succeeds; overlapping/changed assignments are rejected. One-time cannot be repeated for another period.
4. Question queue contains the selected role's native expectations; competency-only excludes generic behavioural criteria. Combined includes regular and role questions. Later library edits cannot change captured questions.
5. Existing scoring, finalisation, audit, source feedback and historical reports remain valid.
6. Build frontend; run relevant backend persistence/auth/AI regressions and IdP contracts; inspect desktop/mobile/error/keyboard setup. Record self-review honestly; side-conversation rules prohibit subagents.
7. Deploy exact tested main revision, migrate the competency occurrence index with rollback guidance, verify revision/OIDC/authenticated manager/admin flows. Configure live examples only in confirmed organisations and with confirmed lawful SFIA provenance.

## Live configuration pending user input

AIIN and MoMo are confirmed targets. SFIA permission/provenance is still pending. Solution Architect and Product Manager examples use the appropriate native skill level ranges, published versions, authored evidence prompts, explicit conversions, and no real employee decision fixtures. Do not claim live setup until verified.

## UX brief

Project: existing Performance product. Surface: cycle setup and appraisal launch. Primary decision: what is assessed, followed by repeat schedule and role expectations. Retain existing MUI/suite theme and Apple-informed typography/spacing, semantic labelled controls, visible errors and accessible mobile actions. No second cycle selector, raw JSON, protocol details or decorative dashboards in the setup. Legacy history stays accessible through contextual links.

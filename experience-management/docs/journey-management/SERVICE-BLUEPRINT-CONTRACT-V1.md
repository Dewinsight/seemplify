# Service blueprint contract v1

**Status:** Implemented as a pure domain foundation; not a shipped blueprint workspace  
**Code:** `backend/src/journeyServiceBlueprint.ts`  
**Contract version:** `journey-service-blueprint/v1`

This contract keeps a service blueprint structurally distinct from a generic
journey card grid. It provides deterministic validation and comparison rules
that persistence, APIs, the editor, analytics, and exports can share.

## Lanes and lines

The ordered lanes are customer, frontstage, backstage, supporting system, and
policy/control. Relationships crossing lane boundaries derive these standard
lines rather than storing decorative line positions:

| Boundary | Derived line |
| --- | --- |
| Customer to frontstage | Interaction |
| Frontstage to backstage | Visibility |
| Backstage to supporting system | Internal interaction |

A relationship crossing several boundaries lists every crossed line in stable
top-to-bottom order. Policy/control is modelled as a typed lane, but no fourth
industry-standard line is invented between policy/control and systems.

## Structured operational semantics

Elements can identify an owner team, actor, system, vendor, and control. They
can carry an SLA in minutes, unit cost, probability/impact risk inputs,
evidence references, and metric references. Validation rejects non-positive
SLAs, negative costs, partial risk inputs, risk values outside `0..1`, missing
stages, duplicate IDs, missing relationship targets, self-links, duplicate
relationships, and dependency cycles.

The analyser also reports review warnings rather than manufacturing facts:

- an operational element without an owner;
- a frontstage element without backstage support;
- a backstage element without supporting-system support;
- a failure point without a mitigation.

Risk score is the transparent product `probability × impact`; it is not a
prediction and it does not imply evidence strength.

## Current and future comparison

The comparison function is restricted to the same space and journey
definition. Stable element and relationship IDs produce deterministic added,
removed, and changed sets. It does not infer business benefit or causation.
Those claims require linked metrics, evidence, and initiatives in later phases.

## Remaining release work

This contract alone does not complete master-plan requirements P4-04, P4-05,
or P4-07. Completion still requires additive SQLite/PostgreSQL persistence,
immutable versions, CRUD and comparison APIs, granular permissions and plan
enforcement, an accessible blueprint editor and table alternative, metric and
initiative linkage, current/future views, faithful export, migration, audit,
large-blueprint performance evidence, and browser tests.

# Journey portfolio domain v1

Status: foundation domain contract; no persistence, API, authorisation, audit stream, notification, export, or user interface.

Implementation: `backend/src/journeyPortfolioDomain.ts`

Tests: `backend/test/journey-portfolio-domain.test.ts`

Version: `journey-portfolio-domain/v1`

## Purpose

The v1 module defines the reusable portfolio graph needed to move from isolated map-card strings to governed pain points, opportunities, solutions, and initiatives. It is a pure validation and calculation layer. It does not claim that these records are stored, permissioned, searchable, editable, or rendered anywhere in the product.

## Canonical records

All four item types have a stable item ID, space, revision, title, description, ownership, evidence links, tags, and created/updated times.

- A **pain point** is a reusable participant problem with severity and frequency. Validation requires evidence before it can enter the validated state.
- An **opportunity** describes a desired outcome. It must link to a pain point before validation.
- A **solution** is a falsifiable response hypothesis with constraints and optional cost/effort estimates. It must link to an opportunity before validation.
- An **initiative** is owned, scheduled delivery work. Planned or later states require a solution link, owner, dates, review cadence, and an exact versioned metric target.

The typed item relationship chain is deliberately directional:

```text
pain point -> opportunity -> solution -> initiative
```

Recovery tickets and assistant actions are not initiatives. A future adapter may create typed references between those systems, but it must not collapse their identity or audit history into the portfolio item.

## Cross-journey reuse and snapshots

`JourneyPortfolioJourneyLink` connects one canonical item to a journey, stage, touchpoint, or persona. Relationships are restricted by item kind:

| Item | Allowed journey relationship |
| --- | --- |
| Pain point | `occurs_at`, `affects` |
| Opportunity | `improves` |
| Solution | `changes` |
| Initiative | `delivers` |

A working-journey link has no journey version or embedded item snapshot and must point at the current canonical item revision. Editing the canonical record therefore updates current working views.

A published-journey link has an exact journey version and a pinned item snapshot. It may retain an earlier canonical revision after the reusable item changes. This is the domain-level rule needed for published versions to remain historically accurate; durable immutable storage and publish-transaction enforcement remain future work.

The graph validator returns deterministic cross-journey usage rows with distinct journey IDs and link counts. It rejects missing typed endpoints, cross-space links, invalid item/relationship combinations, duplicate IDs, invalid applicability windows, and inconsistent snapshot/revision metadata.

## Lifecycle rules

Reusable insight states are:

```text
draft -> validated -> approved -> archived
```

Controlled rework is allowed from `validated` to `draft` and from `approved` to `validated`. Archival is terminal in v1.

Initiative states are:

```text
draft -> planned -> active -> completed -> archived
                    |   ^
                    v   |
                  blocked
```

Draft/planned/active work can be cancelled through the explicit allowed transitions, and cancelled work can be archived. Starting an initiative requires all declared prerequisites to be completed. Completion requires an actual end date and at least one recorded outcome-comparison identifier.

`validateJourneyPortfolioLifecycleTransition` returns sorted machine-readable issues and does not mutate the item. Persistence must perform validation and state change atomically and append the actor, reason, prior state, resulting state, and revision to an audit stream.

## Dependencies

Dependencies are directed initiative-to-initiative edges. `initiativeId` depends on `dependsOnInitiativeId`; topological order therefore places prerequisites first. Self-references, missing initiatives, cross-space edges, repeated directed pairs, and cycles are invalid.

Cycle reporting is canonical and input-order independent. This makes validation stable under database ordering, replay, and test-fixture reordering. Both `finish_to_start` and `blocks` are treated as ordering constraints in v1. Richer scheduling semantics, lag time, partial completion, and resource capacity are not modelled.

## Prioritisation

`assessJourneyPortfolioPriority` reuses the existing versioned RICE/ICE arithmetic from `journeyPortfolioScoring.ts`. The assessment adds item kind, item ID, item revision, policy version, assessment ID, and assessment time.

RICE or ICE is not itself a priority decision. Thresholds, bands, tie-breaking, mandatory work, strategic weighting, and approval remain separately versioned organisation policy. Missing scoring inputs stay incomplete rather than becoming zero.

## Immutable baseline and outcomes

`createJourneyInitiativeBaseline` captures:

- initiative ID and exact revision;
- target metric ID, metric-definition version, direction, target, and unit;
- observation value, numerator, denominator, sample size, source references, calculation version, population/filter keys, timezone, and period;
- capture actor/time;
- a canonical SHA-256 checksum over the complete payload.

The returned baseline is recursively frozen in memory. `verifyJourneyInitiativeBaseline` rejects a deserialised or otherwise modified payload whose checksum no longer matches. Production persistence must additionally make baseline rows append-only and deny updates at the repository/database layer; an in-memory freeze is not a storage control.

`compareJourneyInitiativeOutcome` accepts only comparable before and after observations. They must use the same metric and calculation versions, unit, population, filters, sources, timezone, and window length, and their periods must not overlap. It returns the immutable before and after observations, absolute and relative change, direction-aware improvement, and target status. Numerator, denominator, and sample size remain visible in each observation.

Every result is explicitly labelled `descriptive_before_after` and says that it does not establish either causation or statistical significance. Meeting a target means only that the observed after value crossed the declared threshold under the supplied comparable definitions.

## Limits and remaining production work

This module proves only a domain contract and pure validation behaviour. Phase 3 still requires:

- normalised SQLite/PostgreSQL schema, migrations, repositories, transactions, and deletion/retention behaviour;
- immutable published snapshots and baseline enforcement in durable storage;
- space and journey capabilities, entitlements, quotas, and field-level authorisation;
- evidence resolution and evidence-access checks for portfolio records;
- audit events, approval history, comments, mentions, watchers, notifications, and review queues;
- typed bridges to recovery tickets and assistant actions without identity conflation;
- configurable scoring policy, benefit accounting, currency/unit handling, and target governance;
- dependency editing, concurrency control, progress updates, overdue rules, and scheduled reviews;
- table, board, matrix, dependency-tree, executive, saved-view, sharing, and export surfaces;
- API pagination, search, filtering, usage counts, optimistic concurrency, and bulk operations;
- enterprise-volume performance, accessibility, privacy, security, and permission tests;
- outcome study-design metadata when a team wants to make a causal or statistical claim.

Until those controls exist, this file must not be cited as evidence that the Phase 3 portfolio is production-complete.

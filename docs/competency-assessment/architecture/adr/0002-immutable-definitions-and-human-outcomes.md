# ADR 0002 — Immutable definitions and human-owned outcomes

Status: proposed, 18 October 2026. Stories: role/framework versioning, evaluation, scoring, finalization and reports.

## Context

The PRD requires historical source levels and calculation rules, explicit conversion between frameworks, optional AI drafts and a human final classification. Editing a role/framework must not rewrite existing results. Different sources' level numbers do not establish equivalence.

## Decision

Publish immutable role/framework/strategy versions; freeze readable definitions and scoring/ranking policy at assessment launch. Deterministic pure scoring converts only explicit measures to a declared scale. Missing required findings remain visible and block finalization unless a permitted reasoned exception is recorded. Preserve calculated score/suggested outcome separately from final human classification. Reopening appends a result revision; it never edits an issued report. AI cannot set a rating/classification or become independent evidence.

## Consequences and proof

Snapshots use more storage but remove dependency on mutable libraries and allow reproducible exports. Strict ranking hashes exclude incomparable results. QA edits live libraries after finalization and proves unchanged historical JSON/PDF; tests exact threshold edges, weights, missing evidence, exception denominator, classification overrides, ties, incompatible versions and AI review boundaries.

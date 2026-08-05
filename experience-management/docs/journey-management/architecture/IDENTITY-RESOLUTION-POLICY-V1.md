# Journey identity-resolution policy v1

Status: **foundation / non-production**  
Policy version: `journey.identity-policy.v1`  
State version: `journey.identity-state.v1`

## Purpose

`backend/src/journeyIdentityPolicy.ts` is a pure, deterministic state machine for reviewing the safety semantics of future connected-journey identity resolution. It defines which facts may bind a profile, which actions require explicit privilege, how merges can be reversed, and how deletion prevents delayed events from recreating an identity.

It is intentionally isolated from databases, queues, HTTP routes, SDK ingestion, consent services, and Customer 360 projections. Returning an accepted decision from this module does **not** make an identity pipeline production-ready.

## Policy invariants

1. Every profile, binding, group membership, merge, tombstone, command id, and lookup is scoped to one `spaceId`.
2. Only exact opaque identifiers are accepted:
   - `anonymous_id` for an anonymous observation;
   - `authenticated_user_id` for an authenticated identify event;
   - `external_user_id` for a known source-system profile or authorised alias.
3. Identifier values are case-sensitive and are not trimmed, lower-cased, or otherwise normalised. Namespace and value must match exactly.
4. Email address, name, IP address, device id, and device fingerprint are rejected as join signals. They cannot resolve, alias, or merge a profile.
5. Authenticated identify may promote one anonymous profile to `known`, but it never silently coalesces two profiles. A conflicting authenticated identifier fails closed.
6. Alias, merge, split, membership, and deletion actions require an authenticated actor with their specific permission.
7. Merge creates an explicit redirect from a source profile to a canonical target. It does not rewrite bindings or move source facts.
8. Split deactivates that redirect and appends a separate audit decision. The original merge fact remains.
9. Group and account membership is allowed only for a known profile and a group in the same space.
10. Deletion tombstones every profile and exact binding in the canonical merge set. Later observations or identify events cannot resurrect them.
11. An identical command replay returns the original result without adding facts. Reusing its id with different content is rejected without state mutation.
12. Every accepted or rejected command returns a policy/state version, stable code, human-readable explanation, and structured audit details.

## State and fact model

The state contains two different categories by design:

- **Source and audit facts:** append-only references that record the profile on which the fact originally arrived and the decision made at the time. Merge, split, membership removal, and deletion do not remove them.
- **Operational indexes:** current profile status, exact bindings, active merge redirects, active memberships, processed command fingerprints, and deletion tombstones. These enable deterministic lookup and replay.

Callers should treat the state returned by `applyJourneyIdentityCommand` as the only candidate next state. The input is never mutated. A future persistence adapter must commit the command, audit fact, source fact, tombstones, and operational indexes atomically.

## Commands

| Command | Required permission | Important behaviour |
| --- | --- | --- |
| `observe` | `identity:observe` | Creates/updates an anonymous or known profile from one allowed exact identifier and stores the source reference. |
| `identify` | `identity:identify` | Requires `authenticated_user_id`; promotes one profile to known; conflicting binding is rejected. |
| `alias` | `identity:alias` | Explicitly adds a non-conflicting exact identifier with a recorded reason. |
| `merge` | `identity:merge` | Explicit, same-space, reasoned canonical redirect; retains both profiles and their source facts. |
| `split` | `identity:split` | Reverses an active merge redirect while retaining merge and split audit history. |
| `add_membership` / `remove_membership` | `identity:membership` | Maintains same-space account/group membership for known profiles and retains the source fact. |
| `delete` | `identity:delete` | Tombstones the canonical identity set and its exact bindings; retains historical facts. |

## Lookup semantics

`resolveJourneyIdentity` performs a single exact lookup inside the supplied space. Its result is one of:

- `resolved / exact_match` with the originally bound profile and current canonical profile;
- `not_found / identifier_not_found`;
- `deleted / profile_deleted_tombstone`;
- `rejected / heuristic_identifier_forbidden` or `invalid_identifier`.

The function never falls back to another space and never searches similar values.

## Required work before production use

This foundation does **not** yet provide:

- durable or transactional persistence, concurrency control, an outbox, or distributed idempotency;
- API routes, authorisation middleware, administrative review workflow, or UI;
- consent/withdrawal enforcement, purpose limitation, lawful-basis policy, or regional residency controls;
- identifier encryption/tokenisation, key management, redaction, or log-safety enforcement;
- retention scheduling, legal holds, verified erasure execution, or downstream deletion propagation;
- identity-confidence workflows, manual conflict queues, bulk merge review, or four-eyes approval;
- SDK ingestion integration, event-time ordering, late-arrival windows, or replay/backfill controls;
- a Customer 360 profile, segment projection, journey-path projection, metrics, or orchestration;
- persisted group/account records or authoritative membership synchronisation;
- performance, load, chaos, migration, privacy, or penetration testing.

Before integration, security and privacy owners must ratify identifier classification, consent semantics, deletion propagation, operator permissions, audit retention, and incident-response requirements. Upstream systems should send pseudonymous identifiers; raw email, name, IP, and device fingerprints must not be repackaged as an accepted identifier kind.

## Verification

The golden test suite is `backend/test/journey-identity-policy.test.ts`. It covers space isolation, anonymous and known profiles, authenticated identify, conflict fail-closed behaviour, privileged alias/merge/split, idempotent replay, same-space memberships, heuristic and cross-space rejection, fact preservation, and deletion tombstones.


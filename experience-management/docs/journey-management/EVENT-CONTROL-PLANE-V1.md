# Journey event control plane v1

**Status:** Pure contract plus PostgreSQL runtime-schema-16 persistence foundation; release gates remain open  
**Code:** `backend/src/journeyEventControlPlane.ts`  
**Contract version:** `journey-event-control-plane/v1`

## Source policy

Every source is scoped to one space and one development, staging, or production
environment. Policy records carry active/paused/revoked state, observe/warn/
enforce validation mode, event and byte rate ceilings, and optional browser
origin or application-bundle allowlists.

Origins must be exact HTTPS origins; HTTP is accepted only for loopback local
development. Origin checks are abuse diagnostics, not authentication. A public
write key is necessarily visible in client code and grants only `events:write`.
It cannot read events, profiles, maps, settings, or analytics.

## Credentials

The contract distinguishes public write keys from server secrets and encodes
their kind and environment in a non-secret prefix. Plaintext is returned once.
The durable record contains a key ID/prefix, random salt, and scrypt digest—not
recoverable plaintext. Verification checks source, space, environment, status,
scope, expiry, and digest with constant-time comparison.

Rotation creates a new credential and either revokes the prior key immediately
or gives it a bounded overlap of at most seven days. Explicit revocation takes
effect at the supplied timestamp. Production persistence must encrypt any
exceptional recoverable secret separately; this contract does not support
recovery.

### Metric-import authority

Runtime 21 deliberately reuses the server-only `events:write` capability for
`/v1/metric-imports`; it does not treat that scope as blanket metric access.
Admission additionally requires the credential to remain active at commit,
the exact source/space/environment tuple, an exact published schema belonging
to that source, an active operational metric definition, and a configured
source reference plus schema/projection/rule lineage matching the request.
Public/browser keys, other sources or environments, unpublished/foreign
schemas, expired overlap keys, revoked keys, unconfigured definitions, and
caller-spoofed lineage fail closed. Persisted lineage is normalized from the
authoritative definition rather than trusted from the caller.

## Tracking plans and schemas

Event and property names use `lower_snake_case`. Every property declares a
purpose, type, requiredness, and data class. Bounds and small enums are
explicit. Content-bearing names and credential/prompt/body/document/raw-payload
fields are rejected by default.

Compatibility allows optional property additions. It rejects event/schema
identity changes, property removal, type changes, newly required fields, and an
optional field becoming required. A data-class change is always surfaced for
privacy review.

Observe mode accepts safe payloads and reports drift. Warn mode accepts safe
payloads while retaining error diagnostics. Enforce mode rejects validation
errors. Unsafe object keys and structural bounds fail in every mode.

## PostgreSQL runtime-16 guarantees

The runtime-16 migration persists sources, credentials, schemas, immutable
schema-version content, and content-free control-plane audit events. Composite
foreign keys bind credentials to source + space + environment, and schemas and
versions to their source/tenant ancestry. Partial unique indexes serialize
one-active-key and one-published-version races. Database triggers reject
cross-source rotations, cross-tenant audit references, content mutation after
version insertion, and invalid lifecycle transitions. The runtime role can
append audit rows but cannot update or delete them.

The SQLite-to-PostgreSQL cutover explicitly normalizes the runtime-16 integer
widths and translates only the canonical major.minor SQLite `GLOB` check; all
other unsupported expressions remain fail-closed. The checksummed migration,
runtime contract, least-privilege contract, nested rollback, quota mutex, and
zero-proof-write cleanup are covered by the isolated PostgreSQL probe.

## Remaining release work

Runtime-16 does not by itself complete public ingestion, distributed rate
limiting, debugger/dead-letter/replay, data-plane revocation propagation,
privacy approval, or the production browser gate. P5A-02 and P5A-03 remain
foundations until the control-plane API/UI and those data-plane/release pieces
are complete and production evidence exists.

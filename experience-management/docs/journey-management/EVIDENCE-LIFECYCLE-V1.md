# Journey evidence lifecycle v1

**Status:** Implemented as a pure lifecycle foundation; integration pending  
**Code:** `backend/src/journeyEvidenceLifecycle.ts`  
**Contract version:** `journey-evidence-lifecycle/v1`

An evidence link stores a bounded snapshot for review and audit, while the
source system remains authoritative for access. Reading a link must resolve the
source under the current viewer's space, feature, privacy, and ownership rules.

The contract produces one of three refresh states:

- `current`: the authorised source still matches the reviewed snapshot;
- `changed`: one or more snapshot fields changed and require explicit review;
- `unavailable`: the source cannot be resolved for this viewer.

Unavailable links disclose only the source type and the fact that a link is no
longer usable. Canonical reference, label, excerpt, population, sample size, and
dates are redacted. This prevents an old journey snapshot from bypassing a
source deletion, privacy change, plan change, ownership boundary, or tenant
boundary.

Change sets name changed fields but record only SHA-256 hashes of prior and
current field values. A refresh applies only when the caller supplies the
expected snapshot fingerprint, the source identity is unchanged, the actor and
timestamp are present, and the target is a draft or reusable shared record.
Published and superseded version evidence is immutable.

## Remaining integration work

The pure contract does not yet update Journey Map read models. P1-09 still
requires additive snapshot metadata and durable audit persistence, current-user
availability evaluation in map and persona reads, a refresh/review API and UI,
source-change notification jobs, deletion/access propagation tests, export
redaction, and browser coverage. Until that wiring is complete, existing map
summary counts can still differ from the evidence drawer after source access is
removed.

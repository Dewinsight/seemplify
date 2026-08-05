# ADR-0006: Safe orchestration and idempotent action delivery

**State:** Proposed  
**Scope:** Phase 5D  
**Decision owners:** Action platform, security/privacy, operations, product

## Decision

1. Workflow definitions and published versions are immutable. A run records the
   exact trigger fact, subject, rule/workflow versions, conditions, decisions,
   suppressions, approvals, action attempts, provider result, and outcome.
2. Trigger evaluation and action dispatch use a transactional outbox. Every
   `(workflow version, trigger, subject, action)` has a stable idempotency key.
3. Consequential or externally visible actions require human approval by
   default. A separately authorised administrator may enable only bounded
   automation with explicit caps, purpose, adapter, recipient scope, and audit.
4. Consent, suppression, entitlement, quota, quiet hours, frequency caps, source
   state, and all kill switches are rechecked at execution, not only evaluation.
5. Provider attempts distinguish retryable, terminal, and unknown outcomes.
   Unknown external effects are not blindly retried; they enter review/reconcile.
6. Initial adapters reuse surveys, service-recovery tickets, assistant actions,
   internal notifications, and signed webhooks. Email/social sends retain their
   existing review guarantees unless explicitly authorised and bounded.
7. Simulation and dry run execute the same condition/policy engine without
   dispatching effects and explain every match/non-match and suppression.
8. Kill switches exist at platform, space, workflow, adapter, profile/consent,
   and source levels and safely stop or quarantine eligible pending work.
9. Webhooks enforce scheme/host validation, DNS/IP revalidation, redirect and
   private-network policy, secret protection, body signing, timestamp/nonce
   replay defence, bounded responses, and egress timeouts.

## Verification gates

- Duplicate trigger and crash-at-every-boundary failure injection proves no
  duplicate consequential effect.
- Consent withdrawal, suppression, cap, quiet-hours, revoked entitlement,
  approval rejection, provider outage/unknown result, and kill-switch tests.
- Complete immutable run/action audit and outcome reconciliation.


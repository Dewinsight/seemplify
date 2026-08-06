# Runtime 15 usage metering

## Enforced invariant

`platform_usage_events` is the immutable accounting source and
`platform_usage_buckets` is its reconcilable monthly materialization. Generic
metered consumption, including `monthlyJourneyExports`, takes a PostgreSQL row
lock on the owning `spaces` record before it checks idempotency, evaluates the
allowance, appends the ledger event, and increments the bucket in one
transaction.

The production-shaped PostgreSQL regression uses an independent database
session to hold that row lock while concurrent export requests are admitted.
It verifies that:

- concurrent replays of one idempotency key produce one ledger event and one
  bucket increment;
- reusing a key for the same intent returns the original receipt;
- only the remaining allowance succeeds when different keys race at the
  boundary;
- the rejected request leaves no ledger or bucket increment; and
- the immutable ledger and materialized bucket finish with the same quantity.

## Mixed AI admission is closed

`monthlyAiActions` now admits direct and durable work through the same immutable
ledger, aggregate bucket, and per-space mutex. A durable reservation identity is
the tuple `(job ID, execution generation, attempt)`, so a replay cannot charge
twice and a genuinely new retry cannot reuse an earlier allowance.

An attempt is charged to the UTC month in which its reservation commits. Its
durable identity is globally replayable across monthly periods: for example, an
attempt reserved on 31 August and claimed on 1 September remains an August
charge. A retry reserved in September is a separate September charge. Delayed
claims therefore never move or duplicate previously committed usage.
Direct AI request identities (`actionId` plus `requestKey`) follow the same
cross-month replay rule. Generic monthly meter keys, including export keys,
remain period-scoped, so deliberately repeating a generic key in a new month is
a new monthly reservation.

The enforced durable lifecycle is:

1. creation reserves generation 0, attempt 1 and inserts the `ai_jobs` row in
   one transaction;
2. the first worker claim replays that existing reservation before dispatch;
3. automatic retries reserve the next attempt before returning the row to the
   queue;
4. manual retries reserve generation + 1, attempt 1 before resetting the job
   and linked artifact; and
5. a quota-denied claim terminally fails the job and its linked intelligence,
   deep-analysis, or assistant record, publishes the normal state event, and
   continues to the next eligible space.

The guarded low-level row insert is used only by the admitted coordinator.
Unmetered creation/claim wrappers live in a test-only helper module, and a
static regression prevents production producers or the worker from bypassing
the coordinator.

Pre-runtime-15 durable rows remain readable during adoption. Under the same
space lock, the compatibility path materialises every missing prior attempt in
the ledger and increments the bucket only for newly inserted events. Once any
durable ledger event exists for a job, that job is excluded from the temporary
`ai_jobs` compatibility count, preventing overlap. Reconciliation therefore
compares the complete direct-and-durable ledger with its bucket.

The PostgreSQL regression no longer stages raw SQL to demonstrate an overshoot.
It starts two independent built-application processes, one direct and one
durable, blocks both behind a third session's `spaces ... FOR UPDATE` lock, and
releases them together against a limit of one. Exactly one succeeds, the other
returns `SUBSCRIPTION_QUOTA_EXCEEDED`, the bucket and ledger both equal one,
and a durable job exists only when durable admission won.

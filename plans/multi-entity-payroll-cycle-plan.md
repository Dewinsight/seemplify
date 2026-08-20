# Multi-Entity Payroll Cycle and Accountant Release Plan

## Outcome

Allow an organisation to process one pay period across multiple legal employers while preserving the statutory boundary of each employer, jurisdiction, tax pack, and currency. Replace the visible Submit → Approve → Finalize sequence with a policy-driven Submit → Approve and release workflow, then deliver accounting exports securely to configured accounting contacts.

## Core decisions

1. A statutory payroll run remains limited to one legal employer, jurisdiction, tax-pack version, and currency.
2. A new payroll cycle groups all statutory child runs for the same organisation and pay period.
3. Consolidated reporting may convert child-run totals into the organisation reporting currency, but statutory calculations and exports retain their native currency.
4. Finalization remains transactional because it commits loan deductions, compensation consumption, payslip state, and immutable audit history.
5. Finalization becomes an automatic system action after the final required approval rather than a separate user-facing button.
6. Organisations can require separation of duties. When enabled, a payroll creator cannot approve their own submission.
7. Accountant delivery uses an authenticated, expiring download link with an audit trail. Sensitive payroll files are not sent as open email attachments.

## Data model

### PayrollCycle

- `organizationId`
- `cycleNumber`
- `payPeriod`
- `paymentDate`
- `reportingCurrency`
- `employerEntityIds`
- `runIds`
- `status`: `draft`, `calculating`, `review`, `pending_approval`, `releasing`, `released`, `partially_failed`, `cancelled`
- native-currency and converted summaries
- readiness failures per legal employer
- created/submitted/approved/released audit fields
- optimistic version and idempotency key

The unique active-period constraint must be scoped to organisation, legal employer, pay-period type, and period key. A cycle may contain several runs for a period, but only one active child run per employer and period.

### PayrollApprovalPolicy

- `organizationId`
- optional `employerEntityId`
- `approvalRequired`
- `requiredApprovalLevels`
- `separationOfDuties`
- allowed approver roles and explicit approver user IDs
- release behaviour: automatic after final approval
- accountant-delivery behaviour

### PayrollAccountingContact

- `organizationId`
- optional `employerEntityId`
- name and email
- optional telephone number for contact reference only
- preferred accounting format
- locale and delivery preferences
- active flag
- verification and audit fields

### PayrollDelivery

- cycle/run identity
- recipient identity
- artifact identity and checksum
- secure-link expiry
- state: `queued`, `sent`, `delivered`, `failed`, `expired`, `revoked`
- provider message ID
- attempt count, retry time, and redacted error
- sent/opened/downloaded timestamps

## Backend implementation

### Cycle preflight

Add an endpoint that accepts a pay period and selected employer entities. For every entity it must return:

- assigned and eligible employee count
- jurisdiction and tax-pack version
- payroll currency
- employer readiness issues
- missing variable-work inputs
- duplicate-period conflicts
- missing historical exchange rates for consolidated reporting

The preflight must not create runs or mutate payroll state.

### Cycle creation

Create the cycle idempotently, then create one child `PayrollRun` per selected employer. Each child continues to use the existing engine and employer-assignment validation. A failure for one entity must not corrupt successful child calculations; the cycle records a partial failure and supports retrying only failed children.

### Submission and release state machine

Replace the public three-action workflow with:

1. `Calculate`: produces reviewable draft payslips.
2. `Submit`: freezes the reviewed calculation revision.
3. If approval is not required, automatically finalize and release.
4. If approval is required, enter `pending_approval` and notify approvers.
5. `Approve and release`: records the approval and automatically invokes transactional finalization after the last required level.
6. A rejection returns the run or cycle to review without consuming payroll-linked requests.

Keep legacy submit, approve, and finalize routes temporarily as compatibility adapters. They must delegate to the new workflow and remain idempotent.

### Transaction and concurrency controls

- Record a calculation revision and totals hash at submission.
- Approval must target the submitted revision and hash.
- Finalization must claim the run atomically.
- Recalculation invalidates previous approvals.
- Cycle release must report per-child success and failure.
- Retrying release must never double-consume loans, compensation, or attendance imports.
- Retracting a cycle must explicitly select child runs and preserve immutable delivery history.

### Accounting exports and delivery

- Continue generating one statutory accounting register per child run in its native currency.
- Generate a cycle manifest listing legal employers, currencies, checksums, and converted reporting totals.
- Support configured formats through an adapter interface; CSV remains the default.
- Store generated artifacts in managed private storage.
- Email an expiring authenticated link to each authorised accounting contact.
- Record delivery attempts and allow an authorised resend.
- Revoke outstanding links when payroll is retracted or regenerated.

## API surface

- `POST /api/payroll/cycles/preflight`
- `POST /api/payroll/cycles`
- `GET /api/payroll/cycles`
- `GET /api/payroll/cycles/:id`
- `POST /api/payroll/cycles/:id/recalculate-failed`
- `POST /api/payroll/cycles/:id/submit`
- `POST /api/payroll/cycles/:id/approve-and-release`
- `POST /api/payroll/cycles/:id/reject`
- `POST /api/payroll/cycles/:id/resend-accounting`
- CRUD routes for approval policies and accounting contacts

All endpoints require organisation-scoped authorization, strict idempotency, and content-free audit logging.

## User interface

### Run payroll

- Default to all payroll-ready legal employers.
- Allow selecting one or more entities.
- Show employee count, country, jurisdiction, currency, tax pack, and readiness for every entity.
- Explain that the system creates separate statutory runs under one cycle.
- Block only affected entities and allow the user to exclude them or fix setup.
- Collect variable work inputs grouped by legal employer.

### Cycle review

- Show a simple entity table rather than mixing currencies in one total.
- Display native totals per entity and optional converted consolidated totals.
- Make missing exchange rates explicit; never silently sum unlike currencies.
- Support opening each child run for detailed payslip review.

### Approval and release

- Creator sees `Submit payroll`.
- Approver sees `Approve and release` and `Reject`.
- Hide the standalone Finalize button.
- Show who must approve, whether self-approval is blocked, and the submitted revision.
- After release, show accounting-delivery recipients and delivery status.

### Settings

- Add Payroll approval policy.
- Add accounting contacts globally or per legal employer.
- Allow edit, deactivate, test notification, and resend permissions.
- Never display secret delivery tokens.

## Authorization

- HR/admin can calculate and submit.
- Configured approvers can approve or reject.
- Separation-of-duties policy prevents creator self-approval.
- Only owner/admin can edit approval policies and accounting contacts.
- Accounting recipients receive access only to explicitly assigned employer artifacts.
- Every download revalidates organisation, recipient, artifact, expiry, and revocation state.

## Migration and compatibility

1. Add new collections and indexes without rewriting historical runs.
2. Backfill a single-run cycle wrapper for existing runs when requested or lazily on read.
3. Preserve run IDs and current accounting-export URLs during transition.
4. Map existing `requiredApprovalLevels` into the new organisation policy.
5. Retain historical approval entries and finalization audit events.
6. Remove compatibility routes only after frontend and automation consumers have migrated.

## Tests

### Unit and service tests

- employer grouping and employee assignment
- mixed jurisdictions and currencies
- readiness and duplicate-period detection
- calculation revision and totals-hash invalidation
- separation of duties and multi-level approval
- automatic transactional finalization
- idempotent cycle creation, submission, approval, release, and delivery
- partial child failure and selective retry
- export checksums, link expiry, revocation, and resend

### Integration tests

- Nigerian, UK, and US employers in one cycle
- one failed employer does not roll back successful child calculations
- native totals remain separate from converted consolidated reporting
- compensation, loans, and attendance are consumed exactly once
- rejection and recalculation invalidate approval safely
- legacy routes delegate without changing observable contracts

### Playwright

1. Configure accounting contacts and approval policy.
2. Select multiple legal employers.
3. Review preflight by entity.
4. Calculate all child runs.
5. Verify native currencies and consolidated reporting.
6. Submit as payroll creator.
7. Verify self-approval is blocked when configured.
8. Approve and release as authorised approver.
9. Verify finalization occurs automatically.
10. Verify accounting delivery and secure download.
11. Exercise partial failure, retry, rejection, recalculation, and resend.
12. Run existing payroll tax, employer, regression, and production smoke suites.

## Acceptance criteria

- A single payroll cycle can process multiple payroll-ready legal employers.
- Every child run contains only employees assigned to its legal employer.
- No statutory run mixes legal employers, jurisdictions, tax packs, or currencies.
- Consolidated totals are shown only when valid exchange rates exist.
- The ordinary user workflow no longer exposes Submit, Approve, and Finalize as three separate actions.
- Finalization remains atomic and is automatically triggered after the final required approval.
- Self-approval follows the configured separation-of-duties policy.
- Accounting recipients receive secure, auditable access to the correct employer exports.
- Retries cannot duplicate financial state changes or accounting deliveries.
- Backend, integration, Playwright regression, smoke, and production revision checks pass before release.

## Delivery sequence

1. Models, indexes, migration, and policy service.
2. Cycle preflight and orchestration.
3. Approval/release state machine and compatibility adapters.
4. Accounting artifact and delivery service.
5. Settings and run-cycle interfaces.
6. Unit and integration coverage.
7. Playwright end-to-end and regression coverage.
8. Commit to `main`, push, monitor deployment, and verify the exact live revision.

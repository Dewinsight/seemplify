# Connected application contracts

All service messages carry `schemaVersion`, `eventId`, `organizationId`, `subjectId`, `occurredAt`, `correlationId`, and `idempotencyKey`. HTTP requests use a timestamped HMAC signature. Receivers reject expired timestamps, invalid signatures, unknown applications, and mismatched authenticated identities.

## Ownership and direction

| Source | Target | Purpose |
| --- | --- | --- |
| Recruiter | IDP | Explicit HR membership provision/reactivation and scheduled, completion-based, manual, or emergency deactivation. |
| IDP | Recruiter | Audited confirmation that a scheduled or immediate identity action completed. |
| IDP | Time & Attendance | Member, team, manager, department, jurisdiction, and application-access lifecycle events. |
| Leave | Time & Attendance | Approved, changed, and cancelled leave plus public-holiday reconciliation. |
| Time & Attendance | Payroll | Approved pay-code imports and later versioned adjustment deltas. |
| Performance | Time & Attendance | Read-only approved attendance context for a review period. |
| Approved web apps | Their local backend | Authenticated, same-origin reports whose backend binds the application, employee and organization. |
| Local app backends | Time & Attendance | Minimal presence evidence over signed service calls. |

Delivery attempts are persistent, retryable, idempotent, and dead-lettered after exhaustion. Nightly reconciliation repairs missed IDP roster and Leave events. Payroll acceptance locks the exported timesheet version; a later correction is a delta event, never an overwrite.

Scheduled IDP deactivations are included in reconciliation snapshots so a nightly roster repair cannot erase an effective exit. Recruiter consumes the resulting lifecycle event to close the corresponding `PeopleTransition` identity action idempotently.

## Presence data minimisation

The application registry contains Time & Attendance, IDP, Payroll, Performance Management, Leave Management, and the Recruiter staff console. Experience Management and the Recruiter candidate portal are excluded.

Reporters send only application ID, authenticated employee and organization, session start/end, visible-tab heartbeat, last meaningful safe navigation/action category, browser session ID, and app version. They must never send a URL query string, field value, typed text, document content, screenshot, camera image, biometric, or arbitrary DOM text.

The default heartbeat is 120 seconds while authenticated and visible. Evidence is stale after five minutes. It is supporting evidence only and cannot change pay, timesheet approval, discipline, productivity scoring, or performance ratings.

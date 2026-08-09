# Modernisation release rollout

Do not apply schema indexes, seeds, onboarding migration, or cutover flags without a database snapshot and an approved change window.

## Pre-release gates

1. Run backend tests and all affected frontend production builds.
2. Run `npm run indexes:modernize:dry-run`, review the proposed indexes, then run `npm run indexes:modernize` in the approved window.
3. Run `npm run rules:seed:dry-run`, obtain jurisdictional approval for each draft template, then run `npm run rules:seed`. Seeded packs remain drafts until an authorized administrator publishes them.
4. In `recruiter/backend`, follow the PeopleTransition migration runbook. Do not enable IDP cutover until counts and document hashes reconcile and rollback has been tested.
5. Run `npm run calculations:shadow -- --organization <id> --limit 1000`. Investigate every material difference. This command is read-only and never recalculates or saves a timesheet.
6. Complete security, privacy, accessibility, load, payroll-reconciliation and monitoring-impact gates.

## Staged release

1. Internal test organizations.
2. Nigeria organizations using reviewed Nigeria packs.
3. United Kingdom organizations using reviewed UK packs.
4. EU organizations country by country after each national overlay is reviewed.
5. Global fallback organizations after organization-level policy review.

For the IDP onboarding cutover, set `RECRUITER_PEOPLE_TRANSITIONS_CUTOVER=true` and initially set `RECRUITER_PEOPLE_TRANSITIONS_ORGANIZATION_IDS` to a comma-separated allowlist. Remove the allowlist only after all organizations have passed reconciliation.

Monitor dead-letter jobs, webhook delivery, roster and leave reconciliation, payroll acceptance, notification fallback, presence deletion, and shadow-calculation differences throughout rollout. Roll back the feature/cutover flag before restoring data; never overwrite approved attendance history to reverse a release.

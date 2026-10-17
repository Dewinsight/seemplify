# OKR creation index repair

The production `organizationId_1_assignment.idempotencyKey_1` unique sparse index included ordinary goals because `organizationId` is always present. A second ordinary goal in the same organization therefore collided on a missing retry key. This affected organization, team and individual goal creation, independently of the user's permission to create them.

The replacement, `okr_assignment_idempotency_v2`, is unique on the same tenant/key pair, with a partial filter requiring a string retry key. It permits repeated missing/null keys and still rejects a duplicate real key within a tenant. Different tenants can reuse the same key.

References: [MongoDB sparse compound indexes](https://www.mongodb.com/docs/v8.0/core/index-sparse/) and [partial unique indexes](https://www.mongodb.com/docs/manual/core/index-partial/).

## Deployment

The schema declares the replacement. The core deployment runs the migration from the exact release image in a disposable container before replacing the Performance backend. For an operator-initiated repair, run the commands inside the production backend environment; do not copy its database connection string into a command or this repository.

```sh
npm run migrate:goal-index
npm run migrate:goal-index:apply
```

The default is read-only. Apply builds and verifies the replacement before retiring the known legacy index. Unexpected legacy/replacement options stop the migration. Other indexes and goal documents are not rewritten. Rerunning an already completed migration is safe. Preserve the index inventory in the protected operational evidence directory before an authorized production repair.

## Regression coverage

The route suite now rebuilds OKR indexes after every database reset. This is necessary because `dropDatabase` removes the constraints being tested; the earlier fixture did not recreate them. A route regression saves an individual goal, two organization goals and a team goal in one tenant while continuing to deny a line manager's organization-wide creation request.

Migration checks reproduce the deployed sparse-index failure, preserve existing documents, verify null/missing and tenant-separated keys, reject duplicate real keys, exercise repeat runs and schema index creation after migration, refuse unexpected options, and preserve documents/unrelated indexes on a failed replacement build.

Live acceptance uses the public API and an existing OIDC-derived session kept only in server memory. Two clearly named temporary organization goals must return 201, read back with 200 and exist in MongoDB. Cleanup cancels only those exact temporary records, records a cleanup version, and cancels their scheduled reminders. It does not delete or modify a user's existing goal or invent an appraisal score. Protected proof contains status codes and checks, never cookies, tokens or connection strings.

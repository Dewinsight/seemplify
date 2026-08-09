# IDP onboarding to Recruiter PeopleTransition migration

The migration is dry-run first and does not remove IDP data. Store manifests in an access-controlled location because rollback snapshots contain original records.

## Preconditions

- Take a recoverable IDP onboarding database and file-storage snapshot.
- Ensure every IDP organization maps to a Recruiter organization and responsible Recruiter user.
- Configure `IDP_MONGODB_URI`, Recruiter `MONGO_URI`, and a protected `TRANSITION_MIGRATION_MANIFEST_DIR`.
- Keep `RECRUITER_PEOPLE_TRANSITIONS_CUTOVER` disabled in IDP. Use the optional comma-separated `RECRUITER_PEOPLE_TRANSITIONS_ORGANIZATION_IDS` allowlist for staged organization rollout before enabling it globally.

## Runbook

1. Run `npm run migrate:idp-people-transitions` in `recruiter/backend` and review planned counts.
2. Resolve missing organization/user mappings and any source-ID collision. The script refuses to overwrite a non-migration record.
3. Run `npm run migrate:idp-people-transitions:apply`. This verifies reachable original and signed document content hashes.
4. Confirm source and target counts, workflow-item counts, and every required file hash agree. Re-run safely if needed; IDs and migration markers make the operation idempotent.
5. Test active forms, document views, multi-signer envelopes, reminders, edit/cancel, and personal IDP deep links.
6. Test Recruiter `ready_to_provision` through explicit HR provisioning, lifecycle webhook delivery, and Time & Attendance roster convergence.
7. Enable the cutover flag for an internal organization, then the planned rollout groups. Legacy IDP onboarding APIs return `410` and old pages redirect to Recruiter only after verification.
8. Retain the rollback snapshot and generated EJSON manifest for the approved recovery period before retiring legacy routes/models/views.

## Rollback

Disable the cutover flag, restore the IDP snapshot if IDP data was independently changed, and run:

```text
node scripts/migrateIdpOnboardingToPeopleTransitions.js --rollback <manifest.json>
```

The manifest restores records that existed before the migration and removes records created by it. Investigate any downstream memberships already provisioned before attempting rollback; membership actions are separately audited and are not reversed by this data script.

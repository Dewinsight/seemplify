# Initiative Rule + Workflow Rollout Plan

Date: 2026-02-17

## Goal

Roll out the new dynamic governance structure safely:

- Dynamic roles
- Dynamic workflow policy
- Rule effects
- Updated system-rule seeding
- Optional non-admin role reset/reconciliation

## Execution Order

1. Backup current DB state
2. Backfill rule effects for existing rules
3. Seed/reconcile governance structure (roles + workflow policy)
4. Upload/update system rules with effects
5. (Optional) clear non-admin role assignments
6. Validate behavior in UI/API

## Commands

Run from `approver/backend`:

1. Backfill effects on existing rules
```bash
npm run migrate:rule-effects
```

2. Seed governance defaults + policy (safe baseline)
```bash
npm run seed:governance -- --force-policy-sync
```

3. Update all org system rules (now includes effects + policy ensure)
```bash
npm run seed:rules:system
```

4. Optional: force-sync default role definitions too
```bash
npm run seed:governance -- --force-policy-sync --force-role-sync
```

5. Optional: clear all non-admin role assignments
```bash
npm run seed:governance:clear-non-admin
```

6. Optional dry run for reconciliation script
```bash
node scripts/seedGovernancePoliciesAndRoles.js --dry-run
```

## Validation Checklist

1. Confirm role catalog loads:
   - `GET /api/roles`
2. Confirm workflow policy loads:
   - `GET /api/workflow-policy`
3. Submit Tier 1, Tier 2, Tier 3 samples and verify stage routing.
4. Confirm deleting a role removes it from:
   - user permissions
   - pending invites
   - workflow stage required roles
5. Confirm `rules.manage` users can create/update/delete rules.
6. Confirm `rules.manage.system` users can bulk toggle system rules.
7. Confirm dashboard counts reflect `status` (`Approved`, `Rejected`, `Under Review`/`Pending`).

## Notes

- If you want to keep existing non-admin role assignments, do not run the clear command.
- If you want only valid-role cleanup (without full clear), run `seed:governance` without `--clear-non-admin-roles`.
- Frontend admin now supports:
  - role catalog management
  - workflow policy JSON editing


# Initiative Rule + Workflow Refactor Report

Date: 2026-02-17  
Scope: `approver` backend/frontend, rule seeding, workflow policy seeding, dynamic role model

## Summary

Implemented the new structure end-to-end:

- Dynamic role catalog per organization (create/update/delete roles).
- Dynamic workflow policy per organization (tiers, stages, required roles, min approvals, rejection behavior).
- Rule `effects` model (including tier escalation effects).
- Updated analysis engine to apply rule effects + workflow policy routing.
- Updated seeding scripts to seed/update rules and workflow policy together.
- Added role cleanup/reconciliation script for existing users (including optional non-admin role reset).
- Updated frontend admin screens to manage roles and workflow policy.
- Updated frontend capability checks to stop depending on hardcoded role names.

## Implemented Changes

### 1) New governance data model

- Added `Role` model: `approver/backend/models/Role.js`
- Added `WorkflowPolicy` model: `approver/backend/models/WorkflowPolicy.js`
- Extended `Rule` model with `effects`: `approver/backend/models/Rule.js`
- Removed fixed role enums from user membership/invite schemas:
  - `approver/backend/models/UserOrganization.js`
  - `approver/backend/models/User.js`
  - `approver/backend/models/Invite.js`
- Made project workflow fields dynamic:
  - `approvalStatus` and `workflowStage` no longer fixed enums
  - added `workflowPolicy`, `currentStageKey`, `workflowPlan`
  - `approvalHistory.stage` now dynamic
  - file: `approver/backend/models/Project.js`

### 2) Dynamic governance seeding service

- Added `governanceConfigService`:
  - default roles + capabilities
  - default workflow policy for Tier 1/2/3 routing
  - org bootstrap/sync helpers
  - rule-effect helper for system rule upload
  - file: `approver/backend/services/governanceConfigService.js`

### 3) Authorization + access control refactor

- Added access utility layer (role/capability helpers):
  - `approver/backend/utils/access.js`
- Updated auth middleware to:
  - load org role catalog dynamically
  - resolve user capabilities from assigned roles
  - authorize by either role key or capability token
  - file: `approver/backend/middleware/auth.js`

### 4) New role/workflow-policy API surface

- Added controller:
  - `approver/backend/controllers/governanceController.js`
- Added endpoints:
  - `GET/POST/PATCH/DELETE /api/roles`
  - `GET/PUT/POST(reset) /api/workflow-policy`
  - file: `approver/backend/routes/api.js`
- Role deletion now removes role references from:
  - user memberships
  - pending invites
  - workflow policy stage requirements

### 5) Rule analysis + review engine update

- `analyzeProject` now:
  - reads rule `effects`
  - applies triggered effects (e.g., forced tier escalation)
  - resolves thresholds from org workflow policy (`aiGate`)
  - routes to first configured stage from policy
  - stores policy snapshot per project (`workflowPlan`)
  - file: `approver/backend/controllers/mainController.js`

- Stage review endpoints (`coe`, `governance`, `executive`) now use a generic policy-driven transition engine:
  - validates current stage key
  - enforces required role keys per stage
  - supports `minApprovals`
  - supports rejection escalation (`ESCALATE_TO_NEXT`)
  - file: `approver/backend/controllers/mainController.js`

### 6) Seeding and migration updates

- System rule upload now also:
  - writes rule `effects`
  - ensures governance config/policy per org
  - updates existing rules in place
  - file: `approver/backend/scripts/uploadSystemRulesToAllOrgs.js`

- Added governance seed/reconcile script:
  - `approver/backend/scripts/seedGovernancePoliciesAndRoles.js`
  - supports:
    - `--force-policy-sync`
    - `--force-role-sync`
    - `--clear-non-admin-roles`
    - `--dry-run`

- Added rule-effect backfill script:
  - `approver/backend/scripts/backfillRuleEffects.js`

- Updated seed scripts to include new structure:
  - `approver/backend/scripts/seedEscalationRules.js`
  - `approver/backend/scripts/seedRulesForTony.js`

- Added npm script aliases:
  - `seed:rules:system`
  - `seed:governance`
  - `seed:governance:clear-non-admin`
  - `migrate:rule-effects`
  - file: `approver/backend/package.json`

### 7) Auth/membership payload updates

- Login + org refresh payloads now include:
  - `roles` (org role catalog)
  - `capabilities` (effective capabilities for the user)
- files:
  - `approver/backend/controllers/authController.js`
  - `approver/backend/controllers/mainController.js`

### 8) Frontend updates

- Added access utility for capability checks:
  - `approver/frontend/src/utils/access.ts`
- Updated capability-aware UI behavior:
  - `Dashboard`, `Rules`, `ProjectDetail`
  - files:
    - `approver/frontend/src/pages/Dashboard.tsx`
    - `approver/frontend/src/pages/Rules.tsx`
    - `approver/frontend/src/pages/ProjectDetail.tsx`
- Updated admin page:
  - dynamic role options in user-permission modal
  - new role catalog management section
  - workflow policy JSON editor/save
  - file: `approver/frontend/src/pages/AdminUsers.tsx`
- Updated invites/onboarding/profile role label handling:
  - `approver/frontend/src/pages/InvitesPage.tsx`
  - `approver/frontend/src/pages/OnboardingPage.tsx`
  - `approver/frontend/src/pages/Profile.tsx`
- Updated auth context typing + active org refresh:
  - `approver/frontend/src/context/AuthContext.tsx`

## Verification

Executed:

- Backend syntax checks (`node --check`) passed for updated controllers/middleware/services/routes/scripts.
- Frontend build passed:
  - `npm run build` in `approver/frontend`

Not executed in this run:

- Database mutation scripts (seeding/reconciliation) were implemented but not run automatically against your DB.


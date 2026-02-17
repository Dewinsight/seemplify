# Dynamic Scoring and Rules Update Report

Date: 2026-02-17  
Scope: Approver backend + frontend

## 1) What was changed

### A. Scoring policy is now dynamic and configurable
- Added organization scoring weights and department override weights to workflow policy storage.
- Added scoring policy API endpoints:
  - `GET /api/scoring-policy`
  - `PUT /api/scoring-policy`
- Added Scoring Policy UI page for editing:
  - six dimensions
  - global weights
  - department overrides
  - 100% total enforcement per weight set

### B. Permission model for scoring policy
- Capability `scoring.manage` is enabled for:
  - `CenterOfExcellence`
  - `GovernanceApprover`
  - `ExecutiveApprover`
- Admin can edit global + department scoring.
- Non-admin users with `scoring.manage` can only edit department overrides for departments they manage.
- Non-admin users cannot change global weights.

### C. Initiative list score label clarified
- Initiative table label updated from `AI Score` to `Rule Pass %`.
- This avoids confusion with `Priority` score.

### D. Tier calculation made deterministic
- Tier now comes from weighted priority score + workflow policy tier ranges.
- Rule effects can still escalate tier upward via `SET_TIER`.
- Tier is no longer taken from model-returned `calculatedTier` when persisting decision.

### E. Rule effects simplified for user-facing authoring
- Rule creation UI now supports only `Set Tier`.
- `Route To Stage` removed from create flow.
- Legacy route effects are shown as deprecated/ignored in UI.
- Backend rule-effect execution no longer routes by stage from rule effects.

### F. Rule sanitation and AI refinement tooling
- Added AI-assisted bulk refinement script:
  - `scripts/refineRulesWithAI.js`
- Extended sanitization script to normalize legacy effects:
  - remove `ROUTE_TO_STAGE`
  - preserve/derive `SET_TIER`
  - preserve `SET_FLAG`

## 2) Current scoring and tier semantics

- `Rule Pass %`:
  - percent of rules that passed in AI rule evaluation.
  - used for visibility and audit context.

- `Priority Score`:
  - weighted score from 6 dimensions:
    - Strategic Alignment
    - Regulatory Risk
    - Business Impact
    - Implementation Complexity
    - Time To Value
    - Resource Requirements
  - score range: `1.0` to `5.0`.

- `Tier`:
  - derived from workflow policy tier ranges using the final weighted `Priority Score`.
  - may be escalated upward by rule effects (`SET_TIER`) and escalation rules.

## 3) Files updated (high-level)

- Backend:
  - `backend/controllers/mainController.js`
  - `backend/controllers/governanceController.js`
  - `backend/services/OpenAIService.js`
  - `backend/scripts/sanitizeRules.js`
  - `backend/scripts/refineRulesWithAI.js` (new)
  - `backend/package.json`

- Frontend:
  - `frontend/src/pages/ScoringPolicy.tsx`
  - `frontend/src/pages/Rules.tsx`
  - `frontend/src/pages/Analyze.tsx`
  - `frontend/src/pages/ProjectDetail.tsx`
  - `frontend/src/utils/access.ts`

## 4) Execution plan (recommended order)

1. Seed governance defaults and role capabilities:
```bash
cd approver/backend
npm run seed:governance -- --force-role-sync
```

2. Dry-run AI rule refinement:
```bash
cd approver/backend
node scripts/refineRulesWithAI.js --scope=system --dry-run
```

3. Apply AI rule refinement:
```bash
cd approver/backend
node scripts/refineRulesWithAI.js --scope=system --apply
```

4. Sanitize rules (normalize legacy effects + de-dup + category hygiene):
```bash
cd approver/backend
npm run sanitize:rules
```

5. Verify frontend build:
```bash
cd approver/frontend
npm run build
```

## 5) Validation checklist

- Scoring Policy page opens for `scoring.manage` users.
- Non-admin scoring managers cannot change global weights.
- Department overrides save only for departments user manages.
- Initiative list shows `Rule Pass %` and separate `Priority`.
- Rule creation only exposes `Set Tier` effect.
- Project detail shows score breakdown and applied weights.

## 6) Execution results (run in environment)

### Governance seed
- Command:
```bash
npm run seed:governance -- --force-role-sync
```
- Result:
  - Success.
  - Membership updates applied: `8`.

### AI rule refinement
- Dry-run command:
```bash
node scripts/refineRulesWithAI.js --scope=system --dry-run
```
- Apply command:
```bash
node scripts/refineRulesWithAI.js --scope=system --apply
```
- Result:
  - System rule records scanned: `1900`
  - Unique templates: `95`
  - Templates changed: `95`
  - Rule records updated: `1900`
  - Failed batches: `0`
  - Reports:
    - `backend/scripts/reports/rule-refine-report-2026-02-17T12-02-03-741Z.json`
    - `backend/scripts/reports/rule-refine-report-2026-02-17T12-03-12-579Z.json`

### Sanitize rules
- Command:
```bash
npm run sanitize:rules
```
- Result:
  - Total rules: `1948`
  - Legacy effects normalized: `252`
  - Orphans removed: `0`
  - Missing category fixes: `0`
  - Duplicate groups disabled: `0`

### Post-run verification
- Totals:
  - Total rules: `1948`
  - System: `1900`
  - Custom: `48`
  - Active: `1853`
  - Hidden: `0`
  - Rules still using `ROUTE_TO_STAGE`: `0`
  - Distinct system templates (`systemRuleId`): `95`

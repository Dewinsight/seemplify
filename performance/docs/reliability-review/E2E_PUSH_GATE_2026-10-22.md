# Performance browser release gate — 22 October 2026

## 1. Verified result

| Check | Result | Evidence scope |
| --- | --- | --- |
| Full current application browser suite | **56/56 passed**, zero retries, 3.8 minutes | Production Next build, actual application routes, real disposable Mongo replica set/indexes |
| Conversation resume browser regression | **4/4 passed**, zero retries, 25.6 seconds | Real product routers and disposable Mongo; desktop and mobile |
| TypeScript / production build | Passed | Current source and browser fixtures |
| Scoped frontend lint | Passed | Existing `no-explicit-any` debt excluded; no new violations |
| Independent review | Approved | Production fix, fixture boundaries and preserved acceptance assertions |

## 2. Product fix found by the broad run

Keyboard feedback selection could fail when a directory response replaced an already-highlighted roster option between Arrow Down and Enter. The recipient input remained an email instead of selecting the intended person.

The picker now remembers only an explicit keyboard choice for the current query. If the library loses that highlight during refresh, Enter can select the same person only while their ID remains in the current results. Typing a different query, clearing, closing or using a pointer clears that recovery choice. It never automatically chooses the first result.

The real-API regression holds an actual directory HTTP response until after keyboard highlighting, delivers the unchanged response, selects with Enter, sends fictional feedback and verifies the intended recipient's persisted record. A second case verifies that changing the query leaves Send disabled until a new person is explicitly selected.

## 3. Conversation evidence added

The four new browser cases verify a persisted unanswered question after a 100-day absence, a full page revisit, focus during a pending answer/account check, exactly one saved answer, all configured questions, report refinement and submission, and shared saved answers between **AI chat** and **Answer form**. Both desktop and mobile completion journeys refine all five report sections and verify the resulting submitted values in Mongo.

## 4. Current-screen coverage restored

Older tests were updated to the current accessible account label, readiness copy, combined cycle/date report text, published-cycle editor and three-step launch flow. They retain actual creation, persistence, reload, permissions, frozen expectations, selected reviewer, role evidence and scoring assertions.

The goals journey creates organization, team and staff goals through the current workspace, checks the hierarchy, proves launch is blocked before employee acknowledgement, acknowledges through the employee UI, and checks frozen goal snapshots after launch. It covers an open planning period; it does not claim coverage of the retired inline late-goal override.

The disabled competency feature remains a real denial. Published cycle settings remain immutable. Manual submissions use the supported `assessmentMode: 'form'` contract.

## 5. Boundaries and commands

Identity/session/directory data, external AI account/completion responses and an external disconnected-calendar status are synthetic. Calendar status still traverses the actual product route, identity resolution and signed HTTP client; the loopback fixture checks the signature, service and fictional identity. Product 5xx checks remain enabled. This is local end-to-end evidence, not proof of external provider execution or real employee submissions.

```powershell
# performance/frontend
$env:PERFORMANCE_E2E_PRODUCTION='1'
npx playwright test --config playwright.live.config.ts --reporter=line

# Separate frontend build/API environment; do not run concurrently with the above
npx playwright test e2e/appraisal-conversation-resume.fullstack.spec.ts --reporter=line
npx tsc --noEmit
```

Screenshots and traces are retained in the sibling private access workspace. Production revision, deployment, health/OIDC and authenticated read-only acceptance are verified separately after push.

# Performance management end-to-end audit

## Intended journey

1. Employees and managers maintain targets as OKRs throughout the performance period.
2. HR or a line manager opens a review cycle and chooses employees who have a valid reporting manager.
3. The employee completes an AI-guided reflection. The assistant asks for target outcomes, evidence, achievements, challenges, learning, and future goals, then produces an editable self-assessment draft.
4. The line manager reviews the employee submission. AI provides evidence prompts, rating assistance, and a bias check, but the manager owns the submitted rating and narrative.
5. Employee and manager hold a performance discussion and record agreed strengths, improvements, development actions, support, and next steps.
6. The rating is calibrated when the cycle requires it, then the final outcome is confirmed.
7. The employee reviews and acknowledges the final outcome.

## Findings

- Cycle creation had two competing models: a legacy draft-and-launch dialog and a newer create-and-launch form.
- `/admin/appraisal-cycles/new` was not a real page. It entered the dynamic cycle-detail route and redirected a second time to `/new/edit`.
- Creating a cycle exposed cycle metadata, eight phase dates, participants, rating weights, and four feature switches at once.
- The role of AI was described after the fact rather than within the workflow where employees and managers make decisions.
- Manager submission skipped the performance discussion and moved directly to calibration or final review.
- Completing a discussion in a calibration-enabled cycle produced a status that calibration did not accept, leaving the appraisal unable to continue.
- The main appraisal list did not show Discussion as a workflow step and offered no discussion action.
- Final employee acknowledgement was only offered for an intermediate discussion status, even though finalisation changed the appraisal to `completed`.
- The application has substantial pre-existing lint debt, so a clean production build is currently the reliable frontend release gate.

## Changes made

- Established one canonical workflow transition service and covered it with Node tests.
- Manager submission now always opens the performance-discussion stage.
- Completing the discussion now moves to calibration when enabled, otherwise directly to final review.
- Final acknowledgement is reachable after the appraisal is completed.
- Added Discussion to appraisal progress and action controls.
- Added a real static cycle-creation route.
- Replaced the all-at-once creation screen with three steps: Review period, People, Confirm.
- Kept phase dates and scope controls available when editing an existing cycle, without making them prerequisites for starting a new one.
- Explained the employee, AI, line-manager, discussion, calibration, and finalisation responsibilities before launch.

## Verification

- Backend state-machine tests cover calibrated and non-calibrated journeys plus employee/manager action ownership.
- Backend route and workflow-service syntax checks pass.
- The Next.js production build passes and includes the new static `/admin/appraisal-cycles/new` route.

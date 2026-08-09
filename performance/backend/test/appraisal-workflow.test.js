const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WORKFLOW_STAGES,
  getWorkflowStage,
  getStatusAfterManagerReview,
  getStatusAfterDiscussion,
  isCalibrationRequired,
  getNextAction
} = require('../services/appraisalWorkflowService');

test('canonical appraisal journey keeps the discussion between manager review and calibration', () => {
  const statuses = [
    'self_assessment_pending',
    'manager_review_pending',
    getStatusAfterManagerReview(),
    getStatusAfterDiscussion({ calibrationRequired: true }),
    'final_review_pending',
    'completed'
  ];

  assert.deepEqual(statuses, [
    'self_assessment_pending',
    'manager_review_pending',
    'discussion_scheduled',
    'calibration_pending',
    'final_review_pending',
    'completed'
  ]);

  assert.deepEqual(statuses.map(getWorkflowStage), WORKFLOW_STAGES);
});

test('discussion moves directly to final review when calibration is disabled', () => {
  assert.equal(getStatusAfterDiscussion({ calibrationRequired: false }), 'final_review_pending');
  assert.deepEqual(getNextAction('discussion_completed', { calibrationRequired: false }), {
    actor: 'manager',
    label: 'Finalize appraisal'
  });
});

test('cycle synchronization cannot accidentally enable an unused calibration phase', () => {
  assert.equal(isCalibrationRequired({
    currentPhase: 'finalReview',
    phases: { calibration: { isActive: false, isCompleted: true } }
  }), false);

  assert.equal(isCalibrationRequired({
    currentPhase: 'finalReview',
    phases: { calibration: { startDate: new Date('2026-08-01'), endDate: new Date('2026-08-02') } }
  }), true);
});

test('next actions clearly separate employee and line-manager responsibilities', () => {
  assert.equal(getNextAction('self_assessment_pending').actor, 'employee');
  assert.equal(getNextAction('manager_review_pending').actor, 'manager');
  assert.equal(getNextAction('discussion_scheduled').label, 'Hold performance discussion');
  assert.equal(getNextAction('calibration_pending').label, 'Calibrate rating');
});

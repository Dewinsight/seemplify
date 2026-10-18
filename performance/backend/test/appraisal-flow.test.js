'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const flow = require('../services/appraisalFlowService');

function config(types) { return flow.validateFlow({ assessmentMode: 'form', steps: types.map((type, index) => ({ id: `${type}_${index}`, type })) }); }
function complete(appraisal, step) {
  const at = new Date();
  if (step.type === 'selfAssessment') appraisal.selfAssessment = { submittedAt: at };
  if (step.type === 'managerReview') appraisal.managerReview = { submittedAt: at };
  if (step.type === 'discussion') appraisal.discussion = { completedDate: at };
  if (step.type === 'calibration') appraisal.calibration = { calibratedAt: at };
  if (step.type === 'finalReview') appraisal.finalRating = { finalizedAt: at };
  if (step.type === 'acknowledgement') appraisal.discussion = { ...appraisal.discussion, employeeAcknowledgedAt: at };
  if (step.type === 'oneOnOne') appraisal.completedMeetingSteps = [...(appraisal.completedMeetingSteps || []), step.id];
}
function permutations(items) { return items.length ? items.flatMap((item, i) => permutations(items.filter((_, j) => i !== j)).map(rest => [item, ...rest])) : [[]]; }

test('all 24 supported orderings execute the configured sequence, including reviewer-first and calls before assessments', () => {
  for (const sequence of permutations(['selfAssessment', 'managerReview', 'discussion', 'oneOnOne'])) {
    const result = config([...sequence, 'finalReview', 'acknowledgement']); assert.deepEqual(result.errors, []);
    const appraisal = { status: 'not_started', cycleConfigurationSnapshot: { appraisalFlow: result.flow } };
    for (const step of result.flow.steps) {
      flow.syncFlowStatus(appraisal); assert.equal(flow.currentStep(appraisal).id, step.id);
      assert.equal(appraisal.status, flow.TYPES[step.type].status); complete(appraisal, step);
    }
    flow.syncFlowStatus(appraisal); assert.equal(appraisal.status, 'employee_acknowledged');
  }
});
test('all optional assessment combinations and repeated one-on-ones complete without fabricated assessment submissions', () => {
  for (let mask = 0; mask < 8; mask++) {
    const types = ['selfAssessment', 'managerReview', 'discussion'].filter((_, i) => mask & (1 << i));
    const result = config(['oneOnOne', ...types, 'oneOnOne', 'finalReview']); assert.deepEqual(result.errors, []);
    const appraisal = { cycleConfigurationSnapshot: { appraisalFlow: result.flow } };
    for (const step of result.flow.steps) { flow.syncFlowStatus(appraisal); assert.equal(flow.currentStep(appraisal).id, step.id); complete(appraisal, step); }
    flow.syncFlowStatus(appraisal); assert.equal(appraisal.status, 'employee_acknowledged');
    if (!(mask & 1)) assert.equal(appraisal.selfAssessment, undefined);
  }
});
test('invalid, duplicate, unknown and unsafe stage arrangements are rejected before persistence', () => {
  for (const types of [[], ['managerReview'], ['finalReview', 'oneOnOne'], ['acknowledgement', 'finalReview'], ['calibration', 'finalReview'], ['calibration', 'managerReview', 'finalReview'], ['selfAssessment', 'selfAssessment', 'finalReview'], ['unsupported', 'finalReview']]) assert.ok(config(types).errors.length, types.join(','));
  assert.ok(flow.validateFlow({ steps: [{ id: 'same', type: 'discussion' }, { id: 'same', type: 'finalReview' }] }).errors.length);
  assert.ok(flow.validateFlow({ steps: config(['finalReview']).flow.steps, assessmentMode: 'unknown' }).errors.length);
});
test('legacy and cancelled appraisals keep their existing status', () => {
  const legacy = { status: 'manager_review_pending' }; flow.syncFlowStatus(legacy); assert.equal(legacy.status, 'manager_review_pending');
  const cancelled = { status: 'cancelled', cycleConfigurationSnapshot: { appraisalFlow: config(['finalReview']).flow } }; flow.syncFlowStatus(cancelled); assert.equal(cancelled.status, 'cancelled');
});

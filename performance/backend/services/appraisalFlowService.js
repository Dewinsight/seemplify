'use strict';

const TYPES = Object.freeze({
  selfAssessment: { label: 'Employee assessment', status: 'self_assessment_pending' },
  managerReview: { label: 'Reviewer assessment', status: 'manager_review_pending' },
  oneOnOne: { label: 'One-on-one meeting', status: 'meeting_pending' },
  discussion: { label: 'Performance discussion', status: 'discussion_scheduled' },
  calibration: { label: 'Calibration', status: 'calibration_pending' },
  finalReview: { label: 'Final outcome', status: 'final_review_pending' },
  acknowledgement: { label: 'Employee acknowledgement', status: 'completed' }
});

function defaultSteps(design = {}) {
  return ['selfAssessment', 'managerReview', 'discussion', 'calibration', 'finalReview', 'acknowledgement']
    .filter(type => design.stages?.[type]?.enabled !== false && (type !== 'calibration' || design.stages?.calibration?.enabled === true))
    .map(type => ({ id: type, type, label: TYPES[type].label }));
}

function validateFlow(input, design = {}) {
  const errors = [];
  if (!input || !Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > 12) {
    return { errors: ['Choose between 1 and 12 appraisal steps.'] };
  }
  const ids = new Set(); const types = new Set();
  const steps = input.steps.map(step => {
    const type = String(step?.type || '');
    const id = String(step?.id || '');
    if (!TYPES[type]) errors.push('Choose a supported appraisal step.');
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || ids.has(id)) errors.push('Each step needs a unique identifier.');
    if (type !== 'oneOnOne' && types.has(type)) errors.push('Assessment stages may only appear once.');
    ids.add(id); types.add(type);
    return { id, type, label: String(step?.label || TYPES[type]?.label || '').trim().slice(0, 120) };
  });
  const finalIndex = steps.findIndex(s => s.type === 'finalReview');
  if (finalIndex < 0) errors.push('Keep a final outcome step so a person approves the result.');
  if (steps.some((s, i) => i > finalIndex && s.type !== 'acknowledgement')) errors.push('Place all review work before the final outcome.');
  if (types.has('acknowledgement') && steps.at(-1)?.type !== 'acknowledgement') errors.push('Employee acknowledgement must be last.');
  if (types.has('calibration') && (!types.has('managerReview') || steps.findIndex(s => s.type === 'calibration') < steps.findIndex(s => s.type === 'managerReview'))) errors.push('Calibration follows a reviewer assessment.');
  if (input.assessmentMode !== undefined && !['conversation', 'form'].includes(input.assessmentMode)) errors.push('Choose AI conversation or manual form.');
  return { errors: [...new Set(errors)], flow: { version: 1, assessmentMode: input.assessmentMode || 'conversation', steps } };
}

function flowFor(appraisal) { return appraisal?.cycleConfigurationSnapshot?.appraisalFlow; }
function completed(appraisal, step) {
  switch (step.type) {
    case 'selfAssessment': return Boolean(appraisal.selfAssessment?.submittedAt);
    case 'managerReview': return Boolean(appraisal.managerReview?.submittedAt);
    case 'discussion': return Boolean(appraisal.discussion?.completedDate);
    case 'calibration': return Boolean(appraisal.calibration?.calibratedAt);
    case 'finalReview': return Boolean(appraisal.finalRating?.finalizedAt);
    case 'acknowledgement': return Boolean(appraisal.discussion?.employeeAcknowledgedAt);
    case 'oneOnOne': return (appraisal.completedMeetingSteps || []).includes(step.id);
    default: return false;
  }
}
function currentStep(appraisal) { return flowFor(appraisal)?.steps?.find(step => !completed(appraisal, step)) || null; }
function hasStep(appraisal, type) { return !flowFor(appraisal) || flowFor(appraisal).steps.some(step => step.type === type); }
function syncFlowStatus(appraisal) {
  if (!flowFor(appraisal) || appraisal.status === 'cancelled') return;
  const step = currentStep(appraisal);
  const inProgress = { selfAssessment: 'self_assessment_in_progress', managerReview: 'manager_review_in_progress', calibration: 'calibration_in_progress' };
  appraisal.status = step ? (appraisal.status === inProgress[step.type] ? appraisal.status : TYPES[step.type].status) : 'employee_acknowledged';
}
function applySnapshot(appraisal) {
  if (!appraisal?.cycleId?.settings || !flowFor(appraisal)) return;
  const snapshot = appraisal.cycleConfigurationSnapshot;
  appraisal.cycleId = typeof appraisal.cycleId.$clone === 'function' ? appraisal.cycleId.$clone() : { ...appraisal.cycleId };
  // Populated cycle documents are request-local. Never save these overrides to the shared quarter.
  appraisal.cycleId.settings = { ...appraisal.cycleId.settings.toObject?.() || appraisal.cycleId.settings, ...snapshot.settings };
  appraisal.cycleId.workflowDefinition = snapshot.workflowDefinition;
  appraisal.cycleId.$appraisalDesign = snapshot.workflowDefinition;
}

module.exports = { TYPES, defaultSteps, validateFlow, flowFor, currentStep, completed, hasStep, syncFlowStatus, applySnapshot };

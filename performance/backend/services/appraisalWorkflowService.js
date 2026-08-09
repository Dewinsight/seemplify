const WORKFLOW_STAGES = Object.freeze([
  'self_assessment',
  'manager_review',
  'discussion',
  'calibration',
  'final_review',
  'completed'
]);

const STATUS_STAGE = Object.freeze({
  not_started: 'self_assessment',
  goal_setting: 'self_assessment',
  goal_approval_pending: 'self_assessment',
  self_assessment_pending: 'self_assessment',
  self_assessment_in_progress: 'self_assessment',
  self_assessment_submitted: 'manager_review',
  manager_review_pending: 'manager_review',
  manager_review_in_progress: 'manager_review',
  manager_review_submitted: 'discussion',
  discussion_scheduled: 'discussion',
  discussion_completed: 'discussion',
  calibration_pending: 'calibration',
  calibration_in_progress: 'calibration',
  calibration_completed: 'final_review',
  final_review_pending: 'final_review',
  completed: 'completed',
  employee_acknowledged: 'completed'
});

function getWorkflowStage(status) {
  return STATUS_STAGE[status] || 'self_assessment';
}

function getStatusAfterManagerReview() {
  return 'discussion_scheduled';
}

function getStatusAfterDiscussion({ calibrationRequired = false } = {}) {
  return calibrationRequired ? 'calibration_pending' : 'final_review_pending';
}

function isCalibrationRequired(cycle) {
  if (!cycle) return false;
  const calibration = cycle?.phases?.calibration;
  if (!calibration) return false;

  // Calibration is configured by giving the phase a schedule. Runtime active
  // state is also accepted while the phase is in progress. `isCompleted` is
  // deliberately not a configuration signal because cycle progress updates
  // mark earlier phases complete and must not enable an unused phase later.
  return Boolean(
    calibration.startDate ||
    calibration.endDate ||
    calibration.isActive ||
    cycle.currentPhase === 'calibration'
  );
}

function getNextAction(status, { calibrationRequired = false } = {}) {
  const actions = {
    self_assessment_pending: { actor: 'employee', label: 'Complete self-assessment' },
    self_assessment_in_progress: { actor: 'employee', label: 'Continue self-assessment' },
    self_assessment_submitted: { actor: 'manager', label: 'Review employee reflection' },
    manager_review_pending: { actor: 'manager', label: 'Review employee reflection' },
    manager_review_in_progress: { actor: 'manager', label: 'Continue manager review' },
    manager_review_submitted: { actor: 'manager', label: 'Hold performance discussion' },
    discussion_scheduled: { actor: 'manager', label: 'Hold performance discussion' },
    discussion_completed: calibrationRequired
      ? { actor: 'manager', label: 'Calibrate rating' }
      : { actor: 'manager', label: 'Finalize appraisal' },
    calibration_pending: { actor: 'manager', label: 'Calibrate rating' },
    calibration_in_progress: { actor: 'manager', label: 'Continue calibration' },
    calibration_completed: { actor: 'manager', label: 'Finalize appraisal' },
    final_review_pending: { actor: 'manager', label: 'Finalize appraisal' },
    completed: { actor: 'employee', label: 'Review final outcome' },
    employee_acknowledged: { actor: null, label: 'Complete' }
  };

  return actions[status] || { actor: null, label: 'Review appraisal' };
}

module.exports = {
  WORKFLOW_STAGES,
  getWorkflowStage,
  getStatusAfterManagerReview,
  getStatusAfterDiscussion,
  isCalibrationRequired,
  getNextAction
};

const RECRUITMENT = 'recruitment';
const EMPLOYEE_ASSESSMENT = 'employee-assessment';

function normalizeJobWorkflow(value) {
  if (value === undefined || value === null || value === '') return RECRUITMENT;
  if (value !== RECRUITMENT && value !== EMPLOYEE_ASSESSMENT) {
    const error = new Error('Unsupported job workflow.');
    error.statusCode = 400;
    throw error;
  }
  return value;
}

function jobWorkflowFilter(value) {
  return normalizeJobWorkflow(value) === EMPLOYEE_ASSESSMENT
    ? { workflowType: EMPLOYEE_ASSESSMENT }
    : { workflowType: { $ne: EMPLOYEE_ASSESSMENT } };
}

function assertWorkflowUnchanged(job, requested) {
  if (requested !== undefined && normalizeJobWorkflow(requested) !== normalizeJobWorkflow(job.workflowType)) {
    const error = new Error('An existing job or employee assessment cannot change its workflow.');
    error.statusCode = 400;
    throw error;
  }
}

module.exports = { RECRUITMENT, EMPLOYEE_ASSESSMENT, normalizeJobWorkflow, jobWorkflowFilter, assertWorkflowUnchanged };

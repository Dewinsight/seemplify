const OPEN_RECALL_STATUSES = new Set(['submitted', 'pending']);
const APPROVED_RECALL_STATUSES = new Set(['approved', 'payroll_pending']);
const SAFE_PAYROLL_STATES = new Set(['not_ready', 'failed', 'no_data']);

function canRecallTimesheet(timesheet) {
    if (OPEN_RECALL_STATUSES.has(timesheet?.status)) return true;
    if (!APPROVED_RECALL_STATUSES.has(timesheet?.status)) return false;
    const payroll = timesheet.payrollIntegration || {};
    if (payroll.exported || payroll.acceptedAt || payroll.payrollRunId) return false;
    return SAFE_PAYROLL_STATES.has(payroll.state || 'not_ready');
}

function resetTimesheetForRecall(timesheet) {
    timesheet.status = 'draft';
    timesheet.lockedAt = null;
    timesheet.lockedBy = null;
    timesheet.submittedAt = null;
    timesheet.submittedNote = null;
    timesheet.approvedBy = undefined;
    timesheet.assignedApprover = undefined;
    timesheet.approvalWorkflow = undefined;
    timesheet.employeeAttestation = undefined;
    timesheet.payrollIntegration = {
        exported: false,
        exportedAt: null,
        payrollRunId: null,
        state: 'not_ready',
        idempotencyKey: null,
        attempts: 0,
        lastAttemptAt: null,
        nextAttemptAt: null,
        lastError: '',
        acceptedAt: null,
    };
    return timesheet;
}

module.exports = { canRecallTimesheet, resetTimesheetForRecall };

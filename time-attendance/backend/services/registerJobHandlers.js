const { registerJobHandler } = require('./backgroundJobService');
const { checkAndAutoClockOut } = require('./autoClockOutService');
const { checkAndSendReminders } = require('./reminderService');
const { checkAndSendManagerReports } = require('./managerReportService');
const { runTimesheetAutomation } = require('./timesheetAutomationService');
const { reconcileAllRosters } = require('./rosterReconciliationService');
const { deliverPendingNotifications } = require('./notificationService');
const { transferPendingTimesheets } = require('./payrollTransferService');
const { reconcileAllLeave } = require('./leaveReconciliationService');
const { summarizeAndDeleteExpiredPresence } = require('./presenceService');
const { processCorrectionRun } = require('./correctionRunService');

function registerCoreJobHandlers() {
    registerJobHandler('auto_clock_out', () => checkAndAutoClockOut());
    registerJobHandler('timesheet_reminders', () => checkAndSendReminders());
    registerJobHandler('manager_reports', () => checkAndSendManagerReports());
    registerJobHandler('timesheet_automation', () => runTimesheetAutomation());
    registerJobHandler('roster_reconciliation', (payload) => reconcileAllRosters(payload));
    registerJobHandler('notification_delivery', () => deliverPendingNotifications());
    registerJobHandler('payroll_transfer', () => transferPendingTimesheets());
    registerJobHandler('leave_reconciliation', (payload) => reconcileAllLeave(payload));
    registerJobHandler('presence_cleanup', () => summarizeAndDeleteExpiredPresence());
    registerJobHandler('correction_run', (payload) => processCorrectionRun(payload));

    // These handlers are replaced by their subsystem implementations as those modules load.
    for (const type of [
        'webhook_delivery',
    ]) {
        registerJobHandler(type, () => ({ skipped: true, reason: `${type} subsystem has no pending work` }));
    }
}

module.exports = { registerCoreJobHandlers };

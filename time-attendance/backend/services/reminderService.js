const { Timesheet, AttendancePolicy } = require('../models');
const emailService = require('./emailService');
const { addHours, differenceInHours, endOfWeek } = require('date-fns');

/**
 * Reminder Service
 * 
 * Sends reminder emails to employees who haven't submitted their timesheets
 * before the deadline. Runs daily to check for upcoming deadlines.
 */

let isRunning = false;

async function checkAndSendReminders() {
    if (isRunning) {
        console.log('⏭️  Reminder check already running, skipping...');
        return;
    }

    try {
        isRunning = true;
        console.log('📧 Running timesheet reminder check...');

        // Get all organizations with reminders enabled
        const policies = await AttendancePolicy.find({
            'notifications.reminderBeforeDeadline': true
        });

        if (policies.length === 0) {
            console.log('   No organizations with reminders enabled');
            return;
        }

        let totalRemindersSent = 0;

        // Process each organization
        for (const policy of policies) {
            const reminderHours = policy.notifications.reminderHoursBefore || 24;
            const deadlineDays = policy.timesheetSettings?.submissionDeadline || 2;

            console.log(`   Checking ${policy.organizationName || policy.organizationId} (reminder: ${reminderHours}h before)`);

            // Find draft timesheets that are approaching deadline
            // Timesheets should be submitted within X days after the period ends
            const now = new Date();
            
            // Find all draft timesheets where:
            // - Period has ended
            // - Still in draft status
            // - Deadline is within the reminder window
            const timesheets = await Timesheet.find({
                organizationId: policy.organizationId,
                status: 'draft',
                endDate: { $lt: now } // Period has ended
            });

            for (const timesheet of timesheets) {
                // Calculate deadline: endDate + submissionDeadline days
                const deadline = new Date(timesheet.endDate);
                deadline.setDate(deadline.getDate() + deadlineDays);

                // Calculate hours until deadline
                const hoursUntilDeadline = differenceInHours(deadline, now);

                // Send reminder if within the reminder window and not yet sent
                if (hoursUntilDeadline > 0 && hoursUntilDeadline <= reminderHours) {
                    // Check if reminder already sent (check audit log)
                    const reminderSent = timesheet.auditLog?.some(
                        log => log.action === 'reminder_sent' && 
                               log.performedAt > addHours(now, -reminderHours)
                    );

                    if (!reminderSent && timesheet.userEmail) {
                        // Send reminder email
                        const result = await emailService.sendTimesheetReminder(
                            timesheet,
                            timesheet.userEmail,
                            hoursUntilDeadline
                        );

                        if (result.success) {
                            // Log the reminder in audit trail
                            timesheet.auditLog.push({
                                action: 'reminder_sent',
                                performedBy: 'system',
                                performedByName: 'Auto Reminder',
                                performedAt: new Date(),
                                details: `Reminder sent (${hoursUntilDeadline}h before deadline)`,
                            });
                            await timesheet.save();

                            totalRemindersSent++;
                            console.log(`   ✅ Reminder sent: ${timesheet.userName} (${timesheet.userEmail})`);
                        }
                    }
                }
            }
        }

        if (totalRemindersSent > 0) {
            console.log(`✅ Reminder check complete: ${totalRemindersSent} reminders sent`);
        } else {
            console.log('   No reminders needed');
        }
    } catch (error) {
        console.error('❌ Reminder service error:', error);
    } finally {
        isRunning = false;
    }
}

/**
 * Start the reminder scheduler
 * Runs once daily at 9:00 AM
 */
function startReminderScheduler() {
    console.log('🔔 Timesheet reminder scheduler started (runs daily at 9:00 AM)');
    
    // Calculate time until next 9:00 AM
    const now = new Date();
    const next9AM = new Date();
    next9AM.setHours(9, 0, 0, 0);
    
    // If it's past 9 AM today, set for tomorrow
    if (now >= next9AM) {
        next9AM.setDate(next9AM.getDate() + 1);
    }
    
    const msUntil9AM = next9AM - now;
    
    // Schedule first run at next 9:00 AM
    setTimeout(() => {
        checkAndSendReminders();
        
        // Then run every 24 hours
        setInterval(() => {
            checkAndSendReminders();
        }, 24 * 60 * 60 * 1000); // 24 hours
    }, msUntil9AM);
    
    console.log(`   Next reminder check at: ${next9AM.toLocaleString()}`);
}

module.exports = {
    checkAndSendReminders,
    startReminderScheduler,
};

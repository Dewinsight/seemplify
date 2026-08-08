const { TimeEntry, AttendancePolicy } = require('../models');
const emailService = require('./emailService');
const attendanceEvents = require('./attendanceEventService');

/**
 * Auto Clock-Out Service
 *
 * Background process that:
 * 1. Sends a warning before auto clock-out threshold
 * 2. Auto clocks out open sessions at the threshold
 * 3. Sends an auto clock-out confirmation
 */

let isRunning = false;

async function hasClockOutAfter(clockInEntry) {
    return TimeEntry.findOne({
        userId: clockInEntry.userId,
        organizationId: clockInEntry.organizationId,
        entryType: 'clock_out',
        timestamp: { $gt: clockInEntry.timestamp },
    });
}

async function hasNewerClockIn(clockInEntry) {
    return TimeEntry.findOne({
        userId: clockInEntry.userId,
        organizationId: clockInEntry.organizationId,
        entryType: 'clock_in',
        timestamp: { $gt: clockInEntry.timestamp },
    });
}

async function maybeSendWarning(clockInEntry, thresholdHours, warningMinutesBefore) {
    if (!clockInEntry.userEmail || clockInEntry.autoClockOut?.warningSentAt) {
        return false;
    }

    const result = await emailService.sendAutoClockOutWarning(
        {
            userName: clockInEntry.userName,
            deadlineAt: new Date(clockInEntry.timestamp.getTime() + thresholdHours * 60 * 60 * 1000),
            warningMinutes: warningMinutesBefore,
            thresholdHours,
        },
        clockInEntry.userEmail
    );

    if (result.success) {
        clockInEntry.autoClockOut = {
            ...(clockInEntry.autoClockOut || {}),
            warningSentAt: new Date(),
            warningEmailMessageId: result.messageId || null,
        };
        await clockInEntry.save();
        console.log(`Warning sent to ${clockInEntry.userEmail} (${clockInEntry.userName || clockInEntry.userId})`);
        return true;
    }

    return false;
}

async function autoClockOutEntry(clockInEntry, thresholdHours) {
    const autoClockOutTime = new Date(
        clockInEntry.timestamp.getTime() + thresholdHours * 60 * 60 * 1000
    );

    const autoClockOutEntry = new TimeEntry({
        userId: clockInEntry.userId,
        userEmail: clockInEntry.userEmail,
        userName: clockInEntry.userName,
        organizationId: clockInEntry.organizationId,
        organizationName: clockInEntry.organizationName,
        teamId: clockInEntry.teamId,
        teamName: clockInEntry.teamName,
        entryType: 'clock_out',
        timestamp: autoClockOutTime,
        timezone: clockInEntry.timezone,
        source: 'auto',
        note: `Auto-clocked out after ${thresholdHours} hours (forgot to clock out)`,
        isManualEntry: true,
    });

    await autoClockOutEntry.save();
    attendanceEvents.publish(clockInEntry.userId, clockInEntry.organizationId, {
        type: 'clock_out',
        source: 'auto',
        entryId: autoClockOutEntry._id,
        at: autoClockOutEntry.timestamp,
    });

    clockInEntry.autoClockOut = {
        ...(clockInEntry.autoClockOut || {}),
        autoClockedOutAt: new Date(),
        autoClockOutEntryId: autoClockOutEntry._id,
    };
    await clockInEntry.save();

    if (clockInEntry.userEmail) {
        await emailService.sendAutoClockedOutNotification(
            {
                userName: clockInEntry.userName,
                autoClockOutTime,
                thresholdHours,
            },
            clockInEntry.userEmail
        );
    }

    console.log(`Auto-clocked out ${clockInEntry.userEmail || clockInEntry.userId}`);
    return true;
}

async function checkAndAutoClockOut() {
    if (isRunning) {
        console.log('Auto clock-out check already running, skipping');
        return;
    }

    try {
        isRunning = true;
        console.log('Running auto clock-out check');

        const policies = await AttendancePolicy.find({
            'clockSettings.autoClockOut.enabled': true,
        });

        if (policies.length === 0) {
            console.log('No organizations with auto clock-out enabled');
            return;
        }

        let totalWarningsSent = 0;
        let totalAutoClockOuts = 0;

        for (const policy of policies) {
            const thresholdHours = policy.clockSettings?.autoClockOut?.afterHours || 10;
            const maxWarningMinutes = Math.max(1, Math.floor(thresholdHours * 60) - 1);
            const warningMinutesBefore = Math.max(
                1,
                Math.min(
                    policy.clockSettings?.autoClockOut?.warningMinutesBefore || 30,
                    maxWarningMinutes
                )
            );

            const now = Date.now();
            const warningCutoff = new Date(now - (thresholdHours * 60 - warningMinutesBefore) * 60 * 1000);
            const autoClockOutCutoff = new Date(now - thresholdHours * 60 * 60 * 1000);

            console.log(
                `Checking ${policy.organizationName || policy.organizationId} ` +
                `(threshold ${thresholdHours}h, warning ${warningMinutesBefore}m)`
            );

            const candidates = await TimeEntry.find({
                organizationId: policy.organizationId,
                entryType: 'clock_in',
                timestamp: { $lt: warningCutoff },
            }).sort({ timestamp: 1 });

            for (const clockInEntry of candidates) {
                const clockOutExists = await hasClockOutAfter(clockInEntry);
                if (clockOutExists) {
                    continue;
                }

                const newerClockInExists = await hasNewerClockIn(clockInEntry);
                if (newerClockInExists) {
                    continue;
                }

                if (clockInEntry.timestamp <= autoClockOutCutoff) {
                    if (!clockInEntry.autoClockOut?.autoClockedOutAt) {
                        const didAutoClockOut = await autoClockOutEntry(clockInEntry, thresholdHours);
                        if (didAutoClockOut) {
                            totalAutoClockOuts++;
                        }
                    }
                    continue;
                }

                const warningWindowStart = new Date(
                    clockInEntry.timestamp.getTime() + (thresholdHours * 60 - warningMinutesBefore) * 60 * 1000
                );
                const warningWindowEnd = new Date(
                    clockInEntry.timestamp.getTime() + thresholdHours * 60 * 60 * 1000
                );

                if (new Date(now) >= warningWindowStart && new Date(now) < warningWindowEnd) {
                    const warningSent = await maybeSendWarning(
                        clockInEntry,
                        thresholdHours,
                        warningMinutesBefore
                    );

                    if (warningSent) {
                        totalWarningsSent++;
                    }
                }
            }
        }

        console.log(
            `Auto clock-out check complete: ${totalWarningsSent} warning(s), ${totalAutoClockOuts} auto clock-out(s)`
        );
    } catch (error) {
        console.error('Auto clock-out error:', error);
    } finally {
        isRunning = false;
    }
}

/**
 * Start the auto clock-out scheduler
 * Runs every 15 minutes
 */
function startAutoClockOutScheduler() {
    console.log('Auto clock-out scheduler started (every 15 minutes)');

    setTimeout(() => checkAndAutoClockOut(), 5000);

    setInterval(() => {
        checkAndAutoClockOut();
    }, 15 * 60 * 1000);
}

module.exports = {
    checkAndAutoClockOut,
    startAutoClockOutScheduler,
};

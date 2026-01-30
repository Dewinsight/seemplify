const { TimeEntry, AttendancePolicy } = require('../models');

/**
 * Auto Clock-Out Service
 * 
 * Automatically clocks out employees who have been clocked in for longer than
 * the configured threshold (default 12 hours) to prevent incomplete time entries.
 */

let isRunning = false;

async function checkAndAutoClockOut() {
    if (isRunning) {
        console.log('⏭️  Auto clock-out check already running, skipping...');
        return;
    }

    try {
        isRunning = true;
        console.log('🕐 Running auto clock-out check...');

        // Get all organizations with autoClockOut enabled
        const policies = await AttendancePolicy.find({
            'clockSettings.autoClockOut.enabled': true
        });

        if (policies.length === 0) {
            console.log('   No organizations with auto clock-out enabled');
            return;
        }

        let totalAutoClockOuts = 0;

        // Process each organization
        for (const policy of policies) {
            const threshold = policy.clockSettings.autoClockOut.afterHours;
            const cutoffTime = new Date(Date.now() - threshold * 60 * 60 * 1000);

            console.log(`   Checking ${policy.organizationName || policy.organizationId} (threshold: ${threshold}h)`);

            // Find all clock-in entries older than threshold
            const staleClockIns = await TimeEntry.find({
                organizationId: policy.organizationId,
                entryType: 'clock_in',
                timestamp: { $lt: cutoffTime }
            }).sort({ timestamp: 1 });

            // Check each stale entry
            for (const clockInEntry of staleClockIns) {
                // Check if there's already a clock-out after this clock-in
                const existingClockOut = await TimeEntry.findOne({
                    userId: clockInEntry.userId,
                    organizationId: clockInEntry.organizationId,
                    entryType: 'clock_out',
                    timestamp: { $gt: clockInEntry.timestamp }
                });

                if (!existingClockOut) {
                    // No clock-out found - create auto clock-out
                    const autoClockOutTime = new Date(
                        clockInEntry.timestamp.getTime() + threshold * 60 * 60 * 1000
                    );

                    // Also check if there's a newer clock-in (user may have clocked in again)
                    const newerClockIn = await TimeEntry.findOne({
                        userId: clockInEntry.userId,
                        organizationId: clockInEntry.organizationId,
                        entryType: 'clock_in',
                        timestamp: { $gt: clockInEntry.timestamp }
                    });

                    // Only auto-clock-out if no newer clock-in exists
                    if (!newerClockIn) {
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
                            note: `Auto-clocked out after ${threshold} hours (forgot to clock out)`,
                            isManualEntry: true,
                        });

                        await autoClockOutEntry.save();
                        totalAutoClockOuts++;

                        console.log(`   ✅ Auto-clocked out: ${clockInEntry.userName} (${clockInEntry.userEmail})`);
                    }
                }
            }
        }

        if (totalAutoClockOuts > 0) {
            console.log(`✅ Auto clock-out complete: ${totalAutoClockOuts} entries created`);
        } else {
            console.log('   No auto clock-outs needed');
        }
    } catch (error) {
        console.error('❌ Auto clock-out error:', error);
    } finally {
        isRunning = false;
    }
}

/**
 * Start the auto clock-out scheduler
 * Runs every 15 minutes
 */
function startAutoClockOutScheduler() {
    console.log('🔄 Auto clock-out scheduler started (runs every 15 minutes)');
    
    // Run immediately on startup
    setTimeout(() => checkAndAutoClockOut(), 5000); // Wait 5s for DB connection
    
    // Then run every 15 minutes
    setInterval(() => {
        checkAndAutoClockOut();
    }, 15 * 60 * 1000); // 15 minutes
}

module.exports = {
    checkAndAutoClockOut,
    startAutoClockOutScheduler,
};

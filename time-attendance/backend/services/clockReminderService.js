const { utcToZonedTime } = require('date-fns-tz');
const { format } = require('date-fns');
const { AttendancePolicy, ClockReminderLog, TimeEntry } = require('../models');
const emailService = require('./emailService');

let running = false;

function parseMinutes(value, fallback) {
    const match = String(value || fallback).match(/^(\d{1,2}):(\d{2})$/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : parseMinutes(fallback, '09:00');
}

async function knownUsers(organizationId) {
    return TimeEntry.aggregate([
        { $match: { organizationId, userEmail: { $type: 'string', $ne: '' } } },
        { $sort: { timestamp: -1 } },
        { $group: { _id: '$userId', userEmail: { $first: '$userEmail' }, userName: { $first: '$userName' }, lastEntryType: { $first: '$entryType' } } },
    ]);
}

async function sendOnce(policy, user, type, localDate, shiftTime) {
    const identity = { organizationId: policy.organizationId, userId: user._id, localDate, reminderType: type };
    let log = await ClockReminderLog.findOne(identity);
    if (log?.status === 'sent' || Number(log?.attempts || 0) >= 3) return false;
    if (!log) {
        try { log = await ClockReminderLog.create({ ...identity, userEmail: user.userEmail }); }
        catch (error) { if (error.code === 11000) return false; throw error; }
    }
    log.attempts += 1;
    try {
        const result = await emailService.sendClockReminder({
            type, userName: user.userName, shiftTime, localDate,
            organizationId: policy.organizationId, userId: user._id,
        }, user.userEmail);
        if (!result.success) throw new Error(result.error || result.reason || 'Mail service did not accept the reminder');
        log.status = 'sent';
        log.messageId = result.messageId;
        log.sentAt = new Date();
        log.lastError = undefined;
        await log.save();
        return true;
    } catch (error) {
        log.status = 'failed';
        log.lastError = error.message;
        await log.save();
        return false;
    }
}

async function checkClockReminders(now = new Date()) {
    if (running) return { skipped: true, sent: 0 };
    running = true;
    let sent = 0;
    try {
        const policies = await AttendancePolicy.find({
            $or: [{ 'notifications.clockInReminder': { $ne: false } }, { 'notifications.clockOutReminder': { $ne: false } }],
        });
        for (const policy of policies) {
            const localNow = utcToZonedTime(now, policy.timezone || 'UTC');
            if (!(policy.workSchedule?.workDays || [1, 2, 3, 4, 5]).includes(localNow.getDay())) continue;
            const currentMinute = localNow.getHours() * 60 + localNow.getMinutes();
            const localDate = format(localNow, 'yyyy-MM-dd');
            const users = await knownUsers(policy.organizationId);
            for (const user of users) {
                const todayEntries = await TimeEntry.getTodayEntries(user._id, policy.organizationId, policy.timezone || 'UTC');
                const hasClockedIn = todayEntries.some(entry => entry.entryType === 'clock_in');
                const lastWorkEntry = [...todayEntries].reverse().find(entry => ['clock_in', 'clock_out'].includes(entry.entryType));
                const isClockedIn = lastWorkEntry?.entryType === 'clock_in';
                const shiftStart = policy.workSchedule?.defaultShift?.startTime || '09:00';
                const shiftEnd = policy.workSchedule?.defaultShift?.endTime || '17:00';
                const notifications = policy.notifications || {};
                if (notifications.clockInReminder !== false && !hasClockedIn && currentMinute >= parseMinutes(shiftStart, '09:00') + Number(notifications.clockInReminderMinutesAfter ?? 15) && currentMinute < parseMinutes(shiftEnd, '17:00')) {
                    if (await sendOnce(policy, user, 'clock_in', localDate, shiftStart)) sent += 1;
                }
                if (notifications.clockOutReminder !== false && isClockedIn && currentMinute >= parseMinutes(shiftEnd, '17:00') + Number(notifications.clockOutReminderMinutesAfter ?? 0)) {
                    if (await sendOnce(policy, user, 'clock_out', localDate, shiftEnd)) sent += 1;
                }
            }
        }
        return { skipped: false, sent };
    } finally {
        running = false;
    }
}

function startClockReminderScheduler() {
    const intervalMs = 5 * 60 * 1000;
    const run = () => checkClockReminders().catch(error => console.error('Clock reminder check failed:', error.message));
    setTimeout(run, 15000);
    const timer = setInterval(run, intervalMs);
    timer.unref?.();
    console.log('Clock reminder scheduler started (every 5 minutes)');
}

module.exports = { checkClockReminders, startClockReminderScheduler, parseMinutes };

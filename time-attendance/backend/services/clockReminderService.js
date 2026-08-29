const { utcToZonedTime } = require('date-fns-tz');
const { format } = require('date-fns');
const { AttendancePolicy, ClockReminderLog, TimeEntry, Shift, SchedulePublication, EmployeeRoster } = require('../models');
const emailService = require('./emailService');
const { localDayBounds } = require('./timeCalculationService');

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

function localTimeText(value, timezone) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
    const part = type => parts.find(item => item.type === type)?.value || '00';
    return `${part('hour')}:${part('minute')}`;
}

async function scheduledUsersForDay(policy, now) {
    const bounds = localDayBounds(now, policy.timezone || 'UTC');
    const publication = await SchedulePublication.findOne({
        organizationId: policy.organizationId,
        periodStart: { $lte: bounds.end },
        periodEnd: { $gt: bounds.start },
    }).lean();
    if (!publication || policy.schedulingSettings?.usePublishedShiftsAsAttendanceSchedule === false) return null;
    const shifts = await Shift.find({
        organizationId: policy.organizationId,
        userId: { $nin: [null, ''] },
        status: { $in: ['published', 'completed'] },
        startAt: { $lte: bounds.end },
        endAt: { $gt: bounds.start },
    }).sort({ startAt: 1 }).lean();
    const userIds = [...new Set(shifts.map(shift => String(shift.userId)))];
    const roster = await EmployeeRoster.find({ organizationId: policy.organizationId, userId: { $in: userIds } }).select('userId email name').lean();
    const people = new Map(roster.map(member => [String(member.userId), member]));
    const grouped = new Map();
    for (const shift of shifts) {
        const id = String(shift.userId);
        const member = people.get(id);
        if (!member?.email) continue;
        const timezone = shift.timezone || policy.timezone || 'UTC';
        const current = grouped.get(id) || {
            _id: id,
            userEmail: member.email,
            userName: member.name || member.email,
            timezone,
            shiftStart: localTimeText(shift.startAt, timezone),
            shiftEnd: localTimeText(shift.endAt, timezone),
            shiftStartAt: new Date(shift.startAt),
            shiftEndAt: new Date(shift.endAt),
        };
        if (new Date(shift.startAt) < current.shiftStartAt) {
            current.shiftStartAt = new Date(shift.startAt);
            current.shiftStart = localTimeText(shift.startAt, timezone);
        }
        if (new Date(shift.endAt) > current.shiftEndAt) {
            current.shiftEndAt = new Date(shift.endAt);
            current.shiftEnd = localTimeText(shift.endAt, timezone);
        }
        grouped.set(id, current);
    }
    return [...grouped.values()];
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
            const scheduledUsers = await scheduledUsersForDay(policy, now);
            if (scheduledUsers === null && !(policy.workSchedule?.workDays || [1, 2, 3, 4, 5]).includes(localNow.getDay())) continue;
            const users = scheduledUsers === null ? await knownUsers(policy.organizationId) : scheduledUsers;
            for (const user of users) {
                const timezone = user.timezone || policy.timezone || 'UTC';
                const userLocalNow = utcToZonedTime(now, timezone);
                const currentMinute = userLocalNow.getHours() * 60 + userLocalNow.getMinutes();
                const localDate = format(userLocalNow, 'yyyy-MM-dd');
                const todayEntries = await TimeEntry.getTodayEntries(user._id, policy.organizationId, timezone);
                const hasClockedIn = todayEntries.some(entry => entry.entryType === 'clock_in');
                const lastWorkEntry = [...todayEntries].reverse().find(entry => ['clock_in', 'clock_out'].includes(entry.entryType));
                const isClockedIn = lastWorkEntry?.entryType === 'clock_in';
                const shiftStart = user.shiftStart || policy.workSchedule?.defaultShift?.startTime || '09:00';
                const shiftEnd = user.shiftEnd || policy.workSchedule?.defaultShift?.endTime || '17:00';
                const notifications = policy.notifications || {};
                const clockInReminderDue = user.shiftStartAt
                    ? now >= new Date(new Date(user.shiftStartAt).getTime() + Number(notifications.clockInReminderMinutesAfter ?? 15) * 60000) && now < new Date(user.shiftEndAt)
                    : currentMinute >= parseMinutes(shiftStart, '09:00') + Number(notifications.clockInReminderMinutesAfter ?? 15) && currentMinute < parseMinutes(shiftEnd, '17:00');
                const clockOutReminderDue = user.shiftEndAt
                    ? now >= new Date(new Date(user.shiftEndAt).getTime() + Number(notifications.clockOutReminderMinutesAfter ?? 0) * 60000)
                    : currentMinute >= parseMinutes(shiftEnd, '17:00') + Number(notifications.clockOutReminderMinutesAfter ?? 0);
                if (notifications.clockInReminder !== false && !hasClockedIn && clockInReminderDue) {
                    if (await sendOnce(policy, user, 'clock_in', localDate, shiftStart)) sent += 1;
                }
                if (notifications.clockOutReminder !== false && isClockedIn && clockOutReminderDue) {
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

module.exports = { checkClockReminders, scheduledUsersForDay, startClockReminderScheduler, parseMinutes };

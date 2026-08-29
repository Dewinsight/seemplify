const { zonedTimeToUtc } = require('date-fns-tz');
const crypto = require('crypto');

function dateOnly(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error('A valid generation date is required.');
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dateText(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function buildShiftGenerationKey({ organizationId, templateId, userId, teamId, startAt }) {
    const subject = userId || `open:${teamId || 'organization'}`;
    return crypto.createHash('sha256')
        .update(`${organizationId}:${templateId}:${subject}:${new Date(startAt).toISOString()}`)
        .digest('hex');
}

function enumerateTemplateShifts({ template, startDate, endDate, timezone = 'UTC', activeDays }) {
    const start = dateOnly(startDate);
    const end = dateOnly(endDate);
    if (end < start) throw new Error('Generation end date must be on or after its start date.');
    const days = Math.floor((end - start) / 86400000) + 1;
    if (days > 93) throw new Error('Generate no more than 93 days at a time.');
    const rotating = template.scheduleType === 'rotating';
    const cycleDays = Math.max(1, Number(template.rotation?.cycleDays || 7));
    const configuredDays = Array.isArray(activeDays) && activeDays.length
        ? activeDays.map(Number)
        : Array.isArray(template.rotation?.activeDays) && template.rotation.activeDays.length
            ? template.rotation.activeDays.map(Number)
            : rotating ? [0, 1, 2, 3, 4] : [1, 2, 3, 4, 5];
    const applicableDays = rotating
        ? configuredDays.filter(day => Number.isInteger(day) && day >= 0 && day < cycleDays)
        : configuredDays.filter(day => Number.isInteger(day) && day >= 0 && day <= 6);
    const results = [];
    for (let offset = 0; offset < days; offset += 1) {
        const date = new Date(start);
        date.setUTCDate(date.getUTCDate() + offset);
        const active = rotating
            ? applicableDays.includes(offset % cycleDays)
            : applicableDays.includes(date.getUTCDay());
        if (!active) continue;
        const key = dateText(date);
        const startAt = zonedTimeToUtc(`${key}T${template.startTime}:00`, timezone);
        let endAt = zonedTimeToUtc(`${key}T${template.endTime}:00`, timezone);
        if (endAt <= startAt) {
            const next = new Date(date);
            next.setUTCDate(next.getUTCDate() + 1);
            endAt = zonedTimeToUtc(`${dateText(next)}T${template.endTime}:00`, timezone);
        }
        results.push({
            startAt,
            endAt,
            timezone,
            breakMinutes: template.breakMinutes || 0,
            workMode: template.workMode || 'office',
            locationId: template.locationId,
            activityCode: template.activityCode,
            costCentreCode: template.costCentreCode,
        });
    }
    return results;
}

module.exports = { buildShiftGenerationKey, enumerateTemplateShifts };

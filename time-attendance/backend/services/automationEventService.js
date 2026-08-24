const crypto = require('crypto');
const fs = require('fs');
const AutomationEventOutbox = require('../models/AutomationEventOutbox');

function workspaceUrl() {
    return String(process.env.WORKSPACE_AUTOMATION_API_URL || '')
        .replace(/\/$/, '');
}

function signingSecret() {
    const file = String(
        process.env.WORKSPACE_AUTOMATION_HMAC_SECRET_FILE || '',
    ).trim();
    if (file) return fs.readFileSync(file, 'utf8').trim();
    return String(
        process.env.WORKSPACE_AUTOMATION_HMAC_SECRET || '',
    ).trim();
}

function buildTimesheetEvent(timesheet, name, actorId) {
    const revision = String(timesheet.version || timesheet.__v || 1);
    return {
        id: `time:${timesheet._id}:${name}:v${revision}`,
        name,
        organizationId: String(timesheet.organizationId),
        actorId: String(actorId || 'time-attendance'),
        occurredAt: new Date().toISOString(),
        payload: {
            timesheetId: String(timesheet._id),
            revision,
            employeeId: String(timesheet.userId),
            employeeName: timesheet.userName,
            startsAt: timesheet.startDate,
            endsAt: timesheet.endDate,
            status: timesheet.status,
            summary: timesheet.summary,
            approverIds: timesheet.assignedApprover?.userId
                ? [String(timesheet.assignedApprover.userId)]
                : [],
        },
    };
}

async function queueTimesheetEvent(timesheet, name, actorId) {
    const envelope = buildTimesheetEvent(timesheet, name, actorId);
    await AutomationEventOutbox.updateOne(
        { eventId: envelope.id },
        {
            $setOnInsert: {
                eventId: envelope.id,
                organizationId: envelope.organizationId,
                envelope,
                status: 'pending',
                nextAttemptAt: new Date(),
            },
        },
        { upsert: true },
    );
}

async function deliverPending({ now = new Date() } = {}) {
    if (!workspaceUrl() || !signingSecret()) return { delivered: 0, skipped: true };
    let delivered = 0;
    for (let index = 0; index < 25; index += 1) {
        const delivery = await AutomationEventOutbox.findOneAndUpdate(
            {
                status: { $in: ['pending', 'failed', 'delivering'] },
                nextAttemptAt: { $lte: now },
                $or: [{ leaseUntil: null }, { leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }],
            },
            {
                $set: { status: 'delivering', leaseUntil: new Date(now.getTime() + 60000) },
                $inc: { attempts: 1 },
            },
            { sort: { nextAttemptAt: 1 }, new: true },
        );
        if (!delivery) break;
        try {
            const body = JSON.stringify(delivery.envelope);
            const timestamp = String(Date.now());
            const signature = crypto.createHmac('sha256', signingSecret())
                .update(`${timestamp}.POST./api/internal/events.${body}`)
                .digest('hex');
            const response = await fetch(`${workspaceUrl()}/api/internal/events`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-seemplify-organization': delivery.organizationId,
                    'x-seemplify-automation-timestamp': timestamp,
                    'x-seemplify-automation-signature': `sha256=${signature}`,
                },
                body,
                signal: AbortSignal.timeout(10000),
            });
            if (!response.ok) throw new Error(`Workspace returned ${response.status}`);
            delivery.status = 'delivered';
            delivery.deliveredAt = new Date();
            delivery.responseStatus = response.status;
            delivery.leaseUntil = null;
            delivery.lastError = '';
            delivered += 1;
        } catch (error) {
            delivery.status = delivery.attempts >= delivery.maxAttempts ? 'dead' : 'failed';
            delivery.lastError = String(error.message || error).slice(0, 500);
            delivery.nextAttemptAt = new Date(Date.now() + Math.min(300000, 1000 * (2 ** delivery.attempts)));
            delivery.leaseUntil = null;
        }
        await delivery.save();
    }
    return { delivered };
}

function startAutomationEventWorker() {
    if (!workspaceUrl()) return null;
    const timer = setInterval(() => {
        deliverPending().catch(error => console.error('Time automation delivery failed:', error.message));
    }, 5000);
    timer.unref?.();
    deliverPending().catch(error => console.error('Time automation delivery failed:', error.message));
    return timer;
}

module.exports = { buildTimesheetEvent, deliverPending, queueTimesheetEvent, startAutomationEventWorker };

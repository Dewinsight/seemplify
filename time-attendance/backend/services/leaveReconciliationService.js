const crypto = require('crypto');
const { AttendancePolicy, EmployeeRoster, LeaveSnapshot } = require('../models');
const { processLifecycleEvent } = require('./lifecycleService');

function leaveUrl() {
    return String(process.env.LEAVE_MANAGEMENT_API_URL || 'http://localhost:5002').replace(/\/$/, '');
}

async function fetchLeaveSnapshot(organizationId) {
    const body = { organizationId };
    const serialized = JSON.stringify(body);
    const timestamp = new Date().toISOString();
    const secret = process.env.INTERNAL_SERVICE_SECRET || process.env.TIME_ATTENDANCE_LEAVE_SECRET || '';
    if (!secret && process.env.NODE_ENV === 'production') throw new Error('T&A to Leave authentication is not configured');
    const signature = secret ? crypto.createHmac('sha256', secret).update(`${timestamp}.${serialized}`).digest('hex') : '';
    const response = await fetch(`${leaveUrl()}/api/internal/v1/time-attendance/reconcile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-service-id': 'time-attendance', 'x-service-timestamp': timestamp, 'x-service-signature': signature ? `sha256=${signature}` : '' },
        body: serialized,
        signal: AbortSignal.timeout(Number(process.env.LEAVE_RECONCILIATION_TIMEOUT_MS || 30000)),
    });
    if (!response.ok) throw new Error(`Leave reconciliation failed with HTTP ${response.status}`);
    return response.json();
}

async function reconcileOrganizationLeaves(organizationId) {
    const snapshot = await fetchLeaveSnapshot(organizationId);
    const seen = new Set();
    for (const leave of snapshot.leaves || []) {
        seen.add(String(leave.leaveId));
        const event = leave.status === 'cancelled' ? 'leave.cancelled' : 'leave.updated';
        await processLifecycleEvent('leave', {
            schemaVersion: snapshot.schemaVersion || '1.0',
            eventId: `leave-reconcile:${organizationId}:${leave.leaveId}:${snapshot.generatedAt}`,
            event,
            organizationId,
            subjectId: leave.userId,
            occurredAt: snapshot.generatedAt,
            data: { ...leave, organizationId },
        }, event);
    }
    const missing = await LeaveSnapshot.find({ organizationId, status: 'approved', externalLeaveId: { $nin: [...seen] } });
    for (const leave of missing) {
        await processLifecycleEvent('leave', {
            eventId: `leave-reconcile-missing:${organizationId}:${leave.externalLeaveId}:${snapshot.generatedAt}`,
            event: 'leave.cancelled', organizationId, subjectId: leave.userId, occurredAt: snapshot.generatedAt,
            data: { leaveId: leave.externalLeaveId, organizationId, userId: leave.userId, leaveType: leave.type, startAt: leave.startAt, endAt: leave.endAt },
        }, 'leave.cancelled');
    }
    await processLifecycleEvent('leave', {
        schemaVersion: snapshot.schemaVersion || '1.0',
        eventId: `holiday-reconcile:${organizationId}:${snapshot.generatedAt}`,
        event: 'holiday.calendar.updated', organizationId, occurredAt: snapshot.generatedAt,
        data: { organizationId, holidayId: 'calendar', holidays: snapshot.holidays || [] },
    }, 'holiday.calendar.updated');
    return { organizationId, leaves: seen.size, missingCancelled: missing.length, holidays: (snapshot.holidays || []).length };
}

async function reconcileAllLeave(payload = {}) {
    const configured = Array.isArray(payload.organizationIds) ? payload.organizationIds.map(String) : [];
    const organizations = configured.length ? configured : Array.from(new Set([
        ...(await AttendancePolicy.distinct('organizationId')),
        ...(await EmployeeRoster.distinct('organizationId')),
    ].map(String).filter(Boolean)));
    const results = [];
    for (const organizationId of organizations) results.push(await reconcileOrganizationLeaves(organizationId));
    return { organizations: results.length, results };
}

module.exports = { fetchLeaveSnapshot, reconcileAllLeave, reconcileOrganizationLeaves };

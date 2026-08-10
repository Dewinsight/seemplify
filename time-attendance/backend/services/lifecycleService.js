const crypto = require('crypto');
const {
    EmployeeRoster, IntegrationEvent, Shift, TimeEntry, PresenceSession, LeaveSnapshot, PublicHolidaySnapshot, Timesheet, AttendancePolicy,
} = require('../models');

function stableHash(value) {
    return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function eventEnvelope(source, payload, eventTypeHeader) {
    const data = payload.data || payload.payload || {};
    const type = payload.type || payload.event || eventTypeHeader;
    const organizationId = payload.organizationId || data.organizationId;
    const subjectId = payload.subjectId || data.idpSubject || data.userId || data.memberId;
    return {
        eventId: payload.eventId || data.eventId || `${source}:${type}:${organizationId}:${subjectId}:${payload.timestamp || payload.occurredAt || stableHash(payload)}`,
        source,
        type,
        organizationId,
        subjectId,
        schemaVersion: payload.schemaVersion || payload.idpVersion || '1.0',
        occurredAt: new Date(payload.occurredAt || payload.timestamp || Date.now()),
        correlationId: payload.correlationId,
        idempotencyKey: payload.idempotencyKey,
        data,
        raw: payload,
    };
}

async function startEvent(envelope) {
    try {
        return await IntegrationEvent.create({
            eventId: envelope.eventId,
            source: envelope.source,
            type: envelope.type,
            organizationId: envelope.organizationId,
            subjectId: envelope.subjectId,
            schemaVersion: envelope.schemaVersion,
            occurredAt: envelope.occurredAt,
            correlationId: envelope.correlationId,
            idempotencyKey: envelope.idempotencyKey,
            payloadHash: stableHash(envelope.raw),
            status: 'processing',
        });
    } catch (error) {
        if (error.code === 11000) return null;
        throw error;
    }
}

async function markEvent(record, status, error) {
    if (!record) return;
    record.status = status;
    record.processedAt = new Date();
    record.error = error ? String(error.message || error).slice(0, 4000) : '';
    await record.save();
}

async function applyIdpLifecycle(envelope) {
    const data = envelope.data;
    const organizationId = envelope.organizationId;
    if (envelope.type === 'team.manager.changed') {
        if (!organizationId || !data.teamId) throw new Error('Team manager event requires organizationId and teamId');
        const result = await EmployeeRoster.updateMany(
            { organizationId, teamIds: String(data.teamId) },
            { $set: { managerId: data.newManagerId || null, sourceUpdatedAt: envelope.occurredAt, lastEventId: envelope.eventId } }
        );
        return { updated: result.modifiedCount };
    }

    const userId = String(data.idpSubject || envelope.subjectId || '');
    if (!organizationId || !userId) throw new Error('IDP lifecycle event requires organizationId and userId');
    if (envelope.type.startsWith('team.member.')) {
        const teamId = String(data.teamId || '');
        if (!teamId) throw new Error('Team member event requires teamId');
        const update = {
            $set: { sourceUpdatedAt: envelope.occurredAt, lastEventId: envelope.eventId },
            $setOnInsert: { status: 'active' },
        };
        if (envelope.type === 'team.member.removed') update.$pull = { teamIds: teamId };
        else update.$addToSet = { teamIds: teamId };
        const roster = await EmployeeRoster.findOneAndUpdate(
            { organizationId, userId }, update, { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        const oldManager = envelope.type === 'team.member.removed'
            ? data.role === 'line_manager'
            : envelope.type === 'team.member.role_changed' && data.oldRole === 'line_manager' && data.newRole !== 'line_manager';
        const newManager = data.team?.role === 'line_manager' || data.newRole === 'line_manager';
        if (oldManager || newManager) await EmployeeRoster.updateMany(
            { organizationId, teamIds: teamId },
            { $set: { managerId: newManager ? userId : null, sourceUpdatedAt: envelope.occurredAt } }
        );
        return roster;
    }
    const inactive = ['organization.member.removed', 'organization.member.deactivated'].includes(envelope.type);
    const effectiveAt = new Date(data.effectiveAt || envelope.occurredAt || Date.now());
    const status = inactive ? 'inactive' : (data.effectiveExitAt && new Date(data.effectiveExitAt) > new Date() ? 'scheduled_exit' : 'active');
    const roster = await EmployeeRoster.findOneAndUpdate(
        { organizationId, userId },
        {
            $set: {
                employeeId: data.employeeId,
                idpAccountId: data.userId && String(data.userId) !== userId ? String(data.userId) : undefined,
                email: data.email,
                name: data.name || data.userName,
                status,
                role: data.role,
                teamIds: data.teamIds || (data.teamId ? [data.teamId] : []),
                teamAssignments: data.teamAssignments || [],
                managerId: data.managerId,
                departmentId: data.departmentId,
                jurisdiction: data.jurisdiction,
                appAccess: data.appAccess,
                employmentStartAt: data.employmentStartAt,
                effectiveExitAt: inactive ? effectiveAt : (status === 'active' ? (data.effectiveExitAt || null) : data.effectiveExitAt),
                sourceUpdatedAt: envelope.occurredAt,
                lastEventId: envelope.eventId,
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (status === 'scheduled_exit' && data.effectiveExitAt) {
        await Shift.updateMany(
            { organizationId, userId, startAt: { $gte: new Date(data.effectiveExitAt) }, status: { $in: ['draft', 'published'] } },
            { $set: { status: 'cancelled', updatedBy: 'idp-lifecycle' }, $push: { changeHistory: { action: 'cancelled_on_scheduled_exit', actorId: 'system', actorName: 'IDP lifecycle', at: new Date(), details: envelope.eventId } } }
        );
    }

    if (inactive) {
        await Shift.updateMany(
            { organizationId, userId, startAt: { $gte: effectiveAt }, status: { $in: ['draft', 'published'] } },
            { $set: { status: 'cancelled', updatedBy: 'idp-lifecycle' }, $push: { changeHistory: { action: 'cancelled_on_exit', actorId: 'system', actorName: 'IDP lifecycle', at: new Date(), details: envelope.eventId } } }
        );
        const current = await TimeEntry.getCurrentStatus(userId, organizationId);
        if (current.isClockedIn) {
            const timestamp = new Date(Math.max(
                new Date(current.lastEntry.timestamp).getTime(),
                Math.min(effectiveAt.getTime(), Date.now())
            ));
            await TimeEntry.create({
                userId,
                userEmail: roster.email || 'inactive@invalid.local',
                userName: roster.name,
                organizationId,
                entryType: 'clock_out',
                timestamp,
                timezone: 'UTC',
                source: 'auto',
                note: 'Attendance session closed when IDP membership became inactive',
                modifiedBy: { userId: 'system', userName: 'IDP lifecycle', modifiedAt: new Date(), reason: envelope.eventId },
            });
        }
        await PresenceSession.updateMany({ organizationId, userId, status: { $in: ['active', 'stale'] } }, { $set: { status: 'ended', endedAt: effectiveAt, endReason: 'idp_membership_inactive' } });
    }
    return roster;
}

async function applyLeaveEvent(envelope) {
    const data = envelope.data;
    if (!envelope.organizationId || !envelope.subjectId || !data.leaveId) throw new Error('Leave event requires organizationId, userId and leaveId');
    const cancelled = envelope.type === 'leave.cancelled';
    const snapshot = await LeaveSnapshot.findOneAndUpdate(
        { organizationId: envelope.organizationId, externalLeaveId: data.leaveId },
        { $set: {
            userId: envelope.subjectId,
            type: data.leaveType,
            typeName: data.leaveTypeName || null,
            status: cancelled ? 'cancelled' : 'approved',
            startAt: data.startAt,
            endAt: data.endAt,
            allDay: data.allDay !== false,
            sourceUpdatedAt: envelope.occurredAt,
            lastSyncedAt: new Date(),
        } },
        { upsert: true, new: true, runValidators: true }
    );
    await recalculateEditableTimesheets({
        organizationId: envelope.organizationId,
        userId: envelope.subjectId,
        startAt: snapshot.startAt,
        endAt: snapshot.endAt,
    });
    return snapshot;
}

async function recalculateEditableTimesheets({ organizationId, userId, startAt, endAt }) {
    const query = {
        organizationId,
        status: { $in: ['draft', 'rejected', 'revision_requested', 'adjusted'] },
        lockedAt: null,
    };
    if (userId) query.userId = userId;
    if (startAt && endAt) {
        query.startDate = { $lte: endAt };
        query.endDate = { $gte: startAt };
    }
    const [timesheets, policy] = await Promise.all([
        Timesheet.find(query),
        AttendancePolicy.findOne({ organizationId }),
    ]);
    const { refreshTimesheetEntries } = require('../routes/timesheets');
    for (const timesheet of timesheets) await refreshTimesheetEntries(timesheet, policy);
    return timesheets.length;
}

async function applyHolidayEvent(envelope) {
    const data = envelope.data;
    if (!envelope.organizationId) throw new Error('Holiday event requires organizationId');
    if (envelope.type === 'holiday.calendar.updated') {
        const ids = [];
        for (const holiday of data.holidays || []) {
            const id = String(holiday.holidayId || holiday._id);
            ids.push(id);
            await PublicHolidaySnapshot.findOneAndUpdate(
                { organizationId: envelope.organizationId, externalHolidayId: id },
                { $set: { name: holiday.name, date: holiday.date, isRecurring: holiday.isRecurring, status: 'active', sourceUpdatedAt: envelope.occurredAt, lastSyncedAt: new Date() } },
                { upsert: true, new: true, runValidators: true }
            );
        }
        await PublicHolidaySnapshot.updateMany({ organizationId: envelope.organizationId, externalHolidayId: { $nin: ids } }, { $set: { status: 'cancelled', sourceUpdatedAt: envelope.occurredAt } });
        await recalculateEditableTimesheets({ organizationId: envelope.organizationId });
        return { synchronized: ids.length };
    }
    if (!data.holidayId) throw new Error('Holiday event requires holidayId');
    const snapshot = await PublicHolidaySnapshot.findOneAndUpdate(
        { organizationId: envelope.organizationId, externalHolidayId: String(data.holidayId) },
        { $set: { name: data.name, date: data.date, isRecurring: data.isRecurring, status: envelope.type === 'holiday.cancelled' ? 'cancelled' : 'active', sourceUpdatedAt: envelope.occurredAt, lastSyncedAt: new Date() } },
        { upsert: true, new: true, runValidators: true }
    );
    await recalculateEditableTimesheets({ organizationId: envelope.organizationId, startAt: snapshot.date, endAt: snapshot.date });
    return snapshot;
}

async function processLifecycleEvent(source, payload, eventTypeHeader) {
    const envelope = eventEnvelope(source, payload, eventTypeHeader);
    const record = await startEvent(envelope);
    if (!record) return { duplicate: true, eventId: envelope.eventId };
    try {
        let result;
        if (source === 'idp') result = await applyIdpLifecycle(envelope);
        else if (source === 'leave' && envelope.type.startsWith('holiday.')) result = await applyHolidayEvent(envelope);
        else if (source === 'leave') result = await applyLeaveEvent(envelope);
        else throw new Error(`Unsupported lifecycle source ${source}`);
        await markEvent(record, 'processed');
        return { duplicate: false, eventId: envelope.eventId, result };
    } catch (error) {
        await markEvent(record, 'failed', error);
        throw error;
    }
}

module.exports = { eventEnvelope, processLifecycleEvent, stableHash };

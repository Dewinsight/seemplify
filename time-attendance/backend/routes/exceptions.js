const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const {
    requireAuth, requireOrganization, getDepartmentHeadScope,
} = require('../middleware/auth');
const { AttendanceAccessPolicy, AttendanceException, AttendancePolicy, EmployeeRoster, Timesheet } = require('../models');
const { createNotification } = require('../services/notificationService');
const { PERMISSIONS, hasAttendancePermission } = require('../services/attendanceAccessService');
const { applyApprovedCorrection, normalizeRequestedChanges } = require('../services/attendanceCorrectionService');

router.use(requireAuth, requireOrganization);

const MANAGER_FLAG_TYPES = new Set([
    'absence', 'no_clock_out', 'late_arrival', 'early_departure', 'missed_break',
    'duplicate_session', 'leave_conflict', 'manual_review',
]);

function managedUserIds(req) {
    const ids = new Set((getDepartmentHeadScope(req).directReports || []).map(String));
    for (const team of req.user.teams || []) {
        if (team.organizationId !== req.organizationId || !['line_manager', 'team_lead'].includes(team.role)) continue;
        for (const id of [...(team.directReports || []), ...(team.directReportAccountIds || [])]) ids.add(String(id));
    }
    return ids;
}

async function canManage(req, userId) {
    if (!await hasAttendancePermission(req, PERMISSIONS.CORRECTIONS_REVIEW)) return false;
    const scope = req.attendanceAccess?.scopes?.[PERMISSIONS.CORRECTIONS_REVIEW];
    if (scope === 'organization') return true;
    return scope === 'reports' && managedUserIds(req).has(String(userId));
}

async function canView(req, userId) {
    return String(userId) === String(req.user.id) || await canManage(req, userId);
}

async function canReviewTimesheet(req, timesheet) {
    if (String(timesheet.userId) === String(req.user.id)) return false;
    if (!await hasAttendancePermission(req, PERMISSIONS.CORRECTIONS_REVIEW)) return false;
    if (await canManage(req, timesheet.userId)) return true;
    const currentLevel = timesheet.approvalWorkflow?.levels?.[Number(timesheet.approvalWorkflow?.currentLevel || 0)];
    const expectedApprover = currentLevel?.approverId || timesheet.assignedApprover?.userId;
    if (String(expectedApprover || '') === String(req.user.id)) return true;
    const policy = await AttendancePolicy.findOne({ organizationId: req.organizationId }).lean();
    const now = new Date();
    return (policy?.timesheetSettings?.approvalDelegations || []).some(delegation => (
        String(delegation.fromUserId) === String(expectedApprover)
        && String(delegation.toUserId) === String(req.user.id)
        && new Date(delegation.startsAt) <= now
        && new Date(delegation.endsAt) >= now
    ));
}

async function resolveCorrectionReviewers(req, timesheet) {
    const candidates = [];
    const addCandidate = (candidate) => {
        if (!candidate?.userId || String(candidate.userId) === String(timesheet.userId)) return;
        if (candidates.some(item => String(item.userId) === String(candidate.userId))) return;
        candidates.push(candidate);
    };
    const currentLevel = timesheet.approvalWorkflow?.levels?.[Number(timesheet.approvalWorkflow?.currentLevel || 0)];
    const assigned = currentLevel?.approverId
        ? { userId: currentLevel.approverId, userName: currentLevel.approverName || currentLevel.name, userEmail: currentLevel.approverEmail, roleLabel: currentLevel.name || 'Assigned timesheet approver' }
        : timesheet.assignedApprover?.userId
            ? { ...timesheet.assignedApprover.toObject?.() || timesheet.assignedApprover, roleLabel: 'Assigned timesheet approver' }
            : null;
    addCandidate(assigned);

    const employeeRoster = await EmployeeRoster.findOne({ organizationId: req.organizationId, userId: timesheet.userId }).lean();
    if (employeeRoster?.managerId) {
        const manager = await EmployeeRoster.findOne({ organizationId: req.organizationId, userId: employeeRoster.managerId, status: 'active' }).lean();
        addCandidate({
            userId: employeeRoster.managerId,
            userName: manager?.name || 'Line manager',
            userEmail: manager?.email,
            roleLabel: 'Line manager',
        });
    }

    if (!candidates.length) {
        const accessPolicy = await AttendanceAccessPolicy.findOne({ organizationId: req.organizationId }).lean();
        const reviewerRoleKeys = new Set((accessPolicy?.roles || [])
            .filter(role => (role.permissions || []).includes(PERMISSIONS.CORRECTIONS_REVIEW) && role.scope === 'organization')
            .map(role => role.key));
        const assignmentIds = (accessPolicy?.assignments || [])
            .filter(assignment => (assignment.roleKeys || []).some(roleKey => reviewerRoleKeys.has(roleKey)))
            .map(assignment => String(assignment.userId));
        const reviewerRoster = await EmployeeRoster.find({
            organizationId: req.organizationId,
            status: 'active',
            $or: [
                { userId: { $in: assignmentIds } },
                { role: { $in: ['owner', 'admin', 'hr_manager'] } },
            ],
        }).select('userId name email role').limit(20).lean();
        reviewerRoster.forEach(person => addCandidate({
            userId: person.userId,
            userName: person.name,
            userEmail: person.email,
            roleLabel: person.role === 'hr_manager' ? 'HR Manager' : 'Attendance Admin',
        }));
    }

    return {
        recipients: candidates,
        fallbackLabel: candidates.length
            ? candidates.map(item => `${item.userName || item.roleLabel} (${item.roleLabel})`).join(', ')
            : 'the HR Manager or Attendance Admin correction queue',
        reason: assigned && candidates.some(item => String(item.userId) === String(assigned.userId))
            ? 'Assigned timesheet approver'
            : candidates.some(item => item.roleLabel === 'Line manager') ? 'Employee line manager' : 'Organization correction queue',
    };
}

function validDate(value) {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
}

function isWithinTimesheet(date, timesheet) {
    return date >= new Date(timesheet.startDate) && date <= new Date(timesheet.endDate);
}

function contextFromTimesheet(timesheet) {
    if (!timesheet) return null;
    return {
        timesheetId: String(timesheet._id),
        userId: timesheet.userId,
        userName: timesheet.userName,
        userEmail: timesheet.userEmail,
        teamName: timesheet.teamName,
        weekNumber: timesheet.weekNumber,
        year: timesheet.year,
        periodType: timesheet.periodType,
        timezone: timesheet.policySnapshot?.timezone || 'UTC',
        startDate: timesheet.startDate,
        endDate: timesheet.endDate,
        status: timesheet.status,
    };
}

function exceptionView(exception, timesheet) {
    const value = exception.toObject ? exception.toObject() : exception;
    return {
        ...value,
        explanation: {
            message: typeof value.explanation === 'string'
                ? value.explanation
                : value.explanation?.message || value.description,
        },
        rule: { code: value.ruleKey || value.rule?.code },
        employee: {
            userId: value.userId,
            name: value.userName || timesheet?.userName,
            email: value.userEmail || timesheet?.userEmail,
            teamName: timesheet?.teamName,
        },
        period: contextFromTimesheet(timesheet),
    };
}

async function findTimesheetForAccess(req, id) {
    const timesheet = await Timesheet.findOne({ _id: id, organizationId: req.organizationId });
    if (!timesheet) return { status: 404, error: 'Timesheet not found' };
    if (!await canView(req, timesheet.userId) && !await canReviewTimesheet(req, timesheet)) return { status: 403, error: 'Access denied' };
    return { timesheet };
}

async function notifyCorrectionRequested(req, exception, timesheet, routing) {
    const params = new URLSearchParams({
        userId: String(exception.userId),
        timesheetId: String(exception.timesheetId),
        exceptionId: String(exception._id),
        start: new Date(timesheet.startDate).toISOString(),
        end: new Date(timesheet.endDate).toISOString(),
    });
    for (const recipient of routing.recipients) {
        await createNotification({
            organizationId: req.organizationId,
            userId: recipient.userId,
            userEmail: recipient.userEmail,
            type: 'general',
            title: 'Attendance correction awaiting your decision',
            message: `${exception.userName || req.user.name || req.user.email} proposed corrected work times for ${exception.type.replace(/_/g, ' ')}.`,
            actionUrl: `/exceptions?${params.toString()}`,
            priority: 'high',
            eventKey: `exception-correction:${exception._id}:${exception.correctionRequest.requestedAt.toISOString()}:${recipient.userId}`,
        });
    }
}

function recordOpenExceptionResolution(exception, actor, note) {
    if (exception.status !== 'open') {
        return { status: 409, error: 'Only an open exception can be accepted as reviewed' };
    }
    const reviewedAt = new Date();
    const reviewNote = String(note || '').trim().slice(0, 2000);
    if (reviewNote.length < 3) {
        return { status: 400, error: 'A decision reason of at least 3 characters is required' };
    }
    exception.status = 'resolved';
    exception.resolution = {
        outcome: 'accepted',
        reviewedBy: actor.userId,
        reviewedByName: actor.userName,
        reviewedAt,
        note: reviewNote,
    };
    if (!Array.isArray(exception.auditLog)) exception.auditLog = [];
    exception.auditLog.push({
        action: 'exception_accepted',
        actorId: actor.userId,
        actorName: actor.userName,
        at: reviewedAt,
        details: reviewNote,
    });
    return { exception };
}

async function applyCorrectionRequest(req, exception, timesheet) {
    const explanation = String(req.body.explanation || '').trim();
    if (!explanation) return { status: 400, error: 'An explanation is required' };
    const evidence = (Array.isArray(req.body.evidence) ? req.body.evidence : []).slice(0, 10).map(item => ({
        name: String(item.name || '').slice(0, 200),
        url: /^https?:\/\//i.test(String(item.url || '')) ? item.url : undefined,
        note: String(item.note || '').slice(0, 1000),
    }));
    const normalized = normalizeRequestedChanges(req.body.requestedChanges || {}, timesheet);
    if (normalized.error) return { status: 400, error: normalized.error };
    const routing = await resolveCorrectionReviewers(req, timesheet);
    exception.status = 'correction_requested';
    exception.correctionRequest = {
        explanation,
        requestedAt: new Date(),
        requestedBy: { userId: req.user.id, userName: req.user.name, userEmail: req.user.email },
        evidence,
        requestedChanges: normalized.value,
        reviewRouting: { ...routing, routedAt: new Date() },
        decision: 'pending',
    };
    exception.auditLog.push({
        action: 'correction_requested',
        actorId: req.user.id,
        actorName: req.user.name,
        details: explanation,
    });
    await exception.save();
    await notifyCorrectionRequested(req, exception, timesheet, routing);
    return { exception, routing };
}

router.get('/timesheets/:timesheetId/correction-route', async (req, res) => {
    try {
        const access = await findTimesheetForAccess(req, req.params.timesheetId);
        if (access.error) return res.status(access.status).json({ error: access.error });
        const routing = await resolveCorrectionReviewers(req, access.timesheet);
        res.json({ routing });
    } catch (error) {
        console.error('Get correction route error:', error);
        res.status(500).json({ error: 'Failed to determine the correction reviewer' });
    }
});

router.get('/', async (req, res) => {
    try {
        const query = { organizationId: req.organizationId };
        const targetUserId = req.query.userId ? String(req.query.userId) : null;
        let timesheet = null;

        if (req.query.timesheetId) {
            const access = await findTimesheetForAccess(req, req.query.timesheetId);
            if (access.error) return res.status(access.status).json({ error: access.error });
            timesheet = access.timesheet;
            if (targetUserId && targetUserId !== String(timesheet.userId)) {
                return res.status(400).json({ error: 'The employee does not match this timesheet' });
            }
            query.timesheetId = timesheet._id;
            query.userId = timesheet.userId;
        } else if (targetUserId) {
            if (!await canView(req, targetUserId)) return res.status(403).json({ error: 'Access denied' });
            query.userId = targetUserId;
        } else if (await hasAttendancePermission(req, PERMISSIONS.CORRECTIONS_REVIEW) && req.attendanceAccess?.scopes?.[PERMISSIONS.CORRECTIONS_REVIEW] === 'organization') {
            // HR can review all exceptions in the active organization.
        } else if (await hasAttendancePermission(req, PERMISSIONS.CORRECTIONS_REVIEW) && req.attendanceAccess?.scopes?.[PERMISSIONS.CORRECTIONS_REVIEW] === 'reports') {
            query.userId = { $in: Array.from(new Set([String(req.user.id), ...managedUserIds(req)])) };
        } else {
            query.userId = req.user.id;
        }

        if (req.query.status && req.query.status !== 'all') query.status = req.query.status;
        if (req.query.type) query.type = req.query.type;
        const start = validDate(req.query.start);
        const end = validDate(req.query.end);
        if ((req.query.start && !start) || (req.query.end && !end)) return res.status(400).json({ error: 'Invalid date filter' });
        if (start || end) query.occurrenceDate = {};
        if (start) query.occurrenceDate.$gte = start;
        if (end) query.occurrenceDate.$lte = end;

        const exceptions = await AttendanceException.find(query)
            .sort({ occurrenceDate: -1 })
            .limit(Math.min(Number(req.query.limit || 100), 250));
        const timesheetIds = Array.from(new Set(exceptions.map(item => String(item.timesheetId))));
        const timesheets = timesheet
            ? [timesheet]
            : await Timesheet.find({ _id: { $in: timesheetIds }, organizationId: req.organizationId }).lean();
        const timesheetById = new Map(timesheets.map(item => [String(item._id), item]));

        res.json({
            exceptions: exceptions.map(item => exceptionView(item, timesheetById.get(String(item.timesheetId)))),
            context: contextFromTimesheet(timesheet),
            appliedFilters: {
                userId: targetUserId || undefined,
                timesheetId: timesheet ? String(timesheet._id) : undefined,
                start: start?.toISOString(),
                end: end?.toISOString(),
            },
            disclaimer: 'Exceptions are explainable review flags. They do not make disciplinary, pay or performance decisions.',
        });
    } catch (error) {
        console.error('Get exceptions error:', error);
        res.status(500).json({ error: 'Failed to get attendance exceptions' });
    }
});

// A manager can flag a specific day while reviewing an employee timesheet.
router.post('/timesheets/:timesheetId/flags', async (req, res) => {
    try {
        const access = await findTimesheetForAccess(req, req.params.timesheetId);
        if (access.error) return res.status(access.status).json({ error: access.error });
        const timesheet = access.timesheet;
        if (!await canReviewTimesheet(req, timesheet)) return res.status(403).json({ error: 'Manager access required' });
        const type = String(req.body.type || 'manual_review');
        const occurrenceDate = validDate(req.body.date);
        const explanation = String(req.body.explanation || '').trim();
        if (!MANAGER_FLAG_TYPES.has(type)) return res.status(400).json({ error: 'Unsupported exception type' });
        if (!occurrenceDate || !isWithinTimesheet(occurrenceDate, timesheet)) return res.status(400).json({ error: 'The exception date must be inside this timesheet period' });
        if (explanation.length < 5) return res.status(400).json({ error: 'A reason of at least 5 characters is required' });

        const dayKey = occurrenceDate.toISOString().slice(0, 10);
        const fingerprint = crypto.createHash('sha256').update([
            req.organizationId, timesheet._id, timesheet.version || 1, dayKey, type, 'manager',
        ].join('|')).digest('hex');
        const now = new Date();
        const exception = await AttendanceException.findOneAndUpdate(
            { fingerprint },
            {
                $setOnInsert: {
                    organizationId: req.organizationId,
                    userId: timesheet.userId,
                    userEmail: timesheet.userEmail,
                    userName: timesheet.userName,
                    timesheetId: timesheet._id,
                    timesheetVersion: timesheet.version || 1,
                    occurrenceDate,
                    type,
                    ruleKey: 'manual.manager_review',
                    description: explanation,
                    explanation,
                    source: 'manager',
                    approvalBlocking: true,
                    raisedBy: { userId: req.user.id, userName: req.user.name, userEmail: req.user.email, raisedAt: now },
                    auditLog: [{ action: 'manager_flagged', actorId: req.user.id, actorName: req.user.name, details: explanation, at: now }],
                },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        await createNotification({
            organizationId: req.organizationId,
            userId: timesheet.userId,
            userEmail: timesheet.userEmail,
            type: 'general',
            title: 'Timesheet issue needs your attention',
            message: `${req.user.name || 'Your reviewer'} flagged ${type.replace(/_/g, ' ')} on ${dayKey}.`,
            actionUrl: `/timesheets/${timesheet._id}`,
            priority: 'high',
            eventKey: `manager-exception:${exception._id}`,
        });
        res.status(201).json({ exception: exceptionView(exception, timesheet) });
    } catch (error) {
        console.error('Create manager exception error:', error);
        res.status(500).json({ error: 'Failed to flag the timesheet issue' });
    }
});

// An employee can request a correction from the exact day on their timesheet,
// even when an automated rule did not already create an exception record.
router.post('/timesheets/:timesheetId/correction-requests', async (req, res) => {
    try {
        const timesheet = await Timesheet.findOne({ _id: req.params.timesheetId, organizationId: req.organizationId, userId: req.user.id });
        if (!timesheet) return res.status(404).json({ error: 'Timesheet not found' });
        const occurrenceDate = validDate(req.body.date);
        if (!occurrenceDate || !isWithinTimesheet(occurrenceDate, timesheet)) return res.status(400).json({ error: 'The correction date must be inside this timesheet period' });

        let exception = null;
        if (req.body.exceptionId) {
            exception = await AttendanceException.findOne({
                _id: req.body.exceptionId,
                organizationId: req.organizationId,
                userId: req.user.id,
                timesheetId: timesheet._id,
            });
        }
        if (!exception) {
            const dayStart = new Date(occurrenceDate);
            dayStart.setUTCHours(0, 0, 0, 0);
            const dayEnd = new Date(dayStart);
            dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
            exception = await AttendanceException.findOne({
                organizationId: req.organizationId,
                userId: req.user.id,
                timesheetId: timesheet._id,
                occurrenceDate: { $gte: dayStart, $lt: dayEnd },
                status: { $in: ['open', 'correction_requested'] },
            });
        }
        if (!exception) {
            const dayKey = occurrenceDate.toISOString().slice(0, 10);
            const fingerprint = crypto.createHash('sha256').update([
                req.organizationId, timesheet._id, timesheet.version || 1, dayKey, 'employee_correction_request',
            ].join('|')).digest('hex');
            exception = await AttendanceException.create({
                organizationId: req.organizationId,
                userId: req.user.id,
                userEmail: timesheet.userEmail,
                userName: timesheet.userName,
                timesheetId: timesheet._id,
                timesheetVersion: timesheet.version || 1,
                occurrenceDate,
                type: String(req.body.type || 'employee_correction_request'),
                ruleKey: 'employee.correction_request',
                description: 'The employee requested review of this attendance day.',
                explanation: 'The employee requested review of this attendance day.',
                source: 'employee',
                approvalBlocking: false,
                fingerprint,
                raisedBy: { userId: req.user.id, userName: req.user.name, userEmail: req.user.email, raisedAt: new Date() },
                auditLog: [{ action: 'employee_flagged', actorId: req.user.id, actorName: req.user.name, details: String(req.body.explanation || '') }],
            });
        }
        const result = await applyCorrectionRequest(req, exception, timesheet);
        if (result.error) return res.status(result.status).json({ error: result.error });
        res.status(201).json({ exception: exceptionView(result.exception, timesheet), routing: result.routing });
    } catch (error) {
        console.error('Create timesheet correction request error:', error);
        res.status(500).json({ error: 'Failed to request the correction' });
    }
});

router.post('/:id/correction-requests', async (req, res) => {
    try {
        const exception = await AttendanceException.findOne({ _id: req.params.id, organizationId: req.organizationId, userId: req.user.id });
        if (!exception) return res.status(404).json({ error: 'Attendance exception not found' });
        const timesheet = await Timesheet.findOne({ _id: exception.timesheetId, organizationId: req.organizationId });
        if (!timesheet) return res.status(404).json({ error: 'Timesheet not found' });
        const result = await applyCorrectionRequest(req, exception, timesheet);
        if (result.error) return res.status(result.status).json({ error: result.error });
        res.status(201).json({ exception: exceptionView(result.exception, timesheet), routing: result.routing });
    } catch (error) {
        console.error('Request exception correction error:', error);
        res.status(500).json({ error: 'Failed to request the correction' });
    }
});

// A reviewer may accept an open exception as understood without inventing or
// changing worked time. This closes the review flag and keeps the reason in the
// audit trail. Correction requests use the separate review endpoint below.
router.post('/:id/resolve', async (req, res) => {
    try {
        const exception = await AttendanceException.findOne({ _id: req.params.id, organizationId: req.organizationId });
        if (!exception) return res.status(404).json({ error: 'Attendance exception not found' });
        const timesheet = await Timesheet.findOne({ _id: exception.timesheetId, organizationId: req.organizationId });
        if (!timesheet || !await canReviewTimesheet(req, timesheet)) return res.status(403).json({ error: 'A different authorised reviewer is required' });
        const result = recordOpenExceptionResolution(exception, {
            userId: req.user.id,
            userName: req.user.name,
            userEmail: req.user.email,
        }, req.body.note);
        if (result.error) return res.status(result.status).json({ error: result.error });
        await exception.save();
        await createNotification({
            organizationId: req.organizationId,
            userId: exception.userId,
            userEmail: exception.userEmail,
            type: 'general',
            title: 'Attendance exception reviewed',
            message: exception.resolution.note,
            actionUrl: `/exceptions?timesheetId=${encodeURIComponent(String(exception.timesheetId))}&exceptionId=${encodeURIComponent(String(exception._id))}`,
            priority: 'normal',
            eventKey: `exception-resolved:${exception._id}:${exception.resolution.reviewedAt.toISOString()}`,
        });
        res.json({ exception: exceptionView(exception, timesheet) });
    } catch (error) {
        console.error('Resolve attendance exception error:', error);
        res.status(500).json({ error: 'Failed to record the exception decision' });
    }
});

router.post('/:id/review', async (req, res) => {
    try {
        const exception = await AttendanceException.findOne({ _id: req.params.id, organizationId: req.organizationId });
        if (!exception) return res.status(404).json({ error: 'Attendance exception not found' });
        const timesheet = await Timesheet.findOne({ _id: exception.timesheetId, organizationId: req.organizationId });
        if (!timesheet || !await canReviewTimesheet(req, timesheet)) return res.status(403).json({ error: 'Manager access required' });
        if (exception.status !== 'correction_requested') return res.status(409).json({ error: 'No correction request is awaiting review' });
        const note = String(req.body.note || '').trim();
        if (note.length < 3) return res.status(400).json({ error: 'A decision reason of at least 3 characters is required' });
        const accepted = req.body.accepted === true;
        let applied = null;
        if (accepted) {
            applied = await applyApprovedCorrection({
                exception,
                timesheet,
                actor: { userId: req.user.id, userName: req.user.name, userEmail: req.user.email },
                note: note.slice(0, 2000),
            });
            if (applied.error) return res.status(applied.status).json({ error: applied.error });
        }
        exception.status = accepted ? 'resolved' : 'open';
        exception.correctionRequest.decision = accepted ? 'accepted' : 'rejected';
        exception.correctionRequest.reviewedBy = req.user.id;
        exception.correctionRequest.reviewedByName = req.user.name;
        exception.correctionRequest.reviewedAt = new Date();
        exception.correctionRequest.reviewNote = note.slice(0, 2000);
        if (applied) {
            exception.correctionRequest.appliedAt = new Date();
            exception.correctionRequest.appliedTimesheetId = applied.target._id;
            exception.correctionRequest.createdAdjustmentVersion = applied.createdAdjustment;
            exception.correctionRequest.replacementEntryIds = applied.replacementEntryIds;
            exception.correctionRequest.supersededEntryIds = applied.supersededEntryIds;
        }
        exception.auditLog.push({
            action: accepted ? 'correction_accepted' : 'correction_rejected',
            actorId: req.user.id,
            actorName: req.user.name,
            details: exception.correctionRequest.reviewNote,
        });
        await exception.save();
        await createNotification({
            organizationId: req.organizationId,
            userId: exception.userId,
            userEmail: exception.userEmail,
            type: 'general',
            title: accepted ? 'Attendance correction approved and applied' : 'Attendance correction not approved',
            message: exception.correctionRequest.reviewNote,
            actionUrl: `/exceptions?timesheetId=${encodeURIComponent(String(exception.timesheetId))}&exceptionId=${encodeURIComponent(String(exception._id))}`,
            priority: accepted ? 'normal' : 'high',
            eventKey: `exception-reviewed:${exception._id}:${exception.correctionRequest.reviewedAt.toISOString()}`,
        });
        res.json({
            exception: exceptionView(exception, timesheet),
            applied: applied ? {
                timesheetId: String(applied.target._id),
                version: applied.target.version,
                createdAdjustment: applied.createdAdjustment,
            } : undefined,
        });
    } catch (error) {
        console.error('Review exception correction error:', error);
        res.status(500).json({ error: 'Failed to record the exception decision' });
    }
});

module.exports = router;
module.exports.canManage = canManage;
module.exports.canReviewTimesheet = canReviewTimesheet;
module.exports.exceptionView = exceptionView;
module.exports.recordOpenExceptionResolution = recordOpenExceptionResolution;

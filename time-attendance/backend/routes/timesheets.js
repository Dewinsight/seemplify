const express = require('express');
const router = express.Router();
const { requireAuth, requireOrganization, isHRAdmin, isDepartmentHead, getDepartmentHeadScope } = require('../middleware/auth');
const { Timesheet, TimeEntry, AttendancePolicy, EmployeeRoster, LeaveSnapshot, PublicHolidaySnapshot } = require('../models');
const { startOfWeek, endOfWeek, getISOWeek, getYear, format, parseISO, eachDayOfInterval } = require('date-fns');
const { generateTimesheetExcelReport } = require('../services/timesheetExportService');
const { calculatePeriod, canRecalculateTimesheet } = require('../services/timeCalculationService');
const { createNotification } = require('../services/notificationService');
const { syncTimesheetExceptions } = require('../services/exceptionService');
const { resolveCalculationPolicy } = require('../services/rulePackService');

// Apply auth middleware
router.use(requireAuth);
router.use(requireOrganization);

function canManageUser(req, userId) {
    if (isHRAdmin(req)) return true;
    const target = String(userId);
    if (isDepartmentHead(req) && getDepartmentHeadScope(req).directReports.includes(target)) return true;
    return (req.user.teams || []).some(team => (
        team.organizationId === req.organizationId
        && ['line_manager', 'team_lead'].includes(team.role)
        && [...(team.directReports || []), ...(team.directReportAccountIds || [])].map(String).includes(target)
    ));
}

async function canAccessTimesheet(req, timesheet) {
    if (String(timesheet.userId) === String(req.user.id) || canManageUser(req, timesheet.userId)) return true;
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

// Get current user's timesheets (or specific user for managers)
router.get('/', async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { limit = 10, status, year, userId } = req.query;

        // Default to current user if not specified
        let targetUserId = req.user.id;

        if (userId && userId !== req.user.id) {
            if (!canManageUser(req, userId)) return res.status(403).json({ error: 'Access denied' });
            targetUserId = userId;
        }

        const query = { userId: targetUserId, organizationId };
        if (status) query.status = status;
        if (year) query.year = parseInt(year);

        const timesheets = await Timesheet.find(query)
            .sort({ startDate: -1 })
            .limit(parseInt(limit));

        res.json({ timesheets });
    } catch (error) {
        console.error('Get timesheets error:', error);
        res.status(500).json({ error: 'Failed to get timesheets' });
    }
});

// Get current week timesheet
router.get('/current', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;
        const userTeam = req.user.teams?.find(t => t.organizationId === organizationId);

        const policy = await AttendancePolicy.getOrCreateDefault(organizationId, req.organizationName, userId);
        const timesheet = await Timesheet.findOrCreateCurrentPeriod(userId, organizationId, {
            email: req.user.email,
            name: req.user.name,
            organizationName: req.organizationName,
            teamId: userTeam?.id,
            teamName: userTeam?.name,
            timezone: req.user.userinfo?.zoneinfo || 'UTC',
        }, policy);

        // Refresh daily entries with actual time data
        if (canRecalculateTimesheet(timesheet)) {
            await refreshTimesheetEntries(timesheet, policy);
        }

        res.json({ timesheet });
    } catch (error) {
        console.error('Get current timesheet error:', error);
        res.status(500).json({ error: 'Failed to get current timesheet' });
    }
});

// Get specific timesheet by ID
router.get('/:id', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;

        const timesheet = await Timesheet.findOne({
            _id: req.params.id,
            organizationId,
        });

        if (!timesheet) {
            return res.status(404).json({ error: 'Timesheet not found' });
        }

        // Check access - user can view own, managers can view team's, HR can view all
        if (!await canAccessTimesheet(req, timesheet)) return res.status(403).json({ error: 'Access denied' });

        // Draft and revision timesheets are live views of attendance. Refresh
        // them before returning details so punches, breaks and locations never
        // appear only as a side effect of submission.
        if (canRecalculateTimesheet(timesheet)) {
            const policy = await AttendancePolicy.getOrCreateDefault(organizationId, req.organizationName, userId);
            await refreshTimesheetEntries(timesheet, policy);
        }

        res.json({ timesheet });
    } catch (error) {
        console.error('Get timesheet error:', error);
        res.status(500).json({ error: 'Failed to get timesheet' });
    }
});

// Export a detailed timesheet report as Excel (.xlsx)
router.get('/:id/export', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;

        const timesheet = await Timesheet.findOne({
            _id: req.params.id,
            organizationId,
        });

        if (!timesheet) {
            return res.status(404).json({ error: 'Timesheet not found' });
        }

        // Check access - user can export own, managers can export team's, HR can export all
        if (!await canAccessTimesheet(req, timesheet)) return res.status(403).json({ error: 'Access denied' });

        // Refresh timesheet to ensure latest computed totals before export.
        if (canRecalculateTimesheet(timesheet)) {
            const policy = await AttendancePolicy.getOrCreateDefault(organizationId, req.organizationName, userId);
            await refreshTimesheetEntries(timesheet, policy);
        }

        const entries = await TimeEntry.find({
            userId: timesheet.userId,
            organizationId,
            timestamp: { $gte: timesheet.startDate, $lte: timesheet.endDate },
        }).sort({ timestamp: 1 }).lean();

        const { buffer, filename } = await generateTimesheetExcelReport({
            timesheet: timesheet.toObject(),
            entries,
            organizationName: req.organizationName,
            exportedByName: req.user.name,
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', buffer.length);
        return res.send(buffer);
    } catch (error) {
        console.error('Export timesheet error:', error);
        res.status(500).json({ error: 'Failed to export timesheet' });
    }
});

// Submit timesheet for approval
router.post('/:id/submit', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;
        const { note, attested = true, statementVersion = 'v1' } = req.body;

        const timesheet = await Timesheet.findOne({
            _id: req.params.id,
            userId,
            organizationId,
        });

        if (!timesheet) {
            return res.status(404).json({ error: 'Timesheet not found' });
        }

        // Treat undefined/null status as 'draft'
        const currentStatus = timesheet.status || 'draft';
        if (!['draft', 'rejected', 'revision_requested', 'adjusted'].includes(currentStatus)) {
            return res.status(400).json({
                error: 'Timesheet cannot be submitted',
                code: 'INVALID_STATUS',
                currentStatus,
            });
        }

        // Reject an open period before recalculating or mutating workflow state.
        // Previously the route saved the timesheet as submitted and only then
        // returned PERIOD_STILL_OPEN, leaving the persisted status inconsistent
        // with the response shown to the employee.
        if (new Date(timesheet.endDate) >= new Date()) {
            return res.status(409).json({
                error: 'The attendance period is still open and cannot be submitted yet',
                code: 'PERIOD_STILL_OPEN',
                periodEndsAt: timesheet.endDate,
            });
        }

        // Refresh entries and calculate summary
        const policy = await AttendancePolicy.getOrCreateDefault(organizationId, req.organizationName, userId);
        await refreshTimesheetEntries(timesheet, policy);
        timesheet.calculateSummary();

        // Find line manager for approval
        // Note: IdP returns managerId/managerName directly on the team object
        const userTeam = req.user.teams?.find(t => t.organizationId === organizationId);

        if (userTeam && userTeam.managerId) {
            timesheet.assignedApprover = {
                userId: userTeam.managerId,
                userName: userTeam.managerName,
                userEmail: userTeam.managerEmail || null,
                teamId: userTeam.id,
                assignedAt: new Date(),
            };
        }

        const configuredLevels = policy.timesheetSettings?.approvalLevels?.length
            ? policy.timesheetSettings.approvalLevels
            : [{ name: 'Line manager', approverType: 'line_manager' }];
        timesheet.approvalWorkflow = {
            currentLevel: 0,
            levels: configuredLevels.map((level, order) => ({
                order,
                name: level.name || `Approval level ${order + 1}`,
                approverType: level.approverType || 'line_manager',
                approverId: level.approverType === 'line_manager' ? userTeam?.managerId : level.approverId,
                approverName: level.approverType === 'line_manager' ? userTeam?.managerName : level.approverName,
                approverEmail: level.approverType === 'line_manager' ? userTeam?.managerEmail : level.approverEmail,
                status: 'pending',
            })),
        };
        const firstLevel = timesheet.approvalWorkflow.levels[0];
        timesheet.assignedApprover = {
            userId: firstLevel.approverId,
            userName: firstLevel.approverName || firstLevel.name,
            userEmail: firstLevel.approverEmail,
            teamId: userTeam?.id,
            assignedAt: new Date(),
        };

        timesheet.status = 'submitted';
        timesheet.submittedAt = new Date();
        timesheet.submittedNote = note;
        timesheet.employeeAttestation = {
            accepted: Boolean(attested),
            acceptedAt: attested ? new Date() : null,
            statementVersion,
        };
        timesheet.addAuditLog('submitted', userId, req.user.name, note);

        if (policy.timesheetSettings?.autoApprove && Number(timesheet.summary?.incompleteEntries || 0) === 0) {
            for (const level of timesheet.approvalWorkflow.levels) {
                level.status = 'approved';
                level.decidedBy = 'system';
                level.decidedByName = 'Attendance policy';
                level.decidedAt = new Date();
                level.comment = 'Automatically approved by organization policy';
            }
            timesheet.approvalWorkflow.completedAt = new Date();
            timesheet.status = 'payroll_pending';
            timesheet.approvedBy = {
                userId: 'system',
                userName: 'Attendance policy',
                approvedAt: new Date(),
                comment: 'Automatically approved by organization policy',
            };
            timesheet.lockedAt = new Date();
            timesheet.lockedBy = 'system';
            timesheet.payrollIntegration.state = 'pending';
            timesheet.payrollIntegration.idempotencyKey = `timesheet:${timesheet._id}:v${timesheet.version || 1}`;
            timesheet.addAuditLog('auto_approved', 'system', 'Attendance policy');
        }

        await timesheet.save();

        // Notify assigned manager on submission (if policy allows and manager email is available)
        if (timesheet.status === 'submitted' && timesheet.assignedApprover?.userId) {
            await createNotification({
                organizationId,
                userId: timesheet.assignedApprover.userId,
                userEmail: timesheet.assignedApprover.userEmail,
                type: 'timesheet_status',
                title: 'Timesheet awaiting approval',
                message: `${timesheet.userName || timesheet.userEmail} submitted a timesheet for your review.`,
                actionUrl: `/approvals`,
                priority: 'normal',
                eventKey: `timesheet-submitted:${timesheet._id}:v${timesheet.version || 1}`,
                channels: { email: policy?.notifications?.emailOnSubmission === true },
            });
        }

        res.json({
            success: true,
            timesheet,
            message: timesheet.status === 'payroll_pending' ? 'Timesheet submitted and approved by policy' : 'Timesheet submitted for approval',
        });
    } catch (error) {
        console.error('Submit timesheet error:', error);
        res.status(500).json({ error: 'Failed to submit timesheet' });
    }
});

// Recall submitted timesheet
router.post('/:id/recall', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;

        const timesheet = await Timesheet.findOne({
            _id: req.params.id,
            userId,
            organizationId,
        });

        if (!timesheet) {
            return res.status(404).json({ error: 'Timesheet not found' });
        }

        if (timesheet.status !== 'submitted') {
            return res.status(400).json({
                error: 'Only submitted timesheets can be recalled',
                code: 'INVALID_STATUS',
            });
        }

        timesheet.status = 'draft';
        timesheet.addAuditLog('recalled', userId, req.user.name, 'Recalled for editing');

        await timesheet.save();

        res.json({
            success: true,
            timesheet,
            message: 'Timesheet recalled',
        });
    } catch (error) {
        console.error('Recall timesheet error:', error);
        res.status(500).json({ error: 'Failed to recall timesheet' });
    }
});

// Update daily entry note (for draft timesheets only)
router.patch('/:id/daily/:date', async (req, res) => {
    try {
        const userId = req.user.id;
        const organizationId = req.organizationId;
        const { notes } = req.body;

        const timesheet = await Timesheet.findOne({
            _id: req.params.id,
            userId,
            organizationId,
        });

        if (!timesheet) {
            return res.status(404).json({ error: 'Timesheet not found' });
        }

        if (timesheet.status !== 'draft') {
            return res.status(400).json({ error: 'Cannot modify submitted timesheet' });
        }

        const targetDate = parseISO(req.params.date);
        const dailyEntry = timesheet.dailyEntries.find(
            e => format(e.date, 'yyyy-MM-dd') === format(targetDate, 'yyyy-MM-dd')
        );

        if (!dailyEntry) {
            return res.status(404).json({ error: 'Daily entry not found' });
        }

        dailyEntry.notes = notes;
        timesheet.addAuditLog('updated', userId, req.user.name, null, `Updated notes for ${format(targetDate, 'MMM d')}`);

        await timesheet.save();

        res.json({ success: true, timesheet });
    } catch (error) {
        console.error('Update daily entry error:', error);
        res.status(500).json({ error: 'Failed to update entry' });
    }
});

// Helper function to refresh timesheet with actual time entries
async function refreshTimesheetEntries(timesheet, suppliedPolicy = null, options = {}) {
    if (!options.allowLocked && !canRecalculateTimesheet(timesheet)) {
        return timesheet;
    }

    const policy = suppliedPolicy || await AttendancePolicy.getOrCreateDefault(
        timesheet.organizationId,
        timesheet.organizationName,
        timesheet.userId
    );
    const [entries, roster] = await Promise.all([
        TimeEntry.find({
            userId: timesheet.userId,
            organizationId: timesheet.organizationId,
            timestamp: { $gte: timesheet.startDate, $lte: timesheet.endDate },
        }).sort({ timestamp: 1 }).lean(),
        EmployeeRoster.findOne({ organizationId: timesheet.organizationId, userId: timesheet.userId }).lean(),
    ]);

    const [leaves, holidays] = await Promise.all([
        LeaveSnapshot.find({ organizationId: timesheet.organizationId, userId: timesheet.userId, status: 'approved', startAt: { $lte: timesheet.endDate }, endAt: { $gte: timesheet.startDate } }).lean(),
        PublicHolidaySnapshot.find({ organizationId: timesheet.organizationId, status: 'active', $or: [{ date: { $gte: timesheet.startDate, $lte: timesheet.endDate } }, { isRecurring: true }] }).lean(),
    ]);
    const effective = await resolveCalculationPolicy({
        policy,
        organizationId: timesheet.organizationId,
        userId: timesheet.userId,
        teamId: timesheet.teamId || roster?.teamIds?.[0],
        countryCode: roster?.jurisdiction?.countryCode,
        subdivisionCode: roster?.jurisdiction?.subdivisionCode,
        at: timesheet.endDate,
    });
    const calculationPolicy = effective.policy;
    const calculation = calculatePeriod(entries, {
        start: timesheet.startDate,
        end: timesheet.endDate,
    }, calculationPolicy, { leaves, holidays });
    timesheet.dailyEntries = calculation.dailyEntries;
    timesheet.summary = calculation.summary;
    timesheet.policySnapshot = {
        rulePackId: policy.activeRulePack?.rulePackId?.toString(),
        rulePackVersion: policy.activeRulePack?.version,
        appliedRulePacks: effective.applied.map(item => ({ id: item.id?.toString(), key: item.key, version: item.version, precedence: item.score })),
        timezone: calculation.timeZone,
        standardHoursPerDay: calculationPolicy.workSchedule?.standardHoursPerDay,
        standardHoursPerWeek: calculationPolicy.workSchedule?.standardHoursPerWeek,
        dailyOvertimeThreshold: calculationPolicy.overtime?.dailyThreshold,
        weeklyOvertimeThreshold: calculationPolicy.overtime?.weeklyThreshold,
        calculatedAt: new Date(),
    };
    await timesheet.save();
    await syncTimesheetExceptions(timesheet);

    return timesheet;
}

// Export both router and helper function
module.exports = router;
module.exports.refreshTimesheetEntries = refreshTimesheetEntries;

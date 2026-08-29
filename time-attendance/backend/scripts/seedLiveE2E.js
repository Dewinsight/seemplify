require('dotenv').config();

const mongoose = require('mongoose');
const {
    AttendanceException,
    AttendancePolicy,
    AttendanceRulePack,
    EmployeeRoster,
    Notification,
    NotificationPreference,
    ApplicationAssignment,
    Shift,
    ShiftRequest,
    ShiftTemplate,
    TimeEntry,
    Timesheet,
} = require('../models');
const { buildApprovalWorkflow } = require('../services/approvalConfigurationService');
const { defaultRequestPolicy } = require('../services/schedulingPolicyService');
const { getPeriodBounds } = require('../services/timeCalculationService');

const ORGANIZATION_ID = 'org-live-e2e';
const EMPLOYEE_ID = 'employee-live-1';
const REPORT_ID = 'employee-live-2';
const TEAM_ID = 'team-live-1';

function addDays(date, days) {
    return new Date(date.getTime() + (days * 24 * 60 * 60 * 1000));
}

async function seed() {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is required');
    if (!/live-e2e|ta-e2e/i.test(uri)) {
        throw new Error('Refusing to reset a database whose URI is not clearly marked as E2E');
    }

    await mongoose.connect(uri);
    await mongoose.connection.dropDatabase();

    const now = new Date();
    const current = getPeriodBounds(now, 'weekly', 'Europe/London');
    const previousStart = addDays(current.start, -7);
    const previousEnd = new Date(current.start.getTime() - 1);
    const twoPeriodsAgoStart = addDays(current.start, -14);
    const twoPeriodsAgoEnd = new Date(previousStart.getTime() - 1);

    await AttendancePolicy.create({
        organizationId: ORGANIZATION_ID,
        organizationName: 'Seemplify Live E2E',
        timezone: 'Europe/London',
        jurisdiction: { countryCode: 'NG' },
        workSchedule: {
            type: 'flexible',
            standardHoursPerDay: 8,
            standardHoursPerWeek: 40,
            workDays: [0, 1, 2, 3, 4, 5, 6],
            defaultShift: { name: 'Live test shift', startTime: '00:00', endTime: '23:59', breakDuration: 30 },
        },
        clockSettings: {
            allowRemoteClock: true,
            requireNote: false,
            allowManualEntry: true,
            enforceClockInWindow: false,
            nonWorkingDayClockIn: 'allow',
            maximumLocationAccuracyMeters: 1000,
            autoClockOut: { enabled: false, afterHours: 12, warningMinutes: 30 },
        },
        geofencing: { enabled: false, enforced: false, locations: [] },
        timesheetSettings: {
            periodType: 'weekly',
            autoSubmit: false,
            autoApprove: false,
            approvalLevels: [{ name: 'Line manager', approverType: 'line_manager' }],
        },
        notifications: {
            emailOnSubmission: false,
            emailOnApproval: false,
            emailOnRejection: false,
            reminderBeforeDeadline: false,
            managerReports: { enabled: false, frequency: 'weekly', sendHourUtc: 9, includeExcel: true },
        },
        createdBy: EMPLOYEE_ID,
        updatedBy: EMPLOYEE_ID,
    });

    await EmployeeRoster.insertMany([
        {
            organizationId: ORGANIZATION_ID,
            userId: EMPLOYEE_ID,
            email: 'alex.live@example.test',
            name: 'Alex Live',
            status: 'active',
            role: 'admin',
            teamIds: [TEAM_ID],
            teamAssignments: [{ teamId: TEAM_ID, name: 'Operations', managerId: EMPLOYEE_ID }],
            jurisdiction: { countryCode: 'NG' },
            appAccess: { mode: 'all', appIds: [] },
        },
        {
            organizationId: ORGANIZATION_ID,
            userId: REPORT_ID,
            email: 'jamie.live@example.test',
            name: 'Jamie Live',
            status: 'active',
            role: 'employee',
            teamIds: [TEAM_ID],
            teamAssignments: [{ teamId: TEAM_ID, name: 'Operations', managerId: EMPLOYEE_ID }],
            managerId: EMPLOYEE_ID,
            jurisdiction: { countryCode: 'NG' },
            appAccess: { mode: 'all', appIds: [] },
        },
    ]);

    const currentTimesheet = await Timesheet.create({
        userId: EMPLOYEE_ID,
        userEmail: 'alex.live@example.test',
        userName: 'Alex Live',
        organizationId: ORGANIZATION_ID,
        organizationName: 'Seemplify Live E2E',
        teamId: TEAM_ID,
        teamName: 'Operations',
        periodType: 'weekly',
        periodKey: current.key,
        startDate: current.start,
        endDate: current.end,
        weekNumber: current.weekNumber,
        year: current.year,
        status: 'draft',
        summary: { totalHours: 0, regularHours: 0, overtimeHours: 0, daysWorked: 0 },
        auditLog: [{ action: 'created', performedBy: EMPLOYEE_ID, performedByName: 'Alex Live' }],
    });

    const previousTimesheet = await Timesheet.create({
        userId: EMPLOYEE_ID,
        userEmail: 'alex.live@example.test',
        userName: 'Alex Live',
        organizationId: ORGANIZATION_ID,
        organizationName: 'Seemplify Live E2E',
        teamId: TEAM_ID,
        teamName: 'Operations',
        periodType: 'weekly',
        periodKey: 'live-e2e-previous',
        startDate: previousStart,
        endDate: previousEnd,
        weekNumber: current.weekNumber ? Math.max(1, current.weekNumber - 1) : 1,
        year: previousStart.getUTCFullYear(),
        status: 'draft',
        summary: { totalHours: 40, regularHours: 40, overtimeHours: 0, daysWorked: 5 },
        dailyEntries: [{
            date: previousStart,
            dayOfWeek: previousStart.getUTCDay(),
            clockIn: new Date(previousStart.getTime() + (9 * 60 * 60 * 1000)),
            clockOut: new Date(previousStart.getTime() + (17 * 60 * 60 * 1000)),
            breakDuration: 0,
            totalMinutes: 480,
            totalHours: 8,
            regularHours: 8,
            overtimeHours: 0,
            status: 'present',
        }],
        auditLog: [{ action: 'created', performedBy: EMPLOYEE_ID, performedByName: 'Alex Live' }],
    });

    const reportTimesheet = await Timesheet.create({
        userId: REPORT_ID,
        userEmail: 'jamie.live@example.test',
        userName: 'Jamie Live',
        organizationId: ORGANIZATION_ID,
        organizationName: 'Seemplify Live E2E',
        teamId: TEAM_ID,
        teamName: 'Operations',
        periodType: 'weekly',
        periodKey: 'live-e2e-report-previous',
        startDate: twoPeriodsAgoStart,
        endDate: twoPeriodsAgoEnd,
        weekNumber: current.weekNumber ? Math.max(1, current.weekNumber - 2) : 1,
        year: twoPeriodsAgoStart.getUTCFullYear(),
        status: 'submitted',
        submittedAt: new Date(now.getTime() - (60 * 60 * 1000)),
        assignedApprover: {
            userId: EMPLOYEE_ID,
            userName: 'Alex Live',
            userEmail: 'alex.live@example.test',
            teamId: TEAM_ID,
            assignedAt: new Date(now.getTime() - (60 * 60 * 1000)),
        },
        approvalWorkflow: {
            currentLevel: 0,
            levels: [{
                order: 0,
                name: 'Line manager',
                approverType: 'line_manager',
                approverId: EMPLOYEE_ID,
                approverName: 'Alex Live',
                approverEmail: 'alex.live@example.test',
                status: 'pending',
            }],
        },
        summary: { totalHours: 38, regularHours: 38, overtimeHours: 0, daysWorked: 5 },
        auditLog: [
            { action: 'created', performedBy: REPORT_ID, performedByName: 'Jamie Live' },
            { action: 'submitted', performedBy: REPORT_ID, performedByName: 'Jamie Live' },
        ],
    });

    await TimeEntry.create({
        userId: REPORT_ID,
        userEmail: 'jamie.live@example.test',
        userName: 'Jamie Live',
        organizationId: ORGANIZATION_ID,
        organizationName: 'Seemplify Live E2E',
        teamId: TEAM_ID,
        teamName: 'Operations',
        entryType: 'clock_in',
        timestamp: new Date(now.getTime() - (60 * 60 * 1000)),
        timezone: 'Europe/London',
        source: 'web',
        workMode: 'remote',
    });

    const template = await ShiftTemplate.create({
        organizationId: ORGANIZATION_ID,
        name: 'Day shift',
        scheduleType: 'fixed',
        startTime: '09:00',
        endTime: '17:00',
        breakMinutes: 30,
        workMode: 'remote',
        createdBy: EMPLOYEE_ID,
    });

    const publishedShift = await Shift.create({
        organizationId: ORGANIZATION_ID,
        userId: EMPLOYEE_ID,
        teamId: TEAM_ID,
        templateId: template._id,
        startAt: addDays(now, 1),
        endAt: new Date(addDays(now, 1).getTime() + (8 * 60 * 60 * 1000)),
        timezone: 'Europe/London',
        breakMinutes: 30,
        workMode: 'remote',
        status: 'published',
        publicationVersion: 1,
        acknowledgement: { status: 'pending' },
        createdBy: EMPLOYEE_ID,
    });

    const openShift = await Shift.create({
        organizationId: ORGANIZATION_ID,
        teamId: TEAM_ID,
        templateId: template._id,
        startAt: addDays(now, 2),
        endAt: new Date(addDays(now, 2).getTime() + (8 * 60 * 60 * 1000)),
        timezone: 'Europe/London',
        breakMinutes: 30,
        workMode: 'office',
        status: 'published',
        publicationVersion: 1,
        openShift: true,
        createdBy: EMPLOYEE_ID,
    });

    await Shift.create({
        organizationId: ORGANIZATION_ID,
        userId: REPORT_ID,
        teamId: TEAM_ID,
        templateId: template._id,
        startAt: addDays(now, 3),
        endAt: new Date(addDays(now, 3).getTime() + (8 * 60 * 60 * 1000)),
        timezone: 'Europe/London',
        breakMinutes: 30,
        workMode: 'office',
        status: 'draft',
        createdBy: EMPLOYEE_ID,
    });

    const coverRequestPolicy = defaultRequestPolicy();
    const coverApproval = buildApprovalWorkflow(coverRequestPolicy, {
        managerId: EMPLOYEE_ID,
        managerName: 'Alex Live',
        managerEmail: 'alex.live@example.test',
        teamId: TEAM_ID,
    });

    await ShiftRequest.create({
        organizationId: ORGANIZATION_ID,
        type: 'cover',
        shiftId: openShift._id,
        requestedBy: REPORT_ID,
        subjectUserId: REPORT_ID,
        targetUserId: REPORT_ID,
        reason: 'Live E2E coverage request',
        status: 'pending',
        targetResponse: { status: 'not_required' },
        assignedApprover: coverApproval.assignedApprover,
        approvalWorkflow: coverApproval.workflow,
        requestPolicySnapshot: coverRequestPolicy,
        changeHistory: [{ action: 'created', actorId: REPORT_ID, actorName: 'Jamie Live', details: 'cover' }],
    });

    await AttendanceException.create({
        organizationId: ORGANIZATION_ID,
        userId: EMPLOYEE_ID,
        userEmail: 'alex.live@example.test',
        userName: 'Alex Live',
        timesheetId: currentTimesheet._id,
        timesheetVersion: 1,
        occurrenceDate: now,
        type: 'late_arrival',
        ruleKey: 'LIVE-LATE-01',
        description: 'Arrival was outside the configured grace period.',
        explanation: 'Arrival was outside the configured grace period.',
        calculation: { scheduledAt: '09:00', actualAt: '09:20', graceMinutes: 15 },
        rulePack: { id: 'ng-live-e2e', version: 1 },
        fingerprint: `live-e2e:${currentTimesheet._id}:late`,
        status: 'open',
        auditLog: [{ action: 'created', actorId: 'system', actorName: 'Rules engine' }],
    });

    await Notification.create({
        organizationId: ORGANIZATION_ID,
        userId: EMPLOYEE_ID,
        userEmail: 'alex.live@example.test',
        type: 'timesheet_deadline',
        title: 'Timesheet due',
        message: 'Submit the completed period by 17:00.',
        actionUrl: `/timesheets/${previousTimesheet._id}`,
        priority: 'normal',
        eventKey: 'live-e2e-timesheet-due',
        deliveries: [{ channel: 'in_app', status: 'delivered', attempts: 1, deliveredAt: now }],
    });

    await NotificationPreference.create({
        organizationId: ORGANIZATION_ID,
        userId: EMPLOYEE_ID,
        timezone: 'Europe/London',
        channels: { inApp: true, email: false, browserPush: false },
        quietHours: { enabled: true, start: '22:00', end: '07:00', allowUrgent: true },
    });

    await ApplicationAssignment.create({
        organizationId: ORGANIZATION_ID,
        appId: 'time-attendance',
        scopeType: 'employee',
        scopeId: EMPLOYEE_ID,
        expected: true,
        effectiveFrom: addDays(now, -1),
        createdBy: EMPLOYEE_ID,
    });

    await AttendanceRulePack.create({
        key: 'ng-live-e2e',
        name: 'Nigeria live E2E template',
        description: 'A deterministic rule pack used by the live browser acceptance suite.',
        version: 1,
        status: 'published',
        jurisdiction: { kind: 'country', countryCode: 'NG' },
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        rules: {
            work: { standardHoursPerDay: 8, standardHoursPerWeek: 40, workDays: [1, 2, 3, 4, 5] },
            breaks: { requiredAfterMinutes: 360, minimumBreakMinutes: 30, paid: false },
            rest: { minimumDailyRestMinutes: 660, minimumWeeklyRestMinutes: 1440 },
            overtime: { enabled: true, dailyThresholdHours: 8, weeklyThresholdHours: 40, multiplier: 1.5, requiresApproval: true },
            retention: { attendanceDays: 2555, presenceEventDays: 90 },
            exceptions: { lateGraceMinutes: 15, earlyDepartureGraceMinutes: 15, longBreakAfterMinutes: 60 },
        },
        sources: [{ title: 'Live E2E implementation reference', url: 'https://example.test/rules' }],
        reviewRequired: false,
        reviewedBy: 'Live E2E',
        lastReviewedAt: now,
        approvedBy: EMPLOYEE_ID,
        approvedAt: now,
        createdBy: EMPLOYEE_ID,
        updatedBy: EMPLOYEE_ID,
    });

    console.log(JSON.stringify({
        organizationId: ORGANIZATION_ID,
        employeeId: EMPLOYEE_ID,
        currentTimesheetId: String(currentTimesheet._id),
        previousTimesheetId: String(previousTimesheet._id),
        pendingApprovalTimesheetId: String(reportTimesheet._id),
        publishedShiftId: String(publishedShift._id),
    }));
}

seed()
    .then(() => mongoose.disconnect())
    .catch(async error => {
        console.error(error);
        await mongoose.disconnect().catch(() => {});
        process.exit(1);
    });

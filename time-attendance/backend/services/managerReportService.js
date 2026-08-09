const {
    startOfDay,
    endOfDay,
    subDays,
    startOfWeek,
    endOfWeek,
    subWeeks,
    startOfMonth,
    endOfMonth,
    subMonths,
    format,
} = require('date-fns');

const { AttendancePolicy, Timesheet, ReportDispatchLog } = require('../models');
const emailService = require('./emailService');
const { generateTeamManagerExcelReport } = require('./teamReportExportService');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5011';
const REPORT_SCHEDULER_INTERVAL_MS = 60 * 60 * 1000; // hourly

let isRunning = false;

function getStatusLabel(value) {
    if (!value) return 'Unknown';
    return String(value)
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeReportConfig(policy) {
    const managerReports = policy.notifications?.managerReports || {};
    const frequency = ['daily', 'weekly', 'monthly'].includes(managerReports.frequency)
        ? managerReports.frequency
        : 'weekly';

    const sendHourUtc = Number.isFinite(managerReports.sendHourUtc)
        ? Math.max(0, Math.min(23, managerReports.sendHourUtc))
        : 9;

    return {
        enabled: managerReports.enabled !== false,
        frequency,
        sendHourUtc,
        includeExcel: managerReports.includeExcel !== false,
    };
}

function getReportPeriod(frequency, now = new Date()) {
    if (frequency === 'daily') {
        const target = subDays(now, 1);
        const periodStart = startOfDay(target);
        const periodEnd = endOfDay(target);
        return {
            periodStart,
            periodEnd,
            periodKey: format(target, 'yyyy-MM-dd'),
            periodLabel: format(target, 'MMM dd, yyyy'),
        };
    }

    if (frequency === 'monthly') {
        const target = subMonths(now, 1);
        const periodStart = startOfMonth(target);
        const periodEnd = endOfMonth(target);
        return {
            periodStart,
            periodEnd,
            periodKey: format(target, 'yyyy-MM'),
            periodLabel: format(target, 'MMMM yyyy'),
        };
    }

    // Default weekly
    const target = subWeeks(now, 1);
    const periodStart = startOfWeek(target, { weekStartsOn: 1 });
    const periodEnd = endOfWeek(target, { weekStartsOn: 1 });
    return {
        periodStart,
        periodEnd,
        periodKey: `${format(periodStart, 'yyyy-MM-dd')}_${format(periodEnd, 'yyyy-MM-dd')}`,
        periodLabel: `${format(periodStart, 'MMM dd')} - ${format(periodEnd, 'MMM dd, yyyy')}`,
    };
}

function hasDispatchWindowOpened(frequency, sendHourUtc, now = new Date()) {
    if (frequency === 'daily') {
        const windowStart = startOfDay(now);
        windowStart.setUTCHours(sendHourUtc, 0, 0, 0);
        return now >= windowStart;
    }

    if (frequency === 'monthly') {
        const windowStart = startOfMonth(now);
        windowStart.setUTCHours(sendHourUtc, 0, 0, 0);
        return now >= windowStart;
    }

    const windowStart = startOfWeek(now, { weekStartsOn: 1 });
    windowStart.setUTCHours(sendHourUtc, 0, 0, 0);
    return now >= windowStart;
}

function buildSummaryRowsHtml(metrics) {
    const rows = [
        ['Members', metrics.memberCount],
        ['Timesheets', metrics.timesheetCount],
        ['Submitted', metrics.submittedCount],
        ['Approved', metrics.approvedCount],
        ['Rejected', metrics.rejectedCount],
        ['Draft', metrics.draftCount],
        ['Total Hours', Number((metrics.totalHours || 0).toFixed(2))],
        ['Overtime Hours', Number((metrics.overtimeHours || 0).toFixed(2))],
    ];

    return rows.map(([label, value], idx) => `
        <tr>
            <td style="padding: 8px 10px; font-size: 12px; color: #475569; border-bottom: 1px solid #e2e8f0; background: ${idx % 2 ? '#f8fafc' : '#ffffff'};">${label}</td>
            <td style="padding: 8px 10px; font-size: 12px; color: #0f172a; font-weight: 700; text-align: right; border-bottom: 1px solid #e2e8f0; background: ${idx % 2 ? '#f8fafc' : '#ffffff'};">${value}</td>
        </tr>
    `).join('');
}

function buildMemberRowsHtml(memberRows, maxRows = 8) {
    const rows = memberRows.slice(0, maxRows);
    return rows.map((member, idx) => `
        <tr>
            <td style="padding: 8px 10px; font-size: 12px; color: #0f172a; border-bottom: 1px solid #e2e8f0; background: ${idx % 2 ? '#f8fafc' : '#ffffff'};">
                ${member.userName || member.userId}
            </td>
            <td style="padding: 8px 10px; font-size: 12px; color: #0f172a; text-align: right; border-bottom: 1px solid #e2e8f0; background: ${idx % 2 ? '#f8fafc' : '#ffffff'};">
                ${(member.totalHours || 0).toFixed(2)}
            </td>
            <td style="padding: 8px 10px; font-size: 12px; color: #a16207; text-align: right; border-bottom: 1px solid #e2e8f0; background: ${idx % 2 ? '#f8fafc' : '#ffffff'};">
                ${(member.overtimeHours || 0).toFixed(2)}
            </td>
            <td style="padding: 8px 10px; font-size: 11px; text-align: center; border-bottom: 1px solid #e2e8f0; background: ${idx % 2 ? '#f8fafc' : '#ffffff'}; color: #334155;">
                ${member.latestStatusLabel || 'Unknown'}
            </td>
        </tr>
    `).join('');
}

function aggregateManagerPayload({ managerGroup, periodStart, periodEnd, periodLabel, frequency, organizationName }) {
    const timesheets = managerGroup.timesheets || [];
    const memberMap = new Map();

    const timesheetRows = timesheets.map((timesheet) => {
        const summary = timesheet.summary || {};
        const member = memberMap.get(timesheet.userId) || {
            userId: timesheet.userId,
            userName: timesheet.userName,
            userEmail: timesheet.userEmail,
            teamName: timesheet.teamName,
            timesheetCount: 0,
            submittedCount: 0,
            approvedCount: 0,
            rejectedCount: 0,
            draftCount: 0,
            totalHours: 0,
            overtimeHours: 0,
            daysWorked: 0,
            latestStatus: timesheet.status,
            latestStatusLabel: timesheet.status ? timesheet.status.replace('_', ' ') : 'unknown',
            latestDate: timesheet.endDate,
            drilldownUrl: `${FRONTEND_URL}/team/${timesheet.userId}`,
        };

        member.timesheetCount += 1;
        member.totalHours += summary.totalHours || 0;
        member.overtimeHours += summary.overtimeHours || 0;
        member.daysWorked += summary.daysWorked || 0;

        if (timesheet.status === 'submitted' || timesheet.status === 'pending') member.submittedCount += 1;
        else if (['approved', 'locked', 'payroll_pending', 'payroll_exported'].includes(timesheet.status)) member.approvedCount += 1;
        else if (timesheet.status === 'rejected') member.rejectedCount += 1;
        else member.draftCount += 1;

        if (!member.latestDate || new Date(timesheet.endDate) > new Date(member.latestDate)) {
            member.latestDate = timesheet.endDate;
            member.latestStatus = timesheet.status;
            member.latestStatusLabel = timesheet.status ? timesheet.status.replace('_', ' ') : 'unknown';
        }

        memberMap.set(timesheet.userId, member);

        return {
            userId: timesheet.userId,
            userName: timesheet.userName,
            userEmail: timesheet.userEmail,
            teamName: timesheet.teamName,
            weekNumber: timesheet.weekNumber,
            year: timesheet.year,
            startDate: timesheet.startDate,
            endDate: timesheet.endDate,
            status: timesheet.status,
            totalHours: summary.totalHours || 0,
            regularHours: summary.regularHours || 0,
            overtimeHours: summary.overtimeHours || 0,
            daysWorked: summary.daysWorked || 0,
            submittedAt: timesheet.submittedAt,
            timesheetUrl: `${FRONTEND_URL}/timesheets/${timesheet._id}`,
        };
    });

    const memberRows = Array.from(memberMap.values()).sort((a, b) =>
        (b.totalHours || 0) - (a.totalHours || 0)
    );

    const metrics = {
        memberCount: memberRows.length,
        timesheetCount: timesheets.length,
        submittedCount: timesheetRows.filter((item) => item.status === 'submitted' || item.status === 'pending').length,
        approvedCount: timesheetRows.filter((item) => ['approved', 'locked', 'payroll_pending', 'payroll_exported'].includes(item.status)).length,
        rejectedCount: timesheetRows.filter((item) => item.status === 'rejected').length,
        draftCount: timesheetRows.filter((item) => !['submitted', 'pending', 'approved', 'locked', 'payroll_pending', 'payroll_exported', 'rejected'].includes(item.status)).length,
        pendingCount: timesheetRows.filter((item) => item.status === 'submitted' || item.status === 'pending').length,
        totalHours: memberRows.reduce((sum, item) => sum + (item.totalHours || 0), 0),
        overtimeHours: memberRows.reduce((sum, item) => sum + (item.overtimeHours || 0), 0),
        absentDayCount: 0,
    };

    return {
        organizationName,
        managerName: managerGroup.managerName,
        managerEmail: managerGroup.managerEmail,
        frequency,
        periodStart,
        periodEnd,
        periodLabel,
        metrics,
        memberRows,
        timesheetRows,
        platformReportUrl: `${FRONTEND_URL}/reports`,
        platformTeamUrl: `${FRONTEND_URL}/team`,
    };
}

async function getFallbackApproverMap(organizationId, userIds) {
    if (!userIds.length) return new Map();

    const fallback = await Timesheet.aggregate([
        {
            $match: {
                organizationId,
                userId: { $in: userIds },
                'assignedApprover.userEmail': { $exists: true, $ne: null },
            },
        },
        { $sort: { updatedAt: -1 } },
        {
            $group: {
                _id: '$userId',
                assignedApprover: { $first: '$assignedApprover' },
            },
        },
    ]);

    return new Map(fallback.map((row) => [row._id, row.assignedApprover]));
}

function groupTimesheetsByManager(timesheets, fallbackApproverMap) {
    const groups = new Map();

    for (const timesheet of timesheets) {
        const approver = timesheet.assignedApprover?.userEmail
            ? timesheet.assignedApprover
            : fallbackApproverMap.get(timesheet.userId);

        if (!approver?.userEmail) continue;

        const key = `${approver.userId || 'unknown'}::${approver.userEmail}`;
        if (!groups.has(key)) {
            groups.set(key, {
                managerUserId: approver.userId || null,
                managerName: approver.userName || approver.userEmail,
                managerEmail: approver.userEmail,
                teamId: approver.teamId || null,
                timesheets: [],
            });
        }

        groups.get(key).timesheets.push(timesheet);
    }

    return Array.from(groups.values());
}

async function hasAlreadySent({ organizationId, frequency, periodKey, managerEmail }) {
    const existing = await ReportDispatchLog.findOne({
        organizationId,
        frequency,
        periodKey,
        managerEmail,
        status: 'sent',
    }).lean();

    return Boolean(existing);
}

async function upsertDispatchLog({
    organizationId,
    organizationName,
    frequency,
    periodKey,
    periodStart,
    periodEnd,
    managerUserId,
    managerName,
    managerEmail,
    status,
    details,
}) {
    await ReportDispatchLog.findOneAndUpdate(
        { organizationId, frequency, periodKey, managerEmail },
        {
            organizationId,
            organizationName,
            frequency,
            periodKey,
            periodStart,
            periodEnd,
            managerUserId,
            managerName,
            managerEmail,
            status,
            details,
            sentAt: new Date(),
        },
        {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
        }
    );
}

async function sendManagerReportForGroup({
    policy,
    frequency,
    periodStart,
    periodEnd,
    periodKey,
    periodLabel,
    includeExcel,
    managerGroup,
}) {
    if (await hasAlreadySent({
        organizationId: policy.organizationId,
        frequency,
        periodKey,
        managerEmail: managerGroup.managerEmail,
    })) {
        return { sent: false, reason: 'already_sent' };
    }

    const payload = aggregateManagerPayload({
        managerGroup,
        periodStart,
        periodEnd,
        periodLabel,
        frequency,
        organizationName: policy.organizationName || policy.organizationId,
    });

    let attachment = null;
    let excelFileName = 'team-attendance-report.xlsx';

    if (includeExcel) {
        const excel = await generateTeamManagerExcelReport({
            ...payload,
            exportedByName: 'System',
        });
        attachment = {
            filename: excel.filename,
            content: excel.buffer,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        };
        excelFileName = excel.filename;
    }

    const emailResult = await emailService.sendManagerTeamReport(
        {
            managerName: payload.managerName,
            managerEmail: payload.managerEmail,
            frequencyLabel: getStatusLabel(frequency),
            periodLabel,
            summaryRowsHtml: buildSummaryRowsHtml(payload.metrics),
            memberRowsHtml: buildMemberRowsHtml(payload.memberRows),
            reportUrl: payload.platformReportUrl,
            teamUrl: payload.platformTeamUrl,
            generatedAt: format(new Date(), 'MMM dd, yyyy HH:mm'),
            excelFileName,
            attachmentDescription: includeExcel
                ? `Your team attendance report is ready. The detailed Excel workbook (<strong>${excelFileName}</strong>) is attached to this email.`
                : 'Your team attendance report is ready. Open the links below to review the full report on the platform.',
        },
        attachment
    );

    if (!emailResult.success) {
        await upsertDispatchLog({
            organizationId: policy.organizationId,
            organizationName: policy.organizationName,
            frequency,
            periodKey,
            periodStart,
            periodEnd,
            managerUserId: managerGroup.managerUserId,
            managerName: managerGroup.managerName,
            managerEmail: managerGroup.managerEmail,
            status: 'failed',
            details: emailResult.error || emailResult.reason || 'Failed to send manager report',
        });

        return { sent: false, reason: 'email_failed' };
    }

    await upsertDispatchLog({
        organizationId: policy.organizationId,
        organizationName: policy.organizationName,
        frequency,
        periodKey,
        periodStart,
        periodEnd,
        managerUserId: managerGroup.managerUserId,
        managerName: managerGroup.managerName,
        managerEmail: managerGroup.managerEmail,
        status: 'sent',
        details: `Report sent (${frequency}) for ${periodLabel}`,
    });

    return { sent: true };
}

async function processPolicyReports(policy, now = new Date()) {
    const config = normalizeReportConfig(policy);
    if (!config.enabled) {
        return { sent: 0, skipped: 1 };
    }

    if (!hasDispatchWindowOpened(config.frequency, config.sendHourUtc, now)) {
        return { sent: 0, skipped: 1 };
    }

    const { periodStart, periodEnd, periodKey, periodLabel } = getReportPeriod(config.frequency, now);

    const timesheets = await Timesheet.find({
        organizationId: policy.organizationId,
        startDate: { $lte: periodEnd },
        endDate: { $gte: periodStart },
    }).lean();

    if (!timesheets.length) {
        return { sent: 0, skipped: 1 };
    }

    const userIds = [...new Set(timesheets.map((timesheet) => timesheet.userId))];
    const fallbackApproverMap = await getFallbackApproverMap(policy.organizationId, userIds);
    const managerGroups = groupTimesheetsByManager(timesheets, fallbackApproverMap);

    if (!managerGroups.length) {
        return { sent: 0, skipped: 1 };
    }

    let sentCount = 0;
    let skippedCount = 0;

    for (const managerGroup of managerGroups) {
        try {
            const result = await sendManagerReportForGroup({
                policy,
                frequency: config.frequency,
                periodStart,
                periodEnd,
                periodKey,
                periodLabel,
                includeExcel: config.includeExcel,
                managerGroup,
            });

            if (result.sent) {
                sentCount += 1;
            } else {
                skippedCount += 1;
            }
        } catch (error) {
            console.error(
                `Manager report send failure for ${managerGroup.managerEmail} (${policy.organizationId}):`,
                error.message
            );
            skippedCount += 1;
        }
    }

    return { sent: sentCount, skipped: skippedCount };
}

async function checkAndSendManagerReports() {
    if (isRunning) {
        console.log('Manager report check already running, skipping');
        return;
    }

    try {
        isRunning = true;
        console.log('Running manager report scheduler check');

        const policies = await AttendancePolicy.find({
            $or: [
                { 'notifications.managerReports.enabled': true },
                { 'notifications.managerReports.enabled': { $exists: false } },
            ],
        });

        if (!policies.length) {
            console.log('No organizations configured for manager reports');
            return;
        }

        let totalSent = 0;
        let totalSkipped = 0;

        for (const policy of policies) {
            const result = await processPolicyReports(policy, new Date());
            totalSent += result.sent;
            totalSkipped += result.skipped;
        }

        console.log(`Manager report check complete: ${totalSent} sent, ${totalSkipped} skipped`);
    } catch (error) {
        console.error('Manager report scheduler error:', error);
    } finally {
        isRunning = false;
    }
}

function startManagerReportScheduler() {
    console.log('Manager report scheduler started (runs hourly)');

    setTimeout(() => {
        checkAndSendManagerReports();
    }, 10000);

    setInterval(() => {
        checkAndSendManagerReports();
    }, REPORT_SCHEDULER_INTERVAL_MS);
}

module.exports = {
    checkAndSendManagerReports,
    startManagerReportScheduler,
};

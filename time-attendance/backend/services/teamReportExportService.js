const ExcelJS = require('exceljs');
const { format } = require('date-fns');

const COLORS = {
    brand: 'FF0F766E',
    brandLight: 'FFE6FFFA',
    dark: 'FF0F172A',
    muted: 'FF64748B',
    border: 'FFE2E8F0',
    success: 'FF059669',
    successLight: 'FFECFDF5',
    warning: 'FFD97706',
    warningLight: 'FFFFFBEB',
    danger: 'FFDC2626',
    dangerLight: 'FFFEF2F2',
    neutralLight: 'FFF8FAFC',
};

const BASE_FONT = { name: 'Calibri', size: 11 };

function formatDate(value, fallback = '--') {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return fallback;
    return format(date, 'MMM dd, yyyy');
}

function formatDateTime(value, fallback = '--') {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return fallback;
    return format(date, 'MMM dd, yyyy HH:mm');
}

function round(value) {
    return Number((value || 0).toFixed(2));
}

function getStatusLabel(status) {
    if (!status) return 'Unknown';
    return String(status)
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getStatusColor(status) {
    switch (status) {
        case 'approved':
            return { bg: COLORS.successLight, fg: COLORS.success };
        case 'submitted':
        case 'pending':
            return { bg: COLORS.warningLight, fg: COLORS.warning };
        case 'rejected':
            return { bg: COLORS.dangerLight, fg: COLORS.danger };
        default:
            return { bg: COLORS.neutralLight, fg: COLORS.muted };
    }
}

function styleTitle(sheet, rowNumber, title, subtitle) {
    sheet.mergeCells(`A${rowNumber}:L${rowNumber}`);
    const titleCell = sheet.getCell(`A${rowNumber}`);
    titleCell.value = title;
    titleCell.font = { ...BASE_FONT, size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.dark } };
    titleCell.alignment = { horizontal: 'left', vertical: 'middle' };
    sheet.getRow(rowNumber).height = 28;

    if (subtitle) {
        sheet.mergeCells(`A${rowNumber + 1}:L${rowNumber + 1}`);
        const subtitleCell = sheet.getCell(`A${rowNumber + 1}`);
        subtitleCell.value = subtitle;
        subtitleCell.font = { ...BASE_FONT, color: { argb: COLORS.muted } };
        subtitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.brandLight } };
        subtitleCell.alignment = { horizontal: 'left', vertical: 'middle' };
        sheet.getRow(rowNumber + 1).height = 20;
    }
}

function styleHeaderRow(sheet, rowNumber, columnCount) {
    const row = sheet.getRow(rowNumber);
    row.height = 20;
    for (let col = 1; col <= columnCount; col++) {
        const cell = row.getCell(col);
        cell.font = { ...BASE_FONT, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.brand } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
            top: { style: 'thin', color: { argb: COLORS.border } },
            left: { style: 'thin', color: { argb: COLORS.border } },
            bottom: { style: 'thin', color: { argb: COLORS.border } },
            right: { style: 'thin', color: { argb: COLORS.border } },
        };
    }
}

function styleCell(cell, { align = 'left', bold = false, fg = 'FF111827', bg = null, wrap = false } = {}) {
    cell.font = { ...BASE_FONT, bold, color: { argb: fg } };
    cell.alignment = { horizontal: align, vertical: 'middle', wrapText: wrap };
    cell.border = {
        top: { style: 'thin', color: { argb: COLORS.border } },
        left: { style: 'thin', color: { argb: COLORS.border } },
        bottom: { style: 'thin', color: { argb: COLORS.border } },
        right: { style: 'thin', color: { argb: COLORS.border } },
    };
    if (bg) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
    }
}

function asciiBar(value, maxValue) {
    const safeMax = Math.max(1, maxValue || 1);
    const ratio = Math.max(0, Math.min(1, (value || 0) / safeMax));
    const width = 18;
    const filled = Math.round(ratio * width);
    return `[${'#'.repeat(filled)}${'.'.repeat(width - filled)}]`;
}

function sanitizeFileName(value) {
    return String(value || '')
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function addOverviewSheet(workbook, payload) {
    const {
        organizationName,
        managerName,
        managerEmail,
        frequency,
        periodStart,
        periodEnd,
        metrics,
        memberRows,
    } = payload;

    const sheet = workbook.addWorksheet('Overview', {
        views: [{ state: 'frozen', ySplit: 13 }],
    });

    sheet.columns = Array.from({ length: 12 }).map(() => ({ width: 16 }));

    styleTitle(
        sheet,
        1,
        'Team Attendance Report',
        `${organizationName || 'Organization'} | ${formatDate(periodStart)} - ${formatDate(periodEnd)} | ${getStatusLabel(frequency)}`
    );

    const infoRows = [
        ['Manager', managerName || '--', 'Manager Email', managerEmail || '--'],
        ['Frequency', getStatusLabel(frequency), 'Generated At', formatDateTime(new Date())],
        ['Platform Link', payload.platformReportUrl || '--', 'Team Page', payload.platformTeamUrl || '--'],
    ];

    let rowIndex = 4;
    for (const rowValues of infoRows) {
        sheet.getRow(rowIndex).values = rowValues;
        sheet.mergeCells(`B${rowIndex}:F${rowIndex}`);
        sheet.mergeCells(`H${rowIndex}:L${rowIndex}`);

        styleCell(sheet.getCell(`A${rowIndex}`), { bg: COLORS.neutralLight, bold: true });
        styleCell(sheet.getCell(`B${rowIndex}`));
        styleCell(sheet.getCell(`G${rowIndex}`), { bg: COLORS.neutralLight, bold: true });
        styleCell(sheet.getCell(`H${rowIndex}`));
        rowIndex += 1;
    }

    sheet.mergeCells('A8:L8');
    const metricsTitle = sheet.getCell('A8');
    metricsTitle.value = 'Team Metrics Snapshot';
    metricsTitle.font = { ...BASE_FONT, bold: true, size: 13, color: { argb: COLORS.dark } };
    metricsTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.brandLight } };

    const metricHeaders = [
        'Members',
        'Timesheets',
        'Submitted',
        'Approved',
        'Rejected',
        'Draft',
        'Total Hours',
        'Overtime Hours',
        'Avg Hours/Member',
        'Avg OT/Member',
        'Pending',
        'Absent Entries',
    ];

    const avgHours = metrics.memberCount > 0 ? round(metrics.totalHours / metrics.memberCount) : 0;
    const avgOvertime = metrics.memberCount > 0 ? round(metrics.overtimeHours / metrics.memberCount) : 0;

    const metricValues = [
        metrics.memberCount,
        metrics.timesheetCount,
        metrics.submittedCount,
        metrics.approvedCount,
        metrics.rejectedCount,
        metrics.draftCount,
        round(metrics.totalHours),
        round(metrics.overtimeHours),
        avgHours,
        avgOvertime,
        metrics.pendingCount,
        metrics.absentDayCount,
    ];

    sheet.getRow(9).values = metricHeaders;
    styleHeaderRow(sheet, 9, metricHeaders.length);

    sheet.getRow(10).values = metricValues;
    metricValues.forEach((value, index) => {
        styleCell(sheet.getCell(10, index + 1), { align: 'center', bold: true, bg: COLORS.neutralLight });
        sheet.getCell(10, index + 1).value = value;
    });

    sheet.mergeCells('A12:L12');
    const visualTitle = sheet.getCell('A12');
    visualTitle.value = 'Member Workload Visual';
    visualTitle.font = { ...BASE_FONT, bold: true, size: 13, color: { argb: COLORS.dark } };
    visualTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.brandLight } };

    sheet.getRow(13).values = ['Member', 'Team', 'Hours', 'Overtime', 'Status Mix', 'Hours Visual', '', '', '', '', '', ''];
    styleHeaderRow(sheet, 13, 6);

    const maxHours = Math.max(1, ...memberRows.map((row) => row.totalHours || 0));
    rowIndex = 14;
    for (const member of memberRows) {
        sheet.getCell(rowIndex, 1).value = member.userName || member.userId;
        sheet.getCell(rowIndex, 2).value = member.teamName || '--';
        sheet.getCell(rowIndex, 3).value = round(member.totalHours || 0);
        sheet.getCell(rowIndex, 4).value = round(member.overtimeHours || 0);
        sheet.getCell(rowIndex, 5).value = `A:${member.approvedCount} S:${member.submittedCount} D:${member.draftCount} R:${member.rejectedCount}`;
        sheet.getCell(rowIndex, 6).value = asciiBar(member.totalHours || 0, maxHours);

        styleCell(sheet.getCell(rowIndex, 1));
        styleCell(sheet.getCell(rowIndex, 2));
        styleCell(sheet.getCell(rowIndex, 3), { align: 'right' });
        styleCell(sheet.getCell(rowIndex, 4), { align: 'right', fg: COLORS.warning });
        styleCell(sheet.getCell(rowIndex, 5), { align: 'center' });
        styleCell(sheet.getCell(rowIndex, 6), { align: 'left', bold: true, fg: COLORS.brand });
        sheet.getCell(rowIndex, 6).font = { ...BASE_FONT, name: 'Consolas', bold: true, color: { argb: COLORS.brand } };

        rowIndex += 1;
    }
}

function addMemberSummarySheet(workbook, payload) {
    const { memberRows } = payload;
    const sheet = workbook.addWorksheet('Member Summary', {
        views: [{ state: 'frozen', ySplit: 1 }],
    });

    sheet.columns = [
        { header: 'Member', key: 'member', width: 24 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'Team', key: 'team', width: 20 },
        { header: 'Timesheets', key: 'timesheets', width: 11 },
        { header: 'Submitted', key: 'submitted', width: 11 },
        { header: 'Approved', key: 'approved', width: 11 },
        { header: 'Rejected', key: 'rejected', width: 11 },
        { header: 'Draft', key: 'draft', width: 11 },
        { header: 'Total Hours', key: 'totalHours', width: 12 },
        { header: 'Overtime Hours', key: 'overtimeHours', width: 14 },
        { header: 'Days Worked', key: 'daysWorked', width: 11 },
        { header: 'Latest Status', key: 'latestStatus', width: 13 },
        { header: 'Drilldown URL', key: 'drilldownUrl', width: 44 },
    ];

    styleHeaderRow(sheet, 1, sheet.columns.length);

    let rowIndex = 2;
    for (const member of memberRows) {
        const row = sheet.getRow(rowIndex);
        row.values = [
            member.userName || member.userId,
            member.userEmail || '--',
            member.teamName || '--',
            member.timesheetCount,
            member.submittedCount,
            member.approvedCount,
            member.rejectedCount,
            member.draftCount,
            round(member.totalHours || 0),
            round(member.overtimeHours || 0),
            member.daysWorked || 0,
            getStatusLabel(member.latestStatus),
            member.drilldownUrl || '--',
        ];

        const statusColor = getStatusColor(member.latestStatus);
        styleCell(row.getCell(1));
        styleCell(row.getCell(2));
        styleCell(row.getCell(3));
        styleCell(row.getCell(4), { align: 'right' });
        styleCell(row.getCell(5), { align: 'right' });
        styleCell(row.getCell(6), { align: 'right' });
        styleCell(row.getCell(7), { align: 'right' });
        styleCell(row.getCell(8), { align: 'right' });
        styleCell(row.getCell(9), { align: 'right' });
        styleCell(row.getCell(10), { align: 'right', fg: COLORS.warning });
        styleCell(row.getCell(11), { align: 'right' });
        styleCell(row.getCell(12), { align: 'center', bg: statusColor.bg, fg: statusColor.fg, bold: true });
        styleCell(row.getCell(13), { wrap: true, fg: COLORS.brand });

        rowIndex += 1;
    }
}

function addTimesheetDetailsSheet(workbook, payload) {
    const { timesheetRows } = payload;
    const sheet = workbook.addWorksheet('Timesheet Details', {
        views: [{ state: 'frozen', ySplit: 1 }],
    });

    sheet.columns = [
        { header: 'Member', key: 'member', width: 24 },
        { header: 'Email', key: 'email', width: 28 },
        { header: 'Team', key: 'team', width: 20 },
        { header: 'Week', key: 'week', width: 10 },
        { header: 'Year', key: 'year', width: 8 },
        { header: 'Period Start', key: 'start', width: 14 },
        { header: 'Period End', key: 'end', width: 14 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Total Hours', key: 'totalHours', width: 12 },
        { header: 'Regular Hours', key: 'regularHours', width: 13 },
        { header: 'Overtime', key: 'overtime', width: 10 },
        { header: 'Days Worked', key: 'daysWorked', width: 11 },
        { header: 'Submitted At', key: 'submittedAt', width: 20 },
        { header: 'Timesheet URL', key: 'timesheetUrl', width: 44 },
    ];

    styleHeaderRow(sheet, 1, sheet.columns.length);

    let rowIndex = 2;
    for (const rowData of timesheetRows) {
        const row = sheet.getRow(rowIndex);
        row.values = [
            rowData.userName || rowData.userId,
            rowData.userEmail || '--',
            rowData.teamName || '--',
            rowData.weekNumber || '--',
            rowData.year || '--',
            formatDate(rowData.startDate),
            formatDate(rowData.endDate),
            getStatusLabel(rowData.status),
            round(rowData.totalHours || 0),
            round(rowData.regularHours || 0),
            round(rowData.overtimeHours || 0),
            rowData.daysWorked || 0,
            formatDateTime(rowData.submittedAt),
            rowData.timesheetUrl || '--',
        ];

        const statusColor = getStatusColor(rowData.status);
        styleCell(row.getCell(1));
        styleCell(row.getCell(2));
        styleCell(row.getCell(3));
        styleCell(row.getCell(4), { align: 'center' });
        styleCell(row.getCell(5), { align: 'center' });
        styleCell(row.getCell(6), { align: 'center' });
        styleCell(row.getCell(7), { align: 'center' });
        styleCell(row.getCell(8), { align: 'center', bg: statusColor.bg, fg: statusColor.fg, bold: true });
        styleCell(row.getCell(9), { align: 'right' });
        styleCell(row.getCell(10), { align: 'right' });
        styleCell(row.getCell(11), { align: 'right', fg: COLORS.warning });
        styleCell(row.getCell(12), { align: 'right' });
        styleCell(row.getCell(13), { align: 'center' });
        styleCell(row.getCell(14), { wrap: true, fg: COLORS.brand });
        row.height = 24;
        rowIndex += 1;
    }
}

async function generateTeamManagerExcelReport(payload) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Seemplify Time & Attendance';
    workbook.lastModifiedBy = payload.exportedByName || 'System';
    workbook.created = new Date();
    workbook.modified = new Date();

    addOverviewSheet(workbook, payload);
    addMemberSummarySheet(workbook, payload);
    addTimesheetDetailsSheet(workbook, payload);

    const manager = sanitizeFileName(payload.managerName || payload.managerEmail || 'manager');
    const periodStart = sanitizeFileName(formatDate(payload.periodStart, 'start'));
    const periodEnd = sanitizeFileName(formatDate(payload.periodEnd, 'end'));
    const filename = `team_attendance_report_${manager}_${periodStart}_to_${periodEnd}.xlsx`;
    const buffer = await workbook.xlsx.writeBuffer();

    return { filename, buffer: Buffer.from(buffer) };
}

module.exports = {
    generateTeamManagerExcelReport,
};

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
    neutral: 'FF334155',
    neutralLight: 'FFF8FAFC',
};

const BASE_FONT = { name: 'Calibri', size: 11 };

function formatDateTime(value, fallback = '--') {
    if (!value) return fallback;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return fallback;
    return format(parsed, 'MMM dd, yyyy HH:mm');
}

function formatTime(value, fallback = '--') {
    if (!value) return fallback;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return fallback;
    return format(parsed, 'h:mm a');
}

function formatLocation(location) {
    if (!location) return '--';
    return (
        location.address ||
        location.displayName ||
        [location.area, location.city, location.state].filter(Boolean).join(', ') ||
        '--'
    );
}

function formatDuration(minutes) {
    const safe = Number(minutes || 0);
    const hours = Math.floor(safe / 60);
    const mins = Math.max(0, Math.round(safe % 60));
    return `${hours}h ${mins}m`;
}

function getStatusLabel(status) {
    if (!status) return 'Unknown';
    return String(status)
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getStatusColors(status) {
    switch (status) {
        case 'working':
            return { bg: COLORS.successLight, fg: COLORS.success };
        case 'on_break':
            return { bg: COLORS.warningLight, fg: COLORS.warning };
        case 'clocked_out':
            return { bg: COLORS.neutralLight, fg: COLORS.neutral };
        case 'not_clocked_in':
        default:
            return { bg: COLORS.neutralLight, fg: COLORS.muted };
    }
}

function applyBorder(cell) {
    cell.border = {
        top: { style: 'thin', color: { argb: COLORS.border } },
        left: { style: 'thin', color: { argb: COLORS.border } },
        bottom: { style: 'thin', color: { argb: COLORS.border } },
        right: { style: 'thin', color: { argb: COLORS.border } },
    };
}

function styleHeaderRow(sheet, rowNumber, columnCount) {
    const row = sheet.getRow(rowNumber);
    row.height = 22;
    for (let col = 1; col <= columnCount; col++) {
        const cell = row.getCell(col);
        cell.font = { ...BASE_FONT, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.brand } };
        applyBorder(cell);
    }
}

function styleDataCell(cell, { align = 'left', bold = false, fg = 'FF111827', bg = null, wrap = false } = {}) {
    cell.font = { ...BASE_FONT, bold, color: { argb: fg } };
    cell.alignment = { horizontal: align, vertical: 'middle', wrapText: wrap };
    if (bg) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
    }
    applyBorder(cell);
}

function sanitizeFileName(value) {
    return String(value || '')
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

async function generateTeamAttendanceTableExcel(payload) {
    const {
        organizationName,
        managerName,
        teamScopeName,
        rows,
        summary,
        statusFilter,
        searchQuery,
    } = payload;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Seemplify Time & Attendance';
    workbook.lastModifiedBy = managerName || 'Manager';
    workbook.created = new Date();
    workbook.modified = new Date();

    const sheet = workbook.addWorksheet('Team Attendance', {
        views: [{ state: 'frozen', ySplit: 7 }],
    });

    sheet.columns = [
        { width: 24 }, // Member
        { width: 30 }, // Email
        { width: 18 }, // Team
        { width: 15 }, // Status
        { width: 12 }, // Clock In
        { width: 12 }, // Clock Out
        { width: 13 }, // Worked
        { width: 22 }, // Last Activity
        { width: 18 }, // Last Activity Type
        { width: 42 }, // Clock-In Location
        { width: 42 }, // Clock-Out Location
    ];

    sheet.mergeCells('A1:K1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'Team Attendance Table Export';
    titleCell.font = { ...BASE_FONT, size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'left', vertical: 'middle' };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.dark } };
    sheet.getRow(1).height = 28;

    sheet.mergeCells('A2:K2');
    const subtitleCell = sheet.getCell('A2');
    subtitleCell.value = [
        organizationName || 'Organization',
        `Scope: ${teamScopeName || 'All Managed Teams'}`,
        `Status: ${getStatusLabel(statusFilter || 'all')}`,
        `Search: ${searchQuery ? `"${searchQuery}"` : 'None'}`,
        `Generated: ${formatDateTime(new Date())}`,
    ].join(' | ');
    subtitleCell.font = { ...BASE_FONT, color: { argb: COLORS.muted } };
    subtitleCell.alignment = { horizontal: 'left', vertical: 'middle' };
    subtitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.brandLight } };
    sheet.getRow(2).height = 20;

    const metricHeaders = ['Total', 'Working', 'On Break', 'Clocked Out', 'Not Clocked In'];
    const metricValues = [
        summary?.total || 0,
        summary?.working || 0,
        summary?.onBreak || 0,
        Math.max(0, (summary?.clockedOut || 0) - (summary?.notClockedIn || 0)),
        summary?.notClockedIn || 0,
    ];

    sheet.getRow(4).values = metricHeaders;
    styleHeaderRow(sheet, 4, metricHeaders.length);
    sheet.getRow(5).values = metricValues;
    for (let i = 1; i <= metricValues.length; i++) {
        styleDataCell(sheet.getCell(5, i), { align: 'center', bold: true, bg: COLORS.neutralLight });
    }

    const columns = [
        'Member',
        'Email',
        'Team',
        'Status',
        'Clock In',
        'Clock Out',
        'Worked Today',
        'Last Activity',
        'Last Activity Type',
        'Clock-In Location',
        'Clock-Out Location',
    ];
    sheet.getRow(7).values = columns;
    styleHeaderRow(sheet, 7, columns.length);
    sheet.autoFilter = {
        from: { row: 7, column: 1 },
        to: { row: Math.max(7, rows.length + 7), column: columns.length },
    };

    let rowIndex = 8;
    for (const rowData of rows) {
        const row = sheet.getRow(rowIndex);
        row.values = [
            rowData.userName || `User ${String(rowData.userId || '').slice(0, 8)}`,
            rowData.userEmail || '--',
            rowData.teamName || '--',
            getStatusLabel(rowData.status),
            formatTime(rowData.clockInAt),
            formatTime(rowData.clockOutAt),
            formatDuration(rowData.workedMinutesToday || 0),
            formatDateTime(rowData.lastActivity),
            getStatusLabel(rowData.lastActivityType || '--'),
            formatLocation(rowData.clockInLocation),
            formatLocation(rowData.clockOutLocation),
        ];

        const statusColors = getStatusColors(rowData.status);
        styleDataCell(row.getCell(1));
        styleDataCell(row.getCell(2));
        styleDataCell(row.getCell(3));
        styleDataCell(row.getCell(4), { align: 'center', bold: true, bg: statusColors.bg, fg: statusColors.fg });
        styleDataCell(row.getCell(5), { align: 'center' });
        styleDataCell(row.getCell(6), { align: 'center' });
        styleDataCell(row.getCell(7), { align: 'right', bold: true });
        styleDataCell(row.getCell(8), { align: 'center' });
        styleDataCell(row.getCell(9), { align: 'center', fg: COLORS.muted });
        styleDataCell(row.getCell(10), { wrap: true });
        styleDataCell(row.getCell(11), { wrap: true });
        row.height = 24;
        rowIndex += 1;
    }

    const scopeName = sanitizeFileName(teamScopeName || 'all_managed_teams');
    const dateStamp = format(new Date(), 'yyyyMMdd_HHmm');
    const filename = `team_attendance_${scopeName}_${dateStamp}.xlsx`;
    const buffer = await workbook.xlsx.writeBuffer();
    return {
        filename,
        buffer: Buffer.from(buffer),
    };
}

module.exports = {
    generateTeamAttendanceTableExcel,
};

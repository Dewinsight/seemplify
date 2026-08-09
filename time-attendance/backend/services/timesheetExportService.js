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

function safeDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value, fallback = '--') {
    const date = safeDate(value);
    return date ? format(date, 'MMM dd, yyyy') : fallback;
}

function formatTime(value, fallback = '--') {
    const date = safeDate(value);
    return date ? format(date, 'HH:mm') : fallback;
}

function formatDateTime(value, fallback = '--') {
    const date = safeDate(value);
    return date ? format(date, 'MMM dd, yyyy HH:mm') : fallback;
}

function roundHours(value) {
    return Number((value || 0).toFixed(2));
}

function formatLocation(location) {
    if (!location) return '--';

    return (
        location.address ||
        location.displayName ||
        [location.area, location.city, location.state, location.country].filter(Boolean).join(', ') ||
        '--'
    );
}

function getStatusLabel(status) {
    if (!status) return 'Unknown';
    return String(status)
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getStatusColors(status) {
    switch (status) {
        case 'present':
        case 'approved':
        case 'locked':
        case 'payroll_pending':
        case 'payroll_exported':
        case 'working':
            return { bg: COLORS.successLight, fg: COLORS.success };
        case 'partial':
        case 'submitted':
        case 'on_break':
            return { bg: COLORS.warningLight, fg: COLORS.warning };
        case 'absent':
        case 'rejected':
            return { bg: COLORS.dangerLight, fg: COLORS.danger };
        default:
            return { bg: COLORS.neutralLight, fg: COLORS.muted };
    }
}

function buildAsciiBar(hours, maxHours) {
    const safeMax = Math.max(1, maxHours || 1);
    const ratio = Math.max(0, Math.min(1, (hours || 0) / safeMax));
    const width = 18;
    const filled = Math.round(ratio * width);
    return `[${'='.repeat(filled)}${'.'.repeat(width - filled)}]`;
}

function styleTitleRow(sheet, rowNumber, fromCol, toCol, title, subtitle = null) {
    sheet.mergeCells(`${fromCol}${rowNumber}:${toCol}${rowNumber}`);
    const titleCell = sheet.getCell(`${fromCol}${rowNumber}`);
    titleCell.value = title;
    titleCell.font = { ...BASE_FONT, bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'left', vertical: 'middle' };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.dark } };
    sheet.getRow(rowNumber).height = 28;

    if (subtitle) {
        sheet.mergeCells(`${fromCol}${rowNumber + 1}:${toCol}${rowNumber + 1}`);
        const subtitleCell = sheet.getCell(`${fromCol}${rowNumber + 1}`);
        subtitleCell.value = subtitle;
        subtitleCell.font = { ...BASE_FONT, size: 11, color: { argb: COLORS.muted } };
        subtitleCell.alignment = { horizontal: 'left', vertical: 'middle' };
        subtitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.brandLight } };
        sheet.getRow(rowNumber + 1).height = 20;
    }
}

function styleHeaderRow(sheet, rowNumber, columnCount) {
    const row = sheet.getRow(rowNumber);
    row.height = 20;
    for (let col = 1; col <= columnCount; col++) {
        const cell = row.getCell(col);
        cell.font = { ...BASE_FONT, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.brand } };
        cell.border = {
            top: { style: 'thin', color: { argb: COLORS.border } },
            left: { style: 'thin', color: { argb: COLORS.border } },
            bottom: { style: 'thin', color: { argb: COLORS.border } },
            right: { style: 'thin', color: { argb: COLORS.border } },
        };
    }
}

function styleDataCell(cell, options = {}) {
    const { align = 'left', bg = null, fg = 'FF111827', bold = false, wrap = false } = options;
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

function addOverviewSheet(workbook, payload) {
    const { timesheet, organizationName, exportedByName } = payload;
    const summary = timesheet.summary || {};
    const dailyEntries = timesheet.dailyEntries || [];

    const sheet = workbook.addWorksheet('Overview', {
        views: [{ state: 'frozen', ySplit: 16 }],
    });

    sheet.columns = [
        { width: 20 },
        { width: 18 },
        { width: 18 },
        { width: 18 },
        { width: 18 },
        { width: 18 },
        { width: 18 },
        { width: 24 },
    ];

    styleTitleRow(
        sheet,
        1,
        'A',
        'H',
        'Timesheet Report',
        `${organizationName || timesheet.organizationName || 'Organization'} | ${formatDate(timesheet.startDate)} - ${formatDate(timesheet.endDate)}`
    );

    const infoRows = [
        ['Employee Name', timesheet.userName || '--', 'Employee Email', timesheet.userEmail || '--'],
        ['Team', timesheet.teamName || '--', 'Week Number', timesheet.weekNumber || '--'],
        ['Year', timesheet.year || '--', 'Status', getStatusLabel(timesheet.status)],
        ['Exported By', exportedByName || 'System', 'Exported At', formatDateTime(new Date())],
    ];

    let infoRowIndex = 4;
    for (const rowValues of infoRows) {
        sheet.getRow(infoRowIndex).values = rowValues;
        styleDataCell(sheet.getCell(`A${infoRowIndex}`), { bg: COLORS.neutralLight, bold: true });
        styleDataCell(sheet.getCell(`B${infoRowIndex}`));
        styleDataCell(sheet.getCell(`C${infoRowIndex}`), { bg: COLORS.neutralLight, bold: true });
        styleDataCell(sheet.getCell(`D${infoRowIndex}`));
        sheet.mergeCells(`D${infoRowIndex}:H${infoRowIndex}`);
        styleDataCell(sheet.getCell(`D${infoRowIndex}`));
        infoRowIndex += 1;
    }

    sheet.mergeCells('A10:H10');
    const summaryTitle = sheet.getCell('A10');
    summaryTitle.value = 'Summary Metrics';
    summaryTitle.font = { ...BASE_FONT, bold: true, size: 13, color: { argb: COLORS.dark } };
    summaryTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.brandLight } };
    summaryTitle.alignment = { horizontal: 'left', vertical: 'middle' };

    const metricHeaders = [
        'Total Hours',
        'Regular Hours',
        'Overtime Hours',
        'Days Worked',
        'Days Absent',
        'Break Minutes',
        'Late Days',
        'Incomplete Entries',
    ];
    const metricValues = [
        roundHours(summary.totalHours || 0),
        roundHours(summary.regularHours || 0),
        roundHours(summary.overtimeHours || 0),
        summary.daysWorked || 0,
        summary.daysAbsent || 0,
        summary.breakTime || 0,
        summary.lateDays || 0,
        summary.incompleteEntries || 0,
    ];

    sheet.getRow(11).values = metricHeaders;
    styleHeaderRow(sheet, 11, metricHeaders.length);

    sheet.getRow(12).values = metricValues;
    metricValues.forEach((value, idx) => {
        styleDataCell(sheet.getCell(12, idx + 1), {
            align: 'center',
            bold: true,
            bg: idx < 3 ? COLORS.successLight : COLORS.neutralLight,
            fg: idx < 3 ? COLORS.success : COLORS.dark,
        });
        sheet.getCell(12, idx + 1).value = value;
    });

    sheet.mergeCells('A14:H14');
    const visualTitle = sheet.getCell('A14');
    visualTitle.value = 'Daily Hours Visual';
    visualTitle.font = { ...BASE_FONT, bold: true, size: 13, color: { argb: COLORS.dark } };
    visualTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.brandLight } };
    visualTitle.alignment = { horizontal: 'left', vertical: 'middle' };

    sheet.getRow(15).values = ['Date', 'Day', 'Status', 'Hours', 'Overtime', 'Break (min)', 'Hours Visual', 'Notes'];
    styleHeaderRow(sheet, 15, 8);

    const maxDailyHours = Math.max(1, ...dailyEntries.map((entry) => entry.totalHours || 0));
    let rowIndex = 16;
    for (const day of dailyEntries) {
        const status = day.status || 'unknown';
        const statusColor = getStatusColors(status);
        const dateObj = safeDate(day.date);
        const formattedDate = dateObj ? format(dateObj, 'yyyy-MM-dd') : '--';
        const dayName = dateObj ? format(dateObj, 'EEE') : '--';
        const hours = roundHours(day.totalHours || 0);
        const overtime = roundHours(day.overtimeHours || 0);
        const breakMinutes = day.breakDuration || 0;
        const visual = buildAsciiBar(hours, maxDailyHours);
        const notes = (day.notes || '').slice(0, 120);

        sheet.getRow(rowIndex).values = [
            formattedDate,
            dayName,
            getStatusLabel(status),
            hours,
            overtime,
            breakMinutes,
            visual,
            notes || '--',
        ];

        styleDataCell(sheet.getCell(rowIndex, 1), { align: 'center' });
        styleDataCell(sheet.getCell(rowIndex, 2), { align: 'center' });
        styleDataCell(sheet.getCell(rowIndex, 3), {
            align: 'center',
            bg: statusColor.bg,
            fg: statusColor.fg,
            bold: true,
        });
        styleDataCell(sheet.getCell(rowIndex, 4), { align: 'right' });
        styleDataCell(sheet.getCell(rowIndex, 5), { align: 'right', fg: COLORS.warning });
        styleDataCell(sheet.getCell(rowIndex, 6), { align: 'right' });
        styleDataCell(sheet.getCell(rowIndex, 7), { align: 'left', fg: COLORS.brand, bold: true });
        sheet.getCell(rowIndex, 7).font = { ...BASE_FONT, name: 'Consolas', bold: true, color: { argb: COLORS.brand } };
        styleDataCell(sheet.getCell(rowIndex, 8), { wrap: true });
        rowIndex += 1;
    }

    const legendRow = rowIndex + 1;
    sheet.mergeCells(`A${legendRow}:H${legendRow}`);
    const legendCell = sheet.getCell(`A${legendRow}`);
    legendCell.value = 'Visual legend: bars scale by the highest daily hours in this timesheet period.';
    legendCell.font = { ...BASE_FONT, italic: true, color: { argb: COLORS.muted } };
    legendCell.alignment = { horizontal: 'left', vertical: 'middle' };

    return sheet;
}

function addDailyBreakdownSheet(workbook, payload) {
    const { timesheet } = payload;
    const dailyEntries = timesheet.dailyEntries || [];
    const sheet = workbook.addWorksheet('Daily Breakdown', {
        views: [{ state: 'frozen', ySplit: 1 }],
    });

    sheet.columns = [
        { header: 'Date', key: 'date', width: 14 },
        { header: 'Day', key: 'day', width: 10 },
        { header: 'Status', key: 'status', width: 16 },
        { header: 'Clock In', key: 'clockIn', width: 12 },
        { header: 'Clock Out', key: 'clockOut', width: 12 },
        { header: 'Worked Hours', key: 'workedHours', width: 14 },
        { header: 'Regular Hours', key: 'regularHours', width: 14 },
        { header: 'Overtime Hours', key: 'overtimeHours', width: 14 },
        { header: 'Break Minutes', key: 'breakMinutes', width: 13 },
        { header: 'Clock-In Location', key: 'clockInLocation', width: 36 },
        { header: 'Clock-Out Location', key: 'clockOutLocation', width: 36 },
        { header: 'Exceptions', key: 'exceptions', width: 28 },
        { header: 'Notes', key: 'notes', width: 30 },
    ];

    styleHeaderRow(sheet, 1, sheet.columns.length);

    let rowIndex = 2;
    for (const day of dailyEntries) {
        const dateObj = safeDate(day.date);
        const status = day.status || 'unknown';
        const statusColor = getStatusColors(status);
        const exceptionText = (day.exceptions || [])
            .map((item) => `${item.type}: ${item.description || ''}`.trim())
            .join(' | ');

        const row = sheet.getRow(rowIndex);
        row.values = [
            dateObj ? format(dateObj, 'yyyy-MM-dd') : '--',
            dateObj ? format(dateObj, 'EEE') : '--',
            getStatusLabel(status),
            formatTime(day.clockIn),
            formatTime(day.clockOut),
            roundHours(day.totalHours || 0),
            roundHours(day.regularHours || 0),
            roundHours(day.overtimeHours || 0),
            day.breakDuration || 0,
            formatLocation(day.clockInLocation),
            formatLocation(day.clockOutLocation),
            exceptionText || '--',
            day.notes || '--',
        ];

        styleDataCell(row.getCell(1), { align: 'center' });
        styleDataCell(row.getCell(2), { align: 'center' });
        styleDataCell(row.getCell(3), {
            align: 'center',
            bg: statusColor.bg,
            fg: statusColor.fg,
            bold: true,
        });
        styleDataCell(row.getCell(4), { align: 'center' });
        styleDataCell(row.getCell(5), { align: 'center' });
        styleDataCell(row.getCell(6), { align: 'right' });
        styleDataCell(row.getCell(7), { align: 'right' });
        styleDataCell(row.getCell(8), { align: 'right', fg: COLORS.warning });
        styleDataCell(row.getCell(9), { align: 'right' });
        styleDataCell(row.getCell(10), { wrap: true });
        styleDataCell(row.getCell(11), { wrap: true });
        styleDataCell(row.getCell(12), { wrap: true });
        styleDataCell(row.getCell(13), { wrap: true });
        row.height = 28;
        rowIndex += 1;
    }

    return sheet;
}

function addEntryTimelineSheet(workbook, payload) {
    const { entries } = payload;
    const sheet = workbook.addWorksheet('Entry Timeline', {
        views: [{ state: 'frozen', ySplit: 1 }],
    });

    sheet.columns = [
        { header: 'Timestamp', key: 'timestamp', width: 22 },
        { header: 'Entry Type', key: 'entryType', width: 16 },
        { header: 'Source', key: 'source', width: 12 },
        { header: 'Manual Entry', key: 'manual', width: 12 },
        { header: 'Location', key: 'location', width: 40 },
        { header: 'Verified', key: 'verified', width: 10 },
        { header: 'Coordinates', key: 'coordinates', width: 28 },
        { header: 'Note', key: 'note', width: 40 },
    ];

    styleHeaderRow(sheet, 1, sheet.columns.length);

    let rowIndex = 2;
    for (const entry of entries) {
        const location = entry.location || null;
        const entryType = entry.entryType || 'unknown';
        const entryTypeColors = getStatusColors(
            entryType === 'clock_in' || entryType === 'break_end'
                ? 'working'
                : entryType === 'break_start'
                    ? 'on_break'
                    : entryType === 'clock_out'
                        ? 'clocked_out'
                        : 'unknown'
        );

        const row = sheet.getRow(rowIndex);
        row.values = [
            formatDateTime(entry.timestamp),
            getStatusLabel(entryType),
            entry.source || '--',
            entry.isManualEntry ? 'Yes' : 'No',
            formatLocation(location),
            location?.verified === undefined ? '--' : (location.verified ? 'Yes' : 'No'),
            (location?.latitude && location?.longitude)
                ? `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`
                : '--',
            entry.note || '--',
        ];

        styleDataCell(row.getCell(1), { align: 'center' });
        styleDataCell(row.getCell(2), {
            align: 'center',
            bg: entryTypeColors.bg,
            fg: entryTypeColors.fg,
            bold: true,
        });
        styleDataCell(row.getCell(3), { align: 'center' });
        styleDataCell(row.getCell(4), { align: 'center' });
        styleDataCell(row.getCell(5), { wrap: true });
        styleDataCell(row.getCell(6), { align: 'center' });
        styleDataCell(row.getCell(7), { align: 'center' });
        styleDataCell(row.getCell(8), { wrap: true });
        row.height = 24;
        rowIndex += 1;
    }

    return sheet;
}

function addExceptionsSheet(workbook, payload) {
    const { timesheet } = payload;
    const sheet = workbook.addWorksheet('Exceptions', {
        views: [{ state: 'frozen', ySplit: 1 }],
    });

    sheet.columns = [
        { header: 'Date', key: 'date', width: 14 },
        { header: 'Day', key: 'day', width: 10 },
        { header: 'Exception Type', key: 'type', width: 22 },
        { header: 'Description', key: 'description', width: 70 },
    ];

    styleHeaderRow(sheet, 1, sheet.columns.length);

    let rowIndex = 2;
    for (const day of timesheet.dailyEntries || []) {
        const dateObj = safeDate(day.date);
        for (const exception of day.exceptions || []) {
            const row = sheet.getRow(rowIndex);
            row.values = [
                dateObj ? format(dateObj, 'yyyy-MM-dd') : '--',
                dateObj ? format(dateObj, 'EEE') : '--',
                getStatusLabel(exception.type),
                exception.description || '--',
            ];

            styleDataCell(row.getCell(1), { align: 'center' });
            styleDataCell(row.getCell(2), { align: 'center' });
            styleDataCell(row.getCell(3), { align: 'center', bg: COLORS.warningLight, fg: COLORS.warning, bold: true });
            styleDataCell(row.getCell(4), { wrap: true });
            row.height = 26;
            rowIndex += 1;
        }
    }

    if (rowIndex === 2) {
        const row = sheet.getRow(2);
        row.values = ['--', '--', 'No Exceptions', 'No exceptions found in this timesheet period.'];
        styleDataCell(row.getCell(1), { align: 'center' });
        styleDataCell(row.getCell(2), { align: 'center' });
        styleDataCell(row.getCell(3), { align: 'center', bg: COLORS.successLight, fg: COLORS.success, bold: true });
        styleDataCell(row.getCell(4));
    }

    return sheet;
}

function sanitizeFileName(value) {
    return String(value || '')
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

async function generateTimesheetExcelReport(payload) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Seemplify Time & Attendance';
    workbook.lastModifiedBy = payload.exportedByName || 'System';
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.properties.date1904 = false;

    addOverviewSheet(workbook, payload);
    addDailyBreakdownSheet(workbook, payload);
    addEntryTimelineSheet(workbook, payload);
    addExceptionsSheet(workbook, payload);

    const employee = sanitizeFileName(payload.timesheet.userName || payload.timesheet.userId || 'employee');
    const start = sanitizeFileName(formatDate(payload.timesheet.startDate, 'start'));
    const end = sanitizeFileName(formatDate(payload.timesheet.endDate, 'end'));
    const filename = `timesheet_detailed_${employee}_${start}_to_${end}.xlsx`;
    const buffer = await workbook.xlsx.writeBuffer();

    return { buffer: Buffer.from(buffer), filename };
}

module.exports = {
    generateTimesheetExcelReport,
};

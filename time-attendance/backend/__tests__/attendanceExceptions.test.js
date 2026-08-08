const { buildAttendanceExceptions } = require('../services/attendanceExceptionService');

test('exception register identifies lateness, short breaks, manual changes and clock source', () => {
    const entries = [
        { userId: 'u1', userName: 'Ada', userEmail: 'ada@example.com', timestamp: new Date('2026-08-03T09:30:00Z'), entryType: 'clock_in', source: 'hub' },
        { userId: 'u1', userName: 'Ada', userEmail: 'ada@example.com', timestamp: new Date('2026-08-03T13:00:00Z'), entryType: 'break_start', source: 'web' },
        { userId: 'u1', userName: 'Ada', userEmail: 'ada@example.com', timestamp: new Date('2026-08-03T13:10:00Z'), entryType: 'break_end', source: 'manual', isManualEntry: true },
        { userId: 'u1', userName: 'Ada', userEmail: 'ada@example.com', timestamp: new Date('2026-08-03T17:00:00Z'), entryType: 'clock_out', source: 'web' },
    ];
    const report = buildAttendanceExceptions(entries, {
        timezone: 'UTC', workSchedule: { defaultShift: { startTime: '09:00', endTime: '17:00' } },
        gracePeriod: { lateArrival: 5, earlyDeparture: 0 }, breakRules: { requiredAfterMinutes: 360, minimumBreakMinutes: 20 },
        clockSettings: { autoClockOut: { afterHours: 12 } },
    });
    const types = report.rows[0].exceptions.map(item => item.type);
    expect(types).toEqual(expect.arrayContaining(['late_arrival', 'break_shortfall', 'manual_entry']));
    expect(report.summary.sourceCounts).toMatchObject({ hub: 1, web: 2, manual: 1 });
});

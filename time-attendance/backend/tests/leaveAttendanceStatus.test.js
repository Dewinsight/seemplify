const attendanceRouter = require('../routes/attendance');

const { buildLeaveWindow, buildTeamMemberRow, buildTeamSummary } = attendanceRouter._test;

describe('leave attendance status', () => {
    const leave = {
        startAt: new Date('2026-08-10T00:00:00Z'),
        endAt: new Date('2026-08-12T00:00:00Z'),
        allDay: true,
        type: 'sick',
        typeName: 'Sick Leave',
    };

    test('shows approved leave instead of a missing clock-in without exposing the leave type', () => {
        const member = buildTeamMemberRow({
            userId: 'employee-1',
            seed: { userName: 'Alex Morgan', userEmail: 'alex@example.com', teamName: 'Operations' },
            todayEntries: [],
            latestEntry: null,
            latestTimesheet: null,
            currentLeave: leave,
        });

        expect(member).toMatchObject({ status: 'on_leave', leaveConflict: false });
        expect(member.leave).toEqual(buildLeaveWindow(leave));
        expect(member.leave).not.toHaveProperty('type');
        expect(member.leave).not.toHaveProperty('typeName');
    });

    test('preserves live attendance and marks a leave overlap for review', () => {
        const member = buildTeamMemberRow({
            userId: 'employee-1',
            seed: { userName: 'Alex Morgan' },
            todayEntries: [{ entryType: 'clock_in', timestamp: new Date('2026-08-10T09:00:00Z') }],
            latestEntry: { entryType: 'clock_in', timestamp: new Date('2026-08-10T09:00:00Z') },
            latestTimesheet: null,
            currentLeave: leave,
        });

        expect(member).toMatchObject({ status: 'working', leaveConflict: true, hasActiveSession: true });
    });

    test('reports leave separately from clocked-out and missing-clock states', () => {
        expect(buildTeamSummary([
            { status: 'working', leaveConflict: true },
            { status: 'on_leave', leaveConflict: false },
            { status: 'not_clocked_in', leaveConflict: false },
        ])).toEqual({
            total: 3,
            working: 1,
            onBreak: 0,
            clockedOut: 1,
            notClockedIn: 1,
            onLeave: 1,
            leaveConflicts: 1,
        });
    });
});

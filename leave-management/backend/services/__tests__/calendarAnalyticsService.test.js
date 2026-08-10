const { buildCalendarAnalytics, daysInRange } = require('../calendarAnalyticsService');

describe('calendar analytics service', () => {
  const roster = [
    { userId: 'employee-1', teamAssignments: [{ teamId: 'team-a', name: 'Operations' }] },
    { userId: 'employee-2', teamAssignments: [{ teamId: 'team-a', name: 'Operations' }] },
    { userId: 'employee-3', teamAssignments: [{ teamId: 'team-b', name: 'Sales' }] },
    { userId: 'employee-4', teamAssignments: [{ teamId: 'team-b', name: 'Sales' }] },
  ];

  test('calculates organization and team peak coverage from approved leave only', () => {
    const requests = [
      { userId: 'employee-1', status: 'approved', startDate: '2026-08-10', endDate: '2026-08-12' },
      { userId: 'employee-2', status: 'approved', startDate: '2026-08-11', endDate: '2026-08-11' },
      { userId: 'employee-3', status: 'pending', startDate: '2026-08-11', endDate: '2026-08-13' },
    ];

    const result = buildCalendarAnalytics({
      startDate: '2026-08-10', endDate: '2026-08-13', roster, requests,
    });

    expect(result.summary).toMatchObject({
      totalWorkforce: 4,
      peopleOnApprovedLeave: 2,
      workforcePercentOnLeaveInPeriod: 50,
      pendingRequests: 1,
      peakAwayCount: 2,
      peakAwayPercent: 50,
      peakDate: '2026-08-11',
    });
    expect(result.dailyCoverage.find((day) => day.date === '2026-08-11')).toMatchObject({
      approvedAway: 2, pendingAway: 1, approvedAwayPercent: 50,
    });
    expect(result.teamCoverage.find((team) => team.teamId === 'team-a')).toMatchObject({
      totalWorkforce: 2,
      peopleOnApprovedLeave: 2,
      workforcePercentOnLeaveInPeriod: 100,
      peakAwayCount: 2,
      peakAwayPercent: 100,
    });
  });

  test('limits reporting ranges to a year plus leap-day allowance', () => {
    expect(daysInRange('2026-01-01', '2026-12-31')).toHaveLength(365);
    expect(() => daysInRange('2026-01-01', '2027-12-31')).toThrow('cannot exceed 370 days');
  });
});

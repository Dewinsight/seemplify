const analyticsService = require('../PayrollAnalyticsService');

describe('PayrollAnalyticsService', () => {
  test('builds current workforce counts from active payroll profiles only', () => {
    const result = analyticsService.buildHeadcountAnalytics([
      { userId: '1', isActive: true, status: 'active', employeeInfo: { department: 'Product', employmentType: 'full_time', dateOfJoining: '2025-09-01' } },
      { userId: '2', isActive: true, status: 'on_leave', employeeInfo: { department: 'Product', employmentType: 'part_time' } },
      { userId: '3', isActive: false, status: 'active', employeeInfo: { department: 'Sales', employmentType: 'contract' } },
      { userId: '4', isActive: false, status: 'terminated', employeeInfo: { department: 'Sales', employmentType: 'contract' } },
    ], new Date('2026-08-20T00:00:00.000Z'));

    expect(result.total).toBe(2);
    expect(result.totalRecords).toBe(4);
    expect(result.statusBreakdown).toEqual({
      active: 1, on_notice: 0, on_leave: 1, terminated: 1, suspended: 0, inactive: 1,
    });
    expect(result.departmentHeadcount).toEqual({ Product: 2 });
    expect(result.employmentTypes).toEqual({ full_time: 1, part_time: 1, contract: 0, intern: 0, unspecified: 0 });
    expect(result.tenureDistribution).toContainEqual({ label: 'Not recorded', count: 1 });
  });

  test('normalizes blank departments and builds a current roster', () => {
    const profiles = [
      { userId: '1', isActive: true, status: 'active', employeeInfo: { department: ' Product ' } },
      { userId: '2', isActive: true, status: 'on_notice', employeeInfo: { department: '' } },
      { userId: '3', isActive: false, status: 'terminated', employeeInfo: { department: 'Product' } },
    ];
    const roster = analyticsService.buildDepartmentRoster(profiles);
    expect(roster.get('Product').userIds.size).toBe(1);
    expect(roster.get('Unassigned').onNotice).toBe(1);
    expect(roster.has('Sales')).toBe(false);
    expect(analyticsService.currentDepartmentByUser(profiles).get('2')).toBe('Unassigned');
  });
});

'use strict';

const {
  getApprovedUnpaidLeaveSummary,
} = require('../unpaidLeaveSummaryService');

function approvedUnpaid(overrides = {}) {
  return {
    organizationId: 'org-a',
    userId: 'employee-a',
    leaveType: 'unpaid',
    status: 'approved',
    startDate: new Date('2026-08-05T00:00:00.000Z'),
    endDate: new Date('2026-08-12T00:00:00.000Z'),
    ...overrides,
  };
}

describe('approved unpaid-leave summary', () => {
  test('is tenant/employee scoped and calculates only the overlapping policy days', async () => {
    const findPolicy = jest.fn().mockResolvedValue({
      organizationId: 'org-a',
      timezone: 'Africa/Nairobi',
      workingDays: [1, 2, 3, 4, 5],
      holidays: [{ date: new Date('2026-08-12T00:00:00.000Z') }],
    });
    const findRequests = jest.fn().mockResolvedValue([
      // Clipped to Aug 10-12.
      approvedUnpaid(),
      // Adjacent overlap is merged and clipped to Aug 13-14.
      approvedUnpaid({
        startDate: new Date('2026-08-13T00:00:00.000Z'),
        endDate: new Date('2026-08-18T00:00:00.000Z'),
      }),
      // A defensive boundary drops foreign-tenant data even if a faulty data
      // adapter returns it despite the Mongo query.
      approvedUnpaid({ organizationId: 'org-b' }),
      approvedUnpaid({ userId: 'employee-b' }),
      approvedUnpaid({ status: 'pending' }),
      approvedUnpaid({ leaveType: 'annual' }),
    ]);

    const result = await getApprovedUnpaidLeaveSummary({
      organizationId: 'org-a',
      userId: 'employee-a',
      startDate: '2026-08-10',
      endDate: '2026-08-14',
    }, { findPolicy, findRequests });

    expect(result).toEqual({
      organizationId: 'org-a',
      userId: 'employee-a',
      startDate: '2026-08-10',
      endDate: '2026-08-14',
      unpaidDays: 4,
      workingDaysInPeriod: 4,
      matchedRequestCount: 2,
      timezone: 'Africa/Nairobi',
    });
    expect(findPolicy).toHaveBeenCalledWith('org-a');
    expect(findRequests).toHaveBeenCalledTimes(1);
    const query = findRequests.mock.calls[0][0];
    expect(query).toMatchObject({
      organizationId: 'org-a',
      userId: 'employee-a',
      leaveType: 'unpaid',
      status: 'approved',
    });
    expect(query.startDate.$lt.toISOString()).toBe('2026-08-15T00:00:00.000Z');
    expect(query.endDate.$gte.toISOString()).toBe('2026-08-10T00:00:00.000Z');
  });

  test('unions overlapping approved records so a day cannot be deducted twice', async () => {
    const result = await getApprovedUnpaidLeaveSummary({
      organizationId: 'org-a',
      userId: 'employee-a',
      startDate: '2026-08-03',
      endDate: '2026-08-07',
    }, {
      findPolicy: async () => ({
        organizationId: 'org-a',
        timezone: 'UTC',
        workingDays: [1, 2, 3, 4, 5],
        holidays: [],
      }),
      findRequests: async () => [
        approvedUnpaid({
          startDate: new Date('2026-08-03T00:00:00.000Z'),
          endDate: new Date('2026-08-06T00:00:00.000Z'),
        }),
        approvedUnpaid({
          startDate: new Date('2026-08-05T00:00:00.000Z'),
          endDate: new Date('2026-08-07T00:00:00.000Z'),
        }),
      ],
    });

    expect(result.unpaidDays).toBe(5);
    expect(result.matchedRequestCount).toBe(2);
  });

  test('fails closed if the scoped organization policy is unavailable', async () => {
    await expect(getApprovedUnpaidLeaveSummary({
      organizationId: 'org-a',
      userId: 'employee-a',
      startDate: '2026-08-01',
      endDate: '2026-08-31',
    }, {
      findPolicy: async () => null,
      findRequests: jest.fn(),
    })).rejects.toMatchObject({
      statusCode: 503,
      code: 'LEAVE_POLICY_UNAVAILABLE',
    });
  });

  test('rejects invalid or excessive date windows before reading leave data', async () => {
    const dependencies = {
      findPolicy: jest.fn(),
      findRequests: jest.fn(),
    };
    await expect(getApprovedUnpaidLeaveSummary({
      organizationId: 'org-a',
      userId: 'employee-a',
      startDate: '2026-08-31',
      endDate: '2026-08-01',
    }, dependencies)).rejects.toMatchObject({ statusCode: 400 });

    await expect(getApprovedUnpaidLeaveSummary({
      organizationId: 'org-a',
      userId: 'employee-a',
      startDate: '2025-01-01',
      endDate: '2026-12-31',
    }, dependencies)).rejects.toMatchObject({ statusCode: 400 });
    expect(dependencies.findPolicy).not.toHaveBeenCalled();
  });
});

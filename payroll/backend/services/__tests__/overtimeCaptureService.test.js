const { normalizeManualOvertimeCapture } = require('../overtimeCaptureService');

const now = new Date('2026-08-10T20:00:00.000Z');

function valid(overrides = {}) {
  return {
    overtimeHours: 2,
    overtimeMultiplier: 1.5,
    reason: 'External customer meeting after normal working hours.',
    effectiveDate: '2026-08-10',
    overtimeContext: {
      captureMethod: 'manual_external_work',
      activityType: 'external_meeting',
      startedAt: '2026-08-10T17:00:00.000Z',
      endedAt: '2026-08-10T19:00:00.000Z',
      workLocation: 'Customer office, Manchester',
      clientOrProject: 'Customer renewal meeting',
      evidenceReference: 'Calendar event CRM-421',
      confirmedNotInTimesheet: true,
    },
    now,
    ...overrides,
  };
}

describe('manual overtime capture', () => {
  test('normalizes an external work record for approval and payroll', () => {
    const result = normalizeManualOvertimeCapture(valid());
    expect(result).toMatchObject({
      overtimeHours: 2,
      overtimeMultiplier: 1.5,
      overtimeContext: {
        captureMethod: 'manual_external_work',
        activityType: 'external_meeting',
        confirmedNotInTimesheet: true,
      },
    });
    expect(result.overtimeContext.startedAt).toEqual(new Date('2026-08-10T17:00:00.000Z'));
  });

  test.each(['field_sales', 'client_site', 'travel', 'event_support', 'after_hours_support', 'weekend_work', 'other'])('accepts %s work', activityType => {
    expect(normalizeManualOvertimeCapture(valid({
      overtimeContext: { ...valid().overtimeContext, activityType },
    })).overtimeContext.activityType).toBe(activityType);
  });

  test('rejects duplicate-timesheet risk without an explicit declaration', () => {
    expect(() => normalizeManualOvertimeCapture(valid({
      overtimeContext: { ...valid().overtimeContext, confirmedNotInTimesheet: false },
    }))).toThrow('not already included');
  });

  test('rejects payable hours longer than the recorded session', () => {
    expect(() => normalizeManualOvertimeCapture(valid({ overtimeHours: 3 }))).toThrow('cannot exceed');
  });

  test('enforces the configured request limit and multiplier', () => {
    expect(() => normalizeManualOvertimeCapture(valid({
      overtimeHours: 2,
      maximumHours: 1.5,
    }))).toThrow('no more than 1.5 hours');

    const result = normalizeManualOvertimeCapture(valid({
      overtimeMultiplier: 3,
      forcedMultiplier: 1.25,
    }));
    expect(result.overtimeMultiplier).toBe(1.25);
  });

  test('rejects future and invalid work intervals', () => {
    expect(() => normalizeManualOvertimeCapture(valid({
      overtimeContext: { ...valid().overtimeContext, startedAt: '2026-08-10T19:30:00.000Z', endedAt: '2026-08-10T20:30:00.000Z' },
    }))).toThrow('before the work has ended');
    expect(() => normalizeManualOvertimeCapture(valid({
      overtimeContext: { ...valid().overtimeContext, startedAt: '2026-08-10T19:00:00.000Z', endedAt: '2026-08-10T18:00:00.000Z' },
    }))).toThrow('after its start');
  });

  test('keeps legacy overtime requests compatible but validated', () => {
    const result = normalizeManualOvertimeCapture({
      overtimeHours: 1,
      overtimeMultiplier: 2,
      reason: 'Legacy approved weekend support.',
      effectiveDate: '2026-08-09',
    });
    expect(result.overtimeContext.captureMethod).toBe('legacy_manual');
  });

  test('keeps legacy fixed-amount overtime compatible', () => {
    const result = normalizeManualOvertimeCapture({
      amount: 125,
      reason: '',
      effectiveDate: '2026-08-09',
    });
    expect(result).toMatchObject({ overtimeContext: { captureMethod: 'legacy_manual' } });
    expect(result.overtimeHours).toBeUndefined();
  });
});

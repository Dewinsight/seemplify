const ACTIVITY_TYPES = Object.freeze([
  'external_meeting',
  'field_sales',
  'client_site',
  'travel',
  'event_support',
  'after_hours_support',
  'weekend_work',
  'other',
]);

function fail(message, code = 'INVALID_OVERTIME_CAPTURE') {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 400;
  throw error;
}

function clean(value, maxLength) {
  const normalized = String(value || '').trim();
  return normalized ? normalized.slice(0, maxLength) : '';
}

function normalizeManualOvertimeCapture({
  overtimeHours,
  overtimeMultiplier,
  amount,
  reason,
  effectiveDate,
  overtimeContext,
  maximumHours = 24,
  forcedMultiplier,
  now = new Date(),
}) {
  const hours = Number(overtimeHours);
  const multiplier = Number(forcedMultiplier ?? overtimeMultiplier ?? 1.5);
  const requestMaximumHours = Math.min(24, Math.max(0.25, Number(maximumHours) || 24));
  const description = clean(reason, 1000);
  const date = new Date(effectiveDate);

  if (Number.isNaN(date.getTime())) fail('A valid overtime date is required.');

  const context = overtimeContext || {};
  if (context.captureMethod !== 'manual_external_work') {
    return {
      overtimeHours: Number.isFinite(hours) && hours > 0 ? hours : undefined,
      overtimeMultiplier: Number.isFinite(multiplier) ? multiplier : 1.5,
      reason: description,
      effectiveDate: date,
      overtimeContext: {
        captureMethod: context.captureMethod === 'timesheet' ? 'timesheet' : 'legacy_manual',
      },
    };
  }

  if (!Number.isFinite(hours) || hours <= 0 || hours > requestMaximumHours) {
    fail(`Overtime hours must be greater than 0 and no more than ${requestMaximumHours} hours.`);
  }
  if (!Number.isFinite(multiplier) || multiplier < 1 || multiplier > 3) {
    fail('Overtime multiplier must be between 1.0 and 3.0.');
  }
  if (description.length < 10) {
    fail('Describe the overtime work using at least 10 characters.');
  }

  if (!ACTIVITY_TYPES.includes(context.activityType)) {
    fail('Select the type of off-system overtime work.');
  }
  const startedAt = new Date(context.startedAt);
  const endedAt = new Date(context.endedAt);
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) {
    fail('Valid overtime start and end times are required.');
  }
  if (endedAt <= startedAt) fail('Overtime end time must be after its start time.');
  if (endedAt > new Date(now).getTime() + 5 * 60 * 1000) {
    fail('Overtime cannot be submitted before the work has ended.');
  }

  const elapsedHours = (endedAt - startedAt) / 3600000;
  if (elapsedHours > 24) fail('A single overtime record cannot span more than 24 hours.');
  if (hours > elapsedHours + 0.01) {
    fail('Payable overtime hours cannot exceed the recorded work duration.');
  }
  if (context.confirmedNotInTimesheet !== true) {
    fail('Confirm that these hours are not already included in an approved timesheet.', 'OVERTIME_TIMESHEET_CONFIRMATION_REQUIRED');
  }

  return {
    overtimeHours: hours,
    overtimeMultiplier: multiplier,
    reason: description,
    effectiveDate: date,
    overtimeContext: {
      captureMethod: 'manual_external_work',
      activityType: context.activityType,
      startedAt,
      endedAt,
      workLocation: clean(context.workLocation, 200),
      clientOrProject: clean(context.clientOrProject, 200),
      evidenceReference: clean(context.evidenceReference, 500),
      confirmedNotInTimesheet: true,
    },
  };
}

module.exports = {
  ACTIVITY_TYPES,
  normalizeManualOvertimeCapture,
};

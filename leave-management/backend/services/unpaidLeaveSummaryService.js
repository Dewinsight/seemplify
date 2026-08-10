'use strict';

const { zonedTimeToUtc } = require('date-fns-tz');

const { LeavePolicy, LeaveRequest } = require('../models');
const { calculateLeaveDays } = require('./leaveCalculations');

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_SUMMARY_WINDOW_DAYS = 366;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

class UnpaidLeaveSummaryError extends Error {
  constructor(message, statusCode = 400, code = 'INVALID_UNPAID_LEAVE_SUMMARY_REQUEST') {
    super(message);
    this.name = 'UnpaidLeaveSummaryError';
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
  }
}

function requiredIdentifier(value, fieldName) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 200) {
    throw new UnpaidLeaveSummaryError(`${fieldName} must be a non-empty identifier.`);
  }
  return normalized;
}

function parseDateOnly(value, fieldName) {
  const normalized = String(value || '').trim();
  const match = DATE_ONLY_PATTERN.exec(normalized);
  if (!match) {
    throw new UnpaidLeaveSummaryError(`${fieldName} must use YYYY-MM-DD format.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const epoch = Date.UTC(year, month - 1, day);
  const parsed = new Date(epoch);
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new UnpaidLeaveSummaryError(`${fieldName} is not a valid calendar date.`);
  }

  return { value: normalized, epoch };
}

function dateToEpochDay(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function epochDayToDateOnly(epoch) {
  return new Date(epoch).toISOString().slice(0, 10);
}

function mergeIntervals(intervals) {
  const sorted = intervals
    .slice()
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];

  for (const interval of sorted) {
    const prior = merged[merged.length - 1];
    if (!prior || interval.start > prior.end + MILLISECONDS_PER_DAY) {
      merged.push({ ...interval });
      continue;
    }
    prior.end = Math.max(prior.end, interval.end);
  }

  return merged;
}

function policyDateInstant(dateOnly, timezone) {
  // calculateLeaveDays expects real instants and converts them into the policy
  // timezone. Constructing local midnight first prevents a date-only value from
  // shifting to the previous day west of UTC.
  return zonedTimeToUtc(`${dateOnly}T00:00:00`, timezone || 'UTC');
}

async function defaultFindPolicy(organizationId) {
  return LeavePolicy.findOne({ organizationId })
    .select('organizationId timezone workingDays holidays')
    .lean();
}

async function defaultFindRequests(query) {
  return LeaveRequest.find(query)
    .select('organizationId userId leaveType status startDate endDate')
    .lean();
}

async function getApprovedUnpaidLeaveSummary(input = {}, dependencies = {}) {
  const organizationId = requiredIdentifier(input.organizationId, 'organizationId');
  const userId = requiredIdentifier(input.userId, 'userId');
  const start = parseDateOnly(input.startDate, 'startDate');
  const end = parseDateOnly(input.endDate, 'endDate');

  if (start.epoch > end.epoch) {
    throw new UnpaidLeaveSummaryError('startDate must be on or before endDate.');
  }
  const windowDays = Math.floor((end.epoch - start.epoch) / MILLISECONDS_PER_DAY) + 1;
  if (windowDays > MAX_SUMMARY_WINDOW_DAYS) {
    throw new UnpaidLeaveSummaryError(
      `The unpaid-leave summary window cannot exceed ${MAX_SUMMARY_WINDOW_DAYS} days.`
    );
  }

  const findPolicy = dependencies.findPolicy || defaultFindPolicy;
  const findRequests = dependencies.findRequests || defaultFindRequests;
  const leaveDaysCalculator = dependencies.calculateLeaveDays || calculateLeaveDays;

  const policy = await findPolicy(organizationId);
  if (!policy || String(policy.organizationId) !== organizationId) {
    throw new UnpaidLeaveSummaryError(
      'The organization leave policy is unavailable.',
      503,
      'LEAVE_POLICY_UNAVAILABLE'
    );
  }

  const queryEndExclusive = new Date(end.epoch + MILLISECONDS_PER_DAY);
  const query = {
    organizationId,
    userId,
    leaveType: 'unpaid',
    status: 'approved',
    startDate: { $lt: queryEndExclusive },
    endDate: { $gte: new Date(start.epoch) },
  };
  const requests = await findRequests(query);

  const intervals = [];
  let matchedRequestCount = 0;
  for (const request of Array.isArray(requests) ? requests : []) {
    // Retain a defensive tenant and employee boundary even though Mongo also
    // scopes the query. This prevents an adapter/cache regression leaking data.
    if (
      String(request?.organizationId || '') !== organizationId
      || String(request?.userId || '') !== userId
      || request?.leaveType !== 'unpaid'
      || request?.status !== 'approved'
    ) {
      continue;
    }

    const requestStart = dateToEpochDay(request.startDate);
    const requestEnd = dateToEpochDay(request.endDate);
    if (requestStart === null || requestEnd === null || requestStart > requestEnd) {
      throw new UnpaidLeaveSummaryError(
        'Approved unpaid-leave data contains an invalid date range.',
        503,
        'LEAVE_DATA_INVALID'
      );
    }

    const overlapStart = Math.max(start.epoch, requestStart);
    const overlapEnd = Math.min(end.epoch, requestEnd);
    if (overlapStart <= overlapEnd) {
      intervals.push({ start: overlapStart, end: overlapEnd });
      matchedRequestCount += 1;
    }
  }

  const timezone = String(policy.timezone || 'UTC');
  const calculationPolicy = {
    timezone,
    workingDays: Array.isArray(policy.workingDays) ? policy.workingDays : [1, 2, 3, 4, 5],
    holidays: Array.isArray(policy.holidays) ? policy.holidays : [],
  };
  const workingDaysInPeriod = Number(leaveDaysCalculator(
    policyDateInstant(start.value, timezone),
    policyDateInstant(end.value, timezone),
    calculationPolicy
  ));
  if (!Number.isFinite(workingDaysInPeriod) || workingDaysInPeriod <= 0) {
    throw new UnpaidLeaveSummaryError(
      'The organization working-day policy does not produce a valid payroll divisor for this period.',
      503,
      'LEAVE_POLICY_INVALID'
    );
  }
  const mergedIntervals = mergeIntervals(intervals);
  const unpaidDays = mergedIntervals.reduce((total, interval) => {
    const intervalStart = epochDayToDateOnly(interval.start);
    const intervalEnd = epochDayToDateOnly(interval.end);
    const days = Number(leaveDaysCalculator(
      policyDateInstant(intervalStart, timezone),
      policyDateInstant(intervalEnd, timezone),
      calculationPolicy
    ));
    if (!Number.isFinite(days) || days < 0) {
      throw new UnpaidLeaveSummaryError(
        'Approved unpaid-leave data could not be calculated.',
        503,
        'LEAVE_DATA_INVALID'
      );
    }
    return total + days;
  }, 0);

  return {
    organizationId,
    userId,
    startDate: start.value,
    endDate: end.value,
    unpaidDays,
    workingDaysInPeriod,
    matchedRequestCount,
    timezone,
  };
}

module.exports = {
  MAX_SUMMARY_WINDOW_DAYS,
  UnpaidLeaveSummaryError,
  getApprovedUnpaidLeaveSummary,
  mergeIntervals,
  parseDateOnly,
};

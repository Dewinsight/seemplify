const CompensationRequest = require('../models/CompensationRequest');
const TimeAttendanceImport = require('../models/TimeAttendanceImport');

const ACTIVE_MANUAL_STATUSES = ['pending', 'approved', 'approved_l1', 'approved_l2', 'processed'];

function overlapQuery(startedAt, endedAt) {
  return {
    'overtimeContext.startedAt': { $lt: new Date(endedAt) },
    'overtimeContext.endedAt': { $gt: new Date(startedAt) },
  };
}

async function findDuplicateManualOvertime({ organizationId, userId, startedAt, endedAt, excludeRequestId }) {
  return CompensationRequest.findOne({
    organizationId,
    userId,
    type: 'overtime',
    status: { $in: ACTIVE_MANUAL_STATUSES },
    'overtimeContext.captureMethod': 'manual_external_work',
    ...overlapQuery(startedAt, endedAt),
    ...(excludeRequestId ? { _id: { $ne: excludeRequestId } } : {}),
  }).lean();
}

async function findAttendanceImportConflict({ organizationId, userId, startedAt, endedAt }) {
  return TimeAttendanceImport.findOne({
    organizationId,
    userId,
    status: { $in: ['accepted', 'applied'] },
    'period.startAt': { $lt: new Date(endedAt) },
    'period.endAt': { $gt: new Date(startedAt) },
    payCodeLines: {
      $elemMatch: {
        $or: [
          { category: 'overtime' },
          { category: 'adjustment', 'metadata.adjustmentCategory': 'overtime' },
        ],
      },
    },
  }).lean();
}

async function findManualOvertimeForImport({ organizationId, userId, period }) {
  return CompensationRequest.findOne({
    organizationId,
    userId,
    type: 'overtime',
    status: { $in: ACTIVE_MANUAL_STATUSES },
    'overtimeContext.captureMethod': 'manual_external_work',
    'overtimeContext.startedAt': { $lt: new Date(period.endAt) },
    'overtimeContext.endedAt': { $gt: new Date(period.startAt) },
  }).lean();
}

module.exports = {
  ACTIVE_MANUAL_STATUSES,
  findAttendanceImportConflict,
  findDuplicateManualOvertime,
  findManualOvertimeForImport,
};

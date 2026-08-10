const express = require('express');
const router = express.Router();

const { LeavePolicy } = require('../models');
const {
  requireAuth,
  requireOrganization,
  requireLeavePermission,
  asyncHandler,
  AppError,
} = require('../middleware');
const { logLeavePolicyUpdated } = require('../services/auditService');
const { queueAttendanceEvent } = require('../services/attendanceIntegrationService');
const { getPolicyLeaveTypes, LEGACY_POLICY_FIELDS } = require('../services/leaveEntitlementService');

// Apply auth and org middleware to all routes
router.use(requireAuth);
router.use(requireOrganization);

// Get current organization's leave policy
router.get('/', asyncHandler(async (req, res) => {
  const policy = await LeavePolicy.findOrCreate(req.organizationId, req.organizationName);
  res.json({ policy });
}));

// Get default policy values
router.get('/defaults', asyncHandler(async (req, res) => {
  const defaults = LeavePolicy.getDefaultPolicy();
  res.json({ defaults });
}));

// Update organization's leave policy (admin only)
router.put('/',
  requireLeavePermission('manage_policies'),
  asyncHandler(async (req, res) => {
    const updates = req.body;

    // Fields that can be updated
    const allowedFields = [
      'annualLeaveDays',
      'sickLeaveDays',
      'personalLeaveDays',
      'maternityLeaveDays',
      'paternityLeaveDays',
      'unpaidLeaveDays',
      'requiresApproval',
      'approvalRoles',
      'autoApproveTypes',
      'maxConsecutiveDays',
      'advanceNoticeDays',
      'minLeaveDays',
      'carryOverAllowed',
      'maxCarryOverDays',
      'carryOverExpiryMonths',
      'timezone',
      'workingDays',
      'holidays',
      'holidayCalendar',
      'accrualMethod',
      'accrualDay',
      'notifyApproversOnRequest',
      'notifyRequesterOnDecision',
      'reminderDaysBeforeLeave',
      'customSettings',
    ];

    const policy = await LeavePolicy.findOne({ organizationId: req.organizationId });

    if (!policy) {
      throw new AppError('Leave policy not found', 404, 'NOT_FOUND');
    }

    const previousPolicy = policy.toObject();

    // Apply allowed updates
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        policy[field] = updates[field];
      }
    }

    // Keep the canonical definitions aligned while legacy policy fields are
    // still accepted during migration.
    for (const [key, legacyField] of Object.entries(LEGACY_POLICY_FIELDS)) {
      if (updates[legacyField] === undefined) continue;
      const definition = policy.leaveTypes.find((item) => item.key === key);
      if (definition) {
        definition.defaultDays = Math.max(0, Number(updates[legacyField]));
        definition.updatedAt = new Date();
        definition.updatedBy = req.user.id;
      }
    }

    policy.updatedBy = req.user.id;
    await policy.save();
    if (updates.holidays !== undefined || updates.holidayCalendar !== undefined) {
      await queueAttendanceEvent('holiday.calendar.updated', {
        organizationId: req.organizationId,
        holidayId: 'calendar',
        calendar: policy.holidayCalendar,
        holidays: policy.holidays.map(holiday => ({ holidayId: holiday._id, name: holiday.name, date: holiday.date, isRecurring: holiday.isRecurring })),
        updatedAt: policy.updatedAt,
      });
    }

    // Log audit
    await logLeavePolicyUpdated(policy, req.user, req, previousPolicy);

    res.json({
      success: true,
      policy,
    });
  })
);

// Add holiday to policy
router.post('/holidays',
  requireLeavePermission('manage_policies'),
  asyncHandler(async (req, res) => {
    const { date, name, isRecurring } = req.body;

    if (!date) {
      throw new AppError('Holiday date is required', 400, 'VALIDATION_ERROR');
    }

    const policy = await LeavePolicy.findOne({ organizationId: req.organizationId });

    if (!policy) {
      throw new AppError('Leave policy not found', 404, 'NOT_FOUND');
    }

    // Check if holiday already exists
    const holidayDate = new Date(date);
    const exists = policy.holidays.some(h => {
      const existingDate = new Date(h.date);
      return existingDate.toISOString().split('T')[0] === holidayDate.toISOString().split('T')[0];
    });

    if (exists) {
      throw new AppError('Holiday already exists for this date', 400, 'DUPLICATE_HOLIDAY');
    }

    policy.holidays.push({
      date: holidayDate,
      name: name || 'Holiday',
      isRecurring: isRecurring || false,
    });

    policy.updatedBy = req.user.id;
    await policy.save();
    const addedHoliday = policy.holidays[policy.holidays.length - 1];
    await queueAttendanceEvent('holiday.updated', {
      organizationId: req.organizationId,
      holidayId: addedHoliday._id.toString(),
      name: addedHoliday.name,
      date: addedHoliday.date,
      isRecurring: addedHoliday.isRecurring,
      status: 'active',
      updatedAt: policy.updatedAt,
    });

    res.json({
      success: true,
      policy,
    });
  })
);

// Remove holiday from policy
router.delete('/holidays',
  requireLeavePermission('manage_policies'),
  asyncHandler(async (req, res) => {
    const { date } = req.body;

    if (!date) {
      throw new AppError('Holiday date is required', 400, 'VALIDATION_ERROR');
    }

    const policy = await LeavePolicy.findOne({ organizationId: req.organizationId });

    if (!policy) {
      throw new AppError('Leave policy not found', 404, 'NOT_FOUND');
    }

    const holidayDate = new Date(date).toISOString().split('T')[0];

    const removedHoliday = policy.holidays.find(h => {
      const existingDate = new Date(h.date).toISOString().split('T')[0];
      return existingDate === holidayDate;
    });
    policy.holidays = policy.holidays.filter(h => {
      const existingDate = new Date(h.date).toISOString().split('T')[0];
      return existingDate !== holidayDate;
    });

    policy.updatedBy = req.user.id;
    await policy.save();
    if (removedHoliday) await queueAttendanceEvent('holiday.cancelled', {
      organizationId: req.organizationId,
      holidayId: removedHoliday._id.toString(),
      name: removedHoliday.name,
      date: removedHoliday.date,
      isRecurring: removedHoliday.isRecurring,
      status: 'cancelled',
      updatedAt: policy.updatedAt,
    });

    res.json({
      success: true,
      policy,
    });
  })
);

// Get holidays for a specific year
router.get('/holidays', asyncHandler(async (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();

  const policy = await LeavePolicy.findOrCreate(req.organizationId, req.organizationName);

  // Filter holidays for the requested year
  const yearHolidays = policy.holidays.filter(h => {
    const holidayDate = new Date(h.date);
    if (h.isRecurring) {
      return true; // Recurring holidays apply to all years
    }
    return holidayDate.getFullYear() === year;
  }).map(h => {
    const holidayDate = new Date(h.date);
    if (h.isRecurring) {
      // Adjust to requested year
      holidayDate.setFullYear(year);
    }
    return {
      date: holidayDate,
      name: h.name,
      isRecurring: h.isRecurring,
    };
  });

  // Sort by date
  yearHolidays.sort((a, b) => new Date(a.date) - new Date(b.date));

  res.json({
    year,
    holidays: yearHolidays,
  });
}));

// Get leave entitlements
router.get('/entitlements', asyncHandler(async (req, res) => {
  const policy = await LeavePolicy.findOrCreate(req.organizationId, req.organizationName);

  const leaveTypes = getPolicyLeaveTypes(policy);
  const entitlements = Object.fromEntries(leaveTypes.map((definition) => [definition.key, definition.defaultDays]));

  res.json({
    entitlements,
    leaveTypes,
    requiresApproval: policy.requiresApproval,
    autoApproveTypes: policy.autoApproveTypes,
    maxConsecutiveDays: policy.maxConsecutiveDays,
    advanceNoticeDays: policy.advanceNoticeDays,
  });
}));

module.exports = router;

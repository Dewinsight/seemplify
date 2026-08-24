const express = require('express');
const mongoose = require('mongoose');

const { LeaveBalance, LeavePolicy } = require('../models');
const {
  requireAuth,
  requireOrganization,
  requireLeavePermission,
  asyncHandler,
  AppError,
} = require('../middleware');
const { logLeaveTypeChanged } = require('../services/auditService');
const {
  getPolicyLeaveTypes,
  normalizeLeaveTypeKey,
} = require('../services/leaveEntitlementService');

const router = express.Router();
router.use(requireAuth);
router.use(requireOrganization);

function validateDays(value) {
  const days = Number(value);
  if (!Number.isFinite(days) || days < 0 || days > 365) {
    throw new AppError('Default days must be between 0 and 365', 400, 'INVALID_DEFAULT_DAYS');
  }
  return days;
}

function validateRequestLimit(value) {
  if (value === null || value === undefined || value === '') return null;
  const days = Number(value);
  if (!Number.isFinite(days) || days < 0.5 || days > 365) {
    throw new AppError('Maximum days per request must be between 0.5 and 365', 400, 'INVALID_REQUEST_LIMIT');
  }
  return days;
}

router.get('/', asyncHandler(async (req, res) => {
  const policy = await LeavePolicy.findOrCreate(req.organizationId, req.organizationName);
  const includeInactive = req.query.includeInactive === 'true' && (
    req.hasCentralAuthorization
      ? req.organizationPermissions?.includes('manage_policies')
      : ['owner', 'admin'].includes(req.organizationRole)
  );
  res.json({ leaveTypes: getPolicyLeaveTypes(policy, { includeInactive }) });
}));

router.post('/', requireLeavePermission('manage_policies'), asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const key = normalizeLeaveTypeKey(req.body.key || name);
  if (!name || !key) throw new AppError('Leave type name is required', 400, 'VALIDATION_ERROR');

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const policy = await LeavePolicy.findOne({ organizationId: req.organizationId }).session(session);
    if (!policy) throw new AppError('Leave policy not found', 404, 'NOT_FOUND');
    if (policy.leaveTypes.some((definition) => definition.key === key)) {
      throw new AppError('A leave type with this key already exists', 409, 'DUPLICATE_LEAVE_TYPE');
    }
    if (policy.leaveTypes.filter((definition) => definition.active).length >= 50) {
      throw new AppError('A maximum of 50 active leave types is supported', 400, 'LEAVE_TYPE_LIMIT');
    }

    policy.leaveTypes.push({
      key,
      name,
      description: String(req.body.description || '').trim(),
      defaultDays: validateDays(req.body.defaultDays),
      maxConsecutiveDays: validateRequestLimit(req.body.maxConsecutiveDays),
      paid: req.body.paid !== false,
      active: true,
      requiresApproval: typeof req.body.requiresApproval === 'boolean' ? req.body.requiresApproval : null,
      order: Number.isFinite(Number(req.body.order)) ? Number(req.body.order) : policy.leaveTypes.length * 10 + 10,
      createdBy: req.user.id,
      updatedBy: req.user.id,
    });
    policy.updatedBy = req.user.id;
    await policy.save({ session });
    const leaveType = getPolicyLeaveTypes(policy, { includeInactive: true }).find((item) => item.key === key);
    await LeaveBalance.updateMany(
      {
        organizationId: req.organizationId,
        year: { $gte: new Date().getFullYear() },
        'entitlements.leaveTypeKey': { $ne: key },
      },
      {
        $push: {
          entitlements: {
            leaveTypeKey: key,
            leaveTypeName: leaveType.name,
            total: leaveType.defaultDays,
            used: 0,
            remaining: leaveType.defaultDays,
            pending: 0,
            policyDefault: leaveType.defaultDays,
            source: 'policy',
          },
        },
        $inc: { version: 1 },
      },
      { session }
    );
    await logLeaveTypeChanged({
      action: 'leave_type_created', policy, leaveType, user: req.user, req, session,
    });
    await session.commitTransaction();
    res.status(201).json({ success: true, leaveType });
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
}));

router.patch('/:key', requireLeavePermission('manage_policies'), asyncHandler(async (req, res) => {
  const key = normalizeLeaveTypeKey(req.params.key);
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const policy = await LeavePolicy.findOne({ organizationId: req.organizationId }).session(session);
    if (!policy) throw new AppError('Leave policy not found', 404, 'NOT_FOUND');
    const definition = policy.leaveTypes.find((item) => item.key === key);
    if (!definition) throw new AppError('Leave type not found', 404, 'NOT_FOUND');
    const previousState = definition.toObject();

    if (req.body.name !== undefined) {
      const name = String(req.body.name || '').trim();
      if (!name) throw new AppError('Leave type name cannot be empty', 400, 'VALIDATION_ERROR');
      definition.name = name;
    }
    if (req.body.description !== undefined) definition.description = String(req.body.description || '').trim();
    if (req.body.defaultDays !== undefined) definition.defaultDays = validateDays(req.body.defaultDays);
    if (req.body.maxConsecutiveDays !== undefined) {
      definition.maxConsecutiveDays = validateRequestLimit(req.body.maxConsecutiveDays);
    }
    if (req.body.paid !== undefined) definition.paid = Boolean(req.body.paid);
    if (req.body.active !== undefined) definition.active = Boolean(req.body.active);
    if (req.body.requiresApproval !== undefined) {
      definition.requiresApproval = req.body.requiresApproval === null ? null : Boolean(req.body.requiresApproval);
    }
    if (req.body.order !== undefined && Number.isFinite(Number(req.body.order))) definition.order = Number(req.body.order);
    definition.updatedAt = new Date();
    definition.updatedBy = req.user.id;
    policy.updatedBy = req.user.id;
    await policy.save({ session });

    if (req.body.defaultDays !== undefined || req.body.name !== undefined) {
      await LeaveBalance.updateMany(
        { organizationId: req.organizationId, year: { $gte: new Date().getFullYear() } },
        {
          $set: {
            'entitlements.$[entry].leaveTypeName': definition.name,
            'entitlements.$[entry].policyDefault': definition.defaultDays,
          },
          $inc: { version: 1 },
        },
        { session, arrayFilters: [{ 'entry.leaveTypeKey': key }] }
      );
      if (req.body.defaultDays !== undefined) {
        await LeaveBalance.updateMany(
          { organizationId: req.organizationId, year: { $gte: new Date().getFullYear() } },
          { $set: { 'entitlements.$[entry].total': definition.defaultDays } },
          { session, arrayFilters: [{ 'entry.leaveTypeKey': key, 'entry.source': 'policy' }] }
        );
      }
    }

    const leaveType = getPolicyLeaveTypes(policy, { includeInactive: true }).find((item) => item.key === key);
    await logLeaveTypeChanged({
      action: 'leave_type_updated', policy, leaveType, user: req.user, req, previousState, session,
    });
    await session.commitTransaction();
    res.json({ success: true, leaveType });
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
}));

router.delete('/:key', requireLeavePermission('manage_policies'), asyncHandler(async (req, res) => {
  const key = normalizeLeaveTypeKey(req.params.key);
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const policy = await LeavePolicy.findOne({ organizationId: req.organizationId }).session(session);
    if (!policy) throw new AppError('Leave policy not found', 404, 'NOT_FOUND');
    const definition = policy.leaveTypes.find((item) => item.key === key);
    if (!definition) throw new AppError('Leave type not found', 404, 'NOT_FOUND');
    if (!definition.active) throw new AppError('Leave type is already archived', 409, 'ALREADY_ARCHIVED');
    const previousState = definition.toObject();
    definition.active = false;
    definition.updatedAt = new Date();
    definition.updatedBy = req.user.id;
    policy.autoApproveTypes = policy.autoApproveTypes.filter((item) => item !== key);
    policy.updatedBy = req.user.id;
    await policy.save({ session });
    const leaveType = getPolicyLeaveTypes(policy, { includeInactive: true }).find((item) => item.key === key);
    await logLeaveTypeChanged({
      action: 'leave_type_archived', policy, leaveType, user: req.user, req, previousState, session,
    });
    await session.commitTransaction();
    res.json({ success: true, leaveType });
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
}));

module.exports = router;

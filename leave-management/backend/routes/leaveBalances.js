const express = require('express');
const mongoose = require('mongoose');

const {
  LeaveBalance,
  LeaveEntitlementAdjustment,
  LeavePolicy,
} = require('../models');
const {
  requireAuth,
  requireOrganization,
  requireLeavePermission,
  balanceUpdateLimiter,
  asyncHandler,
  AppError,
} = require('../middleware');
const { logLeaveEntitlementAdjusted, logLeaveBalancesInitialized } = require('../services/auditService');
const emailService = require('../services/emailService');
const { fetchOrganizationRoster, findRosterMember } = require('../services/rosterService');
const {
  getPolicyLeaveTypes,
  normalizeLeaveTypeKey,
  serializeBalance,
} = require('../services/leaveEntitlementService');

const router = express.Router();
router.use(requireAuth);
router.use(requireOrganization);

function parseYear(value) {
  const year = Number.parseInt(value, 10) || new Date().getFullYear();
  if (year < 2000 || year > 2200) throw new AppError('Invalid leave year', 400, 'INVALID_YEAR');
  return year;
}

function defaultBalanceForMember(member, policy, year) {
  return {
    _id: null,
    userId: member.userId,
    userEmail: member.email,
    userName: member.name,
    organizationId: policy.organizationId,
    year,
    timezone: policy.timezone,
    version: 0,
    initialized: false,
    entitlements: getPolicyLeaveTypes(policy, { includeInactive: true }).map((definition) => ({
      leaveTypeKey: definition.key,
      leaveTypeName: definition.name,
      total: definition.defaultDays,
      used: 0,
      remaining: definition.defaultDays,
      pending: 0,
      available: definition.defaultDays,
      policyDefault: definition.defaultDays,
      source: 'policy',
      overrideReason: '',
      active: definition.active,
    })),
  };
}

async function getManagedBalance(member, organizationId, year) {
  return LeaveBalance.findOrCreate(
    member.userId,
    member.email,
    member.name,
    organizationId,
    year
  );
}

router.get('/me', asyncHandler(async (req, res) => {
  const year = parseYear(req.query.year);
  const policy = await LeavePolicy.findOrCreate(req.organizationId, req.organizationName);
  const balance = await LeaveBalance.findOrCreate(
    req.user.id, req.user.email, req.user.name, req.organizationId, year
  );
  res.json({ balance: serializeBalance(balance, policy) });
}));

router.get('/me/history', asyncHandler(async (req, res) => {
  const year = req.query.year ? parseYear(req.query.year) : undefined;
  const query = { organizationId: req.organizationId, userId: req.user.id };
  if (year) query.year = year;
  const adjustments = await LeaveEntitlementAdjustment.find(query)
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(req.query.limit) || 100, 200));
  res.json({ adjustments });
}));

router.get('/summary', asyncHandler(async (req, res) => {
  const year = parseYear(req.query.year);
  const policy = await LeavePolicy.findOrCreate(req.organizationId, req.organizationName);
  const balance = await LeaveBalance.findOrCreate(
    req.user.id, req.user.email, req.user.name, req.organizationId, year
  );
  const serialized = serializeBalance(balance, policy);
  const summary = serialized.entitlements
    .filter((entry) => entry.active)
    .reduce((result, entry) => {
      result.byType[entry.leaveTypeKey] = entry;
      result.totalAvailable += entry.available;
      result.totalUsed += entry.used;
      result.totalPending += entry.pending;
      return result;
    }, { totalAvailable: 0, totalUsed: 0, totalPending: 0, byType: {} });
  res.json({ year, summary, balance: serialized });
}));

router.get('/members', requireLeavePermission('view_all_leaves'), asyncHandler(async (req, res) => {
  const year = parseYear(req.query.year);
  const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 25, 1), 100);
  const search = String(req.query.search || '').trim().toLowerCase();
  const [policy, roster] = await Promise.all([
    LeavePolicy.findOrCreate(req.organizationId, req.organizationName),
    fetchOrganizationRoster(req.organizationId),
  ]);
  const filtered = search
    ? roster.filter((member) => [
      member.name,
      member.email,
      member.employeeId,
      member.role,
      ...(member.teamAssignments || []).map((team) => team.name),
    ]
      .some((value) => String(value || '').toLowerCase().includes(search)))
    : roster;
  const members = filtered.sort((left, right) => left.name.localeCompare(right.name));
  const selected = members.slice((page - 1) * limit, page * limit);
  const balances = await LeaveBalance.find({
    organizationId: req.organizationId,
    year,
    userId: { $in: selected.map((member) => member.userId) },
  });
  const balanceByUser = new Map(balances.map((balance) => [balance.userId, balance]));
  const data = selected.map((member) => {
    const balance = balanceByUser.get(member.userId);
    return {
      ...member,
      balance: balance
        ? { ...serializeBalance(balance, policy), initialized: true }
        : defaultBalanceForMember(member, policy, year),
    };
  });
  res.json({
    members: data,
    pagination: { page, limit, total: members.length, pages: Math.ceil(members.length / limit) },
  });
}));

// Compatibility alias for older admin clients.
router.get('/', requireLeavePermission('view_all_leaves'), asyncHandler(async (req, res) => {
  const year = parseYear(req.query.year);
  const policy = await LeavePolicy.findOrCreate(req.organizationId, req.organizationName);
  const balances = await LeaveBalance.find({ organizationId: req.organizationId, year }).sort({ userName: 1 });
  res.json({
    balances: balances.map((balance) => serializeBalance(balance, policy)),
    pagination: { page: 1, limit: balances.length, total: balances.length, pages: balances.length ? 1 : 0 },
  });
}));

router.post('/initialize', balanceUpdateLimiter, requireLeavePermission('manage_leaves'), asyncHandler(async (req, res) => {
  const year = parseYear(req.body.year);
  const roster = await fetchOrganizationRoster(req.organizationId);
  const results = { created: 0, existing: 0, errors: [] };
  for (const member of roster) {
    try {
      const existing = await LeaveBalance.exists({
        userId: member.userId, organizationId: req.organizationId, year,
      });
      await getManagedBalance(member, req.organizationId, year);
      if (existing) results.existing += 1;
      else results.created += 1;
    } catch (error) {
      results.errors.push({ userId: member.userId, error: error.message });
    }
  }
  await logLeaveBalancesInitialized({
    organizationId: req.organizationId, year, results, user: req.user, req,
  });
  res.json({ success: true, results });
}));

router.get('/user/:userId/history', requireLeavePermission('view_all_leaves'), asyncHandler(async (req, res) => {
  const year = req.query.year ? parseYear(req.query.year) : undefined;
  const member = await findRosterMember(req.organizationId, req.params.userId);
  if (!member) throw new AppError('Organization member not found', 404, 'MEMBER_NOT_FOUND');
  const query = { organizationId: req.organizationId, userId: member.userId };
  if (year) query.year = year;
  const adjustments = await LeaveEntitlementAdjustment.find(query).sort({ createdAt: -1 }).limit(200);
  res.json({ member, adjustments });
}));

router.get('/user/:userId', requireLeavePermission('view_all_leaves'), asyncHandler(async (req, res) => {
  const year = parseYear(req.query.year);
  const [policy, member] = await Promise.all([
    LeavePolicy.findOrCreate(req.organizationId, req.organizationName),
    findRosterMember(req.organizationId, req.params.userId),
  ]);
  if (!member) throw new AppError('Organization member not found', 404, 'MEMBER_NOT_FOUND');
  const balance = await getManagedBalance(member, req.organizationId, year);
  res.json({ member, balance: serializeBalance(balance, policy) });
}));

router.patch('/user/:userId/entitlements/:leaveTypeKey',
  balanceUpdateLimiter,
  requireLeavePermission('manage_leaves'),
  asyncHandler(async (req, res) => {
    const year = parseYear(req.body.year);
    const key = normalizeLeaveTypeKey(req.params.leaveTypeKey);
    const reason = String(req.body.reason || '').trim();
    if (!reason) throw new AppError('A reason is required for every entitlement change', 400, 'REASON_REQUIRED');
    const member = await findRosterMember(req.organizationId, req.params.userId);
    if (!member) throw new AppError('Organization member not found', 404, 'MEMBER_NOT_FOUND');
    await getManagedBalance(member, req.organizationId, year);

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      // MongoDB transactions do not support parallel operations on one session.
      // Keep these reads sequential to avoid transaction-number races.
      const policy = await LeavePolicy.findOne({ organizationId: req.organizationId }).session(session);
      const balance = await LeaveBalance.findOne({
        userId: member.userId,
        organizationId: req.organizationId,
        year,
      }).session(session);
      const definition = policy?.getLeaveType(key, { includeInactive: true });
      if (!definition) throw new AppError('Leave type not found', 404, 'LEAVE_TYPE_NOT_FOUND');
      const entitlement = balance.getEntitlement(key);
      if (!entitlement) throw new AppError('Leave entitlement not found', 404, 'ENTITLEMENT_NOT_FOUND');
      if (req.body.expectedVersion !== undefined && Number(req.body.expectedVersion) !== balance.version) {
        throw new AppError('This balance changed since it was opened. Refresh and try again.', 409, 'VERSION_CONFLICT');
      }

      const previousState = entitlement.toObject ? entitlement.toObject() : { ...entitlement };
      const previousTotal = Number(entitlement.total || 0);
      const resetToPolicy = req.body.resetToPolicy === true;
      const hasTotal = req.body.total !== undefined;
      const delta = Number(req.body.delta);
      const operation = resetToPolicy
        ? 'reset'
        : hasTotal
          ? 'set'
          : delta > 0
            ? 'add'
            : 'deduct';
      if (!resetToPolicy && !hasTotal && (!Number.isFinite(delta) || delta === 0)) {
        throw new AppError('Days to add or deduct must be greater than zero', 400, 'INVALID_DELTA');
      }
      if (req.body.operation !== undefined && req.body.operation !== operation) {
        throw new AppError('The requested operation does not match the entitlement change', 400, 'INVALID_OPERATION');
      }
      const requestedTotal = resetToPolicy
        ? definition.defaultDays
        : hasTotal
          ? Number(req.body.total)
          : previousTotal + delta;
      if (!Number.isFinite(requestedTotal) || requestedTotal < 0 || requestedTotal > 3650) {
        throw new AppError('Entitlement total must be between 0 and 3650 days', 400, 'INVALID_TOTAL');
      }
      const committed = Number(entitlement.used || 0) + Number(entitlement.pending || 0);
      if (requestedTotal < committed) {
        throw new AppError(`Entitlement cannot be lower than ${committed} committed day(s)`, 400, 'BELOW_COMMITTED_DAYS');
      }

      entitlement.total = requestedTotal;
      entitlement.remaining = requestedTotal - Number(entitlement.used || 0);
      entitlement.policyDefault = definition.defaultDays;
      entitlement.source = resetToPolicy ? 'policy' : 'override';
      entitlement.overrideReason = resetToPolicy ? '' : reason;
      entitlement.lastAdjustedAt = new Date();
      entitlement.lastAdjustedBy = req.user.id;
      balance.version += 1;

      const adjustmentData = {
        organizationId: req.organizationId,
        userId: member.userId,
        userName: member.name,
        userEmail: member.email,
        year,
        leaveTypeKey: key,
        leaveTypeName: definition.name,
        operation,
        previousTotal,
        newTotal: requestedTotal,
        delta: requestedTotal - previousTotal,
        reason,
        actorId: req.user.id,
        actorName: req.user.name,
        actorEmail: req.user.email,
      };
      await balance.save({ session });
      await LeaveEntitlementAdjustment.create([adjustmentData], { session });
      await logLeaveEntitlementAdjusted({
        balance, adjustment: adjustmentData, user: req.user, req, previousState, session,
      });
      await session.commitTransaction();

      await emailService.sendLeaveEntitlementAdjusted({ ...adjustmentData, balanceId: balance._id });
      res.json({ success: true, balance: serializeBalance(balance, policy), adjustment: adjustmentData });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  })
);

// Legacy update contract remains available, but every change is routed through
// the auditable single-entitlement endpoint by newer clients.
router.put('/user/:userId', balanceUpdateLimiter, requireLeavePermission('manage_leaves'), asyncHandler(async (req, res) => {
  throw new AppError(
    'Use PATCH /user/:userId/entitlements/:leaveTypeKey with a reason',
    410,
    'AUDITABLE_ENTITLEMENT_ENDPOINT_REQUIRED'
  );
}));

module.exports = router;

const express = require('express');
const router = express.Router();

const { LeaveBalance, LeavePolicy } = require('../models');
const {
  requireAuth,
  requireOrganization,
  requireLeavePermission,
  balanceUpdateLimiter,
  asyncHandler,
  AppError,
} = require('../middleware');
const { logLeaveBalanceUpdated } = require('../services/auditService');

// Apply auth and org middleware to all routes
router.use(requireAuth);
router.use(requireOrganization);

// Get current user's leave balance
router.get('/me', asyncHandler(async (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();

  const balance = await LeaveBalance.findOrCreate(
    req.user.id,
    req.user.email,
    req.user.name,
    req.organizationId,
    year
  );

  res.json({ balance });
}));

// Get all leave balances for organization (admin only)
router.get('/',
  requireLeavePermission('view_all_leaves'),
  asyncHandler(async (req, res) => {
    const { year, page = 1, limit = 50 } = req.query;
    const currentYear = parseInt(year) || new Date().getFullYear();

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [balances, total] = await Promise.all([
      LeaveBalance.find({ organizationId: req.organizationId, year: currentYear })
        .sort({ userName: 1 })
        .skip(skip)
        .limit(parseInt(limit)),
      LeaveBalance.countDocuments({ organizationId: req.organizationId, year: currentYear }),
    ]);

    res.json({
      balances,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  })
);

// Get specific user's balance (admin only)
router.get('/user/:userId',
  requireLeavePermission('view_all_leaves'),
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const balance = await LeaveBalance.findOne({
      userId,
      organizationId: req.organizationId,
      year,
    });

    if (!balance) {
      throw new AppError('Leave balance not found', 404, 'NOT_FOUND');
    }

    res.json({ balance });
  })
);

// Update user's leave balance (admin only)
router.put('/user/:userId',
  balanceUpdateLimiter,
  requireLeavePermission('manage_leaves'),
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { year, updates, reason } = req.body;
    const currentYear = parseInt(year) || new Date().getFullYear();

    if (!updates || typeof updates !== 'object') {
      throw new AppError('Updates object is required', 400, 'VALIDATION_ERROR');
    }

    const balance = await LeaveBalance.findOne({
      userId,
      organizationId: req.organizationId,
      year: currentYear,
    });

    if (!balance) {
      throw new AppError('Leave balance not found', 404, 'NOT_FOUND');
    }

    const previousBalance = balance.toObject();
    const validLeaveTypes = ['annual', 'sick', 'personal', 'maternity', 'paternity', 'unpaid'];

    // Apply updates
    for (const [leaveType, changes] of Object.entries(updates)) {
      if (!validLeaveTypes.includes(leaveType)) {
        continue;
      }

      if (typeof changes !== 'object') {
        continue;
      }

      if (changes.total !== undefined) {
        balance[leaveType].total = Math.max(0, changes.total);
      }
      if (changes.used !== undefined) {
        balance[leaveType].used = Math.max(0, changes.used);
      }
      // Remaining is calculated in pre-save hook
    }

    balance.version += 1;
    await balance.save();

    // Log audit
    await logLeaveBalanceUpdated(balance, req.user, req, {
      updates,
      reason,
      previousBalance,
    });

    res.json({
      success: true,
      balance,
    });
  })
);

// Initialize balances for all organization members (admin only)
router.post('/initialize',
  balanceUpdateLimiter,
  requireLeavePermission('manage_leaves'),
  asyncHandler(async (req, res) => {
    const { year, userIds } = req.body;
    const currentYear = parseInt(year) || new Date().getFullYear();

    // Get policy for default values
    const policy = await LeavePolicy.findOrCreate(req.organizationId, req.organizationName);

    const results = {
      created: 0,
      existing: 0,
      errors: [],
    };

    // Get members from user's organizations claim
    const userinfo = req.user?.userinfo || req.user;
    const org = (userinfo.organizations || []).find(o => o.id === req.organizationId);

    if (!org) {
      throw new AppError('Organization not found in claims', 404, 'ORG_NOT_FOUND');
    }

    // If userIds provided, use those; otherwise this would need IdP API call
    // For now, just create for specified users
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      throw new AppError('userIds array is required', 400, 'VALIDATION_ERROR');
    }

    for (const userData of userIds) {
      try {
        const existing = await LeaveBalance.findOne({
          userId: userData.id,
          organizationId: req.organizationId,
          year: currentYear,
        });

        if (existing) {
          results.existing++;
          continue;
        }

        await LeaveBalance.create({
          userId: userData.id,
          userEmail: userData.email,
          userName: userData.name,
          organizationId: req.organizationId,
          year: currentYear,
          annual: {
            total: policy.annualLeaveDays,
            used: 0,
            remaining: policy.annualLeaveDays,
            pending: 0,
          },
          sick: {
            total: policy.sickLeaveDays,
            used: 0,
            remaining: policy.sickLeaveDays,
            pending: 0,
          },
          personal: {
            total: policy.personalLeaveDays,
            used: 0,
            remaining: policy.personalLeaveDays,
            pending: 0,
          },
        });

        results.created++;
      } catch (error) {
        results.errors.push({
          userId: userData.id,
          error: error.message,
        });
      }
    }

    res.json({
      success: true,
      results,
    });
  })
);

// Get balance summary for dashboard
router.get('/summary', asyncHandler(async (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();

  const balance = await LeaveBalance.findOrCreate(
    req.user.id,
    req.user.email,
    req.user.name,
    req.organizationId,
    year
  );

  // Calculate summary
  const summary = {
    totalAvailable: 0,
    totalUsed: 0,
    totalPending: 0,
    byType: {},
  };

  const leaveTypes = ['annual', 'sick', 'personal', 'maternity', 'paternity', 'unpaid'];

  for (const type of leaveTypes) {
    if (balance[type]) {
      summary.byType[type] = {
        total: balance[type].total,
        used: balance[type].used,
        remaining: balance[type].remaining,
        pending: balance[type].pending,
        available: balance[type].remaining - balance[type].pending,
      };

      summary.totalAvailable += balance[type].remaining - balance[type].pending;
      summary.totalUsed += balance[type].used;
      summary.totalPending += balance[type].pending;
    }
  }

  res.json({
    year,
    summary,
    balance,
  });
}));

module.exports = router;

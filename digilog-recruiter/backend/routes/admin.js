const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../db/client');

const { adminAuth, requirePermission, requireSuperAdmin } = require('../middleware/adminAuth');
const crypto = require('crypto');
const emailService = require('../services/emailService');
const currencyConversionService = require('../services/currencyConversionService');

// Prisma has no `.select('-password')` exclusion; enumerate all non-password User scalars.
const USER_PUBLIC_SELECT = {
  id: true, email: true, profile: true, company: true, preferences: true,
  profileCompletion: true, features: true, security: true, subscription: true,
  emailCapabilities: true, role: true, permissions: true, isActive: true,
  lastLoginAt: true, loginCount: true, twoFactorEnabled: true, resetPasswordToken: true,
  resetPasswordExpires: true, lastPasswordChange: true, hasCompletedOrganizationSetup: true,
  defaultOrganizationId: true, legacyOrganizations: true, calendarConnected: true,
  calendarConnectedEmail: true, calendarEmail: true, calendarProvider: true,
  nylasAccountId: true, nylasGrantId: true, nylasGrantStatus: true, grantConnectedAt: true,
  lastGrantRefresh: true, lastGrantRevocation: true, idpAccessToken: true, idpTokenExpiry: true,
  idpTeams: true, idpTeamPermissions: true, currentOrganizationId: true,
  createdAt: true, updatedAt: true
};

// Prisma has no `.select('-password')` exclusion; enumerate all non-password columns.
const ADMIN_PUBLIC_SELECT = {
  id: true, email: true, name: true, role: true, permissions: true, authSource: true,
  idpAccountId: true, isActive: true, lastLogin: true, lastSsoLoginAt: true, lastIdpSyncAt: true,
  loginAttempts: true, lockUntil: true, resetPasswordOTP: true, resetPasswordOTPExpires: true,
  resetPasswordAttempts: true, createdAt: true, updatedAt: true
};

const buildAdminTokenPayload = (admin) => ({
  admin: {
    id: admin.id
  },
  isAdmin: true
});

const issueAdminToken = (admin) => {
  return jwt.sign(
    buildAdminTokenPayload(admin),
    process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );
};

const buildAdminAuthResponse = (admin, token = issueAdminToken(admin)) => ({
  token,
  admin: {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
    permissions: admin.permissions
  }
});

// @route   POST /api/admin/auth/login
// @desc    Admin login
// @access  Public
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ msg: 'Please provide email and password' });
    }

    // Find admin
    const admin = await prisma.admin.findFirst({ where: { email: email.toLowerCase() } });

    if (!admin) {
      return res.status(401).json({ msg: 'Invalid credentials' });
    }

    // Check if account is locked
    const isLocked = !!(admin.lockUntil && new Date(admin.lockUntil).getTime() > Date.now());
    if (isLocked) {
      return res.status(423).json({
        msg: 'Account is locked due to too many failed login attempts. Please try again later.'
      });
    }

    // Check password
    const isMatch = !!password && !!admin.password && await bcrypt.compare(password, admin.password);

    if (!isMatch) {
      // incLoginAttempts: expired lock -> restart at 1; otherwise increment and lock after 5.
      if (admin.lockUntil && new Date(admin.lockUntil).getTime() < Date.now()) {
        await prisma.admin.update({ where: { id: admin.id }, data: { loginAttempts: 1, lockUntil: null } });
      } else {
        const data = { loginAttempts: { increment: 1 } };
        if ((admin.loginAttempts + 1) >= 5 && !isLocked) {
          data.lockUntil = new Date(Date.now() + 2 * 60 * 60 * 1000);
        }
        await prisma.admin.update({ where: { id: admin.id }, data });
      }
      return res.status(401).json({ msg: 'Invalid credentials' });
    }

    // Reset login attempts on successful login
    await prisma.admin.update({ where: { id: admin.id }, data: { loginAttempts: 0, lastLogin: new Date(), lockUntil: null } });

    res.json(buildAdminAuthResponse(admin));
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   GET /api/admin/auth/me
// @desc    Get current admin
// @access  Private (Admin)
router.get('/auth/me', adminAuth, async (req, res) => {
  try {
    const admin = await prisma.admin.findUnique({
      where: { id: req.admin.id },
      select: ADMIN_PUBLIC_SELECT
    });
    res.json(admin);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   POST /api/admin/auth/forgot-password
// @desc    Request admin password reset with OTP
// @access  Public
router.post('/auth/forgot-password', async (req, res) => {
  try {
    const { email, frontendUrl } = req.body;

    if (!email) {
      return res.status(400).json({ msg: 'Email is required' });
    }

    // Find admin by email
    const admin = await prisma.admin.findFirst({ where: { email: email.toLowerCase() } });

    if (!admin) {
      // Don't reveal if admin exists or not for security
      return res.json({ msg: 'If an admin account with that email exists, an OTP has been sent.' });
    }

    if (!admin.isActive) {
      return res.status(400).json({ msg: 'Admin account is deactivated' });
    }

    // Generate OTP (was Admin.generateResetOTP: 6-digit, 10 min expiry, reset attempts)
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await prisma.admin.update({
      where: { id: admin.id },
      data: {
        resetPasswordOTP: otp,
        resetPasswordOTPExpires: new Date(Date.now() + 10 * 60 * 1000),
        resetPasswordAttempts: 0
      }
    });

    // Send OTP email
    try {
      await emailService.sendAdminPasswordResetOTP(admin.email, otp, admin.name);
      console.log(`✅ Password reset OTP sent to admin: ${admin.email}`);
    } catch (emailError) {
      console.error('❌ Failed to send OTP email:', emailError);
      return res.status(500).json({ msg: 'Failed to send OTP email' });
    }

    res.json({
      msg: 'OTP sent to your email address. Please check your inbox.',
      email: admin.email
    });
  } catch (err) {
    console.error('Error in admin forgot password:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   POST /api/admin/auth/verify-otp
// @desc    Verify OTP for admin password reset
// @access  Public
router.post('/auth/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ msg: 'Email and OTP are required' });
    }

    const admin = await prisma.admin.findFirst({ where: { email: email.toLowerCase() } });

    if (!admin) {
      return res.status(400).json({ msg: 'Invalid request' });
    }

    // Verify OTP (was Admin.verifyResetOTP)
    let verification;
    if (!admin.resetPasswordOTPExpires || new Date(admin.resetPasswordOTPExpires).getTime() < Date.now()) {
      verification = { valid: false, reason: 'OTP has expired' };
    } else if (admin.resetPasswordAttempts >= 3) {
      verification = { valid: false, reason: 'Too many invalid attempts' };
    } else if (admin.resetPasswordOTP !== otp) {
      admin.resetPasswordAttempts += 1;
      verification = { valid: false, reason: 'Invalid OTP' };
    } else {
      verification = { valid: true };
    }

    if (!verification.valid) {
      // Save updated attempt count
      await prisma.admin.update({
        where: { id: admin.id },
        data: { resetPasswordAttempts: admin.resetPasswordAttempts }
      });
      return res.status(400).json({ msg: verification.reason });
    }

    // Generate temporary token for password reset
    const resetToken = crypto.randomBytes(32).toString('hex');
    await prisma.admin.update({
      where: { id: admin.id },
      data: {
        resetPasswordOTP: resetToken, // Reuse field for reset token
        resetPasswordOTPExpires: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
      }
    });

    res.json({
      msg: 'OTP verified successfully',
      resetToken: resetToken
    });
  } catch (err) {
    console.error('Error verifying OTP:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   POST /api/admin/auth/reset-password
// @desc    Reset admin password with token
// @access  Public
router.post('/auth/reset-password', async (req, res) => {
  try {
    const { email, resetToken, newPassword } = req.body;

    if (!email || !resetToken || !newPassword) {
      return res.status(400).json({ msg: 'Email, reset token, and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ msg: 'Password must be at least 8 characters long' });
    }

    const admin = await prisma.admin.findFirst({
      where: {
        email: email.toLowerCase(),
        resetPasswordOTP: resetToken,
        resetPasswordOTPExpires: { gt: new Date() }
      }
    });

    if (!admin) {
      return res.status(400).json({ msg: 'Invalid or expired reset token' });
    }

    // Update password (hashing was done by pre-save middleware)
    const hashedPassword = await bcrypt.hash(newPassword, await bcrypt.genSalt(10));
    // clearResetOTP + reset login attempts/lock
    await prisma.admin.update({
      where: { id: admin.id },
      data: {
        password: hashedPassword,
        resetPasswordOTP: null,
        resetPasswordOTPExpires: null,
        resetPasswordAttempts: 0,
        loginAttempts: 0,
        lockUntil: null
      }
    });

    console.log(`✅ Admin password reset successfully: ${admin.email}`);

    res.json({ msg: 'Password reset successfully. You can now login with your new password.' });
  } catch (err) {
    console.error('Error resetting admin password:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   GET /api/admin/users
// @desc    Get all users with pagination and filtering
// @access  Private (Admin with manageUsers permission)
router.get('/users', adminAuth, requirePermission('manageUsers'), async (req, res) => {
  try {
    const { page = 1, limit = 20, search, organizationId } = req.query;

    // Build query
    const where = {};

    if (search) {
      // NOTE: profile/company are Json columns; Prisma Json string_contains has no
      // case-insensitive mode, so only the email term keeps mode:'insensitive'.
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { profile: { path: ['firstName'], string_contains: search } },
        { profile: { path: ['lastName'], string_contains: search } },
        { company: { path: ['name'], string_contains: search } }
      ];
    }

    if (organizationId) {
      where.memberships = { some: { organizationId } };
    }

    // Execute query with pagination
    const users = await prisma.user.findMany({
      where,
      select: {
        ...USER_PUBLIC_SELECT,
        currentOrganization: { select: { id: true, name: true } },
        memberships: {
          include: { organization: { select: { id: true, name: true, subscription: true } } }
        }
      },
      take: parseInt(limit) * 1,
      skip: (parseInt(page) - 1) * parseInt(limit),
      orderBy: { createdAt: 'desc' }
    });

    // Preserve legacy response shape: organizationMemberships[].organization
    const shapedUsers = users.map((u) => {
      const { memberships, ...rest } = u;
      return {
        ...rest,
        organizationMemberships: (memberships || []).map((m) => ({
          ...m,
          organization: m.organization
        }))
      };
    });

    // Get total count
    const count = await prisma.user.count({ where });

    res.json({
      users: shapedUsers,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      totalUsers: count
    });
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   GET /api/admin/organizations
// @desc    Get all organizations with pagination (syncs from IdP)
// @access  Private (Admin with manageOrganizations permission)
router.get('/organizations', adminAuth, requirePermission('manageOrganizations'), async (req, res) => {
  try {
    const { page = 1, limit = 20, search, plan, status } = req.query;

    // List organizations from this app's own database (no Identity Provider)
    const where = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ];
    }

    const subscriptionFilters = [];
    if (plan) {
      subscriptionFilters.push({ subscription: { path: ['plan'], equals: plan } });
    }
    if (status) {
      subscriptionFilters.push({ subscription: { path: ['licenseStatus'], equals: status } });
    }
    if (subscriptionFilters.length) {
      where.AND = subscriptionFilters;
    }

    const organizations = await prisma.organization.findMany({
      where,
      include: {
        owner: { select: { id: true, email: true, profile: true } },
        members: true
      },
      take: parseInt(limit) * 1,
      skip: (parseInt(page) - 1) * parseInt(limit),
      orderBy: { createdAt: 'desc' }
    });

    const count = await prisma.organization.count({ where });

    const orgsWithStats = organizations.map(org => {
      const orgObj = { ...org };
      orgObj.memberCount = org.members?.filter(m => m.status === 'active').length || 0;
      orgObj.isIdpManaged = false;
      orgObj.memberSource = 'local';
      orgObj.usagePercentage = {
        members: orgObj.memberCount > 0
          ? (orgObj.memberCount / (org.subscription?.memberLimit || 5)) * 100
          : 0
      };
      return orgObj;
    });

    res.json({
      organizations: orgsWithStats,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      totalOrganizations: count
    });
  } catch (err) {
    console.error('Error fetching organizations:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   GET /api/admin/organizations/:id
// @desc    Get single organization by ID (fetches from IdP if IdP-linked)
// @access  Private (Admin with manageOrganizations permission)
router.get('/organizations/:id', adminAuth, requirePermission('manageOrganizations'), async (req, res) => {
  try {
    // Always use local member data (no Identity Provider); owner + members.user populated.
    const organization = await prisma.organization.findUnique({
      where: { id: req.params.id },
      include: {
        owner: { select: { id: true, email: true, profile: true } },
        members: { include: { user: { select: { id: true, email: true, profile: true } } } }
      }
    });

    if (!organization) {
      return res.status(404).json({ msg: 'Organization not found' });
    }

    const orgObj = { ...organization };
    orgObj.memberCount = organization.members?.filter(m => m.status === 'active').length || 0;
    orgObj.isIdpManaged = false;
    orgObj.memberSource = 'local';

    orgObj.usagePercentage = {
      members: orgObj.memberCount > 0
        ? (orgObj.memberCount / (organization.subscription?.memberLimit || 5)) * 100
        : 0
    };

    res.json({ organization: orgObj });
  } catch (err) {
    console.error('Error fetching organization:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   PUT /api/admin/organizations/:id/license
// @desc    Update organization license
// @access  Private (Admin with manageLicenses permission)
router.put('/organizations/:id/license', adminAuth, requirePermission('manageLicenses'), async (req, res) => {
  try {
    const {
      plan,
      memberLimit,
      licenseType,
      licenseEndDate,
      defaultCurrency,
      generateNewKey
    } = req.body;

    const organization = await prisma.organization.findUnique({ where: { id: req.params.id } });

    if (!organization) {
      return res.status(404).json({ msg: 'Organization not found' });
    }

    // subscription/settings are Json columns — mutate a local copy, then persist.
    organization.subscription = organization.subscription || {};
    if (!Array.isArray(organization.subscription.adminNotes)) organization.subscription.adminNotes = [];

    // Validate plan if provided - only use database plans
    if (plan) {
      const planExists = await prisma.plan.findFirst({ where: { code: plan } }); // Only organization plans exist now

      if (!planExists) {
        return res.status(400).json({
          msg: `Invalid plan code: "${plan}". This plan doesn't exist in the database.`
        });
      }

      organization.subscription.plan = plan;
    }
    if (memberLimit) organization.subscription.memberLimit = memberLimit;
    if (licenseType) organization.subscription.licenseType = licenseType;
    if (licenseEndDate) organization.subscription.licenseEndDate = new Date(licenseEndDate);
    if (defaultCurrency) {
      if (!currencyConversionService.ALLOWED_CURRENCIES[String(defaultCurrency).trim().toUpperCase()]) {
        return res.status(400).json({ msg: 'Unsupported default currency' });
      }
      if (!organization.settings) organization.settings = {};
      organization.settings.defaultCurrency = String(defaultCurrency).trim().toUpperCase();
    }

    // Generate new license key if requested
    if (generateNewKey) {
      organization.subscription.licenseKey = crypto.randomBytes(16).toString('hex').toUpperCase();
    }

    // Update license status
    organization.subscription.licenseStatus = 'active';
    organization.subscription.licenseStartDate = new Date();

    // Add admin note
    organization.subscription.adminNotes.push({
      note: `License updated: Plan ${plan}, Limits: ${memberLimit} members${defaultCurrency ? `, Currency: ${String(defaultCurrency).trim().toUpperCase()}` : ''}`,
      addedBy: req.admin.id
    });

    await prisma.organization.update({
      where: { id: organization.id },
      data: { subscription: organization.subscription, settings: organization.settings }
    });

    res.json({
      msg: 'License updated successfully',
      organization
    });
  } catch (err) {
    console.error('Error updating license:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   PUT /api/admin/organizations/:id/plan
// @desc    Upgrade organization plan
// @access  Private (Admin with manageLicenses permission)
router.put('/organizations/:id/plan', adminAuth, requirePermission('manageLicenses'), async (req, res) => {
  try {
    const { plan, customLimits } = req.body;

    const organization = await prisma.organization.findUnique({ where: { id: req.params.id } });

    if (!organization) {
      return res.status(404).json({ msg: 'Organization not found' });
    }

    // subscription is a Json column — mutate a local copy, then persist.
    organization.subscription = organization.subscription || {};
    if (!Array.isArray(organization.subscription.adminNotes)) organization.subscription.adminNotes = [];

    // Validate plan - only use database plans
    const planExists = await prisma.plan.findFirst({ where: { code: plan } }); // Only organization plans exist now

    if (!planExists) {
      return res.status(400).json({
        msg: `Invalid plan code: "${plan}". This plan doesn't exist in the database.`
      });
    }

    console.log('🔄 Plan update request:', {
      organizationId: req.params.id,
      organizationName: organization.name,
      currentPlan: organization.subscription.plan,
      newPlan: plan,
      customLimits
    });

    // Define plan limits
    const planLimits = {
      free: { members: 5 },
      basic: { members: 20 },
      pro: { members: 100 },
      enterprise: { members: 1000 }
    };

    // Update plan and limits
    console.log('📝 Updating plan from', organization.subscription.plan, 'to', plan);
    organization.subscription.plan = plan;

    if (customLimits) {
      // Use custom limits if provided
      organization.subscription.memberLimit = customLimits.members || planLimits[plan].members;
    } else {
      // Use default plan limits
      organization.subscription.memberLimit = planLimits[plan].members;
    }

    // Update credits from the new plan
    if (planExists.credits?.totalCredits) {
      const currentCredits = organization.subscription.creditUsage || {};
      const usedCredits = currentCredits.usedCredits || 0;
      const newTotalCredits = planExists.credits.totalCredits;
      const previousTotal = currentCredits.totalCredits || 0;

      // Initialize creditUsage if it doesn't exist
      if (!organization.subscription.creditUsage) {
        organization.subscription.creditUsage = {
          totalCredits: newTotalCredits,
          usedCredits: 0,
          remainingCredits: newTotalCredits,
          currentCycleStart: new Date(),
          currentCycleEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          transactions: [],
          rolloverCredits: 0,
          creditPurchases: [],
          lowCreditWarning: { enabled: true, threshold: 20 }
        };
      } else {
        // Update existing creditUsage with new plan's credits
        organization.subscription.creditUsage.totalCredits = newTotalCredits;
        organization.subscription.creditUsage.remainingCredits = Math.max(0, newTotalCredits - usedCredits);
      }

      // Add transaction record for the plan upgrade
      organization.subscription.creditUsage.transactions = organization.subscription.creditUsage.transactions || [];
      organization.subscription.creditUsage.transactions.push({
        action: 'planUpgrade',
        credits: newTotalCredits - previousTotal,
        timestamp: new Date(),
        balanceAfter: organization.subscription.creditUsage.remainingCredits,
        metadata: {
          previousPlan: organization.subscription.plan,
          newPlan: plan,
          previousTotal: previousTotal,
          newTotal: newTotalCredits
        }
      });

      console.log('💳 Credits updated:', {
        previousTotal,
        newTotal: newTotalCredits,
        usedCredits,
        newRemaining: organization.subscription.creditUsage.remainingCredits
      });
    }

    // Add admin note
    organization.subscription.adminNotes.push({
      note: `Plan upgraded to ${plan}`,
      addedBy: req.admin.id
    });

    await prisma.organization.update({
      where: { id: organization.id },
      data: { subscription: organization.subscription }
    });

    console.log('✅ Plan update completed:', {
      organizationId: organization._id,
      organizationName: organization.name,
      updatedPlan: organization.subscription.plan,
      memberLimit: organization.subscription.memberLimit
    });

    res.json({
      msg: 'Plan upgraded successfully',
      organization
    });
  } catch (err) {
    console.error('Error upgrading plan:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   GET /api/admin/dashboard/stats
// @desc    Get dashboard statistics
// @access  Private (Admin)
router.get('/dashboard/stats', adminAuth, async (req, res) => {
  try {
    const totalUsers = await prisma.user.count();
    const totalOrganizations = await prisma.organization.count();
    const activeOrganizations = await prisma.organization.count({
      where: { subscription: { path: ['licenseStatus'], equals: 'active' } }
    });

    // Count by plan — group by Json subscription.plan in JS (Prisma can't groupBy a Json path).
    const orgSubscriptions = await prisma.organization.findMany({ select: { subscription: true } });
    const planCountMap = new Map();
    for (const org of orgSubscriptions) {
      const planKey = (org.subscription && org.subscription.plan) || null;
      planCountMap.set(planKey, (planCountMap.get(planKey) || 0) + 1);
    }
    const planCounts = Array.from(planCountMap.entries()).map(([_id, count]) => ({ _id, count }));

    // Recent signups (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentUsers = await prisma.user.count({
      where: { createdAt: { gte: thirtyDaysAgo } }
    });

    const recentOrganizations = await prisma.organization.count({
      where: { createdAt: { gte: thirtyDaysAgo } }
    });

    res.json({
      totalUsers,
      totalOrganizations,
      activeOrganizations,
      planDistribution: planCounts,
      recentSignups: {
        users: recentUsers,
        organizations: recentOrganizations
      }
    });
  } catch (err) {
    console.error('Error fetching dashboard stats:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   POST /api/admin/organizations/:id/suspend
// @desc    Suspend an organization
// @access  Private (Super Admin)
router.post('/organizations/:id/suspend', adminAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { reason } = req.body;

    const organization = await prisma.organization.findUnique({ where: { id: req.params.id } });

    if (!organization) {
      return res.status(404).json({ msg: 'Organization not found' });
    }

    // subscription is a Json column — mutate a local copy, then persist.
    organization.subscription = organization.subscription || {};
    if (!Array.isArray(organization.subscription.adminNotes)) organization.subscription.adminNotes = [];

    organization.subscription.licenseStatus = 'suspended';
    organization.isActive = false;

    // Add admin note
    organization.subscription.adminNotes.push({
      note: `Organization suspended. Reason: ${reason}`,
      addedBy: req.admin.id
    });

    await prisma.organization.update({
      where: { id: organization.id },
      data: { subscription: organization.subscription, isActive: false }
    });

    res.json({
      msg: 'Organization suspended successfully',
      organization
    });
  } catch (err) {
    console.error('Error suspending organization:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   POST /api/admin/organizations/:id/activate
// @desc    Activate an organization
// @access  Private (Admin with manageLicenses permission)
router.post('/organizations/:id/activate', adminAuth, requirePermission('manageLicenses'), async (req, res) => {
  try {
    const organization = await prisma.organization.findUnique({ where: { id: req.params.id } });

    if (!organization) {
      return res.status(404).json({ msg: 'Organization not found' });
    }

    // subscription is a Json column — mutate a local copy, then persist.
    organization.subscription = organization.subscription || {};
    if (!Array.isArray(organization.subscription.adminNotes)) organization.subscription.adminNotes = [];

    organization.subscription.licenseStatus = 'active';
    organization.isActive = true;

    // Add admin note
    organization.subscription.adminNotes.push({
      note: 'Organization activated',
      addedBy: req.admin.id
    });

    await prisma.organization.update({
      where: { id: organization.id },
      data: { subscription: organization.subscription, isActive: true }
    });

    res.json({
      msg: 'Organization activated successfully',
      organization
    });
  } catch (err) {
    console.error('Error activating organization:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   PUT /api/admin/organizations/:id/credits
// @desc    Adjust organization credits (add or remove)
// @access  Private (Admin with manageLicenses permission)
const organizationController = require('../controllers/organizationController');
router.put('/organizations/:id/credits',
  adminAuth,
  requirePermission('manageLicenses'),
  organizationController.adjustOrganizationCredits
);

// ===============================
// ADMIN MANAGEMENT ROUTES
// ===============================

// @route   GET /api/admin/admins
// @desc    Get all admin users
// @access  Private (Super Admin only)
router.get('/admins', adminAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;

    // Build query
    const where = {};

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Execute query with pagination
    const admins = await prisma.admin.findMany({
      where,
      select: ADMIN_PUBLIC_SELECT,
      take: parseInt(limit) * 1,
      skip: (parseInt(page) - 1) * parseInt(limit),
      orderBy: { createdAt: 'desc' }
    });

    // Get total count
    const count = await prisma.admin.count({ where });

    res.json({
      admins,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      totalAdmins: count
    });
  } catch (err) {
    console.error('Error fetching admins:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   POST /api/admin/admins
// @desc    Create a new admin user
// @access  Private (Super Admin only)
router.post('/admins', adminAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { email, password, name, role, permissions } = req.body;

    // Validate input
    if (!email || !password || !name || !role) {
      return res.status(400).json({ msg: 'Please provide email, password, name, and role' });
    }

    // Validate role
    const validRoles = ['super_admin', 'admin', 'support'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ msg: 'Invalid role. Must be super_admin, admin, or support' });
    }

    // Check if admin already exists
    const existingAdmin = await prisma.admin.findFirst({ where: { email: email.toLowerCase() } });
    if (existingAdmin) {
      return res.status(400).json({ msg: 'Admin with this email already exists' });
    }

    // Set default permissions based on role
    let adminPermissions = permissions || {};
    if (role === 'super_admin') {
      // Super admin gets all permissions automatically
      adminPermissions = { manageUsers: true, manageOrganizations: true, manageLicenses: true, manageBilling: true, viewAnalytics: true, systemSettings: true };
    } else if (role === 'admin') {
      adminPermissions = {
        manageUsers: adminPermissions.manageUsers !== undefined ? adminPermissions.manageUsers : true,
        manageOrganizations: adminPermissions.manageOrganizations !== undefined ? adminPermissions.manageOrganizations : true,
        manageLicenses: adminPermissions.manageLicenses !== undefined ? adminPermissions.manageLicenses : true,
        manageBilling: adminPermissions.manageBilling !== undefined ? adminPermissions.manageBilling : false,
        viewAnalytics: adminPermissions.viewAnalytics !== undefined ? adminPermissions.viewAnalytics : true,
        systemSettings: adminPermissions.systemSettings !== undefined ? adminPermissions.systemSettings : false
      };
    } else if (role === 'support') {
      adminPermissions = {
        manageUsers: adminPermissions.manageUsers !== undefined ? adminPermissions.manageUsers : false,
        manageOrganizations: adminPermissions.manageOrganizations !== undefined ? adminPermissions.manageOrganizations : false,
        manageLicenses: adminPermissions.manageLicenses !== undefined ? adminPermissions.manageLicenses : false,
        manageBilling: adminPermissions.manageBilling !== undefined ? adminPermissions.manageBilling : false,
        viewAnalytics: adminPermissions.viewAnalytics !== undefined ? adminPermissions.viewAnalytics : true,
        systemSettings: adminPermissions.systemSettings !== undefined ? adminPermissions.systemSettings : false
      };
    }

    // Create new admin (hash password — was done by pre-save middleware)
    const hashedPassword = await bcrypt.hash(password, await bcrypt.genSalt(10));
    const newAdmin = await prisma.admin.create({
      data: {
        email: email.toLowerCase(),
        password: hashedPassword,
        name,
        role,
        permissions: adminPermissions
      }
    });

    // Send welcome/invite email with the password via Brevo
    try {
      await emailService.sendAdminInviteWithPassword(
        email,
        name,
        email,
        password
      );
      console.log('✅ Admin invite email queued to Brevo for', email);
    } catch (inviteErr) {
      console.error('❌ Failed to send admin invite email:', inviteErr?.message || inviteErr);
      // Do not fail creation if email sending fails
    }

    // Return admin without password
    const adminResponse = await prisma.admin.findUnique({
      where: { id: newAdmin.id },
      select: ADMIN_PUBLIC_SELECT
    });

    res.status(201).json({
      msg: 'Admin created successfully',
      admin: adminResponse
    });
  } catch (err) {
    console.error('Error creating admin:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   PUT /api/admin/admins/:id
// @desc    Update an admin user
// @access  Private (Super Admin only)
router.put('/admins/:id', adminAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { name, role, permissions, isActive } = req.body;

    const admin = await prisma.admin.findUnique({ where: { id: req.params.id } });
    if (!admin) {
      return res.status(404).json({ msg: 'Admin not found' });
    }

    const updateData = {};

    // Validate role if provided
    if (role) {
      const validRoles = ['super_admin', 'admin', 'support'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ msg: 'Invalid role. Must be super_admin, admin, or support' });
      }
      updateData.role = role;
    }

    // Update fields
    if (name) updateData.name = name;
    if (permissions) updateData.permissions = { ...admin.permissions, ...permissions };
    if (typeof isActive === 'boolean') updateData.isActive = isActive;

    await prisma.admin.update({ where: { id: admin.id }, data: updateData });

    // Return admin without password
    const adminResponse = await prisma.admin.findUnique({
      where: { id: admin.id },
      select: ADMIN_PUBLIC_SELECT
    });

    res.json({
      msg: 'Admin updated successfully',
      admin: adminResponse
    });
  } catch (err) {
    console.error('Error updating admin:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   DELETE /api/admin/admins/:id
// @desc    Delete an admin user (hard delete)
// @access  Private (Super Admin only)
router.delete('/admins/:id', adminAuth, requireSuperAdmin, async (req, res) => {
  try {
    const admin = await prisma.admin.findUnique({ where: { id: req.params.id } });
    if (!admin) {
      return res.status(404).json({ msg: 'Admin not found' });
    }

    // Prevent self-deletion
    if (admin.id.toString() === req.admin.id) {
      return res.status(400).json({ msg: 'Cannot delete your own admin account' });
    }

    // Hard delete
    await prisma.admin.delete({ where: { id: admin.id } });

    res.json({ msg: 'Admin deleted successfully' });
  } catch (err) {
    console.error('Error deleting admin:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   POST /api/admin/admins/:id/reset-password
// @desc    Reset admin password
// @access  Private (Super Admin only)
router.post('/admins/:id/reset-password', adminAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ msg: 'Password must be at least 8 characters long' });
    }

    const admin = await prisma.admin.findUnique({ where: { id: req.params.id } });
    if (!admin) {
      return res.status(404).json({ msg: 'Admin not found' });
    }

    // Allow password reset for all admins (super admin can reset any password)

    // Update password (hashing was done by pre-save middleware)
    const hashedPassword = await bcrypt.hash(newPassword, await bcrypt.genSalt(10));
    await prisma.admin.update({
      where: { id: admin.id },
      data: { password: hashedPassword, loginAttempts: 0, lockUntil: null }
    });

    res.json({ msg: 'Password reset successfully' });
  } catch (err) {
    console.error('Error resetting password:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ===============================
// USER PLAN MANAGEMENT ROUTES
// ===============================

// User plans have been removed - users can create unlimited organizations
// This route is no longer needed

// @route   DELETE /api/admin/users/:userId
// @desc    Remove a user completely from the system
// @access  Private (Admin with manageUsers permission)
router.delete('/users/:userId', adminAuth, requirePermission('manageUsers'), async (req, res) => {
  try {
    // Use the controller function to handle user removal
    const adminUserController = require('../controllers/adminUserController');
    await adminUserController.removeUserById(req, res);
  } catch (err) {
    console.error('Error in admin user removal route:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   GET /api/admin/users/:id
// @desc    Get detailed user information
// @access  Private (Admin with manageUsers permission)
router.get('/users/:id', adminAuth, requirePermission('manageUsers'), async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        ...USER_PUBLIC_SELECT,
        currentOrganization: { select: { id: true, name: true, subscription: true } },
        memberships: {
          include: { organization: { select: { id: true, name: true, subscription: true } } }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    // Preserve legacy shape: organizationMemberships[].organization; map status->isActive.
    const { memberships, ...userRest } = user;
    const organizationMemberships = (memberships || []).map((m) => ({
      ...m,
      isActive: m.status === 'active',
      organization: m.organization
    }));

    // Count owned organizations for display only (no limits)
    const ownedOrgsCount = organizationMemberships.filter(
      m => m.role === 'owner' && m.isActive
    ).length;

    res.json({
      ...userRest,
      organizationMemberships,
      organizationStats: {
        currentOwnedOrganizations: ownedOrgsCount,
        canCreateMore: true, // Always true now
        maxOrganizations: 'unlimited'
      }
    });
  } catch (err) {
    console.error('Error fetching user details:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Import credit pack controller
const adminCreditPackController = require('../controllers/adminCreditPackController');

// ========== CREDIT PACK MANAGEMENT ==========

// Get all credit packs (admin)
router.get('/credit-packs', adminAuth, adminCreditPackController.getAllCreditPacks);

// Create a new credit pack
router.post('/credit-packs', adminAuth, requirePermission('manageBilling'), adminCreditPackController.createCreditPack);

// Update a credit pack
router.put('/credit-packs/:id', adminAuth, requirePermission('manageBilling'), adminCreditPackController.updateCreditPack);

// Delete a credit pack
router.delete('/credit-packs/:id', adminAuth, requirePermission('manageBilling'), adminCreditPackController.deleteCreditPack);

// ========== CREDIT PURCHASE REQUEST MANAGEMENT ==========

// Get all credit purchase requests
router.get('/credit-purchase-requests', adminAuth, adminCreditPackController.getAllPurchaseRequests);

// Approve a credit purchase request
router.put('/credit-purchase-requests/:requestId/approve', adminAuth, requirePermission('manageBilling'), adminCreditPackController.approvePurchaseRequest);

// Reject a credit purchase request
router.put('/credit-purchase-requests/:requestId/reject', adminAuth, requirePermission('manageBilling'), adminCreditPackController.rejectPurchaseRequest);

module.exports = router;

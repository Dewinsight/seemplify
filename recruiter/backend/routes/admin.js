const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const User = require('../models/User');
const Organization = require('../models/Organization');
const { adminAuth, requirePermission, requireSuperAdmin } = require('../middleware/adminAuth');
const crypto = require('crypto');
const emailService = require('../services/emailService');
const {
  consumeIdpAdminSsoToken,
  upsertAdminFromIdpIdentity,
  verifyIdpAdminSsoToken
} = require('../services/idpAdminSsoService');

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
    const admin = await Admin.findOne({ email: email.toLowerCase() });

    if (!admin) {
      return res.status(401).json({ msg: 'Invalid credentials' });
    }

    // Check if account is locked
    if (admin.isLocked) {
      return res.status(423).json({
        msg: 'Account is locked due to too many failed login attempts. Please try again later.'
      });
    }

    // Check password
    const isMatch = await admin.comparePassword(password);

    if (!isMatch) {
      await admin.incLoginAttempts();
      return res.status(401).json({ msg: 'Invalid credentials' });
    }

    // Reset login attempts on successful login
    await admin.resetLoginAttempts();

    res.json(buildAdminAuthResponse(admin));
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   POST /api/admin/auth/idp-exchange
// @desc    Exchange an IDP admin SSO token for a recruiter admin token
// @access  Public
router.post('/auth/idp-exchange', async (req, res) => {
  try {
    const { token } = req.body || {};

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ msg: 'IDP admin SSO token is required' });
    }

    const identity = verifyIdpAdminSsoToken(token);
    consumeIdpAdminSsoToken(identity.jti, identity.exp);

    const admin = await upsertAdminFromIdpIdentity(identity);
    res.json(buildAdminAuthResponse(admin));
  } catch (err) {
    console.error('IDP admin SSO exchange error:', err);

    if (err.code === 'IDP_ADMIN_SSO_NOT_CONFIGURED') {
      return res.status(500).json({ msg: 'Admin SSO is not configured' });
    }

    if (err.code === 'INVALID_IDP_ADMIN_SSO_TOKEN' || err.code === 'IDP_ADMIN_SSO_TOKEN_REPLAYED') {
      return res.status(401).json({ msg: err.message });
    }

    if (err.code === 'IDP_ADMIN_LINK_MISMATCH') {
      return res.status(409).json({ msg: err.message });
    }

    res.status(500).json({ msg: 'Failed to exchange IDP admin SSO token' });
  }
});

// @route   GET /api/admin/auth/me
// @desc    Get current admin
// @access  Private (Admin)
router.get('/auth/me', adminAuth, async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin.id).select('-password');
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
    const admin = await Admin.findOne({ email: email.toLowerCase() });

    if (!admin) {
      // Don't reveal if admin exists or not for security
      return res.json({ msg: 'If an admin account with that email exists, an OTP has been sent.' });
    }

    if (!admin.isActive) {
      return res.status(400).json({ msg: 'Admin account is deactivated' });
    }

    // Generate OTP
    const otp = admin.generateResetOTP();
    await admin.save();

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

    const admin = await Admin.findOne({ email: email.toLowerCase() });

    if (!admin) {
      return res.status(400).json({ msg: 'Invalid request' });
    }

    // Verify OTP
    const verification = admin.verifyResetOTP(otp);

    if (!verification.valid) {
      await admin.save(); // Save updated attempt count
      return res.status(400).json({ msg: verification.reason });
    }

    // Generate temporary token for password reset
    const resetToken = crypto.randomBytes(32).toString('hex');
    admin.resetPasswordOTP = resetToken; // Reuse field for reset token
    admin.resetPasswordOTPExpires = Date.now() + 15 * 60 * 1000; // 15 minutes
    await admin.save();

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

    const admin = await Admin.findOne({
      email: email.toLowerCase(),
      resetPasswordOTP: resetToken,
      resetPasswordOTPExpires: { $gt: Date.now() }
    });

    if (!admin) {
      return res.status(400).json({ msg: 'Invalid or expired reset token' });
    }

    // Update password (will be hashed by pre-save middleware)
    admin.password = newPassword;
    admin.clearResetOTP();
    admin.loginAttempts = 0;
    admin.lockUntil = undefined;

    await admin.save();

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
    let query = {};

    if (search) {
      query.$or = [
        { email: { $regex: search, $options: 'i' } },
        { 'profile.firstName': { $regex: search, $options: 'i' } },
        { 'profile.lastName': { $regex: search, $options: 'i' } },
        { 'company.name': { $regex: search, $options: 'i' } }
      ];
    }

    if (organizationId) {
      query['organizationMemberships.organization'] = organizationId;
    }

    // Execute query with pagination
    const users = await User.find(query)
      .populate('currentOrganization', 'name')
      .populate('organizationMemberships.organization', 'name subscription.plan')
      .select('-password')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });

    // Get total count
    const count = await User.countDocuments(query);

    res.json({
      users,
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
    const idpService = require('../services/idpService');

    // Step 1: Fetch all organizations from IdP
    const idpOrgsResult = await idpService.getAllOrganizations({ search });
    const idpOrganizations = idpOrgsResult.organizations || [];

    console.log(`📥 Fetched ${idpOrganizations.length} organizations from IdP`);

    // Step 2: Get existing local organizations
    const existingLocalOrgs = await Organization.find({
      idpOrganizationId: { $in: idpOrganizations.map(o => o.id) }
    });
    const existingIdpIds = new Set(existingLocalOrgs.map(o => o.idpOrganizationId));

    // Step 3: Create local records for new IdP organizations
    const newIdpOrgs = idpOrganizations.filter(o => !existingIdpIds.has(o.id));

    if (newIdpOrgs.length > 0) {
      console.log(`🔄 Creating ${newIdpOrgs.length} new local organizations from IdP`);

      for (const idpOrg of newIdpOrgs) {
        try {
          const newOrg = new Organization({
            name: idpOrg.name,
            description: idpOrg.description || '',
            idpOrganizationId: idpOrg.id,
            subscription: {
              plan: 'free', // Default plan
              memberLimit: 5,
              licenseStatus: 'active',
              licenseStartDate: new Date(),
              creditUsage: {
                totalCredits: 100,
                usedCredits: 0,
                remainingCredits: 100,
                currentCycleStart: new Date(),
                currentCycleEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                transactions: [],
                rolloverCredits: 0,
                creditPurchases: [],
                lowCreditWarning: { enabled: true, threshold: 20 }
              },
              adminNotes: [{
                note: 'Auto-created from IdP sync',
                addedAt: new Date()
              }]
            },
            isActive: true,
            createdAt: idpOrg.createdAt || new Date()
          });
          await newOrg.save();
          console.log(`✅ Created local org for IdP org: ${idpOrg.name}`);
        } catch (createErr) {
          console.error(`❌ Failed to create local org for ${idpOrg.name}:`, createErr.message);
        }
      }
    }

    // Step 4: Build query for local organizations with filters
    // Only show IdP-linked organizations (filter out legacy orgs without idpOrganizationId)
    let query = {
      idpOrganizationId: { $exists: true, $ne: null }
    };

    if (search) {
      query.$and = [
        { idpOrganizationId: { $exists: true, $ne: null } },
        {
          $or: [
            { name: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } }
          ]
        }
      ];
      delete query.idpOrganizationId; // Remove duplicate filter when using $and
    }

    if (plan) {
      query['subscription.plan'] = plan;
    }

    if (status) {
      query['subscription.licenseStatus'] = status;
    }

    // Step 5: Execute query with pagination
    const organizations = await Organization.find(query)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });

    const count = await Organization.countDocuments(query);

    // Step 6: Merge with IdP data for member counts
    const orgsWithStats = organizations.map(org => {
      const orgObj = org.toObject();

      // Find matching IdP org for member count
      const idpOrg = idpOrganizations.find(io => io.id === org.idpOrganizationId);

      if (org.idpOrganizationId) {
        orgObj.memberCount = idpOrg?.memberCount || 0;
        orgObj.isIdpManaged = true;
        orgObj.memberSource = 'idp';
      } else {
        orgObj.memberCount = org.members?.filter(m => m.status === 'active').length || 0;
        orgObj.isIdpManaged = false;
        orgObj.memberSource = 'local';
      }

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
      totalOrganizations: count,
      syncedFromIdp: newIdpOrgs.length
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
    const organization = await Organization.findById(req.params.id);

    if (!organization) {
      return res.status(404).json({ msg: 'Organization not found' });
    }

    const orgObj = organization.toObject();

    // If organization is linked to IdP, fetch members from IdP
    if (organization.idpOrganizationId) {
      try {
        const idpService = require('../services/idpService');
        // Note: Admin doesn't have user token, so we can't fetch detailed member data
        // We'll just mark it as IdP-managed and show basic info
        orgObj.memberCount = 0; // Placeholder - actual count should be fetched with proper auth
        orgObj.isIdpManaged = true;
        orgObj.memberSource = 'idp';
        orgObj.membersNote = 'Members managed by Identity Provider. Member count requires user authentication.';
      } catch (idpError) {
        console.warn('Could not fetch IdP data for org:', organization.name);
        orgObj.memberCount = 0;
        orgObj.isIdpManaged = true;
        orgObj.memberSource = 'idp';
      }
    } else {
      // Legacy organization - use local member data
      await organization.populate('owner', 'email profile.firstName profile.lastName');
      await organization.populate('members.user', 'email profile.firstName profile.lastName');
      orgObj.memberCount = organization.members?.filter(m => m.status === 'active').length || 0;
      orgObj.isIdpManaged = false;
      orgObj.memberSource = 'local';
    }

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
      generateNewKey
    } = req.body;

    const organization = await Organization.findById(req.params.id);

    if (!organization) {
      return res.status(404).json({ msg: 'Organization not found' });
    }

    // Validate plan if provided - only use database plans
    if (plan) {
      const Plan = require('../models/Plan');
      const planExists = await Plan.findOne({ code: plan }); // Only organization plans exist now

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

    // Generate new license key if requested
    if (generateNewKey) {
      organization.subscription.licenseKey = crypto.randomBytes(16).toString('hex').toUpperCase();
    }

    // Update license status
    organization.subscription.licenseStatus = 'active';
    organization.subscription.licenseStartDate = new Date();

    // Add admin note
    organization.subscription.adminNotes.push({
      note: `License updated: Plan ${plan}, Limits: ${memberLimit} members`,
      addedBy: req.admin.id
    });

    await organization.save();

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

    const organization = await Organization.findById(req.params.id);

    if (!organization) {
      return res.status(404).json({ msg: 'Organization not found' });
    }

    // Validate plan - only use database plans
    const Plan = require('../models/Plan');
    const planExists = await Plan.findOne({ code: plan }); // Only organization plans exist now

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

    await organization.save();

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
    const totalUsers = await User.countDocuments();
    const totalOrganizations = await Organization.countDocuments();
    const activeOrganizations = await Organization.countDocuments({ 'subscription.licenseStatus': 'active' });

    // Count by plan
    const planCounts = await Organization.aggregate([
      { $group: { _id: '$subscription.plan', count: { $sum: 1 } } }
    ]);

    // Recent signups (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentUsers = await User.countDocuments({
      createdAt: { $gte: thirtyDaysAgo }
    });

    const recentOrganizations = await Organization.countDocuments({
      createdAt: { $gte: thirtyDaysAgo }
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

    const organization = await Organization.findById(req.params.id);

    if (!organization) {
      return res.status(404).json({ msg: 'Organization not found' });
    }

    organization.subscription.licenseStatus = 'suspended';
    organization.isActive = false;

    // Add admin note
    organization.subscription.adminNotes.push({
      note: `Organization suspended. Reason: ${reason}`,
      addedBy: req.admin.id
    });

    await organization.save();

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
    const organization = await Organization.findById(req.params.id);

    if (!organization) {
      return res.status(404).json({ msg: 'Organization not found' });
    }

    organization.subscription.licenseStatus = 'active';
    organization.isActive = true;

    // Add admin note
    organization.subscription.adminNotes.push({
      note: 'Organization activated',
      addedBy: req.admin.id
    });

    await organization.save();

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
    let query = {};

    if (search) {
      query.$or = [
        { email: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } }
      ];
    }

    // Execute query with pagination
    const admins = await Admin.find(query)
      .select('-password')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });

    // Get total count
    const count = await Admin.countDocuments(query);

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
    const existingAdmin = await Admin.findOne({ email: email.toLowerCase() });
    if (existingAdmin) {
      return res.status(400).json({ msg: 'Admin with this email already exists' });
    }

    // Set default permissions based on role
    let adminPermissions = permissions || {};
    if (role === 'super_admin') {
      // Super admin gets all permissions automatically
      adminPermissions = Admin.getSuperAdminPermissions();
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

    // Create new admin
    const newAdmin = new Admin({
      email: email.toLowerCase(),
      password, // Will be hashed by the pre-save middleware
      name,
      role,
      permissions: adminPermissions
    });

    await newAdmin.save();

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
    const adminResponse = await Admin.findById(newAdmin._id).select('-password');

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

    const admin = await Admin.findById(req.params.id);
    if (!admin) {
      return res.status(404).json({ msg: 'Admin not found' });
    }

    // Validate role if provided
    if (role) {
      const validRoles = ['super_admin', 'admin', 'support'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ msg: 'Invalid role. Must be super_admin, admin, or support' });
      }
      admin.role = role;
    }

    // Update fields
    if (name) admin.name = name;
    if (permissions) admin.permissions = { ...admin.permissions, ...permissions };
    if (typeof isActive === 'boolean') admin.isActive = isActive;

    await admin.save();

    // Return admin without password
    const adminResponse = await Admin.findById(admin._id).select('-password');

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
    const admin = await Admin.findById(req.params.id);
    if (!admin) {
      return res.status(404).json({ msg: 'Admin not found' });
    }

    // Prevent self-deletion
    if (admin._id.toString() === req.admin.id) {
      return res.status(400).json({ msg: 'Cannot delete your own admin account' });
    }

    // Hard delete
    await Admin.deleteOne({ _id: admin._id });

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

    const admin = await Admin.findById(req.params.id);
    if (!admin) {
      return res.status(404).json({ msg: 'Admin not found' });
    }

    // Allow password reset for all admins (super admin can reset any password)

    // Update password (will be hashed by pre-save middleware)
    admin.password = newPassword;
    admin.loginAttempts = 0;
    admin.lockUntil = undefined;

    await admin.save();

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
    const user = await User.findById(req.params.id)
      .populate('currentOrganization', 'name subscription.plan')
      .populate('organizationMemberships.organization', 'name subscription.plan')
      .select('-password');

    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    // Count owned organizations for display only (no limits)
    const ownedOrgsCount = user.organizationMemberships.filter(
      m => m.role === 'owner' && m.isActive
    ).length;

    res.json({
      ...user.toObject(),
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

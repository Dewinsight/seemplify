const Organization = require('../models/Organization');
const OrganizationInvite = require('../models/OrganizationInvite');
const User = require('../models/User');
const Notification = require('../models/Notification');
const crypto = require('crypto');
const emailService = require('../services/emailService');
const planService = require('../services/planService');
const idpService = require('../services/idpService');

// Create organization - REQUIRES IdP as the source of truth
exports.createOrganization = async (req, res) => {
  try {
    const { name, description, industry, size, website } = req.body;
    const userId = req.user.id;

    console.log('🏢 Creating organization for user:', userId);
    console.log('📝 Organization data:', { name, description, industry, size, website });

    // Clean up empty strings to avoid validation errors
    const cleanData = {
      name: name?.trim(),
      description: description?.trim() || undefined,
      industry: industry?.trim() || undefined,
      size: size?.trim() || undefined,
      website: website?.trim() || undefined
    };

    console.log('🧹 Cleaned organization data:', cleanData);

    // Get user to check IdP token and existing organizations
    const user = await User.findById(userId).select('+idpAccessToken +idpRefreshToken +idpTokenExpiry');
    if (!user) {
      console.log('❌ User not found:', userId);
      return res.status(404).json({ msg: 'User not found' });
    }

    console.log('👤 User found:', user.email);

    // Check if user has IdP token - REQUIRED for organization creation
    if (!user.idpAccessToken) {
      console.log('❌ No IdP token - redirecting to IdP for organization creation');
      return res.status(410).json({
        msg: 'Organization creation is managed through the Identity Provider. Please create your organization there.',
        code: 'idp_managed',
        redirectUrl: idpService.getIdpManagementUrl(null, 'organizations'),
        action: 'create_organization'
      });
    }

    // CRITICAL: Create organization in IdP first - IdP is the source of truth
    let idpOrganizationId = null;
    let idpOrg = null;
    try {
      console.log('🌐 Creating organization in Identity Provider (REQUIRED)...');
      idpOrg = await idpService.createOrganization({ name: cleanData.name }, userId);
      idpOrganizationId = idpOrg.id || idpOrg._id;
      console.log('✅ Organization created in IdP:', idpOrganizationId);
    } catch (idpError) {
      // IdP creation failed - DO NOT create locally, return error
      console.error('❌ IdP organization creation FAILED:', idpError.message);

      // Check if it's an authentication issue
      if (idpError.message?.includes('re-authenticate') || idpError.message?.includes('token')) {
        return res.status(401).json({
          msg: 'Your Identity Provider session has expired. Please log in again.',
          code: 'idp_auth_required',
          redirectUrl: idpService.getIdpManagementUrl(null, 'organizations')
        });
      }

      // IdP unavailable - user should create org directly in IdP
      return res.status(503).json({
        msg: 'Organization creation requires the Identity Provider. Please try again or create your organization directly in the IdP.',
        code: 'idp_required',
        redirectUrl: idpService.getIdpManagementUrl(null, 'organizations'),
        error: idpError.message
      });
    }

    // IdP creation successful - now create local shell record for SmartHR-specific data
    const organization = new Organization({
      name: cleanData.name,
      description: cleanData.description,
      industry: cleanData.industry,
      size: cleanData.size,
      website: cleanData.website,
      owner: userId,
      idpOrganizationId: idpOrganizationId, // REQUIRED link to IdP
      members: [{
        user: userId,
        role: 'owner',
        status: 'active'
      }],
      subscription: {
        plan: 'free'  // Assign Free plan by default
      }
    });

    console.log('💾 Saving local organization shell...');
    await organization.save();

    // Initialize credits from the free plan
    console.log('💳 Initializing credits from free plan...');
    const Plan = require('../models/Plan');
    const freePlan = await Plan.findOne({ code: 'free' });

    if (freePlan && freePlan.credits && freePlan.credits.totalCredits > 0) {
      const creditsToGrant = freePlan.credits.totalCredits;

      organization.subscription.creditUsage = {
        totalCredits: creditsToGrant,
        usedCredits: 0,
        remainingCredits: creditsToGrant,
        currentCycleStart: new Date(),
        currentCycleEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        transactions: [{
          action: 'cycleReset',  // Using cycleReset for initial credit grant
          credits: creditsToGrant,
          entityType: 'system',
          timestamp: new Date(),
          balanceAfter: creditsToGrant,
          metadata: {
            reason: 'Initial migration to credits system',
            planCode: 'free',
            planName: freePlan.name,
            description: `Initial credit grant: ${creditsToGrant} credits from ${freePlan.name} plan`
          }
        }],
        rolloverCredits: 0,
        creditPurchases: [],
        lowCreditWarning: {
          enabled: true,
          threshold: 20
        }
      };

      await organization.save();
      console.log(`✅ Granted ${creditsToGrant} initial credits from free plan to organization "${organization.name}"`);
    } else {
      console.warn(`⚠️ Free plan not found or has no credits configured. Organization created without initial credits.`);
    }

    // Update user's organization membership
    console.log('👤 Updating user organization membership...');
    user.addOrganizationMembership(organization._id, 'owner');
    await user.save();

    console.log('✅ Organization created successfully (IdP + local):', organization.name);

    // Return organization with user's role for consistent frontend handling
    const organizationWithRole = {
      ...organization.toObject(),
      idpOrganizationId: idpOrganizationId,
      userRole: 'owner', // The creator is always the owner
      joinedAt: new Date(),
      memberCount: 1
    };

    res.status(201).json(organizationWithRole);
  } catch (error) {
    console.error('❌ Error creating organization:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ msg: 'Server error', error: error.message });
  }
};

// Get user's organizations
// Get user's organizations - ONLY from Identity Provider (IdP is source of truth)
exports.getUserOrganizations = async (req, res) => {
  try {
    const userId = req.user.id;

    console.log('🌐 Fetching organizations from Identity Provider for user:', userId);

    // CRITICAL: Organizations ONLY come from IdP - NO local fallback
    try {
      // Get user to access IdP token
      const user = await User.findById(userId).select('+idpAccessToken +idpTokenExpiry +idpRefreshToken');

      if (!user) {
        return res.status(404).json({ msg: 'User not found' });
      }

      if (!user.idpAccessToken) {
        console.error('❌ No IdP access token for user:', user.email);
        return res.status(401).json({
          msg: 'Not authenticated with Identity Provider. Please log in again.',
          code: 'idp_token_missing'
        });
      }

      // Get organizations from IdP API
      const idpOrganizations = await idpService.executeWithTokenRefresh(userId, async (client) => {
        const response = await client.get('/api/organizations');
        return response.data;
      });

      console.log('✅ IdP returned', idpOrganizations.length, 'organizations');

      // Transform IdP organizations to SmartHR format
      // Find or create local records for plan/subscription data
      const localOrgs = await Organization.find({
        idpOrganizationId: { $in: idpOrganizations.map(o => o.id) }
      });

      const organizations = [];

      for (const idpOrg of idpOrganizations) {
        // Find local SmartHR org (for plan data)
        let localOrg = localOrgs.find(lo => lo.idpOrganizationId === idpOrg.id);

        // Create local shell organization if it doesn't exist
        if (!localOrg) {
          console.log('📝 Creating local shell organization for IdP org:', idpOrg.name);
          localOrg = new Organization({
            name: idpOrg.name,
            description: idpOrg.description,
            idpOrganizationId: idpOrg.id,
            owner: userId,
            members: [{
              user: userId,
              role: idpOrg.role,
              status: 'active',
              joinedAt: idpOrg.joinedAt || new Date()
            }],
            subscription: {
              plan: 'free' // Default plan for new organizations
            }
          });
          await localOrg.save();
          console.log('✅ Created local shell org:', localOrg._id);
        }

        organizations.push({
          _id: localOrg._id, // Always use local MongoDB ID
          idpOrganizationId: idpOrg.id,
          name: idpOrg.name,
          description: idpOrg.description,
          userRole: idpOrg.role,
          joinedAt: idpOrg.joinedAt,
          memberCount: idpOrg.memberCount,
          isCurrentOrganization: idpOrg.isCurrentOrganization,
          // SmartHR-specific data from local record
          subscription: localOrg.subscription || { plan: 'free' },
          settings: localOrg.settings || {}
        });
      }

      // Check if user needs organization setup - redirect to IdP
      if (organizations.length === 0) {
        const idpUrl = process.env.IDP_HUB_URL || process.env.OIDC_ISSUER || 'http://localhost:4000';
        return res.status(400).json({
          msg: 'Organization required. Please create or join an organization in the Identity Provider.',
          requiresOrganizationSetup: true,
          organizations: [],
          redirectUrl: `${idpUrl}/organizations`
        });
      }

      console.log('✅ Returning', organizations.length, 'organizations from IdP');
      res.json(organizations);

    } catch (idpError) {
      console.error('❌ Failed to fetch organizations from IdP:', idpError.message);

      // NO FALLBACK - If IdP fails, return error
      return res.status(503).json({
        msg: 'Identity Provider unavailable. Please try again later.',
        code: 'idp_unavailable',
        error: idpError.message
      });
    }

  } catch (error) {
    console.error('❌ Error in getUserOrganizations:', error);
    res.status(500).json({
      msg: 'Server error',
      error: error.message
    });
  }
};

// Get organization creation limits (now unlimited for all users)
exports.getOrganizationLimits = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    // Get current organization count for display purposes only
    const activeOwnerMemberships = user.organizationMemberships.filter(
      m => m.role === 'owner' && m.isActive
    );

    const activeOrganizations = await Organization.find({
      _id: { $in: activeOwnerMemberships.map(m => m.organization) },
      isActive: true
    });

    const currentCount = activeOrganizations.length;

    // All users can now create unlimited organizations
    res.json({
      maxOrganizations: 'unlimited',
      currentCount,
      canCreateMore: true,
      remainingSlots: 'unlimited'
    });
  } catch (error) {
    console.error('❌ Error getting organization limits:', error);
    res.status(500).json({ msg: 'Server error', error: error.message });
  }
};

// Switch current organization
// Switch current organization - verify membership via IdP
exports.switchOrganization = async (req, res) => {
  try {
    const { organizationId } = req.body;
    const userId = req.user.id;

    console.log('🔄 Switch organization request:', {
      userId,
      organizationId,
      currentOrg: req.user.currentOrganization
    });

    const user = await User.findById(userId).select('+idpAccessToken +idpTokenExpiry +idpRefreshToken');
    if (!user) {
      console.log('❌ User not found:', userId);
      return res.status(404).json({ msg: 'User not found' });
    }

    // CRITICAL: Verify membership via IdP, not local database
    try {
      console.log('🌐 Fetching organizations from IdP to verify membership...');

      // Get all user's organizations from IdP
      const idpOrganizations = await idpService.executeWithTokenRefresh(userId, async (client) => {
        const response = await client.get('/api/organizations');
        return response.data;
      });

      console.log('✅ IdP returned', idpOrganizations.length, 'organizations');

      // Find the local organization to get its IdP ID
      const localOrg = await Organization.findById(organizationId);
      if (!localOrg) {
        console.log('❌ Organization not found:', organizationId);
        return res.status(404).json({ msg: 'Organization not found' });
      }

      // Check if organization is not linked to IdP
      if (!localOrg.idpOrganizationId) {
        console.log('⚠️ Organization not linked to IdP:', localOrg.name);
        return res.status(400).json({
          msg: 'Organization not linked to Identity Provider',
          code: 'idp_not_linked'
        });
      }

      // Verify user is a member of this organization in IdP
      const idpOrg = idpOrganizations.find(org => org.id === localOrg.idpOrganizationId);
      if (!idpOrg) {
        console.log('❌ Access denied - user is not a member in IdP:', localOrg.idpOrganizationId);
        return res.status(403).json({ msg: 'Access denied to this organization' });
      }

      console.log('✅ User is member of organization in IdP, switching...');

      // Update user's current organization
      user.currentOrganization = organizationId;
      await user.save();

      console.log('✅ Organization switched successfully to:', localOrg.name);
      res.json({ msg: 'Organization switched successfully' });

    } catch (idpError) {
      console.error('❌ Failed to verify membership via IdP:', idpError.message);
      return res.status(503).json({
        msg: 'Identity Provider unavailable. Please try again later.',
        code: 'idp_unavailable',
        error: idpError.message
      });
    }

  } catch (error) {
    console.error('❌ Error switching organization:', error);
    res.status(500).json({ msg: 'Server error', error: error.message });
  }
};

// Invite user to organization
exports.inviteUser = async (req, res) => {
  try {
    const { email, role, appUrl } = req.body;
    const userId = req.user.id;
    const organizationId = req.user.currentOrganization;

    if (!organizationId) {
      return res.status(400).json({ msg: 'No current organization set' });
    }

    // Get organization first to check for IdP link
    const organization = await Organization.findById(organizationId);

    // If organization is linked to IdP, redirect to IdP for member management
    if (organization && organization.idpOrganizationId) {
      return res.status(410).json({
        msg: 'Member invitations are now managed through the Identity Provider',
        code: 'idp_managed',
        redirectUrl: idpService.getIdpManagementUrl(organization.idpOrganizationId, 'invitations'),
        idpOrganizationId: organization.idpOrganizationId
      });
    }

    // Check if user has permission to invite
    const user = await User.findById(userId);
    if (!user.hasOrganizationPermission(organizationId, 'manage_users')) {
      return res.status(403).json({ msg: 'Insufficient permissions' });
    }
    const activeMembers = organization.members.filter(m => m.status === 'active').length;
    const memberLimit = organization.subscription?.memberLimit || 5;

    // Check if organization has reached member limit
    if (memberLimit !== 'unlimited' && activeMembers >= memberLimit) {
      return res.status(400).json({
        msg: `Member limit reached. Your plan allows ${memberLimit} members and you currently have ${activeMembers} active members.`,
        limit: memberLimit,
        current: activeMembers
      });
    }

    // Check if user with this email is already a member
    const targetUser = await User.findOne({ email });
    if (targetUser) {
      const existingMember = organization.members.find(m =>
        m.user && m.user.toString() === targetUser._id.toString()
      );

      if (existingMember) {
        return res.status(400).json({ msg: 'User is already a member' });
      }
    }

    // Check for existing pending invite
    const existingInvite = await OrganizationInvite.findOne({
      organization: organizationId,
      email,
      status: 'pending',
      expiresAt: { $gt: new Date() } // Only check non-expired invites
    });

    if (existingInvite) {
      return res.status(400).json({ msg: 'Invite already sent' });
    }

    // Create invite
    const token = crypto.randomBytes(32).toString('hex');
    const invite = new OrganizationInvite({
      organization: organizationId,
      email,
      role,
      token,
      invitedBy: userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    });

    await invite.save();

    // Use app URL from frontend request (window.location.origin) or fallback
    const finalAppUrl = appUrl || process.env.FRONTEND_URL || 'https://smarthr.app';
    console.log('🌐 Using app URL for invitation:', finalAppUrl);
    // organization already fetched above on line 284
    const inviter = await User.findById(userId);

    // Check email service configuration before sending
    const emailConfig = emailService.checkConfiguration();
    console.log('📧 Email configuration check:', emailConfig);

    // Send invitation email with proper error handling
    let emailSent = false;
    let emailError = null;

    if (!emailConfig.isConfigured) {
      emailError = 'Email service is not configured - BREVO_API_KEY missing';
      console.error('❌ Cannot send email - service not configured');
    } else {
      try {
        await emailService.sendOrganizationInviteEmail(
          email,
          inviter.profile.displayName || inviter.profile.firstName || 'Someone',
          organization.name,
          finalAppUrl
        );
        emailSent = true;
        console.log(`✅ Invitation email sent successfully to: ${email}`);
      } catch (error) {
        emailError = error.message;
        console.error('❌ Failed to send invitation email:', error);
        console.error('Email error details:', {
          recipientEmail: email,
          organizationName: organization.name,
          inviterName: inviter.profile.displayName || inviter.profile.firstName || 'Someone',
          errorMessage: error.message,
          errorStack: error.stack
        });
        // Continue with the invitation process even if email fails
      }
    }

    // Create notification for the invited user (if they exist)
    const invitedUser = await User.findOne({ email });
    if (invitedUser) {
      try {
        await Notification.createOrganizationInviteNotification(invitedUser._id, {
          token: invite.token,
          organizationId: organization._id,
          organizationName: organization.name,
          role: invite.role,
          inviterName: inviter.profile.displayName || inviter.profile.firstName || 'Someone',
          inviterId: inviter._id,
          expiresAt: invite.expiresAt
        });
        console.log(`📧 Notification created for invited user: ${email}`);
      } catch (notificationError) {
        console.error('Failed to create notification for invited user:', notificationError);
        // Don't fail the invitation if notification creation fails
      }
    }

    // Return appropriate success message with detailed information
    const message = emailSent
      ? 'Invite sent successfully - email notification has been sent'
      : `Invite created successfully - however, the email notification could not be sent. ${emailError ? `Error: ${emailError}` : ''} Please contact the user directly.`;

    res.json({
      msg: message,
      emailSent: emailSent,
      emailError: emailError,
      inviteToken: invite.token, // Include token for manual sharing if needed
      inviteUrl: `${finalAppUrl}/accept-invite/${invite.token}` // Direct invite URL
    });
  } catch (error) {
    console.error('Error inviting user:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};

// Accept organization invite
exports.acceptInvite = async (req, res) => {
  try {
    const { token } = req.params;
    const userId = req.user.id;

    const invite = await OrganizationInvite.findOne({
      token,
      status: 'pending',
      expiresAt: { $gt: new Date() }
    }).populate('organization');

    if (!invite) {
      return res.status(404).json({ msg: 'Invalid or expired invite' });
    }

    // Check if user email matches invite
    const user = await User.findById(userId);
    if (user.email !== invite.email) {
      return res.status(403).json({ msg: 'This invite is not for your email address' });
    }

    // Get organization and check member limit before accepting
    const organization = await Organization.findById(invite.organization._id);
    const activeMembers = organization.members.filter(m => m.status === 'active').length;
    const memberLimit = organization.subscription?.memberLimit || 5;

    // Check if organization has reached member limit (in case limit changed after invite was sent)
    if (memberLimit !== 'unlimited' && activeMembers >= memberLimit) {
      // Mark invite as expired since org is at capacity
      invite.status = 'expired';
      await invite.save();

      return res.status(400).json({
        msg: `Cannot accept invite. The organization has reached its member limit of ${memberLimit} members.`,
        limit: memberLimit,
        current: activeMembers
      });
    }

    // Add user to organization
    organization.addMember(userId, invite.role, invite.invitedBy);
    await organization.save();

    // Update user's organization membership
    user.addOrganizationMembership(invite.organization._id, invite.role);

    // Set as current organization if user has no current organization
    // or if this is their first organization
    if (!user.currentOrganization || user.organizationMemberships.filter(m => m.isActive).length <= 1) {
      console.log(`🏢 Setting ${invite.organization.name} as current organization for user ${user.email}`);
      user.currentOrganization = invite.organization._id;
    }

    await user.save();

    // Mark invite as accepted
    invite.accept(userId);
    await invite.save();

    console.log('✅ Invitation accepted successfully:', {
      userId,
      organizationId: invite.organization._id,
      organizationName: invite.organization.name,
      role: invite.role,
      isNowCurrentOrg: user.currentOrganization?.toString() === invite.organization._id.toString()
    });

    res.json({
      msg: 'Invite accepted successfully',
      organization: invite.organization
    });
  } catch (error) {
    console.error('Error accepting invite:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};

// Get organization details
// Get current organization details - from IdP with local plan data
exports.getOrganization = async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    const userId = req.user.id;

    if (!organizationId) {
      return res.status(400).json({ msg: 'No current organization set' });
    }

    console.log('🌐 Fetching current organization from IdP:', organizationId);

    // Get local org to find IdP ID
    const localOrg = await Organization.findById(organizationId);
    if (!localOrg) {
      return res.status(404).json({ msg: 'Organization not found' });
    }

    // Organizations MUST be linked to IdP
    if (!localOrg.idpOrganizationId) {
      console.error('⚠️ Organization not linked to IdP:', localOrg.name);
      return res.status(400).json({
        msg: 'Organization not linked to Identity Provider. Please contact your administrator.',
        code: 'idp_not_linked'
      });
    }

    try {
      // Fetch organization details from IdP
      const idpOrg = await idpService.getOrganization(localOrg.idpOrganizationId, userId);

      console.log('✅ IdP returned organization:', idpOrg.name);

      // Merge IdP data with local plan data
      const organization = {
        _id: localOrg._id, // Local ID for compatibility
        idpOrganizationId: idpOrg.id,
        name: idpOrg.name,
        description: idpOrg.description,
        owner: idpOrg.owner,
        memberCount: idpOrg.memberCount,
        ownerCount: idpOrg.ownerCount,
        userRole: idpOrg.yourRole,
        // SmartHR-specific data from local record
        subscription: localOrg.subscription,
        settings: localOrg.settings,
        createdAt: idpOrg.createdAt
      };

      // Enhance with plan details
      const enhancedOrg = await planService.enhanceOrganizationWithPlan(organization);

      console.log('📤 Returning current organization:', {
        name: enhancedOrg.name,
        plan: enhancedOrg.subscription?.plan,
        memberCount: enhancedOrg.memberCount,
        userRole: enhancedOrg.userRole
      });

      res.json(enhancedOrg);

    } catch (idpError) {
      console.error('❌ Failed to fetch organization from IdP:', idpError.message);

      // NO FALLBACK - If IdP fails, return error
      return res.status(503).json({
        msg: 'Identity Provider unavailable. Please try again later.',
        code: 'idp_unavailable',
        error: idpError.message
      });
    }

  } catch (error) {
    console.error('Error fetching organization:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};

// Update organization
exports.updateOrganization = async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user.hasOrganizationPermission(organizationId, 'manage_users')) {
      return res.status(403).json({ msg: 'Insufficient permissions' });
    }

    const { name, description, industry, size, website, settings } = req.body;

    const organization = await Organization.findByIdAndUpdate(
      organizationId,
      {
        name,
        description,
        industry,
        size,
        website,
        settings,
        updatedAt: new Date()
      },
      { new: true }
    );

    res.json({
      msg: 'Organization updated successfully',
      organization
    });
  } catch (error) {
    console.error('Error updating organization:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};

// Delete organization
exports.deleteOrganization = async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    const userId = req.user.id;

    const organization = await Organization.findById(organizationId);
    if (!organization) {
      return res.status(404).json({ msg: 'Organization not found' });
    }

    // Only owner can delete
    if (organization.owner.toString() !== userId) {
      return res.status(403).json({ msg: 'Only organization owner can delete' });
    }

    // TODO: Handle data migration/cleanup for jobs, candidates, etc.

    await Organization.findByIdAndDelete(organizationId);

    // Remove organization from all users
    await User.updateMany(
      { 'organizationMemberships.organization': organizationId },
      {
        $pull: { organizationMemberships: { organization: organizationId } },
        $unset: { currentOrganization: 1 }
      }
    );

    res.json({ msg: 'Organization deleted successfully' });
  } catch (error) {
    console.error('Error deleting organization:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};

// Delete organization by ID
exports.deleteOrganizationById = async (req, res) => {
  try {
    const { organizationId } = req.params;
    const userId = req.user.id;

    console.log('🗑️ Deleting organization by ID:', organizationId, 'for user:', userId);

    const organization = await Organization.findById(organizationId);
    if (!organization) {
      console.log('❌ Organization not found:', organizationId);
      return res.status(404).json({ msg: 'Organization not found' });
    }

    console.log('🏢 Organization found:', organization.name);
    console.log('👤 Organization owner:', organization.owner);
    console.log('🔍 Requesting user:', userId);

    // Only owner can delete
    if (organization.owner.toString() !== userId) {
      console.log('❌ User is not the owner, access denied');
      return res.status(403).json({ msg: 'Only organization owner can delete' });
    }

    console.log('✅ User is owner, proceeding with deletion...');

    // Clean up all related data
    console.log('🧹 Starting cleanup of related data...');

    // Get all models that reference the organization
    const Job = require('../models/Job');
    const Candidate = require('../models/Candidate');
    const Interview = require('../models/Interview');
    const ChatSession = require('../models/ChatSession');
    const Session = require('../models/Session');

    // Count related data for logging
    const jobCount = await Job.countDocuments({ organization: organizationId });
    const candidateCount = await Candidate.countDocuments({ organization: organizationId });
    const interviewCount = await Interview.countDocuments({ organization: organizationId });
    const chatSessionCount = await ChatSession.countDocuments({ organization: organizationId });
    const sessionCount = await Session.countDocuments({ organization: organizationId });

    console.log('📊 Related data to delete:', {
      jobs: jobCount,
      candidates: candidateCount,
      interviews: interviewCount,
      chatSessions: chatSessionCount,
      sessions: sessionCount
    });

    // Delete all related data
    await Promise.all([
      Job.deleteMany({ organization: organizationId }),
      Candidate.deleteMany({ organization: organizationId }),
      Interview.deleteMany({ organization: organizationId }),
      ChatSession.deleteMany({ organization: organizationId }),
      Session.deleteMany({ organization: organizationId }),
      OrganizationInvite.deleteMany({ organization: organizationId })
    ]);

    console.log('✅ All related data cleaned up');

    // Finally delete the organization
    await Organization.findByIdAndDelete(organizationId);
    console.log('🗑️ Organization deleted from database');

    // Remove organization from all users
    const updateResult = await User.updateMany(
      { 'organizationMemberships.organization': organizationId },
      {
        $pull: { organizationMemberships: { organization: organizationId } },
        $unset: { currentOrganization: 1 }
      }
    );

    console.log('👥 Updated users:', updateResult.modifiedCount);

    res.json({ msg: 'Organization deleted successfully' });
  } catch (error) {
    console.error('❌ Error deleting organization by ID:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ msg: 'Server error', error: error.message });
  }
};

// Get invite details (for public access)
exports.getInviteDetails = async (req, res) => {
  try {
    const { token } = req.params;

    const invite = await OrganizationInvite.findOne({
      token,
      status: 'pending',
      expiresAt: { $gt: new Date() }
    }).populate('organization', 'name description')
      .populate('invitedBy', 'profile.firstName profile.lastName');

    if (!invite) {
      return res.status(404).json({ msg: 'Invalid or expired invite' });
    }

    res.json({
      email: invite.email,
      role: invite.role,
      organization: invite.organization,
      invitedBy: invite.invitedBy,
      expiresAt: invite.expiresAt
    });
  } catch (error) {
    console.error('Error fetching invite details:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};

// Get organization members
// Now fetches from Identity Provider as the source of truth
exports.getOrganizationMembers = async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    const userId = req.user.id;

    if (!organizationId) {
      return res.status(400).json({ msg: 'No current organization set' });
    }

    const organization = await Organization.findById(organizationId);

    if (!organization) {
      return res.status(404).json({ msg: 'Organization not found' });
    }

    // If organization has IdP link, fetch members from IdP
    if (organization.idpOrganizationId) {
      try {
        console.log('📡 Fetching members from IdP for org:', organization.idpOrganizationId);
        const idpData = await idpService.getOrganizationMembers(
          organization.idpOrganizationId,
          userId
        );

        console.log('✅ IdP returned', idpData.memberCount, 'members');

        // Transform IdP response to match expected frontend format
        const members = idpData.members.map(m => ({
          user: {
            _id: m.id,
            email: m.email,
            profile: {
              firstName: m.name?.split(' ')[0] || '',
              lastName: m.name?.split(' ').slice(1).join(' ') || ''
            }
          },
          role: m.role,
          status: 'active',
          joinedAt: m.joinedAt,
          invitedBy: m.invitedBy ? {
            profile: {
              firstName: m.invitedBy.name?.split(' ')[0] || '',
              lastName: m.invitedBy.name?.split(' ').slice(1).join(' ') || ''
            }
          } : null,
          isOwner: m.isOwner
        }));

        return res.json({
          members,
          memberCount: idpData.memberCount,
          source: 'idp',
          yourRole: idpData.yourRole,
          idpManagementUrl: idpService.getIdpManagementUrl(organization.idpOrganizationId, 'members')
        });
      } catch (idpError) {
        console.error('❌ IdP member fetch failed:', idpError.message);
        // Return error - IdP is the source of truth, no fallback
        return res.status(503).json({
          msg: 'Identity Provider unavailable. Please try again later.',
          code: 'idp_unavailable',
          error: idpError.message
        });
      }
    }

    // Organization without IdP link - return error asking user to migrate
    console.log('⚠️ Organization not linked to IdP:', organizationId);
    return res.status(400).json({
      msg: 'Organization not linked to Identity Provider. Please contact your administrator to migrate this organization.',
      code: 'idp_not_linked',
      idpManagementUrl: null
    });
  } catch (error) {
    console.error('Error fetching organization members:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};

// Remove member from organization
exports.removeMember = async (req, res) => {
  try {
    const { memberId } = req.params;
    const organizationId = req.user.currentOrganization;
    const userId = req.user.id;

    const organization = await Organization.findById(organizationId);
    if (!organization) {
      return res.status(404).json({ msg: 'Organization not found' });
    }

    // If organization is linked to IdP, redirect to IdP for member management
    if (organization.idpOrganizationId) {
      return res.status(410).json({
        msg: 'Member management is now handled through the Identity Provider',
        code: 'idp_managed',
        redirectUrl: idpService.getIdpManagementUrl(organization.idpOrganizationId, 'members'),
        idpOrganizationId: organization.idpOrganizationId
      });
    }

    const user = await User.findById(userId);
    if (!user.hasOrganizationPermission(organizationId, 'manage_users')) {
      return res.status(403).json({ msg: 'Insufficient permissions' });
    }

    // Cannot remove owner
    if (organization.owner.toString() === memberId) {
      return res.status(400).json({ msg: 'Cannot remove organization owner' });
    }

    // Remove member from organization
    organization.removeMember(memberId);
    await organization.save();

    // Remove organization membership from user
    const memberUser = await User.findById(memberId);
    if (memberUser) {
      memberUser.removeOrganizationMembership(organizationId);
      await memberUser.save();
    }

    res.json({ msg: 'Member removed successfully' });
  } catch (error) {
    console.error('Error removing member:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};

// Leave organization (self-remove)
exports.leaveOrganization = async (req, res) => {
  try {
    const userId = req.user.id;
    const organizationId = req.user.currentOrganization;

    if (!organizationId) {
      return res.status(400).json({ msg: 'No current organization set' });
    }

    const organization = await Organization.findById(organizationId);
    if (!organization) {
      return res.status(404).json({ msg: 'Organization not found' });
    }

    // Check if user is the owner
    if (organization.owner.toString() === userId) {
      return res.status(400).json({
        msg: 'Organization owners cannot leave. Please transfer ownership or delete the organization first.',
        code: 'OWNER_CANNOT_LEAVE'
      });
    }

    // Check if user is a member
    const memberIndex = organization.members.findIndex(m => m.user.toString() === userId);
    if (memberIndex === -1) {
      return res.status(400).json({ msg: 'You are not a member of this organization' });
    }

    // Remove user from organization members
    organization.members.splice(memberIndex, 1);
    organization.memberCount = organization.members.length;
    await organization.save();

    // Remove organization from user's memberships
    const user = await User.findById(userId);
    user.organizationMemberships = user.organizationMemberships.filter(
      m => m.organization.toString() !== organizationId.toString()
    );

    // If this was their current organization, clear it
    if (user.currentOrganization && user.currentOrganization.toString() === organizationId.toString()) {
      user.currentOrganization = null;
    }

    await user.save();

    console.log(`👋 User ${user.email} left organization ${organization.name}`);

    res.json({
      msg: 'Successfully left organization',
      organizationName: organization.name
    });
  } catch (error) {
    console.error('❌ Error leaving organization:', error);
    res.status(500).json({ msg: 'Server error', error: error.message });
  }
};

// Update member role
exports.updateMemberRole = async (req, res) => {
  try {
    const { memberId } = req.params;
    const { role } = req.body;
    const organizationId = req.user.currentOrganization;
    const userId = req.user.id;

    const organization = await Organization.findById(organizationId);
    if (!organization) {
      return res.status(404).json({ msg: 'Organization not found' });
    }

    // If organization is linked to IdP, redirect to IdP for role management
    if (organization.idpOrganizationId) {
      return res.status(410).json({
        msg: 'Role management is now handled through the Identity Provider',
        code: 'idp_managed',
        redirectUrl: idpService.getIdpManagementUrl(organization.idpOrganizationId, 'members'),
        idpOrganizationId: organization.idpOrganizationId
      });
    }

    const user = await User.findById(userId);
    if (!user.hasOrganizationPermission(organizationId, 'manage_users')) {
      return res.status(403).json({ msg: 'Insufficient permissions' });
    }

    // Cannot change owner role
    if (organization.owner.toString() === memberId) {
      return res.status(400).json({ msg: 'Cannot change owner role' });
    }

    // Update role in organization
    organization.updateMemberRole(memberId, role);
    await organization.save();

    // Update role in user's membership
    const memberUser = await User.findById(memberId);
    if (memberUser) {
      const membership = memberUser.organizationMemberships.find(
        m => m.organization.toString() === organizationId.toString()
      );
      if (membership) {
        membership.role = role;
        await memberUser.save();
      }
    }

    res.json({ msg: 'Member role updated successfully' });
  } catch (error) {
    console.error('Error updating member role:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};

// Get pending invitations for organization
exports.getPendingInvitations = async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    const userId = req.user.id;

    if (!organizationId) {
      return res.status(400).json({ msg: 'No current organization set' });
    }

    // Check if user has permission to view invitations
    const user = await User.findById(userId);
    if (!user.hasOrganizationPermission(organizationId, 'manage_users')) {
      return res.status(403).json({ msg: 'Insufficient permissions' });
    }

    const pendingInvites = await OrganizationInvite.find({
      organization: organizationId,
      status: 'pending',
      expiresAt: { $gt: new Date() }
    }).populate('invitedBy', 'profile.firstName profile.lastName email')
      .populate('organization', 'name')
      .sort({ createdAt: -1 });

    res.json({
      pendingInvites,
      count: pendingInvites.length
    });
  } catch (error) {
    console.error('Error fetching pending invitations:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};

// Cancel pending invitation
exports.cancelInvitation = async (req, res) => {
  try {
    const { inviteId } = req.params;
    const organizationId = req.user.currentOrganization;
    const userId = req.user.id;

    if (!organizationId) {
      return res.status(400).json({ msg: 'No current organization set' });
    }

    const organization = await Organization.findById(organizationId);

    // If organization is linked to IdP, redirect to IdP for invitation management
    if (organization && organization.idpOrganizationId) {
      return res.status(410).json({
        msg: 'Invitation management is now handled through the Identity Provider',
        code: 'idp_managed',
        redirectUrl: idpService.getIdpManagementUrl(organization.idpOrganizationId, 'invitations'),
        idpOrganizationId: organization.idpOrganizationId
      });
    }

    // Check if user has permission to manage invitations
    const user = await User.findById(userId);
    if (!user.hasOrganizationPermission(organizationId, 'manage_users')) {
      return res.status(403).json({ msg: 'Insufficient permissions' });
    }

    const invite = await OrganizationInvite.findOne({
      _id: inviteId,
      organization: organizationId,
      status: 'pending'
    });

    if (!invite) {
      return res.status(404).json({ msg: 'Invitation not found' });
    }

    // Actually delete the invitation instead of just marking as rejected
    // This allows the same email to be re-invited immediately
    await OrganizationInvite.deleteOne({ _id: inviteId });

    console.log(`🗑️ Invitation deleted for email: ${invite.email} by user: ${userId}`);
    res.json({ msg: 'Invitation cancelled successfully' });
  } catch (error) {
    console.error('Error cancelling invitation:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};

// Get pending invitations for user (invitations they received)
exports.getUserPendingInvitations = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's email to find invitations
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    const pendingInvites = await OrganizationInvite.find({
      email: user.email,
      status: 'pending',
      expiresAt: { $gt: new Date() }
    }).populate('organization', 'name description industry')
      .populate('invitedBy', 'profile.firstName profile.lastName email')
      .sort({ createdAt: -1 });

    res.json({
      pendingInvites,
      count: pendingInvites.length
    });
  } catch (error) {
    console.error('Error fetching user pending invitations:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};

// Cleanup rejected/expired invitations for an organization
exports.cleanupInvitations = async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    const userId = req.user.id;

    if (!organizationId) {
      return res.status(400).json({ msg: 'No current organization set' });
    }

    // Check if user has permission to manage invitations
    const user = await User.findById(userId);
    if (!user.hasOrganizationPermission(organizationId, 'manage_users')) {
      return res.status(403).json({ msg: 'Insufficient permissions' });
    }

    // Delete all rejected and expired invitations
    const cleanupResult = await OrganizationInvite.deleteMany({
      organization: organizationId,
      $or: [
        { status: 'rejected' },
        { status: 'expired' },
        { expiresAt: { $lt: new Date() } }
      ]
    });

    console.log(`🧹 Cleaned up ${cleanupResult.deletedCount} old invitations for organization: ${organizationId}`);

    res.json({
      msg: 'Invitations cleaned up successfully',
      deletedCount: cleanupResult.deletedCount
    });
  } catch (error) {
    console.error('Error cleaning up invitations:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};

// Transfer organization ownership
exports.transferOwnership = async (req, res) => {
  try {
    const { newOwnerId } = req.body;
    const organizationId = req.user.currentOrganization;
    const currentOwnerId = req.user.id;

    console.log('🔄 Ownership transfer request:', {
      organizationId,
      currentOwnerId,
      newOwnerId
    });

    // Validate input
    if (!organizationId) {
      return res.status(400).json({ msg: 'No current organization set' });
    }

    // Get organization first to check for IdP link
    const organization = await Organization.findById(organizationId)
      .populate('members.user', 'profile.firstName profile.lastName email');

    if (!organization) {
      return res.status(404).json({ msg: 'Organization not found' });
    }

    // If organization is linked to IdP, redirect to IdP for ownership transfer
    if (organization.idpOrganizationId) {
      return res.status(410).json({
        msg: 'Ownership transfer is now handled through the Identity Provider',
        code: 'idp_managed',
        redirectUrl: idpService.getIdpManagementUrl(organization.idpOrganizationId, 'members'),
        idpOrganizationId: organization.idpOrganizationId
      });
    }

    if (!newOwnerId) {
      return res.status(400).json({ msg: 'New owner ID is required' });
    }

    // Cannot transfer to self
    if (currentOwnerId === newOwnerId) {
      return res.status(400).json({ msg: 'Cannot transfer ownership to yourself' });
    }

    // Verify current user is the owner
    if (organization.owner.toString() !== currentOwnerId) {
      return res.status(403).json({ msg: 'Only the organization owner can transfer ownership' });
    }

    // Verify new owner is a member of the organization
    const newOwnerMember = organization.members.find(
      m => m.user._id.toString() === newOwnerId && m.status === 'active'
    );

    if (!newOwnerMember) {
      return res.status(400).json({ msg: 'New owner must be an active member of the organization' });
    }

    // Get both users
    const currentOwner = await User.findById(currentOwnerId);
    const newOwner = await User.findById(newOwnerId);

    if (!currentOwner || !newOwner) {
      return res.status(404).json({ msg: 'User not found' });
    }

    console.log('✅ Validation passed. Transferring ownership...');
    console.log(`  From: ${currentOwner.email} (${currentOwnerId})`);
    console.log(`  To: ${newOwner.email} (${newOwnerId})`);

    // Update organization owner
    organization.owner = newOwnerId;

    // Update old owner's role to admin
    const oldOwnerMember = organization.members.find(
      m => m.user._id.toString() === currentOwnerId
    );
    if (oldOwnerMember) {
      oldOwnerMember.role = 'admin';
    }

    // Update new owner's role to owner
    newOwnerMember.role = 'owner';

    // Save organization
    await organization.save();

    // Update current owner's membership to admin
    const currentOwnerMembership = currentOwner.organizationMemberships.find(
      m => m.organization.toString() === organizationId.toString()
    );
    if (currentOwnerMembership) {
      currentOwnerMembership.role = 'admin';
      await currentOwner.save();
    }

    // Update new owner's membership to owner
    const newOwnerMembership = newOwner.organizationMemberships.find(
      m => m.organization.toString() === organizationId.toString()
    );
    if (newOwnerMembership) {
      newOwnerMembership.role = 'owner';
      await newOwner.save();
    }

    console.log('✅ Ownership transfer completed successfully');

    // Create notifications for both users
    try {
      // Notification for old owner
      await Notification.create({
        user: currentOwnerId,
        type: 'ownership_transferred',
        title: 'Ownership Transferred',
        message: `You have transferred ownership of "${organization.name}" to ${newOwner.profile.firstName || newOwner.email}. You are now an Admin.`,
        metadata: {
          organizationId: organization._id,
          organizationName: organization.name,
          newOwnerId: newOwnerId,
          newOwnerName: newOwner.profile.firstName || newOwner.email
        }
      });

      // Notification for new owner
      await Notification.create({
        user: newOwnerId,
        type: 'ownership_received',
        title: 'You Are Now Owner',
        message: `${currentOwner.profile.firstName || currentOwner.email} has transferred ownership of "${organization.name}" to you. You now have full control.`,
        metadata: {
          organizationId: organization._id,
          organizationName: organization.name,
          previousOwnerId: currentOwnerId,
          previousOwnerName: currentOwner.profile.firstName || currentOwner.email
        }
      });

      console.log('📧 Notifications created for ownership transfer');
    } catch (notificationError) {
      console.error('Failed to create notifications:', notificationError);
      // Don't fail the transfer if notifications fail
    }

    res.json({
      msg: 'Ownership transferred successfully',
      organization: {
        _id: organization._id,
        name: organization.name,
        owner: newOwnerId
      },
      oldOwner: {
        _id: currentOwnerId,
        email: currentOwner.email,
        newRole: 'admin'
      },
      newOwner: {
        _id: newOwnerId,
        email: newOwner.email,
        role: 'owner'
      }
    });
  } catch (error) {
    console.error('❌ Error transferring ownership:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ msg: 'Server error', error: error.message });
  }
};

// Admin: Adjust organization credits (add or remove)
exports.adjustOrganizationCredits = async (req, res) => {
  try {
    const organizationId = req.params.id; // Route uses :id parameter
    const { credits, reason, adjustmentType } = req.body;
    const adminId = req.admin.id;

    console.log('💳 Admin credit adjustment request:', {
      organizationId,
      credits,
      adjustmentType,
      reason,
      adminId
    });

    // Validation
    if (!credits || typeof credits !== 'number' || credits === 0) {
      return res.status(400).json({
        success: false,
        msg: 'Credits must be a non-zero number'
      });
    }

    if (!adjustmentType || !['add', 'remove'].includes(adjustmentType)) {
      return res.status(400).json({
        success: false,
        msg: 'Adjustment type must be either "add" or "remove"'
      });
    }

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        msg: 'Reason is required for credit adjustment'
      });
    }

    // Get organization
    const organization = await Organization.findById(organizationId);
    if (!organization) {
      return res.status(404).json({
        success: false,
        msg: 'Organization not found'
      });
    }

    // Initialize creditUsage if it doesn't exist
    if (!organization.subscription) {
      organization.subscription = {};
    }

    if (!organization.subscription.creditUsage) {
      organization.subscription.creditUsage = {
        totalCredits: 0,
        usedCredits: 0,
        remainingCredits: 0,
        currentCycleStart: new Date(),
        currentCycleEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        transactions: [],
        rolloverCredits: 0,
        creditPurchases: [],
        lowCreditWarning: {
          enabled: true,
          threshold: 20
        }
      };
    }

    const creditsBefore = organization.subscription.creditUsage.remainingCredits || 0;
    let creditsAfter;
    let actualCredits = Math.abs(credits); // Ensure positive value

    if (adjustmentType === 'add') {
      // Add credits
      organization.subscription.creditUsage.remainingCredits += actualCredits;
      creditsAfter = organization.subscription.creditUsage.remainingCredits;

      // Record transaction
      organization.subscription.creditUsage.transactions.push({
        action: 'creditPurchase', // Using creditPurchase for admin additions
        credits: actualCredits,
        entityType: 'system',
        performedBy: adminId,
        timestamp: new Date(),
        balanceAfter: creditsAfter,
        metadata: {
          reason: reason,
          adjustmentType: 'add',
          adminAdjustment: true,
          description: `Admin credit adjustment: Added ${actualCredits} credits. Reason: ${reason}`
        }
      });

      console.log(`✅ Added ${actualCredits} credits to ${organization.name}. Balance: ${creditsBefore} → ${creditsAfter}`);
    } else {
      // Remove credits
      if (creditsBefore < actualCredits) {
        return res.status(400).json({
          success: false,
          msg: `Cannot remove ${actualCredits} credits. Organization only has ${creditsBefore} credits available.`,
          currentBalance: creditsBefore,
          requestedRemoval: actualCredits
        });
      }

      organization.subscription.creditUsage.remainingCredits -= actualCredits;
      creditsAfter = organization.subscription.creditUsage.remainingCredits;

      // Record transaction
      organization.subscription.creditUsage.transactions.push({
        action: 'creditRefund', // Using creditRefund for admin removals
        credits: actualCredits,
        entityType: 'system',
        performedBy: adminId,
        timestamp: new Date(),
        balanceAfter: creditsAfter,
        metadata: {
          reason: reason,
          adjustmentType: 'remove',
          adminAdjustment: true,
          description: `Admin credit adjustment: Removed ${actualCredits} credits. Reason: ${reason}`
        }
      });

      console.log(`✅ Removed ${actualCredits} credits from ${organization.name}. Balance: ${creditsBefore} → ${creditsAfter}`);
    }

    await organization.save();

    res.json({
      success: true,
      msg: `Successfully ${adjustmentType === 'add' ? 'added' : 'removed'} ${actualCredits} credits`,
      adjustment: {
        type: adjustmentType,
        credits: actualCredits,
        creditsBefore,
        creditsAfter,
        reason
      },
      organization: {
        _id: organization._id,
        name: organization.name,
        creditBalance: creditsAfter
      }
    });
  } catch (error) {
    console.error('❌ Error adjusting organization credits:', error);
    res.status(500).json({
      success: false,
      msg: 'Server error adjusting credits',
      error: error.message
    });
  }
}; 

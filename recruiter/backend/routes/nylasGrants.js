const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { requireOrganization } = require('../middleware/organizationMiddleware');
const nylasEmailService = require('../services/nylasEmailService');
const User = require('../models/User');
const { decodeHtmlEntities } = require('../utils/htmlDecode');
const { resolveOrganizationForEmail } = require('../utils/organizationEmailContext');

/**
 * GET /api/nylas-grants/email-permissions
 * Check if current user's Nylas grant has email sending permissions
 */
router.get('/email-permissions', authMiddleware, requireOrganization, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user.nylasGrantId) {
      return res.json({
        hasEmailPermissions: false,
        reason: 'No Nylas calendar connected',
        action: 'Connect calendar first'
      });
    }

    // Check email permissions for this grant
    const permissions = await nylasEmailService.checkEmailPermissions(user.nylasGrantId);
    
    res.json({
      grantId: user.nylasGrantId,
      hasEmailPermissions: permissions.canSendEmail,
      grantStatus: permissions.grantStatus,
      provider: permissions.provider,
      scopes: permissions.scopes,
      recommendation: permissions.canSendEmail 
        ? 'Email permissions available - Nylas email integration ready'
        : 'Email permissions missing - user needs to reconnect calendar with email scope',
      action: permissions.canSendEmail 
        ? null 
        : 'Disconnect and reconnect calendar to grant email permissions'
    });

  } catch (error) {
    console.error('Error checking Nylas email permissions:', error);
    res.status(500).json({
      error: 'Failed to check email permissions',
      details: error.message
    });
  }
});

/**
 * GET /api/nylas-grants/verify-status
 * Dynamically verify if the grant is still valid in Nylas
 */
router.get('/verify-status', authMiddleware, requireOrganization, async (req, res) => {
  try {
    const nylasV3Service = require('../services/nylasV3Service');
    const user = await User.findById(req.user.id);
    
    if (!user.nylasGrantId) {
      return res.json({
        valid: false,
        status: 'no_grant',
        message: 'No calendar connected',
        requiresConnection: true,
        calendarConnected: false
      });
    }

    // DYNAMIC CHECK: Verify grant is still valid in Nylas
    console.log(`🔍 [API] Verifying grant status for ${user.email}...`);
    
    // Get account credentials if user has a linked Nylas account
    let accountCredentials = null;
    if (user.nylasAccountId) {
      const NylasAccount = require('../models/NylasAccount');
      const nylasAccount = await NylasAccount.findById(user.nylasAccountId).select('+apiKey');
      if (nylasAccount) {
        accountCredentials = {
          apiKey: nylasAccount.apiKey,
          region: nylasAccount.region,
          clientId: nylasAccount.clientId
        };
        console.log(`   Using Nylas account: ${nylasAccount.name}`);
      }
    }
    
    const verification = await nylasV3Service.verifyGrantStatus(user.nylasGrantId, accountCredentials);
    
    if (!verification.valid) {
      console.log(`❌ [API] Grant invalid for ${user.email}:`, verification.status);
      
      // Update database if grant is invalid
      if (user.nylasGrantStatus !== 'invalid') {
        user.nylasGrantStatus = 'invalid';
        user.calendarConnected = false;
        await user.save();
        console.log(`📝 [API] Updated database for ${user.email}: calendarConnected = false`);
      }
    } else {
      console.log(`✅ [API] Grant valid for ${user.email}`);
      
      // Update database if it was previously invalid
      if (user.nylasGrantStatus !== 'active' || !user.calendarConnected) {
        user.nylasGrantStatus = 'active';
        user.calendarConnected = true;
        await user.save();
        console.log(`📝 [API] Updated database for ${user.email}: calendarConnected = true`);
      }
    }
    
    res.json({
      ...verification,
      calendarConnected: verification.valid,
      requiresReconnection: !verification.valid
    });

  } catch (error) {
    console.error('Error verifying grant status:', error);
    res.status(500).json({
      valid: false,
      status: 'error',
      message: 'Failed to verify grant status',
      error: error.message,
      requiresConnection: false
    });
  }
});

/**
 * POST /api/nylas-grants/test-email
 * Send a test email to verify email permissions work
 */
router.post('/test-email', authMiddleware, requireOrganization, async (req, res) => {
  try {
    const { testEmail } = req.body;
    const user = await User.findById(req.user.id);
    
    if (!user.nylasGrantId) {
      return res.status(400).json({
        error: 'No Nylas calendar connected'
      });
    }

    if (!testEmail) {
      return res.status(400).json({
        error: 'Test email address required'
      });
    }

    const organization = await resolveOrganizationForEmail({
      organizationId: req.user.currentOrganization
    });
    const organizationName = decodeHtmlEntities(organization.name);

    // Test email data
    const templateData = {
      candidateName: 'Test User',
      jobTitle: 'Test Position',
      interviewDate: new Date().toLocaleDateString(),
      interviewTime: '10:00 AM',
      duration: 60,
      interviewType: 'Video',
      meetingLink: 'https://meet.google.com/test-link',
      interviewerName: user.name || user.email,
      organizationName,
      interviewerEmail: user.email
    };

    // Get account credentials if user has a linked Nylas account
    let testEmailAccountCredentials = null;
    if (user.nylasAccountId) {
      const NylasAccount = require('../models/NylasAccount');
      const nylasAccount = await NylasAccount.findById(user.nylasAccountId).select('+apiKey');
      if (nylasAccount) {
        testEmailAccountCredentials = {
          apiKey: nylasAccount.apiKey,
          region: nylasAccount.region,
          clientId: nylasAccount.clientId
        };
        console.log(`   Using Nylas account for test email: ${nylasAccount.name}`);
      }
    }
    
    // Send test email
    const result = await nylasEmailService.sendInterviewInviteEmail(
      user.nylasGrantId,
      testEmail,
      templateData,
      null, // No custom template
      'TEST: Interview Email Integration Check',
      [], // No BCC
      [], // No CC
      testEmailAccountCredentials // Pass account credentials
    );

    if (result.success) {
      res.json({
        success: true,
        message: 'Test email sent successfully via Nylas',
        messageId: result.messageId
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        needsReauth: result.needsReauth,
        fallbackToBrevo: result.fallbackToBrevo,
        details: result.details
      });
    }

  } catch (error) {
    console.error('Error sending test email:', error);
    res.status(500).json({
      error: 'Failed to send test email',
      details: error.message
    });
  }
});

module.exports = router;


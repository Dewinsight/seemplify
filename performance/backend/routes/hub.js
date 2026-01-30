const express = require('express');
const router = express.Router();

const { validateHubToken } = require('../middleware/hubAuth');
const User = require('../models/User');
const { verifySubscriptionAccess, getSubscriptionRequiredUrl } = require('../services/idpSubscriptionService');

// Hub launch endpoint - handles IdP-initiated SSO
router.get('/launch', validateHubToken, async (req, res) => {
  try {
    // Hub token validated - user info in req.hubUser
    const hubUser = req.hubUser;

    console.log('🚀 Hub launch for:', hubUser.email);
    console.log('📊 Organizations:', hubUser.organizations?.length || 0);
    console.log('👥 Teams:', hubUser.teams?.length || 0);

    // Store in session
    req.session.user = {
      id: hubUser.id,
      email: hubUser.email,
      name: hubUser.name,
      organizations: hubUser.organizations || [],
      teams: hubUser.teams || [],
      idpTeams: hubUser.teams || [],
      currentOrganization: hubUser.currentOrganization,
      userinfo: hubUser,
      hubInitiated: true, // Mark as hub-initiated login
    };

    // Set organization from hub or userinfo
    if (req.query.orgId) {
      // Verify user belongs to this org
      const org = (hubUser.organizations || []).find(o => o.id === req.query.orgId);
      if (org) {
        req.session.currentOrganizationId = req.query.orgId;
      }
    } else if (hubUser.currentOrganization) {
      req.session.currentOrganizationId = hubUser.currentOrganization.id;
    } else if (hubUser.organizations?.length > 0) {
      req.session.currentOrganizationId = hubUser.organizations[0].id;
    }

    // Verify subscription access for the current organization
    if (req.session.currentOrganizationId) {
      console.log('🔒 Verifying subscription access for org:', req.session.currentOrganizationId);
      const subscriptionCheck = await verifySubscriptionAccess(
        req.session.currentOrganizationId,
        req.headers['authorization']?.replace('Bearer ', '') || hubUser.accessToken
      );

      if (!subscriptionCheck.allowed) {
        console.log('❌ Subscription access denied for performance-management:', subscriptionCheck.reason);
        // Redirect to IDP subscription required page
        const subscriptionUrl = getSubscriptionRequiredUrl(
          'performance-management',
          req.session.currentOrganizationId,
          subscriptionCheck.reason
        );
        return res.redirect(subscriptionUrl);
      }
      console.log('✅ Subscription access verified for performance-management');
    }

    // Sync user profile and teams with local database
    // Note: Organizations come from IDP session only, not stored locally
    // Teams are cached for querying users in an organization
    let user = await User.findOne({ email: hubUser.email });
    if (user) {
      user.idpTeams = hubUser.teams || []; // Cache teams for org queries
      user.lastGrantRefresh = new Date();
      if (req.session.currentOrganizationId) {
        user.currentOrganizationId = req.session.currentOrganizationId;
      }
      await user.save();
    } else {
      user = new User({
        email: hubUser.email,
        profile: {
          displayName: hubUser.name,
          firstName: hubUser.name?.split(' ')[0],
          lastName: hubUser.name?.split(' ').slice(1).join(' ')
        },
        idpTeams: hubUser.teams || [], // Cache teams for org queries
        currentOrganizationId: req.session.currentOrganizationId,
        lastGrantRefresh: new Date()
      });
      await user.save();
    }

    console.log('✅ Hub launch successful for:', hubUser.email);

    // Redirect to frontend dashboard
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5005';
    const returnUrl = req.query.returnUrl || '/';

    res.redirect(`${frontendUrl}${returnUrl}`);
  } catch (error) {
    console.error('Hub launch error:', error);

    // Redirect to frontend with error
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5005';
    res.redirect(`${frontendUrl}/login?error=${encodeURIComponent('Hub launch failed')}`);
  }
});

// Hub launch with OIDC flow (alternative approach)
router.get('/launch/oidc', validateHubToken, async (req, res) => {
  try {
    // Store hub user info for OIDC callback
    req.session.hubUser = req.hubUser;
    req.session.hubInitiated = true;

    const { generateAuthUrl, generatePKCE } = require('../config/oidc');
    const { v4: uuidv4 } = require('uuid');

    const state = uuidv4();
    const nonce = uuidv4();

    req.session.oidcState = state;
    req.session.oidcNonce = nonce;

    // Generate auth URL with login hint (skip IdP login if already authenticated)
    const { url: authUrl, codeVerifier } = generateAuthUrl(state, nonce, null, {
      login_hint: req.hubUser.email,
      prompt: 'none', // Skip login if session exists
    });

    req.session.oidcCodeVerifier = codeVerifier;

    res.redirect(authUrl);
  } catch (error) {
    console.error('Hub OIDC launch error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5005';
    res.redirect(`${frontendUrl}/login?error=${encodeURIComponent('Hub OIDC launch failed')}`);
  }
});

// Health check for hub integration
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'performance-management',
    hubIntegration: true,
    timestamp: new Date().toISOString(),
  });
});

// App info for hub registration
router.get('/info', (req, res) => {
  res.json({
    appId: 'performance-management',
    name: 'Performance Management',
    description: 'Manage OKRs, performance reviews, and feedback',
    version: '1.0.0',
    url: process.env.PERFORMANCE_MANAGEMENT_URL || process.env.BACKEND_URL,
    loginUrl: `${process.env.PERFORMANCE_MANAGEMENT_URL || process.env.BACKEND_URL}/api/hub/launch`,
    icon: '/icons/performance-management.svg',
    category: 'hr',
    features: [
      'OKR management',
      'Performance reviews',
      'Peer feedback',
      'Manager evaluations',
      'Team analytics',
      '1:1 meeting tracking',
    ],
  });
});

module.exports = router;

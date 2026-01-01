const express = require('express');
const router = express.Router();

const { validateHubToken } = require('../middleware/hubAuth');
const { asyncHandler } = require('../middleware/errorHandler');
const { getUserInfo } = require('../config/oidc');
const { logHubLaunch } = require('../services/auditService');

// Hub launch endpoint - handles IdP-initiated SSO
router.get('/launch', validateHubToken, asyncHandler(async (req, res) => {
  try {
    // Hub token validated - user info in req.hubUser
    const hubUser = req.hubUser;

    // Try to get full userinfo from IdP if we have access token
    let userinfo = hubUser;

    // If the hub token contains enough info, use it directly
    // Otherwise, we might need to initiate OIDC flow

    // Store in session
    req.session.user = {
      id: hubUser.id,
      email: hubUser.email,
      name: hubUser.name,
      organizations: hubUser.organizations || [],
      teams: hubUser.teams || [],
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

    // Log the hub launch
    await logHubLaunch(
      { id: hubUser.id, name: hubUser.name, email: hubUser.email },
      req.session.currentOrganizationId,
      req
    );

    // Redirect to frontend dashboard
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5003';
    const returnUrl = req.query.returnUrl || '/dashboard';

    res.redirect(`${frontendUrl}${returnUrl}`);
  } catch (error) {
    console.error('Hub launch error:', error);

    // Redirect to frontend with error
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5003';
    res.redirect(`${frontendUrl}/login?error=${encodeURIComponent('Hub launch failed')}`);
  }
}));

// Hub launch with OIDC flow (alternative approach)
router.get('/launch/oidc', validateHubToken, asyncHandler(async (req, res) => {
  // Store hub user info for OIDC callback
  req.session.hubUser = req.hubUser;
  req.session.hubInitiated = true;

  // Redirect to OIDC login with pre-authenticated hint
  const { generateAuthUrl } = require('../config/oidc');
  const { v4: uuidv4 } = require('uuid');

  const state = uuidv4();
  const nonce = uuidv4();

  req.session.oidcState = state;
  req.session.oidcNonce = nonce;

  // Generate auth URL with login hint (skip IdP login if already authenticated)
  const authUrl = generateAuthUrl(state, nonce, {
    login_hint: req.hubUser.email,
    prompt: 'none', // Skip login if session exists
  });

  res.redirect(authUrl);
}));

// Health check for hub integration
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'leave-management',
    hubIntegration: true,
    timestamp: new Date().toISOString(),
  });
});

// App info for hub registration
router.get('/info', (req, res) => {
  res.json({
    appId: 'leave-management',
    name: 'Leave Management',
    description: 'Manage employee leave requests and approvals',
    version: '1.0.0',
    url: process.env.LEAVE_MANAGEMENT_URL,
    loginUrl: `${process.env.LEAVE_MANAGEMENT_URL}/api/hub/launch`,
    icon: '/icons/leave-management.svg',
    category: 'hr',
    features: [
      'Leave request management',
      'Leave balance tracking',
      'Approval workflow',
      'Calendar view',
      'Team-based approvals',
    ],
  });
});

module.exports = router;

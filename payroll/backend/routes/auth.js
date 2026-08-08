const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { Issuer, generators } = require('openid-client');
const { requireAuth } = require('../middleware/rbac');
const { verifySubscriptionAccess, getSubscriptionRequiredUrl } = require('../services/idpSubscriptionService');
const { getPayrollOidcClientConfig, getPayrollFrontendUrl } = require('../config/identityProvider');

const isProduction = process.env.NODE_ENV === 'production';

// =============================================================================
// OIDC ISSUER CACHING - Avoid expensive discovery on every request
// =============================================================================
let cachedIssuer = null;
let cachedIssuerUrl = null;
let cachedIssuerExpiry = null;
const ISSUER_CACHE_TTL = 60 * 60 * 1000; // 1 hour cache

/**
 * Get cached OIDC issuer or discover it
 * This avoids the expensive network call to /.well-known/openid-configuration on every request
 */
async function getCachedIssuer(issuerUrl) {
  const now = Date.now();
  
  // Return cached if valid
  if (cachedIssuer && cachedIssuerUrl === issuerUrl && cachedIssuerExpiry > now) {
    console.log('⚡ Using cached OIDC issuer');
    return cachedIssuer;
  }
  
  // Discover and cache
  console.log('🔍 Discovering OIDC issuer (will be cached for 1 hour)...');
  const startTime = Date.now();
  const issuer = await Issuer.discover(issuerUrl);
  console.log(`✅ OIDC issuer discovered in ${Date.now() - startTime}ms`);
  
  cachedIssuer = issuer;
  cachedIssuerUrl = issuerUrl;
  cachedIssuerExpiry = now + ISSUER_CACHE_TTL;
  
  return issuer;
}

// Backward compatibility: redirect /login to /oidc/start
router.get('/login', (req, res) => {
  const queryString = new URLSearchParams(req.query).toString();
  const redirectUrl = `/api/auth/oidc/start${queryString ? '?' + queryString : ''}`;
  console.log('🔄 Redirecting /auth/login to /auth/oidc/start');
  res.redirect(redirectUrl);
});

// OIDC Start - Hub-initiated or direct login
router.get('/oidc/start', async (req, res) => {
  try {
    // Check if this is IdP-initiated SSO from the hub
    const isIdpInitiated = req.query.idp_initiated === 'true';
    const hubToken = req.query.hub_token;

    console.log('🚀 Payroll OIDC Start:', {
      idp_initiated: isIdpInitiated,
      has_hub_token: !!hubToken,
      returnTo: req.query.returnTo,
      referer: req.headers['referer']
    });

    // Validate required environment variables
    const oidcConfig = getPayrollOidcClientConfig();
    const issuerUrl = oidcConfig.issuerUrl;
    if (!issuerUrl) {
      return res.status(500).json({ error: 'IDP_ISSUER_URL not configured' });
    }

    const clientId = oidcConfig.clientId;
    const clientSecret = oidcConfig.clientSecret;
    if (!clientId || !clientSecret) {
      return res.status(500).json({ error: 'OIDC client credentials not configured' });
    }

    const redirectUri = oidcConfig.redirectUri;
    if (!redirectUri) {
      return res.status(500).json({ error: 'OIDC_REDIRECT_URI not configured' });
    }

    // Get returnTo from query parameter or headers
    const returnTo = req.query.returnTo || req.headers['referer'] || getPayrollFrontendUrl();

    // Use cached issuer to avoid expensive discovery on every request
    const issuer = await getCachedIssuer(issuerUrl);
    const client = new issuer.Client({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: [redirectUri],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_basic',
    });

    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);

    // Create state payload with returnTo URL encoded
    const statePayload = {
      nonce: generators.nonce(),
      random: generators.state(),
      returnTo: returnTo
    };

    // Sign state with JWT for security
    const state = jwt.sign(statePayload, process.env.JWT_SECRET || 'payroll-secret', { expiresIn: '10m' });

    // Store in cookies (required for cross-site redirects)
    res.cookie('oidc_verifier', codeVerifier, {
      httpOnly: true,
      sameSite: isProduction ? 'none' : 'lax',
      secure: isProduction,
    });
    res.cookie('oidc_state', state, {
      httpOnly: true,
      sameSite: isProduction ? 'none' : 'lax',
      secure: isProduction,
    });

    // For IdP-initiated SSO (from hub), don't force login - use existing session
    const promptValue = isIdpInitiated ? undefined : 'login';

    console.log('🔐 Payroll OIDC Auth Parameters:', {
      idp_initiated: isIdpInitiated,
      has_hub_token: !!hubToken,
      prompt: promptValue || 'none (will use existing session)',
      redirectUri: redirectUri,
      issuerUrl: issuerUrl
    });

    const authParams = {
      scope: 'openid email profile organizations teams roles team_permissions',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce: statePayload.nonce
    };

    // Only add prompt if we want to force login
    if (promptValue) {
      authParams.prompt = promptValue;
    }

    // If we have a hub token, pass it to the Identity Provider
    if (hubToken) {
      authParams.hub_token = hubToken;
    }

    const url = client.authorizationUrl(authParams);
    res.redirect(url);
  } catch (e) {
    console.error('Payroll OIDC start error:', e);
    res.status(500).json({ error: 'OIDC start failed', message: e.message });
  }
});

// OIDC Callback - handles response from Identity Provider
router.get('/oidc/callback', async (req, res) => {
  console.log('🎯 Payroll OIDC Callback received:', {
    hasCode: !!req.query.code,
    hasState: !!req.query.state,
    hasError: !!req.query.error
  });

  const frontendUrl = getPayrollFrontendUrl();

  // Handle errors from IdP
  if (req.query.error) {
    console.error('OIDC error:', req.query.error, req.query.error_description);
    return res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(req.query.error_description || req.query.error)}`);
  }

  try {
    // Validate required environment variables
    const oidcConfig = getPayrollOidcClientConfig();
    const issuerUrl = oidcConfig.issuerUrl;
    if (!issuerUrl) {
      return res.status(500).json({ error: 'IDP_ISSUER_URL not configured' });
    }

    const clientId = oidcConfig.clientId;
    const clientSecret = oidcConfig.clientSecret;
    if (!clientId || !clientSecret) {
      return res.status(500).json({ error: 'OIDC client credentials not configured' });
    }

    const redirectUri = oidcConfig.redirectUri;

    // Get state from cookie
    const stateCookie = req.cookies.oidc_state;
    if (!stateCookie) {
      return res.redirect(`${frontendUrl}/login?error=${encodeURIComponent('Missing state cookie')}`);
    }

    let returnTo = '/';
    let nonce;

    try {
      const statePayload = jwt.verify(stateCookie, process.env.JWT_SECRET || 'payroll-secret');
      returnTo = statePayload.returnTo || '/';
      nonce = statePayload.nonce;
    } catch (err) {
      console.error('State verification error:', err);
      return res.redirect(`${frontendUrl}/login?error=${encodeURIComponent('Invalid or expired state')}`);
    }

    // Use cached issuer to avoid expensive discovery on every request
    const issuer = await getCachedIssuer(issuerUrl);
    const client = new issuer.Client({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: [redirectUri],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_basic',
    });

    const params = client.callbackParams(req);
    const checks = {
      state: stateCookie,
      nonce: nonce,
      code_verifier: req.cookies.oidc_verifier
    };

    const tokenSet = await client.callback(redirectUri, params, checks);
    const userinfo = await client.userinfo(tokenSet.access_token);

    console.log('✅ Payroll OIDC tokens received for:', userinfo.email);
    console.log('📊 Organization claims:', userinfo.organizations ? userinfo.organizations.length : 0, 'organizations');
    console.log('👥 Team claims:', userinfo.teams ? userinfo.teams.length : 0, 'teams');

    // Store in session
    req.session.user = {
      id: userinfo.sub,
      email: userinfo.email,
      name: userinfo.name,
      organizations: userinfo.organizations || [],
      teams: userinfo.teams || [],
      team_permissions: userinfo.team_permissions || [],
      roles: userinfo.roles || [],
      currentOrganization: userinfo.currentOrganization,
      accessToken: tokenSet.access_token,
      refreshToken: tokenSet.refresh_token,
      idToken: tokenSet.id_token,
      tokenExpiry: tokenSet.expires_at,
      userinfo,
    };

    // Set current organization if available
    if (userinfo.currentOrganization) {
      req.session.currentOrganizationId = userinfo.currentOrganization.id;
    } else if (userinfo.organizations?.length > 0) {
      req.session.currentOrganizationId = userinfo.organizations[0].id;
    }

    // Verify subscription access for the current organization
    if (req.session.currentOrganizationId) {
      console.log('🔒 Verifying subscription access for org:', req.session.currentOrganizationId);
      const subscriptionCheck = await verifySubscriptionAccess(
        req.session.currentOrganizationId,
        tokenSet.access_token
      );

      if (!subscriptionCheck.allowed) {
        console.log('❌ Subscription access denied for payroll-management:', subscriptionCheck.reason);
        const deniedOrganizationId = req.session.currentOrganizationId;
        // Clear session since we're not allowing access
        req.session.destroy((err) => {
          if (err) console.error('Session destroy error:', err);
        });
        // Redirect to IDP subscription required page
        const subscriptionUrl = getSubscriptionRequiredUrl(
          'payroll-management',
          deniedOrganizationId,
          subscriptionCheck.reason
        );
        return res.redirect(subscriptionUrl);
      }
      console.log('✅ Subscription access verified for payroll-management');
    }

    // Clear OIDC cookies
    res.clearCookie('oidc_verifier');
    res.clearCookie('oidc_state');

    // Redirect to frontend with access token in hash (same pattern as leave/performance)
    console.log('📍 Redirecting to frontend:', frontendUrl);
    res.redirect(`${frontendUrl}#access_token=${tokenSet.access_token}`);
  } catch (error) {
    console.error('Payroll OIDC callback error:', error);
    return res.redirect(`${frontendUrl}/login?error=${encodeURIComponent('Authentication failed')}`);
  }
});

// Get current user - supports both session and Bearer token auth
router.get('/me', requireAuth, (req, res) => {
  // requireAuth middleware populates req.session.user from either session or Bearer token

  // Return user info (without sensitive tokens)
  const { accessToken, refreshToken, idToken, ...safeUser } = req.session.user;

  // Get current organization from session
  const currentOrgId = req.session.currentOrganizationId || req.currentOrganization?.id;
  const organizations = safeUser.organizations || [];
  
  // Find the full current organization object
  let currentOrganization = safeUser.currentOrganization;
  if (!currentOrganization && currentOrgId && organizations.length > 0) {
    currentOrganization = organizations.find(org => org.id === currentOrgId);
  }
  if (!currentOrganization && organizations.length > 0) {
    currentOrganization = organizations[0];
  }

  // Mark current organization in the list
  const orgsWithCurrent = organizations.map(org => ({
    ...org,
    isCurrent: org.id === (currentOrganization?.id || currentOrgId)
  }));

  res.json({
    user: {
      ...safeUser,
      organizations: orgsWithCurrent, // Organizations from IDP with isCurrent flag
    },
    currentOrganizationId: currentOrganization?.id || currentOrgId,
    currentOrganization: currentOrganization, // Full organization object from IDP
  });
});

// Get current session status
router.get('/session', (req, res) => {
  if (req.session.user) {
    const { accessToken, refreshToken, idToken, ...safeUser } = req.session.user;
    res.json({
      authenticated: true,
      user: safeUser,
      currentOrganizationId: req.session.currentOrganizationId,
    });
  } else {
    res.json({
      authenticated: false,
    });
  }
});

// Logout
router.post('/logout', (req, res) => {
  try {
    req.session.destroy((err) => {
      if (err) {
        console.error('Session destroy error:', err);
      }
    });

    res.clearCookie('connect.sid', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/'
    });

    console.log('✅ Payroll user logged out successfully');
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.json({ success: true, message: 'Logged out successfully' });
  }
});

// Switch organization
router.post('/switch-organization', requireAuth, async (req, res) => {
  const { organizationId } = req.body;

  if (!organizationId) {
    return res.status(400).json({ error: 'organizationId is required' });
  }

  try {
    // Verify user is a member of the target organization
    const user = req.session.user;
    const organizations = user.organizations || [];
    const targetOrg = organizations.find(org => org.id === organizationId);

    if (!targetOrg) {
      return res.status(403).json({
        error: 'Not a member of the specified organization',
        code: 'NOT_MEMBER'
      });
    }

    // Verify subscription access for the target organization
    console.log('🔒 Verifying subscription access for org:', organizationId);
    const subscriptionCheck = await verifySubscriptionAccess(
      organizationId,
      user.accessToken
    );

    if (!subscriptionCheck.allowed) {
      console.log('❌ Organization switch denied - no subscription:', subscriptionCheck.reason);
      return res.status(403).json({
        error: 'This organization does not have access to Payroll Management',
        code: 'SUBSCRIPTION_REQUIRED',
        reason: subscriptionCheck.reason,
        subscribeUrl: subscriptionCheck.subscribeUrl || `${getPayrollOidcClientConfig().issuerUrl}/plans`
      });
    }
    console.log('✅ Subscription access verified for payroll-management');

    // Switch the active organization - update both ID and full object
    req.session.currentOrganizationId = organizationId;
    req.session.user.currentOrganization = targetOrg;

    console.log('✅ Payroll organization switched to:', targetOrg.name, 'for', user.email);

    res.json({
      success: true,
      currentOrganizationId: organizationId,
      organization: targetOrg, // Return full organization object
      message: 'Organization switched successfully'
    });
  } catch (error) {
    console.error('Switch organization error:', error);
    res.status(500).json({ error: 'Failed to switch organization' });
  }
});

module.exports = router;

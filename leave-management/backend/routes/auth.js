const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const { Issuer, generators } = require('openid-client');

const { generateAuthUrl, getUserInfo } = require('../config/oidc');
const { authLimiter } = require('../middleware/rateLimiter');
const { asyncHandler } = require('../middleware/errorHandler');
const { logUserLogin } = require('../services/auditService');
const { requireAuth } = require('../middleware/auth');
const { verifySubscriptionAccess, getSubscriptionRequiredUrl } = require('../services/idpSubscriptionService');

const isProduction = process.env.NODE_ENV === 'production';

function resolveCurrentOrganization(userinfo = {}) {
  return userinfo.currentOrganization || userinfo.current_organization || null;
}

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

// OIDC Start - Hub-initiated or direct login
router.get('/oidc/start', async (req, res) => {
  try {
    // Check if this is IdP-initiated SSO from the hub
    const isIdpInitiated = req.query.idp_initiated === 'true';
    const hubToken = req.query.hub_token; // SSO token from hub

    console.log('🚀 OIDC Start:', {
      idp_initiated: isIdpInitiated,
      has_hub_token: !!hubToken,
      returnTo: req.query.returnTo,
      referer: req.headers['referer']
    });

    // Validate required environment variables
    const issuerUrl = process.env.IDP_ISSUER_URL;
    if (!issuerUrl) {
      return res.status(500).json({ msg: 'IDP_ISSUER_URL not configured' });
    }

    const clientId = process.env.OIDC_CLIENT_ID;
    const clientSecret = process.env.OIDC_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return res.status(500).json({ msg: 'OIDC client credentials not configured' });
    }

    // Prefer the configured redirect URI (required for production correctness).
    // Falling back to dynamic construction can produce http:// behind proxies if trust proxy isn't set.
    const callbackPath = '/api/auth/oidc/callback';
    const redirectUri =
      process.env.OIDC_REDIRECT_URI ||
      `${req.protocol}://${req.get('host')}${callbackPath}`;

    // Get returnTo from query parameter or headers
    const returnTo = req.query.returnTo || req.headers['referer'] || req.headers['origin'];
    if (!returnTo) {
      return res.status(400).json({ msg: 'returnTo parameter required' });
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

    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);

    // Create state payload with returnTo URL encoded
    const statePayload = {
      nonce: generators.nonce(),
      random: generators.state(),
      returnTo: returnTo
    };

    // Sign state with JWT for security
    const state = jwt.sign(statePayload, process.env.JWT_SECRET || 'default-secret', { expiresIn: '10m' });

    // These cookies must survive cross-site redirects (Netlify -> Backend -> IdP -> Backend).
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
    // For app-initiated SSO (login button), optionally force fresh login
    const promptValue = isIdpInitiated ? undefined : 'login';

    console.log('🔐 OIDC Auth Parameters:', {
      idp_initiated: isIdpInitiated,
      has_hub_token: !!hubToken,
      prompt: promptValue || 'none (will use existing session)',
      redirectUri: redirectUri,
      issuerUrl: issuerUrl
    });

    const authParams = {
      scope: 'openid email profile organizations teams',
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
    // The IdP will verify this token and auto-login the user
    if (hubToken) {
      authParams.hub_token = hubToken;
    }

    const url = client.authorizationUrl(authParams);

    res.redirect(url);
  } catch (e) {
    console.error('OIDC start error:', e);
    const issuerUrl = process.env.IDP_ISSUER_URL || 'https://auth.seemplifyai.com';
    return res.redirect(`${issuerUrl}/sso/recovery?app=leave-management&error=server_error&reason=${encodeURIComponent('The app could not contact the identity service')}`);
  }
});

// Initiate OIDC login - redirects to Identity Provider
router.get('/login', authLimiter, asyncHandler(async (req, res) => {
  // Generate state and nonce for security
  const state = uuidv4();
  const nonce = uuidv4();

  // Store in session for verification
  req.session.oidcState = state;
  req.session.oidcNonce = nonce;

  // Optional: Store return URL
  if (req.query.returnUrl) {
    req.session.returnUrl = req.query.returnUrl;
  }

  // Generate authorization URL with PKCE
  const { url: authUrl, codeVerifier } = generateAuthUrl(state, nonce);
  
  // Store code verifier in session for token exchange
  req.session.oidcCodeVerifier = codeVerifier;

  // Redirect to Identity Provider
  res.redirect(authUrl);
}));

// OIDC callback - handles response from Identity Provider
router.get('/oidc/callback', authLimiter, asyncHandler(async (req, res) => {
  console.log('🎯 OIDC Callback received:', {
    hasCode: !!req.query.code,
    hasState: !!req.query.state,
    hasError: !!req.query.error
  });

  // Handle errors from IdP
  if (req.query.error) {
    console.error('OIDC error:', req.query.error, req.query.error_description);
    return res.redirect(
      `${process.env.FRONTEND_URL}/login?error=${encodeURIComponent(req.query.error_description || req.query.error)}`
    );
  }

  // Validate required environment variables
  const issuerUrl = process.env.IDP_ISSUER_URL;
  if (!issuerUrl) {
    return res.status(500).json({ msg: 'IDP_ISSUER_URL not configured' });
  }

  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({ msg: 'OIDC client credentials not configured' });
  }

  try {
    const callbackPath = '/api/auth/oidc/callback';
    const redirectUri =
      process.env.OIDC_REDIRECT_URI ||
      `${req.protocol}://${req.get('host')}${callbackPath}`;

    // Check for both cookie-based (Hub flow) and session-based (direct login) state
    const stateCookie = req.cookies.oidc_state;
    const stateSession = req.session.oidcState;

    let returnTo = '/dashboard';
    let nonce;
    let stateValue;

    if (stateCookie) {
      // Cookie-based flow (from Hub /oidc/start)
      let statePayload;
      try {
        statePayload = jwt.verify(stateCookie, process.env.JWT_SECRET || 'default-secret');
        returnTo = statePayload.returnTo || '/dashboard';
        nonce = statePayload.nonce;
        stateValue = stateCookie; // Use the JWT token as state
      } catch (err) {
        console.error('State verification error:', err);
        return res.redirect(
          `${process.env.FRONTEND_URL}/login?error=${encodeURIComponent('Invalid or expired state')}`
        );
      }
    } else if (stateSession) {
      // Session-based flow (from /login)
      returnTo = req.session.returnUrl || '/dashboard';
      nonce = req.session.oidcNonce;
      stateValue = stateSession;
    } else {
      return res.status(400).json({ msg: 'Missing state cookie or session' });
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
      state: stateValue,
      nonce: nonce,
      code_verifier: req.cookies.oidc_verifier || req.session.oidcCodeVerifier
    };

    const tokenSet = await client.callback(redirectUri, params, checks);
    const userinfo = await client.userinfo(tokenSet);
    const currentOrganization = resolveCurrentOrganization(userinfo);

    console.log('✅ OIDC tokens received for:', userinfo.email);
    console.log('📊 Organization claims:', userinfo.organizations ? userinfo.organizations.length : 0, 'organizations');
    if (userinfo.organizations && userinfo.organizations.length > 0) {
      console.log('📋 Organizations:', userinfo.organizations.map(o => ({ id: o.id, name: o.name, role: o.role })));
    }
    console.log('👥 Team claims:', userinfo.teams ? userinfo.teams.length : 0, 'teams');
    console.log('🏢 Current Organization:', userinfo.currentOrganization ? { id: userinfo.currentOrganization.id, name: userinfo.currentOrganization.name } : 'none');

    // Store in session
    req.session.user = {
      id: userinfo.sub,
      email: userinfo.email,
      name: userinfo.name,
      organizations: userinfo.organizations || [],
      teams: userinfo.teams || [],
      currentOrganization,
      accessToken: tokenSet.access_token,
      refreshToken: tokenSet.refresh_token,
      idToken: tokenSet.id_token,
      tokenExpiry: tokenSet.expires_at,
      userinfo,
    };

    // Clear OIDC state and PKCE verifier (both cookies and session)
    res.clearCookie('oidc_verifier');
    res.clearCookie('oidc_state');
    delete req.session.oidcState;
    delete req.session.oidcNonce;
    delete req.session.oidcCodeVerifier;

    // Set current organization if available
    if (currentOrganization) {
      req.session.currentOrganizationId = currentOrganization.id;
    } else if (userinfo.organizations?.length > 0) {
      req.session.currentOrganizationId = userinfo.organizations[0].id;
    }

    // Log the login (only if we have an organization)
    if (req.session.currentOrganizationId) {
      await logUserLogin(
        { id: userinfo.sub, name: userinfo.name, email: userinfo.email },
        req.session.currentOrganizationId,
        req
      );
    } else {
      console.warn('⚠️ User logged in but has no organizations:', userinfo.email);
    }

    // Verify subscription access for the current organization
    if (req.session.currentOrganizationId) {
      console.log('🔒 Verifying subscription access for org:', req.session.currentOrganizationId);
      const subscriptionCheck = await verifySubscriptionAccess(
        req.session.currentOrganizationId,
        tokenSet.access_token
      );

      if (!subscriptionCheck.allowed) {
        console.log('❌ Subscription access denied:', subscriptionCheck.reason);
        // Save organization ID before destroying session
        const orgId = req.session.currentOrganizationId;
        // Clear session since we're not allowing access
        req.session.destroy((err) => {
          if (err) console.error('Session destroy error:', err);
        });
        // Redirect to IDP subscription required page
        const subscriptionUrl = getSubscriptionRequiredUrl(
          'leave-management',
          orgId,
          subscriptionCheck.reason
        );
        return res.redirect(subscriptionUrl);
      }
      console.log('✅ Subscription access verified for leave-management');
    }

    // Redirect to dashboard or return URL
    const returnUrl = req.session.returnUrl || '/dashboard';
    delete req.session.returnUrl;

    // Redirect to frontend with tokens
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5003';
    res.redirect(`${frontendUrl}${returnUrl}#access_token=${tokenSet.access_token}`);
  } catch (error) {
    console.error('OIDC callback error:', error);
    return res.redirect(
      `${process.env.FRONTEND_URL}/login?error=${encodeURIComponent('Authentication failed')}`
    );
  }
}));

// Logout
router.post('/logout', asyncHandler(async (req, res) => {
  try {
    // Clear session
    req.session.destroy((err) => {
      if (err) {
        console.error('Session destroy error:', err);
      }
    });

    // Clear session cookie
    res.clearCookie('connect.sid', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/'
    });

    console.log('✅ User logged out successfully');

    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    // Still return success even if there's an error, to allow frontend to clear state
    res.json({ success: true, message: 'Logged out successfully' });
  }
}));

// Get current user
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  // Return user info (without sensitive tokens)
  const { accessToken, refreshToken, idToken, ...safeUser } = req.user;

  res.json({
    user: safeUser,
    currentOrganizationId: req.session?.currentOrganizationId || req.user.currentOrganization?.id,
  });
}));

// Refresh token
router.post('/refresh', asyncHandler(async (req, res) => {
  if (!req.session.user?.refreshToken) {
    return res.status(401).json({
      error: 'No refresh token available',
      code: 'NO_REFRESH_TOKEN',
    });
  }

  try {
    const { refreshTokens } = require('../config/oidc');
    const tokenSet = await refreshTokens(req.session.user.refreshToken);

    // Update session with new tokens
    req.session.user = {
      ...req.session.user,
      accessToken: tokenSet.access_token,
      refreshToken: tokenSet.refresh_token || req.session.user.refreshToken,
      idToken: tokenSet.id_token,
      tokenExpiry: tokenSet.expires_at,
    };

    // Get fresh userinfo
    const userinfo = await getUserInfo(tokenSet.access_token);
    const currentOrganization = resolveCurrentOrganization(userinfo);
    req.session.user.userinfo = userinfo;
    req.session.user.organizations = userinfo.organizations || [];
    req.session.user.teams = userinfo.teams || [];
    req.session.user.currentOrganization = currentOrganization;
    if (currentOrganization?.id) {
      req.session.currentOrganizationId = currentOrganization.id;
    }

    res.json({
      success: true,
      tokenExpiry: tokenSet.expires_at,
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    return res.status(401).json({
      error: 'Token refresh failed',
      code: 'REFRESH_FAILED',
    });
  }
}));

// Switch organization
router.post('/switch-organization', requireAuth, asyncHandler(async (req, res) => {
  const { organizationId } = req.body;

  // Verify user belongs to organization
  const userOrgs = req.user.organizations || [];
  const org = userOrgs.find(o => o.id === organizationId);

  if (!org) {
    return res.status(403).json({
      error: 'You are not a member of this organization',
      code: 'ORG_ACCESS_DENIED',
    });
  }

  // Verify subscription access for the target organization
  const subscriptionCheck = await verifySubscriptionAccess(
    organizationId,
    req.user.accessToken
  );

  if (!subscriptionCheck.allowed) {
    console.log('❌ Organization switch denied - no subscription:', subscriptionCheck.reason);
    return res.status(403).json({
      error: 'This organization does not have access to Leave Management',
      code: 'SUBSCRIPTION_REQUIRED',
      reason: subscriptionCheck.reason,
      subscribeUrl: subscriptionCheck.subscribeUrl || `${process.env.IDP_URL || 'http://localhost:4000'}/plans`
    });
  }

  // Update session if available
  if (req.session) {
    req.session.currentOrganizationId = organizationId;
  }

  res.json({
    success: true,
    currentOrganizationId: organizationId,
    organization: org,
  });
}));

module.exports = router;

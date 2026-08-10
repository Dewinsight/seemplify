const crypto = require('crypto');
const emailService = require('../services/emailService');
const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const browserFingerprintService = require('../services/browserFingerprintService');
const otpService = require('../services/otpService');
const sessionService = require('../services/sessionService');
const jwt = require('jsonwebtoken');
const { Issuer, generators } = require('openid-client');
const {
  getAuthoritativeOrganizationName,
  organizationNameNeedsSync
} = require('../utils/organizationIdentitySync');
const {
  getOidcCallbackTarget,
  normalizeOidcReturnTo,
  normalizeOidcWorkspace
} = require('../utils/oidcReturnTo');
const {
  canUseLocalCredentials,
  firstRecruiterAuthorizedMembership,
  organizationClaimAllowsRecruiter,
  passwordResetQuery,
  recruiterAuthorizedClaims
} = require('../services/sharedAIUserSecurity');
const { materializeRecruiterOrganizations } = require('../services/recruiterOrganizationSync');

const router = express.Router();

// =============================================================================
// OIDC ISSUER CACHING - Avoid expensive discovery on every request
// =============================================================================
let cachedIssuer = null;
let cachedIssuerUrl = null;
let cachedIssuerExpiry = null;
const ISSUER_CACHE_TTL = 60 * 60 * 1000; // 1 hour cache

const AKWA_IBOM_IDP = 'https://akwa.aiinnigeria.com';

function resolveIssuerUrl(req, validatedReturnTo = '') {
  const defaultIssuer = process.env.OIDC_ISSUER;
  const returnTo = validatedReturnTo || req.query.returnTo || req.headers['referer'] || req.headers['origin'] || '';
  try {
    const origin = new URL(returnTo);
    if (origin.hostname.includes('ibom') || origin.hostname.includes('akwa') || origin.hostname.includes('jetstone')) {
      return AKWA_IBOM_IDP;
    }
  } catch (_) {}
  return defaultIssuer;
}

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

// @route   POST /api/auth/signup
// @desc    Register a new user
// @access  Public
router.post('/signup', async (req, res) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    return res.status(400).json({ msg: 'Please enter all fields' });
  }

  try {
    // Check for existing user
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ msg: 'User already exists' });
    }

    // Create new user
    user = new User({
      email,
      password,
    });

    // Hash password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);

    // Save user to database
    await user.save();

    try {
      // Generate browser fingerprint
      const fingerprintData = browserFingerprintService.generateFingerprint(req);

      // Create session with proper tokens
      const { accessToken, refreshToken, session } = await sessionService.createSession({
        user,
        fingerprint: fingerprintData.fingerprint,
        userAgent: req.headers['user-agent'] || 'unknown',
        ip: req.ip,
      });

      // Trust this browser for future logins
      await browserFingerprintService.trustBrowser(user, fingerprintData.fingerprint);

      // Return both tokens for proper authentication
      res.json({
        token: accessToken,
        refreshToken,
        expiresIn: process.env.JWT_ACCESS_TTL || '10m',
        sessionId: session.accessTokenId,
        user: {
          id: user.id,
          email: user.email
        }
      });
    } catch (sessionErr) {
      console.error('Session creation error:', sessionErr);

      // Fallback to simple JWT if session creation fails
      const payload = {
        user: {
          id: user.id,
        },
      };

      jwt.sign(
        payload,
        process.env.JWT_SECRET,
        { expiresIn: '7d' },
        (err, token) => {
          if (err) {
            console.error(err.message);
            return res.status(500).send('Server error on token generation');
          }
          // Note: This fallback doesn't include refresh token
          // Client should handle this case appropriately
          res.json({
            token,
            fallback: true,
            message: 'Session creation failed, using fallback authentication'
          });
        }
      );
    }
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   POST /api/auth/login
// @desc    Authenticate user & get token (with MFA for new browsers)
// @access  Public
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    return res.status(400).json({ msg: 'Please enter all fields' });
  }

  try {
    // Check for user
    let user = await User.findOne({ email });
    if (!canUseLocalCredentials(user)) {
      return res.status(400).json({ msg: 'Invalid credentials' });
    }

    // Validate password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ msg: 'Invalid credentials' });
    }

    // Generate browser fingerprint
    const fingerprintData = browserFingerprintService.generateFingerprint(req);

    // Check if browser is trusted
    const isTrusted = browserFingerprintService.isBrowserTrusted(user, fingerprintData.fingerprint);

    // If browser is not trusted, require OTP
    if (!isTrusted) {
      // Check if user can receive OTP (rate limiting)
      const canSend = otpService.canSendOTP(user);

      // Even if rate limited, still show OTP modal so user can enter existing OTP
      if (!canSend.allowed) {
        return res.status(200).json({
          requiresOTP: true,
          message: canSend.reason,
          browserInfo: fingerprintData.browserInfo,
          rateLimited: true  // Flag to indicate rate limiting
        });
      }

      // Generate and send OTP
      const otp = otpService.generateOTP();
      otpService.storeOTP(user.id, otp, 'login');

      // Update user's last OTP sent time
      user.security = user.security || {};
      user.security.lastOtpSent = new Date();
      await user.save();

      // Send OTP email
      try {
        await otpService.sendOTPEmail(user, otp, fingerprintData.browserInfo);
      } catch (emailError) {
        console.error('Failed to send OTP email:', emailError);
        return res.status(500).json({ msg: 'Failed to send verification email' });
      }

      // Return response indicating OTP is required
      return res.status(200).json({
        requiresOTP: true,
        message: 'Verification code sent to your email',
        browserInfo: fingerprintData.browserInfo
      });
    }

    // Browser is trusted, update last used
    await browserFingerprintService.updateBrowserLastUsed(user, fingerprintData.fingerprint);

    const { accessToken, refreshToken, session } = await sessionService.createSession({
      user,
      fingerprint: fingerprintData.fingerprint,
      userAgent: req.headers['user-agent'] || 'unknown',
      ip: req.ip,
    });

    res.json({
      token: accessToken,
      refreshToken,
      expiresIn: process.env.JWT_ACCESS_TTL || '10m',
      sessionId: session.accessTokenId,
      user: {
        id: user.id,
        email: user.email,
        mfaEnabled: user.security?.mfaEnabled || false
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});
// @route   POST /api/auth/verify-otp
// @desc    Verify OTP and complete login
// @access  Public
router.post('/verify-otp', async (req, res) => {
  const { email, otp } = req.body;

  // Validate input
  if (!email || !otp) {
    return res.status(400).json({ msg: 'Please provide email and OTP' });
  }

  try {
    // Find user
    const user = await User.findOne({ email });
    if (!canUseLocalCredentials(user)) {
      return res.status(400).json({ msg: 'Invalid request' });
    }

    // Verify OTP
    const verificationResult = otpService.verifyOTP(user.id, otp, 'login');

    if (!verificationResult.valid) {
      // Update failed attempts
      await otpService.updateOTPAttempts(user, true);

      return res.status(400).json({
        msg: verificationResult.reason,
        remainingAttempts: verificationResult.remainingAttempts
      });
    }

    // OTP is valid, reset attempts
    await otpService.updateOTPAttempts(user, false);

    // Get browser fingerprint and add to trusted browsers
    const fingerprintData = browserFingerprintService.generateFingerprint(req);
    await browserFingerprintService.addTrustedBrowser(user, fingerprintData);

    // Enable MFA if not already enabled
    if (!user.security?.mfaEnabled) {
      user.security = user.security || {};
      user.security.mfaEnabled = true;
      await user.save();
    }

    const { accessToken, refreshToken, session } = await sessionService.createSession({
      user,
      fingerprint: fingerprintData.fingerprint,
      userAgent: req.headers['user-agent'] || 'unknown',
      ip: req.ip,
    });

    res.json({
      token: accessToken,
      refreshToken,
      expiresIn: process.env.JWT_ACCESS_TTL || '10m',
      sessionId: session.accessTokenId,
      user: {
        id: user.id,
        email: user.email,
        mfaEnabled: true
      },
      message: 'Device trusted successfully'
    });
  } catch (err) {
    console.error('OTP verification error:', err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

router.post('/refresh-token', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ msg: 'Refresh token is required' });
  }

  try {
    const fingerprintData = browserFingerprintService.generateFingerprint(req);
    const { accessToken, refreshToken: newRefreshToken, user } = await sessionService.refreshSession(
      refreshToken,
      fingerprintData.fingerprint,
      req.headers['user-agent'] || 'unknown',
      req.ip,
    );

    res.json({
      token: accessToken,
      refreshToken: newRefreshToken,
      expiresIn: process.env.JWT_ACCESS_TTL || '10m',
      sessionVersion: user.security?.sessionVersion || 1,
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    const codeMap = {
      invalid_refresh_token: 'invalid_refresh_token',
      session_revoked: 'session_revoked',
      refresh_expired: 'refresh_expired',
      user_not_found: 'user_not_found',
    };

    const code = codeMap[error.message] || 'refresh_failed';
    res.status(401).json({ msg: 'Refresh token invalid or expired', code });
  }
});

// @route   POST /api/auth/resend-otp
// @desc    Resend OTP for login
// @access  Public
router.post('/resend-otp', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ msg: 'Email is required' });
  }

  try {
    const user = await User.findOne({ email });
    if (!canUseLocalCredentials(user)) {
      return res.status(400).json({ msg: 'Invalid request' });
    }

    // Check if user can receive OTP (rate limiting)
    const canSend = otpService.canSendOTP(user);
    if (!canSend.allowed) {
      return res.status(429).json({ msg: canSend.reason });
    }

    // Clear old OTP and generate new one
    otpService.clearOTP(user.id, 'login');
    const otp = otpService.generateOTP();
    otpService.storeOTP(user.id, otp, 'login');

    // Update last OTP sent time
    user.security = user.security || {};
    user.security.lastOtpSent = new Date();
    await user.save();

    // Get browser info for email
    const fingerprintData = browserFingerprintService.generateFingerprint(req);

    // Send OTP email
    try {
      await otpService.sendOTPEmail(user, otp, fingerprintData.browserInfo);
      res.json({
        message: 'New verification code sent to your email',
        nextResendIn: 60 // seconds
      });
    } catch (emailError) {
      console.error('Failed to send OTP email:', emailError);
      return res.status(500).json({ msg: 'Failed to send verification email' });
    }
  } catch (err) {
    console.error('Resend OTP error:', err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   POST /api/auth/forgot-password
// @desc    Request password reset
// @access  Public
router.post('/forgot-password', async (req, res) => {
  const { email, frontendUrl } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!canUseLocalCredentials(user)) {
      // We don't want to reveal that the user doesn't exist
      return res.status(200).json({ msg: 'If a user with that email exists, a password reset link has been sent.' });
    }

    // Generate token
    const token = crypto.randomBytes(20).toString('hex');

    // Set token and expiration on user
    user.resetPasswordToken = token;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour

    await user.save();

    // Send email with dynamic frontend URL
    await emailService.sendPasswordResetEmail(user.email, token, frontendUrl);

    res.json({ msg: 'If a user with that email exists, a password reset link has been sent.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).send('Server error');
  }
});

// @route   POST /api/auth/reset-password
// @desc    Reset password
// @access  Public
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;

  try {
    const user = await User.findOne(passwordResetQuery(token));

    if (!user) {
      return res.status(400).json({ msg: 'Password reset token is invalid or has expired.' });
    }

    // Set new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    user.lastPasswordChange = new Date();

    await user.save();

    res.json({ msg: 'Password has been reset successfully.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).send('Server error');
  }
});

router.get('/oidc/start', async (req, res) => {
  const startTime = Date.now();
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

    const requestedReturnTo = req.query.returnTo || req.headers['referer'] || req.headers['origin'];
    if (!requestedReturnTo) {
      return res.status(400).json({ msg: 'returnTo parameter required' });
    }

    const returnTo = normalizeOidcReturnTo(requestedReturnTo);
    if (!returnTo) {
      return res.status(400).json({ msg: 'Invalid returnTo URL' });
    }

    const issuerUrl = resolveIssuerUrl(req, returnTo);
    if (!issuerUrl) {
      return res.status(500).json({ msg: 'OIDC_ISSUER not configured' });
    }

    const clientId = process.env.OIDC_CLIENT_ID;
    const clientSecret = process.env.OIDC_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return res.status(500).json({ msg: 'OIDC client credentials not configured' });
    }

    const protocol = req.protocol;
    const host = req.get('host');
    const callbackPath = '/api/auth/oidc/callback';
    const redirectUri = `${protocol}://${host}${callbackPath}`;

    const issuer = await getCachedIssuer(issuerUrl);
    const client = new issuer.Client({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: [redirectUri],
      response_types: ['code']
    });

    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);

    // Create state payload with returnTo URL encoded
    const statePayload = {
      nonce: generators.nonce(),
      random: generators.state(),
      returnTo: returnTo,
      issuerUrl: issuerUrl,
      workspace: normalizeOidcWorkspace(req.query.workspace) || undefined,
    };

    // Sign state with JWT for security
    const state = jwt.sign(statePayload, process.env.JWT_SECRET, { expiresIn: '10m' });

    res.cookie('oidc_verifier', codeVerifier, { httpOnly: true, sameSite: 'lax' });
    res.cookie('oidc_state', state, { httpOnly: true, sameSite: 'lax' });

    // Reuse the central IdP session for direct app entry as well as hub entry.
    // Only explicit account-switch/re-auth flows should force credentials.
    const promptValue = req.query.force_login === 'true' ? 'login' : undefined;

    console.log('🔐 OIDC Auth Parameters:', {
      idp_initiated: isIdpInitiated,
      has_hub_token: !!hubToken,
      prompt: promptValue || 'none (will use existing session)',
      redirectUri: redirectUri,
      issuerUrl: issuerUrl
    });

    const authParams = {
      scope: 'openid email profile',
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

    console.log(`⏱️ OIDC Start total time: ${Date.now() - startTime}ms`);
    res.redirect(url);
  } catch (e) {
    console.error('OIDC start error:', e);
    const issuerUrl = process.env.IDP_ISSUER_URL || 'https://auth.seemplifyai.com';
    return res.redirect(`${issuerUrl}/sso/recovery?app=smarthr&error=server_error&reason=${encodeURIComponent('The app could not contact the identity service')}`);
  }
});

router.get('/oidc/callback', async (req, res) => {
  const callbackStartTime = Date.now();
  try {
    console.log('🎯 OIDC Callback received:', {
      hasCode: !!req.query.code,
      hasState: !!req.query.state,
      hasError: !!req.query.error,
      error: req.query.error,
      errorDescription: req.query.error_description
    });

    // Check if IdP returned an error directly in the callback URL
    if (req.query.error) {
      console.error('❌ IdP returned error:', req.query.error, req.query.error_description);
      return res.status(400).json({
        msg: 'OIDC callback failed',
        error: `${req.query.error}: ${req.query.error_description || 'Unknown IdP error'}`
      });
    }

    const clientId = process.env.OIDC_CLIENT_ID;
    const clientSecret = process.env.OIDC_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return res.status(500).json({ msg: 'OIDC client credentials not configured' });
    }

    const protocol = req.protocol;
    const host = req.get('host');
    const callbackPath = '/api/auth/oidc/callback';
    const redirectUri = `${protocol}://${host}${callbackPath}`;

    const stateCookie = req.cookies['oidc_state'];
    if (!stateCookie) {
      return res.status(400).json({ msg: 'Missing state cookie' });
    }

    let statePayload;
    try {
      statePayload = jwt.verify(stateCookie, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(400).json({ msg: 'Invalid or expired state' });
    }

    const issuerUrl = statePayload.issuerUrl || process.env.OIDC_ISSUER;
    if (!issuerUrl) {
      return res.status(500).json({ msg: 'OIDC_ISSUER not configured' });
    }

    const issuer = await getCachedIssuer(issuerUrl);
    const client = new issuer.Client({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: [redirectUri],
      response_types: ['code']
    });

    const params = client.callbackParams(req);
    const checks = {
      state: stateCookie,
      nonce: statePayload.nonce,
      code_verifier: req.cookies['oidc_verifier']
    };

    const tokenSet = await client.callback(redirectUri, params, checks);
    const userinfo = await client.userinfo(tokenSet);
    const email = String(userinfo.email || '').trim().toLowerCase();
    const idpSubject = String(userinfo.sub || '').trim();
    if (!email || !idpSubject) {
      return res.status(400).json({ msg: 'The identity provider did not return a stable subject and email.' });
    }

    console.log('✅ OIDC tokens received for:', email);
    console.log('📊 Organization claims:', userinfo.organizations ? userinfo.organizations.length : 0, 'organizations');
    console.log('👥 Team claims:', userinfo.teams ? userinfo.teams.length : 0, 'teams');

    // A stable IdP subject remains authoritative when a person's verified
    // email changes. Email is also resolved to migrate older Recruiter rows;
    // resolving both prevents duplicate users and subject/email takeovers.
    const [userBySubject, userByEmail] = await Promise.all([
      User.findOne({ idpSubject }),
      User.findOne({ email })
    ]);
    if (userBySubject && userByEmail && String(userBySubject._id) !== String(userByEmail._id)) {
      return res.status(409).json({
        code: 'IDP_SUBJECT_CONFLICT',
        msg: 'This identity is already linked to a different Seemplify account.'
      });
    }

    let user = userBySubject || userByEmail;
    if (user?.idpSubject && user.idpSubject !== idpSubject) {
      return res.status(409).json({
        code: 'IDP_SUBJECT_CONFLICT',
        msg: 'This identity is already linked to a different Seemplify account.'
      });
    }
    const wasSharedAIOnly = user?.sharedAIOnly === true;
    const recruiterOrganizationClaims = recruiterAuthorizedClaims(userinfo.organizations);
    const hasOrganizationClaims = Array.isArray(userinfo.organizations) && userinfo.organizations.length > 0;
    if ((wasSharedAIOnly || hasOrganizationClaims) && recruiterOrganizationClaims.length === 0) {
      return res.status(403).json({
        code: 'RECRUITER_APP_ACCESS_REQUIRED',
        msg: 'Your organization has not granted this identity access to Recruiter.'
      });
    }
    if (!user) {
      const salt = await bcrypt.genSalt(10);
      const randomPassword = crypto.randomBytes(12).toString('hex');
      const hash = await bcrypt.hash(randomPassword, salt);
      user = new User({ email, password: hash, idpSubject });
      await user.save();
      console.log('👤 Created new user:', email);
    }

    let shouldSaveUser = false;

    // Keep the IdP subject as the cross-product identity. Existing users are
    // backfilled on their next OIDC sign-in; a conflicting subject is never
    // silently replaced because that could attach another person's shared AI
    // connection to this account.
    if (idpSubject && !user.idpSubject) {
      user.idpSubject = idpSubject;
      shouldSaveUser = true;
    } else if (idpSubject && user.idpSubject && user.idpSubject !== idpSubject) {
      console.error('OIDC subject conflict for:', email);
      return res.status(409).json({
        code: 'IDP_SUBJECT_CONFLICT',
        msg: 'This identity is already linked to a different Seemplify account.'
      });
    }
    if (String(user.email || '').toLowerCase() !== email) {
      user.email = email;
      shouldSaveUser = true;
    }

    // ==========================================================================
    // OPTIMIZED: Organization sync with batch lookups and bulk operations
    // ==========================================================================
    if (Array.isArray(userinfo.organizations)) {
      const orgSyncStart = Date.now();
      const Organization = require('../models/Organization');
      const claimedLocalOrgIds = new Set();
      const recruiterAuthorizedLocalOrgIds = new Set();
      let sharedAIOnlyMembershipSynced = false;

      // OPTIMIZATION: Batch lookup all organizations by IdP IDs in ONE query
      const orgIdpIds = recruiterOrganizationClaims.map(org => org.id);
      const existingOrgs = await Organization.find({
        idpOrganizationId: { $in: orgIdpIds }
      }).lean();

      // Create lookup map for O(1) access
      const orgByIdpId = await materializeRecruiterOrganizations({
        Organization,
        user,
        claims: recruiterOrganizationClaims,
        existingOrganizations: existingOrgs
      });

      console.log(`⏱️ [PERF] Batch org lookup: ${existingOrgs.length}/${orgIdpIds.length} found in ${Date.now() - orgSyncStart}ms`);

      // Track organizations that need to be saved (for bulk write)
      const orgsToUpdate = [];
      const authoritativeRolesByLocalOrgId = new Map();

      for (const orgClaim of recruiterOrganizationClaims) {
        let organization = orgByIdpId.get(String(orgClaim.id));

        if (!organization) {
          // Check if user has an organization (for migration) - only on first org
          if (orgsToUpdate.length === 0) {
            const existingOrg = await Organization.findOne({ 'members.user': user._id });

            if (existingOrg && !existingOrg.idpOrganizationId) {
              // Link existing organization to IdP
              orgsToUpdate.push({
                updateOne: {
                  filter: { _id: existingOrg._id },
                  update: { $set: { idpOrganizationId: orgClaim.id } }
                }
              });
              organization = existingOrg;
              orgByIdpId.set(orgClaim.id, existingOrg);
              console.log('🔗 Linked existing organization to IdP:', existingOrg.name);
            } else if (!existingOrg) {
              // Create new organization from IdP claim
              const newOrg = new Organization({
                name: orgClaim.name || `Organization ${orgClaim.id.slice(-8)}`,
                owner: user._id,
                idpOrganizationId: orgClaim.id,
                members: [{
                  user: user._id,
                  role: orgClaim.role,
                  status: 'active',
                  joinedAt: orgClaim.joinedAt || new Date()
                }]
              });
              await newOrg.save();
              organization = newOrg;
              orgByIdpId.set(orgClaim.id, newOrg);
              console.log('🏢 Created organization from IdP claim:', newOrg.name);
            }
          }
        } else {
          // Organization exists, ensure user is a member with correct role
          const userIdStr = user._id.toString();
          const isMember = organization.members.some(
            m => m.user.toString() === userIdStr && m.status === 'active'
          );

          if (!isMember) {
            orgsToUpdate.push({
              updateOne: {
                filter: { _id: organization._id },
                update: {
                  $push: {
                    members: {
                      user: user._id,
                      role: orgClaim.role,
                      status: 'active',
                      joinedAt: orgClaim.joinedAt || new Date()
                    }
                  }
                }
              }
            });
            console.log('➕ Will add user to organization:', organization.name);
          } else {
            // Update role if changed
            const member = organization.members.find(m => m.user.toString() === userIdStr);
            if (member && member.role !== orgClaim.role) {
              orgsToUpdate.push({
                updateOne: {
                  filter: { _id: organization._id, 'members.user': user._id },
                  update: { $set: { 'members.$.role': orgClaim.role } }
                }
              });
              console.log('🔄 Will update user role in organization:', organization.name);
            }
          }
        }

        if (organization && organizationNameNeedsSync(organization, orgClaim)) {
          const authoritativeName = getAuthoritativeOrganizationName(orgClaim);
          orgsToUpdate.push({
            updateOne: {
              filter: { _id: organization._id },
              update: { $set: { name: authoritativeName, updatedAt: new Date() } }
            }
          });
          organization.name = authoritativeName;
        }

        // Sync user's org memberships to match IdP claims (source of truth)
        if (organization) {
          const localOrganizationId = organization._id.toString();
          claimedLocalOrgIds.add(localOrganizationId);
          authoritativeRolesByLocalOrgId.set(localOrganizationId, orgClaim.role);
          user.addOrganizationMembership(organization._id, orgClaim.role, true);
          shouldSaveUser = true;
          if (organizationClaimAllowsRecruiter(orgClaim)) {
            recruiterAuthorizedLocalOrgIds.add(organization._id.toString());
            sharedAIOnlyMembershipSynced = true;
          }
        }
      }

      // OPTIMIZATION: Execute all organization updates in a single bulk write
      if (orgsToUpdate.length > 0) {
        const bulkStart = Date.now();
        await Organization.bulkWrite(orgsToUpdate);
        console.log(`⏱️ [PERF] Bulk org update: ${orgsToUpdate.length} operations in ${Date.now() - bulkStart}ms`);
      }

      // Deactivate memberships that are no longer present in IdP claims
      if (Array.isArray(user.organizationMemberships) && user.organizationMemberships.length > 0) {
        user.organizationMemberships.forEach(m => {
          if (!m.organization) return;
          const orgId = (m.organization._id || m.organization).toString();
          if (!claimedLocalOrgIds.has(orgId)) {
            m.isActive = false;
            shouldSaveUser = true;
          }
        });
      }

      // Deduplicate memberships (some older flows could create duplicates)
      if (Array.isArray(user.organizationMemberships) && user.organizationMemberships.length > 1) {
        const { deduplicateOrganizationMemberships } = require('../services/recruiterOrganizationSync');
        user.organizationMemberships = deduplicateOrganizationMemberships(
          user.organizationMemberships,
          authoritativeRolesByLocalOrgId
        );
        shouldSaveUser = true;
      }

      // Set current organization from IdP claim if provided
      const currentOrgClaimId = userinfo.current_organization?.id || userinfo.currentOrganization?.id;
      const currentOrgAuthorized = currentOrgClaimId
        && recruiterOrganizationClaims.some((claim) => claim.id === currentOrgClaimId);
      if (currentOrgAuthorized) {
        // Use cached lookup if available
        const currentOrgFromCache = orgByIdpId.get(String(currentOrgClaimId));
        if (currentOrgFromCache) {
          user.currentOrganization = currentOrgFromCache._id;
          user.hasCompletedOrganizationSetup = true;
          shouldSaveUser = true;
        }
      } else {
        // Never retain a Performance-only organization as Recruiter's current
        // workspace. Choose from the active, Recruiter-authorized memberships.
        const firstActive = firstRecruiterAuthorizedMembership(
          user,
          recruiterAuthorizedLocalOrgIds
        );
        if (firstActive?.organization) {
          user.currentOrganization = firstActive.organization;
          user.hasCompletedOrganizationSetup = true;
          shouldSaveUser = true;
        } else if (user.currentOrganization) {
          user.currentOrganization = null;
          user.hasCompletedOrganizationSetup = false;
          shouldSaveUser = true;
        }
      }

      // Only an OIDC membership sync for a Recruiter-authorized organization
      // can promote an identity-only shared-AI row into a Recruiter account.
      // Keeping this after the awaited organization writes prevents a partial
      // sync from accidentally enabling local Recruiter authentication.
      if (wasSharedAIOnly && sharedAIOnlyMembershipSynced) {
        user.sharedAIOnly = false;
        shouldSaveUser = true;
      }
      user.recruiterAuthorizedOrganizations = [...recruiterAuthorizedLocalOrgIds];
      user.recruiterAppAccessSyncedAt = new Date();
      shouldSaveUser = true;

      console.log(`⏱️ [PERF] Total org sync: ${Date.now() - orgSyncStart}ms`);
    }

    if (userinfo.sub && user.idpSubject !== userinfo.sub) {
      user.idpSubject = userinfo.sub;
      shouldSaveUser = true;
    }

    // Store team claims on user for potential use
    if (userinfo.teams) {
      user.idpTeams = userinfo.teams;
      shouldSaveUser = true;
    }

    // Store team permissions for leave management
    if (userinfo.team_permissions) {
      user.idpTeamPermissions = userinfo.team_permissions;
      shouldSaveUser = true;
    }

    // Store IdP access token for API calls to Identity Provider
    if (tokenSet.access_token) {
      user.idpAccessToken = tokenSet.access_token;
      user.idpTokenExpiry = new Date(Date.now() + ((tokenSet.expires_in || 3600) * 1000));
      if (tokenSet.refresh_token) {
        user.idpRefreshToken = tokenSet.refresh_token;
      }
      shouldSaveUser = true;
      console.log('💾 Stored IdP access token for user:', email);
    }

    if (shouldSaveUser) {
      await user.save();
    }

    const fingerprintData = browserFingerprintService.generateFingerprint(req);
    const { accessToken, refreshToken, session } = await sessionService.createSession({
      user,
      fingerprint: fingerprintData.fingerprint,
      userAgent: req.headers['user-agent'] || 'unknown',
      ip: req.ip
    });

    res.clearCookie('oidc_verifier');
    res.clearCookie('oidc_state');

    // Extract returnTo from state payload
    const returnTo = statePayload.returnTo;
    if (!returnTo) {
      return res.status(400).json({ msg: 'Missing returnTo in state' });
    }

    const target = getOidcCallbackTarget(returnTo, process.env, statePayload.workspace);
    if (!target) {
      console.warn('Rejected untrusted OIDC returnTo from signed state:', { returnTo });
      return res.status(400).json({ msg: 'Invalid returnTo URL' });
    }

    const loc = `${target}#token=${encodeURIComponent(accessToken)}&refreshToken=${encodeURIComponent(refreshToken)}&expiresIn=${encodeURIComponent(process.env.JWT_ACCESS_TTL || '10m')}`;

    console.log('🔄 Redirecting to frontend with tokens:', {
      email: email,
      targetUrl: target,
      hasToken: !!accessToken,
      hasRefreshToken: !!refreshToken
    });

    console.log(`⏱️ OIDC Callback total time: ${Date.now() - callbackStartTime}ms`);
    res.redirect(loc);
  } catch (e) {
    console.error('OIDC callback error:', e);
    res.status(500).json({ msg: 'OIDC callback failed', error: e.message });
  }
});

module.exports = router;

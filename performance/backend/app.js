require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

// Import OIDC config
const { initializeOIDC, getOIDCClient, getUserInfo, refreshTokens, generatePKCE } = require('./config/oidc');
const { generators } = require('openid-client');

// Import routes
const okrRoutes = require('./routes/okrs');
const reviewRoutes = require('./routes/reviews');
const feedbackRoutes = require('./routes/feedback');
const teamRoutes = require('./routes/teams');
const aiRoutes = require('./routes/ai');
const analyticsRoutes = require('./routes/analytics');
const userRoutes = require('./routes/user');
const hubRoutes = require('./routes/hub');
const oneOnOneRoutes = require('./routes/oneOnOnes');
const developmentPlanRoutes = require('./routes/developmentPlans');
const calibrationRoutes = require('./routes/calibration');
const bulkRoutes = require('./routes/bulk');
const reportsRoutes = require('./routes/reports');
const appraisalRoutes = require('./routes/appraisals');
const webhooksRouter = require('./routes/webhooks');

// Import RBAC middleware
const { getUserRole, getDirectReports, getManagedTeams, getCurrentOrganization, requireAuth } = require('./middleware/rbac');
const { claimsRefreshMiddleware } = require('./middleware/claimsRefresh');

// Import services
const websocketService = require('./services/websocketService');

const app = express();

const isProduction = process.env.NODE_ENV === 'production';

// Trust proxy (for Azure/App Service deployments)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'none'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  }
}));

// CORS configuration
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:5005',
    process.env.IDP_ISSUER_URL || 'http://localhost:4000',
    process.env.IDP_HUB_URL || 'http://localhost:4000',
    'http://localhost:4000'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Database connection
const mongoUri = process.env.MONGO_URI || 'mongodb://localhost/performance_db';
mongoose.connect(mongoUri)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Session configuration with MongoDB store for persistence
app.use(session({
  secret: process.env.SESSION_SECRET || 'performance-management-secret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: mongoUri,
    collectionName: 'sessions',
    ttl: 24 * 60 * 60, // 1 day
  }),
  cookie: {
    secure: isProduction,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 1 day
    sameSite: isProduction ? 'none' : 'lax',
  },
}));

// Claims refresh middleware (handles stale claims from webhooks)
app.use('/api', claimsRefreshMiddleware);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'performance-management' });
});

// Dashboard summary endpoint - requires auth for user-specific data
app.get('/api/dashboard/summary', requireAuth, async (req, res) => {
  try {
    const OKR = require('./models/OKR');
    const { PerformanceReview } = require('./models/PerformanceReview');
    const Feedback = require('./models/Feedback');

    const userId = req.session?.user?.id;

    // Get OKRs from database
    let okrs = [];
    if (userId) {
      okrs = await OKR.find({ ownerId: userId });
    } else {
      okrs = await OKR.find({}).limit(10);
    }

    // Calculate OKR progress
    const totalKRs = okrs.reduce((acc, okr) =>
      acc + (okr.objectives?.reduce((a, o) => a + (o.keyResults?.length || 0), 0) || 0), 0);
    const completedKRs = okrs.reduce((acc, okr) =>
      acc + (okr.objectives?.reduce((a, o) =>
        a + (o.keyResults?.filter(kr => kr.currentValue >= kr.targetValue).length || 0), 0) || 0), 0);

    // Get pending reviews
    let reviews = [];
    if (userId) {
      reviews = await PerformanceReview.find({
        $or: [{ userId }, { managerId: userId }],
        status: { $nin: ['completed'] }
      });
    } else {
      reviews = await PerformanceReview.find({ status: { $nin: ['completed'] } }).limit(10);
    }

    // Get recent feedback (last 30 days)
    let feedback = [];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    if (userId) {
      feedback = await Feedback.find({
        receiverId: userId,
        createdAt: { $gte: thirtyDaysAgo }
      });
    } else {
      feedback = await Feedback.find({ createdAt: { $gte: thirtyDaysAgo } }).limit(10);
    }

    // Count upcoming deadlines
    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const upcomingDeadlines = okrs.filter(okr => {
      return okr.objectives?.some(obj =>
        obj.keyResults?.some(kr =>
          kr.deadline && new Date(kr.deadline) <= sevenDaysFromNow && new Date(kr.deadline) >= new Date()
        )
      );
    }).length;

    res.json({
      okrProgress: totalKRs > 0 ? Math.round((completedKRs / totalKRs) * 100) : 0,
      pendingReviews: reviews.length,
      recentFeedback: feedback.length,
      totalOkrs: okrs.length,
      completedOkrs: okrs.filter(o => o.status === 'closed').length,
      upcomingDeadlines: upcomingDeadlines
    });
  } catch (error) {
    console.error('Error fetching dashboard summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard summary'
    });
  }
});

// API routes
app.use('/api/okrs', okrRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/user', userRoutes);
app.use('/api/hub', hubRoutes);
app.use('/api/one-on-ones', oneOnOneRoutes);
app.use('/api/development-plans', developmentPlanRoutes);
app.use('/api/calibration', calibrationRoutes);
app.use('/api/bulk', bulkRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/appraisals', appraisalRoutes);
app.use('/api/webhooks', webhooksRouter);

// ============================================
// AUTHENTICATION ROUTES
// ============================================

// OIDC Start - Hub-initiated or direct login (NO AUTH REQUIRED)
app.get('/api/auth/oidc/start', async (req, res) => {
  try {
    // Check if this is IdP-initiated SSO from the hub
    const isIdpInitiated = req.query.idp_initiated === 'true';
    const hubToken = req.query.hub_token;

    console.log('🚀 OIDC Start:', {
      idp_initiated: isIdpInitiated,
      has_hub_token: !!hubToken,
      returnTo: req.query.returnTo
    });

    // Get OIDC client (lazy initialization)
    let client;
    try {
      client = getOIDCClient();
    } catch (e) {
      // Initialize if not already done
      await initializeOIDC();
      client = getOIDCClient();
    }

    if (!client) {
      return res.status(503).json({
        success: false,
        error: 'OIDC not configured'
      });
    }

    const redirectUri = process.env.OIDC_REDIRECT_URI;
    const returnTo = req.query.returnTo || process.env.FRONTEND_URL || 'http://localhost:5005';

    const { codeVerifier, codeChallenge } = generatePKCE();

    // Create state payload with returnTo URL
    const statePayload = {
      nonce: generators.nonce(),
      random: generators.state(),
      returnTo: returnTo
    };

    // Sign state with JWT for security
    const state = jwt.sign(statePayload, process.env.JWT_SECRET || 'performance-secret', { expiresIn: '10m' });

    // Store PKCE verifier and state in cookies
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

    // For IdP-initiated SSO (from hub), don't force login
    const promptValue = isIdpInitiated ? undefined : 'login';

    console.log('🔐 OIDC Auth Parameters:', {
      idp_initiated: isIdpInitiated,
      has_hub_token: !!hubToken,
      prompt: promptValue || 'none (will use existing session)',
      redirectUri: redirectUri
    });

    const authParams = {
      scope: 'openid email profile organizations teams',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce: statePayload.nonce
    };

    if (promptValue) {
      authParams.prompt = promptValue;
    }

    // Pass hub token to IdP for auto-login
    if (hubToken) {
      authParams.hub_token = hubToken;
    }

    const authorizationUrl = client.authorizationUrl(authParams);

    console.log('  📍 REDIRECTING TO IdP');
    res.redirect(authorizationUrl);
  } catch (error) {
    console.error('OIDC start error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initiate OIDC authorization'
    });
  }
});

// OIDC Callback Handler (NO AUTH REQUIRED)
app.get('/api/auth/oidc/callback', async (req, res) => {
  console.log('🎯 OIDC Callback received:', {
    hasCode: !!req.query.code,
    hasState: !!req.query.state,
    hasError: !!req.query.error
  });

  // Handle errors from IdP
  if (req.query.error) {
    console.error('OIDC error:', req.query.error, req.query.error_description);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5005';
    return res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(req.query.error_description || req.query.error)}`);
  }

  try {
    // Get OIDC client
    let client;
    try {
      client = getOIDCClient();
    } catch (e) {
      await initializeOIDC();
      client = getOIDCClient();
    }

    if (!client) {
      return res.status(503).json({
        success: false,
        error: 'OIDC not configured'
      });
    }

    const redirectUri = process.env.OIDC_REDIRECT_URI;
    const stateCookie = req.cookies.oidc_state;

    let returnTo = '/';
    let nonce;

    if (stateCookie) {
      try {
        const statePayload = jwt.verify(stateCookie, process.env.JWT_SECRET || 'performance-secret');
        returnTo = statePayload.returnTo || '/';
        nonce = statePayload.nonce;
      } catch (err) {
        console.error('State verification error:', err);
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5005';
        return res.redirect(`${frontendUrl}/login?error=${encodeURIComponent('Invalid or expired state')}`);
      }
    }

    const params = client.callbackParams(req);
    const checks = {
      state: stateCookie,
      nonce: nonce,
      code_verifier: req.cookies.oidc_verifier
    };

    const tokenSet = await client.callback(redirectUri, params, checks);
    const userinfo = await client.userinfo(tokenSet);

    console.log('✅ OIDC tokens received for:', userinfo.email);
    console.log('📊 Organization claims:', userinfo.organizations?.length || 0);
    console.log('👥 Team claims:', userinfo.teams?.length || 0);
    console.log('🏢 Current Organization:', userinfo.currentOrganization ? { id: userinfo.currentOrganization.id, name: userinfo.currentOrganization.name } : 'none');

    // Store in session with complete user info from IdP
    req.session.user = {
      id: userinfo.sub,
      email: userinfo.email,
      name: userinfo.name,
      organizations: userinfo.organizations || [],
      teams: userinfo.teams || [],
      idpTeams: userinfo.teams || [],
      currentOrganization: userinfo.currentOrganization,
      accessToken: tokenSet.access_token,
      refreshToken: tokenSet.refresh_token,
      idToken: tokenSet.id_token,
      tokenExpiry: tokenSet.expires_at,
      userinfo,
    };

    // Sync user with local database
    const User = require('./models/User');
    let user = await User.findOne({ email: userinfo.email });

    if (user) {
      user.idpTeams = userinfo.teams || [];
      user.idpOrganizations = userinfo.organizations || [];
      user.lastGrantRefresh = new Date();
      await user.save();
    } else {
      user = new User({
        email: userinfo.email,
        profile: {
          firstName: userinfo.given_name || userinfo.name?.split(' ')[0] || 'Performance',
          lastName: userinfo.family_name || userinfo.name?.split(' ').slice(1).join(' ') || 'User',
          displayName: userinfo.name
        },
        idpTeams: userinfo.teams || [],
        idpOrganizations: userinfo.organizations || [],
        lastGrantRefresh: new Date(),
        currentOrganizationId: userinfo.currentOrganization?.id || null,
        hasCompletedOrganizationSetup: true
      });
      await user.save();
    }

    // Clear OIDC cookies
    res.clearCookie('oidc_verifier');
    res.clearCookie('oidc_state');

    // Set current organization in session
    if (userinfo.currentOrganization) {
      req.session.currentOrganizationId = userinfo.currentOrganization.id;
    } else if (userinfo.organizations?.length > 0) {
      req.session.currentOrganizationId = userinfo.organizations[0].id;
    }

    // Redirect to frontend with access token
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5005';
    const redirectPath = returnTo.startsWith('/') ? returnTo : '/';
    res.redirect(`${frontendUrl}${redirectPath}#access_token=${tokenSet.access_token}`);
  } catch (error) {
    console.error('OIDC callback error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5005';
    return res.redirect(`${frontendUrl}/login?error=${encodeURIComponent('Authentication failed')}`);
  }
});

// Get current user - works with session OR bearer token via requireAuth middleware
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    // Get fresh user data from database
    const User = require('./models/User');
    const dbUser = await User.findOne({ email: req.session.user.email });

    const { accessToken, refreshToken, idToken, ...safeUser } = req.session.user;

    res.json({
      success: true,
      user: {
        ...safeUser,
        idpTeams: dbUser?.idpTeams || req.session.user.teams || [],
        idpTeamPermissions: dbUser?.idpTeamPermissions || [],
        idpOrganizations: dbUser?.idpOrganizations || req.session.user.organizations || [],
        profile: dbUser?.profile || {}
      },
      currentOrganizationId: req.session.currentOrganizationId,
      currentOrganization: req.session.user.currentOrganization,
      role: req.userRole
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    const { accessToken, refreshToken, idToken, ...safeUser } = req.session.user;
    res.json({
      success: true,
      user: safeUser,
      currentOrganizationId: req.session.currentOrganizationId
    });
  }
});

// Refresh tokens
app.post('/api/auth/refresh', requireAuth, async (req, res) => {
  try {
    if (!req.session.user?.refreshToken) {
      return res.status(401).json({
        success: false,
        error: 'No refresh token available',
        code: 'NO_REFRESH_TOKEN',
      });
    }

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
    req.session.user.userinfo = userinfo;
    req.session.user.organizations = userinfo.organizations || [];
    req.session.user.teams = userinfo.teams || [];
    req.session.user.idpTeams = userinfo.teams || [];
    req.session.user.currentOrganization = userinfo.currentOrganization;

    res.json({
      success: true,
      tokenExpiry: tokenSet.expires_at,
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    return res.status(401).json({
      success: false,
      error: 'Token refresh failed',
      code: 'REFRESH_FAILED',
    });
  }
});

// Switch organization
app.post('/api/auth/switch-organization', requireAuth, async (req, res) => {
  try {
    const { organizationId } = req.body;

    // Verify user belongs to organization
    const userOrgs = req.session.user.organizations || [];
    const org = userOrgs.find(o => o.id === organizationId);

    if (!org) {
      return res.status(403).json({
        success: false,
        error: 'You are not a member of this organization',
        code: 'ORG_ACCESS_DENIED',
      });
    }

    // Update session
    req.session.currentOrganizationId = organizationId;
    req.session.user.currentOrganization = org;

    // Update database
    const User = require('./models/User');
    await User.updateOne(
      { email: req.session.user.email },
      { currentOrganizationId: organizationId }
    );

    res.json({
      success: true,
      currentOrganizationId: organizationId,
      organization: org,
    });
  } catch (error) {
    console.error('Switch organization error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to switch organization'
    });
  }
});

// Logout - clear all session data and cookies
app.post('/api/auth/logout', (req, res) => {
  // Clear session
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destroy error:', err);
    }
  });

  // Clear all cookies
  res.clearCookie('connect.sid', {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/'
  });
  res.clearCookie('oidc_verifier');
  res.clearCookie('oidc_state');

  console.log('✅ User logged out successfully');
  res.json({ success: true, message: 'Logged out successfully' });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Performance Management Error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    code: 'INTERNAL_ERROR'
  });
});

// Start server with OIDC initialization
const PORT = process.env.PORT || 5004;

const startServer = async () => {
  try {
    // Initialize OIDC client at startup
    const issuerUrl = process.env.IDP_ISSUER_URL || process.env.OIDC_ISSUER;
    if (issuerUrl) {
      await initializeOIDC();
      console.log('OIDC client initialized');
    } else {
      console.warn('IDP_ISSUER_URL not set, OIDC authentication will be disabled');
    }

    const server = app.listen(PORT, () => {
      console.log(`Performance Management Backend running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`MongoDB: ${process.env.MONGO_URI ? 'Connected' : 'Using local'}`);
    });

    // Initialize WebSocket server
    websocketService.initWebSocket(server);
  } catch (error) {
    console.error('Failed to start server:', error);
    // Continue starting server even if OIDC init fails
    const server = app.listen(PORT, () => {
      console.log(`Performance Management Backend running on port ${PORT} (OIDC disabled)`);
    });
    // Initialize WebSocket server even in fallback mode
    websocketService.initWebSocket(server);
  }
};

startServer();

module.exports = app;

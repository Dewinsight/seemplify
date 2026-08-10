require('dotenv').config();

const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const connectDatabase = require('./config/database');
const { initializeOIDC } = require('./config/oidc');
const { InternalServiceNonce } = require('./models');

// Import routes
const authRoutes = require('./routes/auth');
const leaveRequestRoutes = require('./routes/leaveRequests');
const leaveBalanceRoutes = require('./routes/leaveBalances');
const leavePolicyRoutes = require('./routes/leavePolicies');
const leaveTypeRoutes = require('./routes/leaveTypes');
const auditLogRoutes = require('./routes/auditLogs');
const hubRoutes = require('./routes/hub');
const webhooksRouter = require('./routes/webhooks');
const internalPayrollRoutes = require('./routes/internalPayroll');

// Import middleware
const { errorHandler } = require('./middleware/errorHandler');
const { claimsRefreshMiddleware } = require('./middleware/claimsRefresh');

// Import services
const websocketService = require('./services/websocketService');
const sessionStoreService = require('./services/sessionStore');
const { initializeEmailService } = require('./services/emailService');
const { startAttendanceIntegrationWorker } = require('./services/attendanceIntegrationService');
const { assertInternalPayrollConfiguration } = require('./services/internalPayrollSecurity');

const app = express();
const PORT = process.env.PORT || 5002;

// Trust proxy (Azure/App Service) so req.protocol respects X-Forwarded-Proto
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable for development, configure for production
}));

// CORS configuration
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:5003',
    process.env.IDP_ISSUER_URL || 'http://localhost:4000',
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

// Request logging
app.use(morgan('combined'));

// Body parsing. Preserve the exact JSON bytes for timestamp-bound webhook and
// internal-service verification; re-serializing an object is not a safe
// signature boundary.
app.use(express.json({
  verify: (req, _res, buffer) => {
    if (
      req.originalUrl?.startsWith('/api/webhooks/idp')
      || req.originalUrl?.startsWith('/api/internal/payroll/')
    ) {
      req.rawBody = Buffer.from(buffer);
    }
  },
}));
app.use(express.urlencoded({ extended: true }));

// Machine-to-machine payroll reads are authenticated by a signed raw request
// and intentionally bypass browser sessions and user-claim middleware.
app.use('/api/internal/payroll', internalPayrollRoutes);

// Cookie parsing (required for OIDC flow)
app.use(cookieParser());

// Session configuration. Retain the exact store instance so signed IdP
// revocations can delete serialized connect-mongo sessions immediately.
const leaveSessionStore = MongoStore.create({
  mongoUrl: process.env.MONGODB_URI,
  collectionName: 'sessions',
  ttl: 24 * 60 * 60,
});
sessionStoreService.initSessionStore(leaveSessionStore);

app.use(session({
  secret: process.env.SESSION_SECRET || 'leave-management-session-secret',
  resave: false,
  saveUninitialized: false,
  store: leaveSessionStore,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 1 day
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  },
}));

// Claims refresh middleware (handles stale claims from webhooks)
app.use('/api', claimsRefreshMiddleware);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'leave-management-backend' });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/leave-requests', leaveRequestRoutes);
app.use('/api/leave-balances', leaveBalanceRoutes);
app.use('/api/leave-policies', leavePolicyRoutes);
app.use('/api/leave-types', leaveTypeRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/hub', hubRoutes);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/presence', require('./routes/presenceReporter'));
app.use('/api/internal/v1/time-attendance', require('./routes/timeAttendanceIntegration'));

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Initialize and start server
const startServer = async () => {
  try {
    if (process.env.NODE_ENV === 'production') {
      assertInternalPayrollConfiguration('production');
    }

    // Connect to database
    await connectDatabase();

    // Do not accept signed internal calls until Mongo has enforced the durable
    // cross-instance nonce uniqueness and TTL indexes.
    await InternalServiceNonce.init();

    // Initialize OIDC client
    await initializeOIDC();

    // Initialize email service
    initializeEmailService();

    // Start server
    const server = app.listen(PORT, () => {
      console.log(`Leave Management Backend running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      startAttendanceIntegrationWorker();
    });

    // Initialize WebSocket server
    websocketService.initWebSocket(server);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;

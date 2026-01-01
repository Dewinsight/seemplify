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

// Import routes
const authRoutes = require('./routes/auth');
const leaveRequestRoutes = require('./routes/leaveRequests');
const leaveBalanceRoutes = require('./routes/leaveBalances');
const leavePolicyRoutes = require('./routes/leavePolicies');
const hubRoutes = require('./routes/hub');
const webhooksRouter = require('./routes/webhooks');

// Import middleware
const { errorHandler } = require('./middleware/errorHandler');
const { claimsRefreshMiddleware } = require('./middleware/claimsRefresh');

// Import services
const websocketService = require('./services/websocketService');

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

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cookie parsing (required for OIDC flow)
app.use(cookieParser());

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'leave-management-session-secret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    collectionName: 'sessions',
    ttl: 24 * 60 * 60, // 1 day
  }),
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
app.use('/api/hub', hubRoutes);
app.use('/api/webhooks', webhooksRouter);

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Initialize and start server
const startServer = async () => {
  try {
    // Connect to database
    await connectDatabase();

    // Initialize OIDC client
    await initializeOIDC();

    // Start server
    const server = app.listen(PORT, () => {
      console.log(`Leave Management Backend running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
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

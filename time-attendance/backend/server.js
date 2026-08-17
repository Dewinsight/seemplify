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
const { initializeEmailService } = require('./services/emailService');
const { startBackgroundWorker } = require('./services/backgroundJobService');
const { registerCoreJobHandlers } = require('./services/registerJobHandlers');

// Import routes
const authRoutes = require('./routes/auth');
const clockRoutes = require('./routes/clock');
const timesheetRoutes = require('./routes/timesheets');
const attendanceRoutes = require('./routes/attendance');
const approvalRoutes = require('./routes/approvals');
const reportRoutes = require('./routes/reports');
const adminRoutes = require('./routes/admin');
const rulePackRoutes = require('./routes/rulePacks');
const schedulingRoutes = require('./routes/scheduling');
const presenceRoutes = require('./routes/presence');
const webhookRoutes = require('./routes/webhooks');
const notificationRoutes = require('./routes/notifications');
const performanceIntegrationRoutes = require('./routes/performanceIntegration');
const exceptionRoutes = require('./routes/exceptions');
const presenceReporterIntegrationRoutes = require('./routes/presenceReporterIntegration');
const correctionRunRoutes = require('./routes/correctionRuns');
const accessPolicyRoutes = require('./routes/accessPolicy');

// Import middleware
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 5010;

// Trust proxy for Azure/App Service
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false,
}));

// CORS configuration
const approvedWebOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:5011',
    process.env.IDP_ISSUER_URL || 'http://localhost:4000',
    process.env.PAYROLL_FRONTEND_URL || 'http://localhost:3006',
    process.env.PERFORMANCE_FRONTEND_URL || 'http://localhost:3004',
    process.env.LEAVE_FRONTEND_URL || 'http://localhost:3002',
    process.env.RECRUITER_FRONTEND_URL || 'http://localhost:3000',
    ...(process.env.PRESENCE_REPORTER_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean),
];
app.use(cors({
    origin: approvedWebOrigins,
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
    secret: process.env.SESSION_SECRET || 'time-attendance-session-secret',
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

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'time-attendance-backend' });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/clock', clockRoutes);
app.use('/api/timesheets', timesheetRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/v1/rule-packs', rulePackRoutes);
app.use('/api/v1/scheduling', schedulingRoutes);
app.use('/api/v1/presence', presenceRoutes);
app.use('/api/internal/v1/presence', presenceReporterIntegrationRoutes);
app.use('/api/admin/correction-runs', correctionRunRoutes);
app.use('/api/admin/access-policy', accessPolicyRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/integrations/v1/performance', performanceIntegrationRoutes);
app.use('/api/v1/exceptions', exceptionRoutes);
app.use('/api/automation/actions', require('./routes/automation'));

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
        await require('./models/AutomationRequestNonce').init();

        // Initialize OIDC client
        await initializeOIDC();

        // Initialize email service
        initializeEmailService();
        registerCoreJobHandlers();

        // Start server
        app.listen(PORT, () => {
            console.log(`Time & Attendance Backend running on port ${PORT}`);
            console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
            
            startBackgroundWorker().catch(error => console.error('Failed to start background worker:', error));
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();

module.exports = app;

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
const { startAutoClockOutScheduler } = require('./services/autoClockOutService');
const { initializeEmailService } = require('./services/emailService');
const { startReminderScheduler } = require('./services/reminderService');
const { startManagerReportScheduler } = require('./services/managerReportService');
const { startClockReminderScheduler } = require('./services/clockReminderService');

// Import routes
const authRoutes = require('./routes/auth');
const clockRoutes = require('./routes/clock');
const timesheetRoutes = require('./routes/timesheets');
const attendanceRoutes = require('./routes/attendance');
const approvalRoutes = require('./routes/approvals');
const reportRoutes = require('./routes/reports');
const adminRoutes = require('./routes/admin');

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
app.use(cors({
    origin: [
        process.env.FRONTEND_URL || 'http://localhost:5011',
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

        // Initialize email service
        initializeEmailService();

        // Start server
        app.listen(PORT, () => {
            console.log(`Time & Attendance Backend running on port ${PORT}`);
            console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
            
            // Start auto clock-out scheduler
            startAutoClockOutScheduler();
            
            // Start reminder scheduler
            startReminderScheduler();

            startClockReminderScheduler();

            // Start manager report scheduler
            startManagerReportScheduler();
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();

module.exports = app;

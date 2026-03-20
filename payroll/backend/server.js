const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();

// Initialize Models FIRST
require('./models/PayrollProfile');
require('./models/PayrollRun');
require('./models/Payslip');
require('./models/CompensationRequest');
require('./models/SalaryGrade');
require('./models/ExchangeRate');
require('./models/CurrencySyncSettings');
require('./models/TaxJurisdictionConfig');

// Now we can safely import services that depend on models
const MonthlyPayrollScheduler = require('./jobs/MonthlyPayrollScheduler');
const ExchangeRateScheduler = require('./jobs/ExchangeRateScheduler');
const taxJurisdictionService = require('./services/TaxJurisdictionService');

// Import webhook routes and claims middleware
const webhooksRouter = require('./routes/webhooks');
const { claimsRefreshMiddleware } = require('./middleware/claimsRefresh');

const app = express();

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      process.env.FRONTEND_URL || 'http://localhost:5007',
      'http://localhost:3000', // Hub local
      'http://localhost:5000', // SmartHR frontend local
      'http://localhost:5006', // Legacy port
      'http://localhost:5007', // Frontend dev server
      'https://auth.seemplifyai.com', // IdP production
      'https://payroll.seemplifyai.com', // Payroll frontend production
      'https://api-payroll.seemplifyai.com', // Payroll backend production
      'https://smarthr-payroll.netlify.app', // Payroll frontend Netlify
      // Allow any Netlify preview URLs
    ];

    // Check if origin is allowed or is a Netlify preview
    if (allowedOrigins.includes(origin) || origin.endsWith('.netlify.app')) {
      callback(null, true);
    } else {
      console.warn('CORS blocked origin:', origin);
      callback(null, true); // Allow for now, log for debugging
    }
  },
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Trust Proxy for Azure/Netlify
app.set('trust proxy', 1);

// Session Config
app.use(session({
  secret: process.env.SESSION_SECRET || 'payroll-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Claims refresh middleware (handles stale claims from webhooks)
app.use('/api', claimsRefreshMiddleware);

// Database Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/payroll-management', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(async () => {
    console.log('Connected to MongoDB (Payroll DB)');
    await taxJurisdictionService.seedGlobalDefaults();
    console.log('Seeded global tax jurisdictions');
  })
  .catch(err => console.error('MongoDB connection error:', err));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/payroll', require('./routes/payroll'));
app.use('/api/compensation', require('./routes/compensation'));
app.use('/api/payroll/reports', require('./routes/reports'));
app.use('/api/payroll/salary-grades', require('./routes/salary-grades'));
app.use('/api/payroll/currencies', require('./routes/currencies'));
app.use('/api/payroll/tax', require('./routes/tax'));
app.use('/api/webhooks', webhooksRouter);

// Initialize Payroll Scheduler
const payrollScheduler = new MonthlyPayrollScheduler();
payrollScheduler.initializeScheduler();
const exchangeRateScheduler = new ExchangeRateScheduler();
exchangeRateScheduler.initializeScheduler();

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'payroll-management' });
});

const PORT = process.env.PORT || 5006;
app.listen(PORT, () => {
  console.log(`Payroll Service running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`MongoDB: ${process.env.MONGODB_URI ? 'Connected' : 'Using local'}`);
});

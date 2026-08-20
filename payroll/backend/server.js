const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();

// Initialize Models FIRST
require('./models/PayrollProfile');
require('./models/PayrollSequence');
require('./models/PayrollRun');
require('./models/PayrollCycle');
require('./models/PayrollApprovalPolicy');
require('./models/PayrollAccountingContact');
require('./models/PayrollArtifact');
require('./models/PayrollDelivery');
require('./models/Payslip');
require('./models/CompensationRequest');
require('./models/SalaryGrade');
require('./models/ExchangeRate');
require('./models/CurrencySyncSettings');
require('./models/OrganizationCurrencyPolicy');
require('./models/TaxJurisdictionConfig');
require('./models/TimeAttendanceImport');
require('./models/PayrollEmployerEntity');
require('./models/AutomationRequestNonce');
require('./models/AutomationEventOutbox');
const PayrollRun = require('./models/PayrollRun');
const PayrollCycle = require('./models/PayrollCycle');
const PayrollApprovalPolicy = require('./models/PayrollApprovalPolicy');
const PayrollAccountingContact = require('./models/PayrollAccountingContact');
const PayrollArtifact = require('./models/PayrollArtifact');
const PayrollDelivery = require('./models/PayrollDelivery');
const Payslip = require('./models/Payslip');
const PayrollSequence = require('./models/PayrollSequence');
const ExchangeRate = require('./models/ExchangeRate');
const { consolidateExactInstantDuplicates } = require('./services/ExchangeRateIndexMigrationService');
const {
  markExchangeRatesReady,
  markExchangeRatesBlocked,
  getExchangeRateRuntimeState,
} = require('./services/ExchangeRateRuntimeState');

// Now we can safely import services that depend on models
const MonthlyPayrollScheduler = require('./jobs/MonthlyPayrollScheduler');
const ExchangeRateScheduler = require('./jobs/ExchangeRateScheduler');
const taxJurisdictionService = require('./services/TaxJurisdictionService');
const payrollEmployerEntityService = require('./services/PayrollEmployerEntityService');
const payrollSequenceMigrationService = require('./services/PayrollSequenceMigrationService');
const { getPayrollLeaveSigningReadiness } = require('./services/PayrollLeaveRequestSigner');
const { startAutomationEventWorker } = require('./services/automationEventService');

// Import webhook routes and claims middleware
const webhooksRouter = require('./routes/webhooks');
const { claimsRefreshMiddleware } = require('./middleware/claimsRefresh');
const sessionStoreService = require('./services/sessionStore');

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
// Preserve the exact webhook bytes for the IdP V2 delivery signature.
app.use(express.json({
  verify: (req, _res, buffer) => {
    if (req.originalUrl?.startsWith('/api/webhooks/idp')) {
      req.rawBody = Buffer.from(buffer);
    }
  },
}));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Trust Hostinger Traefik
app.set('trust proxy', 1);

const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/payroll-management';
const payrollSessionStore = MongoStore.create({
  mongoUrl: mongoUri,
  collectionName: 'sessions',
  ttl: 24 * 60 * 60,
});
sessionStoreService.initSessionStore(payrollSessionStore);

// Session Config
app.use(session({
  secret: process.env.SESSION_SECRET || 'payroll-secret',
  resave: false,
  saveUninitialized: false,
  store: payrollSessionStore,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Claims refresh middleware (handles stale claims from webhooks)
app.use('/api', claimsRefreshMiddleware);

let serviceReady = false;
let startupError = null;

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/payroll/employer-entities', require('./routes/employer-entities'));
app.use('/api/payroll', require('./routes/payrollCycles'));
app.use('/api/payroll', require('./routes/payroll'));
app.use('/api/compensation', require('./routes/compensation'));
app.use('/api/payroll/reports', require('./routes/reports'));
app.use('/api/payroll/salary-grades', require('./routes/salary-grades'));
app.use('/api/payroll/currencies', require('./routes/currencies'));
app.use('/api/currencies', require('./routes/currencies'));
app.use('/api/payroll/tax', require('./routes/tax'));
app.use('/api/webhooks', webhooksRouter);
app.use('/api/presence', require('./routes/presenceReporter'));
app.use('/api/integrations/v1/time-attendance', require('./routes/timeAttendanceIntegration'));
app.use('/api/automation/actions', require('./routes/automation'));

// Health Check
app.get('/health', (req, res) => {
  const ready = serviceReady && mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ok' : 'starting',
    service: 'payroll-management',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'unavailable',
    integrations: {
      leaveSigning: getPayrollLeaveSigningReadiness(),
      exchangeRates: getExchangeRateRuntimeState(),
    },
    error: startupError ? startupError.message : undefined,
  });
});

const PORT = process.env.PORT || 5006;

async function migratePayrollIndexes() {
  await Promise.all([
    PayrollCycle.createIndexes(),
    PayrollApprovalPolicy.createIndexes(),
    PayrollAccountingContact.createIndexes(),
    PayrollArtifact.createIndexes(),
    PayrollDelivery.createIndexes(),
  ]);
  const migrations = [
    { model: PayrollRun, legacy: 'runNumber_1', compound: { organizationId: 1, runNumber: 1 }, name: 'organizationId_1_runNumber_1' },
    { model: Payslip, legacy: 'payslipNumber_1', compound: { organizationId: 1, payslipNumber: 1 }, name: 'organizationId_1_payslipNumber_1' },
  ];

  for (const migration of migrations) {
    await migration.model.createCollection();
    const indexes = await migration.model.collection.indexes();
    const legacy = indexes.find((index) => index.name === migration.legacy && index.unique);
    if (legacy) await migration.model.collection.dropIndex(migration.legacy);
    await migration.model.collection.createIndex(migration.compound, { unique: true, name: migration.name });
  }
  const runIndexes = await PayrollRun.collection.indexes();
  if (runIndexes.some((index) => index.name === 'organizationId_1_activePeriodKey_1')) {
    await PayrollRun.collection.dropIndex('organizationId_1_activePeriodKey_1');
  }
  const targetRunIndexName = 'organizationId_1_employerEntityId_1_activePeriodKey_1';
  const targetRunIndex = runIndexes.find((index) => index.name === targetRunIndexName);
  const hasExpectedPartialFilter = targetRunIndex?.unique === true
    && targetRunIndex?.partialFilterExpression?.employerEntityId?.$type === 'objectId'
    && targetRunIndex?.partialFilterExpression?.activePeriodKey?.$type === 'string';
  if (targetRunIndex && !hasExpectedPartialFilter) {
    await PayrollRun.collection.dropIndex(targetRunIndexName);
  }
  await PayrollRun.collection.createIndex(
    { organizationId: 1, employerEntityId: 1, activePeriodKey: 1 },
    {
      unique: true,
      partialFilterExpression: {
        employerEntityId: { $type: 'objectId' },
        activePeriodKey: { $type: 'string' },
      },
      name: targetRunIndexName,
    }
  );
  await PayrollSequence.init();
  // Older deployments allowed multiple provenance rows at the same instant.
  // Preserve conflicting legacy rows in an audit archive, keep the documented
  // manual/import/API precedence, and then enforce one immutable timeline.
  try {
    const conflictArchiveCollection = mongoose.connection.collection('exchange_rate_conflict_archive');
    await conflictArchiveCollection.createIndex(
      { resolutionKey: 1, originalExchangeRateId: 1 },
      { unique: true, name: 'exchange_rate_conflict_archive_unique' }
    );
    const exchangeRateMigration = await consolidateExactInstantDuplicates(
      ExchangeRate.collection,
      { conflictArchiveCollection }
    );
    if (exchangeRateMigration.removedCount > 0) {
      console.log(`Consolidated ${exchangeRateMigration.removedCount} duplicate exchange-rate record(s)`);
    }
    if (exchangeRateMigration.archivedConflictRows > 0) {
      console.log(`Archived ${exchangeRateMigration.archivedConflictRows} conflicting exchange-rate record(s) for audit`);
    }
    await ExchangeRate.createIndexes();
    markExchangeRatesReady();
  } catch (error) {
    if (error?.code !== 'EXCHANGE_RATE_DUPLICATE_CONFLICT' && error?.code !== 11000) {
      throw error;
    }
    markExchangeRatesBlocked({ code: 'EXCHANGE_RATE_HISTORY_REVIEW_REQUIRED' });
    console.error(
      'Exchange-rate history requires review; cross-currency payroll is disabled while core payroll remains available.'
    );
  }
  await payrollSequenceMigrationService.seedCounters();
}

async function startServer() {
  try {
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB (Payroll DB)');
    await migratePayrollIndexes();
    await taxJurisdictionService.seedGlobalDefaults();
    console.log('Seeded global tax jurisdictions');
    const upgradedEmployerBindings = await payrollEmployerEntityService.upgradePlatformTaxBindings();
    if (upgradedEmployerBindings > 0) {
      console.log(`Upgraded ${upgradedEmployerBindings} legal employer tax-pack binding(s)`);
    }

    const payrollScheduler = new MonthlyPayrollScheduler();
    payrollScheduler.initializeScheduler();
    if (getExchangeRateRuntimeState().ready) {
      const exchangeRateScheduler = new ExchangeRateScheduler();
      exchangeRateScheduler.initializeScheduler();
    }
    serviceReady = true;
    startAutomationEventWorker();

    return app.listen(PORT, () => {
      console.log(`Payroll Service running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log('MongoDB: Connected and payroll seed ready');
    });
  } catch (error) {
    startupError = error;
    serviceReady = false;
    throw error;
  }
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Payroll startup failed:', error);
    process.exitCode = 1;
  });
}

module.exports = { app, startServer, migratePayrollIndexes };

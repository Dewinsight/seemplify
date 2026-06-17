const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const connectDB = require('./config/db');
const path = require('path');
const multer = require('multer');
const { sessionMiddleware } = require('./middleware/sessionMiddleware');
const authMiddleware = require('./middleware/authMiddleware');
const http = require('http');
const websocketService = require('./services/websocketService');
const aiInterviewVoiceLiveService = require('./services/aiInterviewVoiceLiveService');
const grantVerificationScheduler = require('./scripts/grantVerificationScheduler');
const interviewFeedbackEmailService = require('./services/interviewQuestionEmailService');
const backgroundServiceManager = require('./services/backgroundServiceManager');
const multiCandidateRetryService = require('./services/multiCandidateRetryService');
const interviewBotJoinService = require('./services/interviewBotJoinService');
const aiInterviewEmailService = require('./services/aiInterviewEmailService');
const { requestValidation } = require('./middleware/requestValidation');

// Load environment variables
dotenv.config();

// Connect to database
connectDB();

// PostgreSQL via Prisma — migration in progress; runs ALONGSIDE Mongoose.
// Non-fatal connectivity check so the (still Mongoose-based) app keeps booting
// even if Postgres isn't up yet. Migrated slices use this client; the rest still
// use Mongoose until their slice lands.
const prisma = require('./db/client');
// Auto-bootstrap Postgres so deployments need ZERO manual steps: apply pending
// migrations (migrate deploy) + run idempotent, tracked reference-data seeders.
// Non-blocking and best-effort. See db/bootstrap.js (env: BOOTSTRAP_MIGRATE,
// BOOTSTRAP_SEED). In local dev, migrate is skipped via BOOTSTRAP_MIGRATE=false.
require('./db/bootstrap').runBootstrap()
  .catch((err) => console.warn('⚠️  Postgres bootstrap issue (non-fatal):', err.message));

const app = express();

// Disable X-Powered-By header
app.disable('x-powered-by');

// Security Headers Middleware using Helmet
const helmet = require('helmet');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "https://api.nylas.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "http:", "blob:"],
      connectSrc: ["'self'", "https://api.nylas.com", "https://api.brevo.com", "https://*.seemplifyai.com", "https://*.aiinnigeria.com", "wss:", "ws:", "http://localhost:*", "https://thesmarthr.netlify.app"],
      mediaSrc: ["'self'", "blob:"],
      objectSrc: ["'none'"],
      frameSrc: ["'self'", "https://api.nylas.com"],
      workerSrc: ["'self'", "blob:"],
      childSrc: ["'self'", "blob:"],
      formAction: ["'self'"],
      upgradeInsecureRequests: []
    },
  },
  crossOriginEmbedderPolicy: false, // Disable for compatibility with external resources
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// Additional Security Headers
app.use((req, res, next) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Permissions policy
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(self), camera=()');
  
  // Cache control for security
  if (req.url.includes('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  
  next();
});

// Request Validation Middleware (prevents HTTP desync attacks)
app.use(requestValidation);

// Enhanced CORS configuration with proper preflight handling
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, postman)
    if (!origin) return callback(null, true);
    
    // Explicitly allowed origins
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:5000', 
      'http://localhost:5173',
      'https://app.seemplifyai.com',
      'https://app-dev.seemplifyai.com',
      'https://candidate.seemplifyai.com',
      'https://candidate-dev.seemplifyai.com',
      'https://candidate-ibom.aiinnigeria.com',
      'https://candidate-ibom-dev.aiinnigeria.com',
      'https://api.seemplifyai.com',
      'https://api-dev.seemplifyai.com',
      'https://auth.seemplifyai.com',
      'https://auth-dev.seemplifyai.com',
      'https://thesmarthr.netlify.app',
      'https://smarthr.aiinnigeria.com',
      'https://jetstone.aiinnigeria.com',
      'https://akwaibom.aiinnigeria.com',
      'https://ibom.aiinnigeria.com',
      'https://akwa.aiinnigeria.com',
      'https://smarthrhandover-dev.sterling.ng',
      'smarthrhandover-dev.sterling.ng',
      'https://producive.com',
      'https://www.producive.com'
    ];
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Allow localhost for development
    if (origin.includes('localhost')) return callback(null, true);
    
    // Allow all netlify domains
    if (origin.includes('netlify.app') || origin.includes('netlify.com')) {
      return callback(null, true);
    }
    
    // Allow HTTPS origins for now (tighten this later)
    if (origin.startsWith('https://')) return callback(null, true);
    
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true, // Allow cookies to be sent
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'], // Explicitly allow all methods
  allowedHeaders: [
    'Accept',
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-Session-ID',
    'X-Trace-ID',
    'X-Caller-ID',
    'X-Organization-Id',
    'X-Organization-ID',
    'x-session-id',
    'x-trace-id',
    'x-caller-id',
    'x-organization-id',
    'X-Nylas-Signature',
    'x-admin-auth-token'
  ],
  exposedHeaders: ['X-Session-ID'], // Expose session ID header to frontend
  optionsSuccessStatus: 200 // Some legacy browsers choke on 204
};

// Apply CORS with webhook bypass
app.use((req, res, next) => {
  // Skip CORS for webhook endpoints - they should accept requests from any origin
  if (req.path.includes('/webhook') || req.path.includes('/webhooks')) {
    console.log('Webhook request detected, bypassing CORS:', req.path);
    return next();
  }
  
  // Apply CORS for all other routes
  cors(corsOptions)(req, res, next);
});
// Raw body capture middleware for webhook signature verification
app.use('/api/notetaker/webhook', express.raw({ type: 'application/json' }), (req, res, next) => {
  try {
    req.rawBody = req.body;
    req.body = JSON.parse(req.body.toString());
    console.log('✅ Raw body captured for webhook signature verification');
    next();
  } catch (error) {
    console.error('❌ Failed to parse webhook JSON body:', error.message);
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }
});

app.use('/api/webhooks', express.raw({ type: 'application/json' }), (req, res, next) => {
  try {
    req.rawBody = req.body;
    req.body = JSON.parse(req.body.toString());
    console.log('✅ Raw body captured for webhook signature verification');
    next();
  } catch (error) {
    console.error('❌ Failed to parse webhook JSON body:', error.message);
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }
});

// Debug middleware for file uploads
app.use((req, res, next) => {
  if (req.path.includes('/upload-cv')) {
    console.log('═══════════════════════════════════════');
    console.log('🚀 UPLOAD-CV REQUEST RECEIVED');
    console.log('═══════════════════════════════════════');
    console.log('Path:', req.path);
    console.log('Method:', req.method);
    console.log('Content-Type:', req.headers['content-type']);
    console.log('Content-Length:', req.headers['content-length']);
    console.log('Has body:', !!req.body);
    console.log('Body type:', typeof req.body);
    console.log('═══════════════════════════════════════');
  }
  next();
});

// Conditional JSON parsing - skip for file upload routes
app.use((req, res, next) => {
  // Skip JSON parsing for file upload routes (multer will handle these)
  if (req.path.includes('/upload-cv') || 
      req.path.includes('/bulk-upload') || 
      req.path.includes('/cv/parse')) {
    console.log(`⏭️ Skipping JSON parser for file upload route: ${req.path}`);
    return next();
  }
  
  // Apply JSON parsing for all other routes
  express.json()(req, res, next);
});

app.use(cookieParser()); // Parse cookies
app.set('trust proxy', 1); // Trust first proxy for IP addresses

// `_id` compatibility: mirror Prisma `id` -> `_id` on every JSON response so the
// frontend's `_id: string` contract is preserved as models migrate to Postgres.
// Additive and safe for existing Mongoose responses (which already carry `_id`).
app.use(require('./middleware/idCompat'));

// Input Sanitization Middleware - clean all inputs to prevent XSS and injection attacks
// app.use(sanitizeInputs); // Temporarily disabled to address encoding issues

// REMOVED: Global session middleware that was causing infinite loop
// Session middleware will be applied selectively per route as needed

// Multer setup for file uploads
// Define storage for the images
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Ensure the uploads directory exists
    const uploadDir = 'uploads/';
    const cvDir = 'uploads/cvs/';
    if (!require('fs').existsSync(uploadDir)){
        require('fs').mkdirSync(uploadDir, { recursive: true });
    }
    if (!require('fs').existsSync(cvDir)){
        require('fs').mkdirSync(cvDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
  }
});

// File filter for multer (optional, but good practice)
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/tiff'
  ];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, DOC, DOCX, JPG, PNG, TIFF are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: fileFilter
});


// Define Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/user')); // User profile routes
// REMOVED global multer middleware - handled at route level for better control
app.use('/api/candidates', require('./routes/candidate')); // File upload handled in route
app.use('/api/candidate-lists', require('./routes/candidateLists')); // Saved candidate list routes
app.use('/api/bulk-upload', require('./routes/bulkUpload')); // Bulk CV upload with BullMQ
app.use('/api/jobs', require('./routes/job')); // Job routes
app.use('/api/feedback-forms', require('./routes/feedbackForm')); // Feedback form templates and custom fields
app.use('/api/embeddings', require('./routes/embeddingRoutes')); // Embedding management routes
app.use('/api/sessions', sessionMiddleware, require('./routes/sessionRoutes')); // Session routes with session middleware
app.use('/api/chat-sessions', authMiddleware, sessionMiddleware, require('./routes/chatSessions')); // Chat session routes with auth and session
app.use('/api/ai', require('./routes/ai')); // AI routes - auth handled per route
app.use('/api/trusted-devices', require('./routes/trustedDevices')); // Trusted devices management

// NEW: Nylas integration routes
app.use('/api/interviews', require('./routes/interview')); // Interview scheduling routes
app.use('/api/ai-interviews', require('./routes/aiInterviews')); // Async AI Interviewer routes
app.use('/api/interview-status', require('./routes/interviewStatus')); // Interview status management routes
app.use('/api/interview-stages', require('./routes/interviewStages')); // Interview stages management routes
app.use('/api/ai-analysis', require('./routes/aiAnalysis')); // AI interview analysis routes
app.use('/api/webhooks', require('./routes/webhooks')); // Webhook routes for Nylas
app.use('/api/grant', require('./routes/grant')); // Grant verification and re-authentication routes
app.use('/api/nylas-grants', require('./routes/nylasGrants')); // Nylas grant permissions management routes
app.use('/api/notetaker', require('./routes/notetaker')); // Notetaker routes
app.use('/api/cv', require('./routes/cv')); // CV parsing routes for public applications
app.use('/api/organizations', require('./routes/organizations')); // Organization management routes
app.use('/api/organizations', require('./routes/stageTemplate')); // Stage template management routes (nested under organizations)
app.use('/api/departments', require('./routes/departments')); // Department management routes
app.use('/api/currencies', require('./routes/currencies')); // Currency management routes
app.use('/api/notifications', require('./routes/notifications')); // Notification system routes
app.use('/api/pipeline', require('./routes/pipelineBatch')); // Pipeline batch operations routes
app.use('/api/candidate-emails', require('./routes/candidateEmails')); // Candidate email notification routes
app.use('/api/candidate-shortlists', require('./routes/candidateShortlists')); // Candidate shortlist information routes
app.use('/api/enrichment', require('./routes/enrichment')); // Background enrichment and ranking routes
app.use('/api/subscription', require('./routes/subscription')); // Subscription upgrade request routes
app.use('/api/plans', require('./routes/plan')); // Subscription plan management routes
app.use('/api/credits', require('./routes/credits')); // Credits management routes
app.use('/api/credit-packs', require('./routes/creditPacks')); // Credit pack purchase routes

// Admin portal routes
app.use('/api/admin', require('./routes/admin')); // Admin management routes
app.use('/api/admin/grants', require('./routes/adminGrants')); // Admin grant management routes (NEW: Nylas grant management)
app.use('/api/admin/nylas-accounts', require('./routes/nylasAccounts')); // Multi-Nylas account management

// Serve static files from the "uploads" directory (if needed for direct access, though Cloudinary is primary)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


// Basic GET route
app.get('/', (req, res) => {
  res.json({ message: "SmartHR Backend API Running" });
});

// Error handling middleware (must be after all routes)
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// 404 handler for unmatched routes
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

const PORT = process.env.PORT || 5001;

// Create HTTP server
const server = http.createServer(app);

// Initialize WebSocket service
websocketService.initialize(server);
aiInterviewVoiceLiveService.initialize(server);

// Start grant verification scheduler
grantVerificationScheduler.start();

// Start interview completion service
const interviewCompletionService = require('./services/interviewCompletionService');
interviewCompletionService.startPeriodicCompletionCheck();

// Start interview status service (handles missed interviews)
const interviewStatusService = require('./services/interviewStatusService');

// Register all background services
backgroundServiceManager.register('interviewFeedbackEmail', interviewFeedbackEmailService);
backgroundServiceManager.register('aiInterviewEmail', aiInterviewEmailService);
backgroundServiceManager.register('interviewCompletion', interviewCompletionService);
backgroundServiceManager.register('interviewStatus', interviewStatusService);
backgroundServiceManager.register('interviewBotJoin', interviewBotJoinService);
backgroundServiceManager.register('grantVerification', grantVerificationScheduler);
backgroundServiceManager.register('multiCandidateRetry', multiCandidateRetryService);

// Start all background services
backgroundServiceManager.startAll();

// Add health check endpoint
app.get('/api/health', (req, res) => {
  const health = backgroundServiceManager.getHealthCheck();
  res.status(health.healthy ? 200 : 503).json(health);
});

// On Vercel (serverless) we cannot bind a port or keep WebSockets/workers
// alive, so export the Express app as the request handler and stop here.
// Locally (and on any always-on host), VERCEL is unset and the server starts normally.
if (process.env.VERCEL) {
  module.exports = app;
  return;
}

server.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔌 WebSocket available at ws://localhost:${PORT}/ws/assistant`);
  console.log(`📊 Background services status:`, backgroundServiceManager.getStatus());
  console.log(`🔥 Session middleware applied selectively to prevent infinite loops`);

  // Initialize BullMQ worker for bulk CV uploads
  try {
    const bulkUploadService = require('./services/bulkUploadService');
    await bulkUploadService.initQueue();
    console.log('📦 BullMQ bulk upload queue initialized');
  } catch (err) {
    console.warn('⚠️ BullMQ init failed (non-fatal, bulk upload will init on first use):', err.message);
  }

  // Initialize BullMQ worker for enrichment ranking
  try {
    const enrichmentService = require('./services/enrichmentService');
    await enrichmentService.initQueue();
    console.log('📈 BullMQ enrichment queue initialized');
  } catch (err) {
    console.warn('⚠️ Enrichment queue init failed (non-fatal, enrichment will init on first use):', err.message);
  }
});

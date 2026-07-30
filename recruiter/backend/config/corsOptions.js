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

const corsOptions = {
  origin(origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, service-to-service).
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (origin.includes('localhost')) return callback(null, true);
    if (origin.includes('netlify.app') || origin.includes('netlify.com')) {
      return callback(null, true);
    }
    // Preserve the existing hosted-client policy until the allowlist is tightened.
    if (origin.startsWith('https://')) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Accept',
    'Content-Type',
    'Authorization',
    'Last-Event-ID',
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
    'Idempotency-Key',
    'X-CV-Status-Token',
    'X-Nylas-Signature',
    'x-admin-auth-token'
  ],
  exposedHeaders: ['X-Session-ID', 'Location', 'X-CV-Status-Token'],
  optionsSuccessStatus: 200
};

module.exports = {
  allowedOrigins,
  corsOptions
};

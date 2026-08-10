process.env.PORT = process.env.PORT || '5110';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/time-attendance-live-e2e';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.IDP_ISSUER_URL = process.env.IDP_ISSUER_URL || 'http://127.0.0.1:5119';
process.env.IDP_INTERNAL_API_URL = process.env.IDP_INTERNAL_API_URL || 'http://127.0.0.1:5119';
process.env.OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID || 'time-attendance-live';
process.env.OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET || 'live-e2e-client-secret';
process.env.OIDC_REDIRECT_URI = process.env.OIDC_REDIRECT_URI || 'http://127.0.0.1:5111/oidc/callback';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:5111';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'live-e2e-session-secret';
process.env.BACKGROUND_JOBS_ENABLED = 'false';

require('../../server');

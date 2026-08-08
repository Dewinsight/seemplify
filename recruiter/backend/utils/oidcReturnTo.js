const FIRST_PARTY_FRONTEND_ORIGINS = [
  'https://app.seemplifyai.com',
  'https://app-dev.seemplifyai.com',
  'https://thesmarthr.netlify.app',
  'https://smarthr.aiinnigeria.com',
  'https://jetstone.aiinnigeria.com',
  'https://akwaibom.aiinnigeria.com',
  'https://ibom.aiinnigeria.com',
  'https://smarthrhandover-dev.sterling.ng',
  'https://producive.com',
  'https://www.producive.com'
];

const DEVELOPMENT_FRONTEND_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5000',
  'http://127.0.0.1:5173'
];

function parseHttpOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return null;

  try {
    const parsed = new URL(value.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch (_) {
    return null;
  }
}

function splitConfiguredOrigins(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getAllowedOidcReturnOrigins(env = process.env) {
  const configuredOrigins = [
    ...splitConfiguredOrigins(env.OIDC_ALLOWED_RETURN_ORIGINS),
    ...splitConfiguredOrigins(env.FRONTEND_URL),
    ...splitConfiguredOrigins(env.NEXT_PUBLIC_APP_URL),
    ...splitConfiguredOrigins(env.RECRUITER_FRONTEND_URL),
    ...splitConfiguredOrigins(env.RECRUITER_URL),
    ...splitConfiguredOrigins(env.SMARTHR_URL)
  ];

  const candidates = [
    ...FIRST_PARTY_FRONTEND_ORIGINS,
    ...configuredOrigins,
    ...(env.NODE_ENV === 'production' ? [] : DEVELOPMENT_FRONTEND_ORIGINS)
  ];

  const production = env.NODE_ENV === 'production';
  return new Set(candidates
    .map(parseHttpOrigin)
    .filter((origin) => {
      if (!origin) return false;
      if (!production) return true;
      return new URL(origin).protocol === 'https:';
    }));
}

/**
 * Validate an OIDC return URL and reduce it to its trusted frontend origin.
 *
 * The Recruiter callback has always returned to `/oidc/callback` on the
 * frontend origin, so retaining an arbitrary path/query here is unnecessary.
 * Returning only the origin also prevents encoded or protocol-relative path
 * tricks from influencing the eventual token-bearing redirect.
 */
function normalizeOidcReturnTo(value, env = process.env) {
  const origin = parseHttpOrigin(value);
  if (!origin) return null;

  const allowedOrigins = getAllowedOidcReturnOrigins(env);
  return allowedOrigins.has(origin) ? origin : null;
}

function getOidcCallbackTarget(value, env = process.env) {
  const origin = normalizeOidcReturnTo(value, env);
  return origin ? `${origin}/oidc/callback` : null;
}

module.exports = {
  FIRST_PARTY_FRONTEND_ORIGINS,
  DEVELOPMENT_FRONTEND_ORIGINS,
  getAllowedOidcReturnOrigins,
  getOidcCallbackTarget,
  normalizeOidcReturnTo
};

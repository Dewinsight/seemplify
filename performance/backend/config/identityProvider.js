function productionSafeUrl(value, fallback) {
  const configured = String(value || '').trim();
  if (!configured) return fallback;
  try {
    const hostname = new URL(configured).hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return fallback;
  } catch {
    return fallback;
  }
  return configured;
}

function getPerformanceOidcClientConfig(options = {}) {
  const production = process.env.NODE_ENV === 'production';
  const configuredIssuer = process.env.IDP_ISSUER_URL ||
    process.env.OIDC_ISSUER_URL ||
    process.env.OIDC_ISSUER ||
    process.env.IDP_URL;

  return {
    issuerUrl: production
      ? productionSafeUrl(configuredIssuer, 'https://auth.seemplifyai.com')
      : configuredIssuer || options.issuerUrlFallback,
    clientId: process.env.OIDC_CLIENT_ID || (production ? 'performance-management' : undefined),
    clientSecret: process.env.OIDC_CLIENT_SECRET || (production ? 'performance-management-secret' : undefined),
    redirectUri: production
      ? productionSafeUrl(process.env.OIDC_REDIRECT_URI, 'https://api-performance.seemplifyai.com/api/auth/oidc/callback')
      : process.env.OIDC_REDIRECT_URI || options.redirectUriFallback,
    frontendUrl: production
      ? productionSafeUrl(process.env.FRONTEND_URL, 'https://performance.seemplifyai.com')
      : process.env.FRONTEND_URL || options.frontendUrlFallback,
  };
}

module.exports = { getPerformanceOidcClientConfig };

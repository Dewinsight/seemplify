function getPerformanceOidcClientConfig(options = {}) {
  const production = process.env.NODE_ENV === 'production';

  return {
    issuerUrl: process.env.IDP_ISSUER_URL ||
      process.env.OIDC_ISSUER_URL ||
      process.env.OIDC_ISSUER ||
      process.env.IDP_URL ||
      (production ? 'https://auth.seemplifyai.com' : options.issuerUrlFallback),
    clientId: process.env.OIDC_CLIENT_ID || (production ? 'performance-management' : undefined),
    clientSecret: process.env.OIDC_CLIENT_SECRET || (production ? 'performance-management-secret' : undefined),
    redirectUri: process.env.OIDC_REDIRECT_URI ||
      (production
        ? 'https://api-performance.seemplifyai.com/api/auth/oidc/callback'
        : options.redirectUriFallback),
    frontendUrl: process.env.FRONTEND_URL ||
      (production ? 'https://performance.seemplifyai.com' : options.frontendUrlFallback),
  };
}

module.exports = { getPerformanceOidcClientConfig };

function getIdentityProviderIssuerUrl(fallback) {
  return process.env.IDP_ISSUER_URL ||
    process.env.OIDC_ISSUER_URL ||
    process.env.OIDC_ISSUER ||
    process.env.IDP_URL ||
    (process.env.NODE_ENV === 'production' ? 'https://auth.seemplifyai.com' : fallback);
}

function getPayrollOidcClientConfig(options = {}) {
  const production = process.env.NODE_ENV === 'production';

  return {
    issuerUrl: getIdentityProviderIssuerUrl(options.issuerUrlFallback),
    clientId: process.env.OIDC_CLIENT_ID || (production ? 'payroll-management' : undefined),
    clientSecret: process.env.OIDC_CLIENT_SECRET || (production ? 'payroll-management-secret' : undefined),
    redirectUri: process.env.OIDC_REDIRECT_URI ||
      (production
        ? 'https://api-payroll.seemplifyai.com/api/auth/oidc/callback'
        : options.redirectUriFallback),
  };
}

function getPayrollFrontendUrl(fallback = 'http://localhost:5007') {
  return process.env.FRONTEND_URL ||
    (process.env.NODE_ENV === 'production' ? 'https://payroll.seemplifyai.com' : fallback);
}

module.exports = { getIdentityProviderIssuerUrl, getPayrollOidcClientConfig, getPayrollFrontendUrl };

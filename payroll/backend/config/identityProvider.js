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

function getIdentityProviderIssuerUrl(fallback) {
  const configured = process.env.IDP_ISSUER_URL ||
    process.env.OIDC_ISSUER_URL ||
    process.env.OIDC_ISSUER ||
    process.env.IDP_URL;
  return process.env.NODE_ENV === 'production'
    ? productionSafeUrl(configured, 'https://auth.seemplifyai.com')
    : configured || fallback;
}

function getPayrollOidcClientConfig(options = {}) {
  const production = process.env.NODE_ENV === 'production';

  return {
    issuerUrl: getIdentityProviderIssuerUrl(options.issuerUrlFallback),
    clientId: process.env.OIDC_CLIENT_ID || (production ? 'payroll-management' : undefined),
    clientSecret: process.env.OIDC_CLIENT_SECRET || (production ? 'payroll-management-secret' : undefined),
    redirectUri: production
      ? productionSafeUrl(process.env.OIDC_REDIRECT_URI, 'https://api-payroll.seemplifyai.com/api/auth/oidc/callback')
      : process.env.OIDC_REDIRECT_URI || options.redirectUriFallback,
  };
}

function getPayrollFrontendUrl(fallback = 'http://localhost:5007') {
  return process.env.NODE_ENV === 'production'
    ? productionSafeUrl(process.env.FRONTEND_URL, 'https://payroll.seemplifyai.com')
    : process.env.FRONTEND_URL || fallback;
}

module.exports = { getIdentityProviderIssuerUrl, getPayrollOidcClientConfig, getPayrollFrontendUrl };

function getIdentityProviderIssuerUrl(fallback) {
  return process.env.IDP_ISSUER_URL ||
    process.env.OIDC_ISSUER_URL ||
    process.env.OIDC_ISSUER ||
    process.env.IDP_URL ||
    (process.env.NODE_ENV === 'production' ? 'https://auth.seemplifyai.com' : fallback);
}

module.exports = { getIdentityProviderIssuerUrl };

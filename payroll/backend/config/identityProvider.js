function getIdentityProviderIssuerUrl(fallback) {
  return process.env.IDP_ISSUER_URL ||
    process.env.OIDC_ISSUER_URL ||
    process.env.OIDC_ISSUER ||
    process.env.IDP_URL ||
    fallback;
}

module.exports = { getIdentityProviderIssuerUrl };

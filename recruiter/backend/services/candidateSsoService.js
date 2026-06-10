/**
 * Candidate-portal SSO verification.
 *
 * Lets an existing IdP employee enter the recruiter candidate portal without a
 * separate password: the IdP mints a short-lived HS256 token, the portal
 * exchanges it for a normal candidate session. Mirrors idpAdminSsoService,
 * including one-time jti replay protection.
 */

const jwt = require('jsonwebtoken');

const usedCandidateSsoTokenIds = new Map();

const cleanupUsedCandidateSsoTokenIds = () => {
  const now = Date.now();
  for (const [jti, expiresAt] of usedCandidateSsoTokenIds.entries()) {
    if (expiresAt <= now) usedCandidateSsoTokenIds.delete(jti);
  }
};

const cleanupTimer = setInterval(cleanupUsedCandidateSsoTokenIds, 5 * 60 * 1000);
cleanupTimer.unref?.();

const getCandidateSsoConfig = () => ({
  secret: String(
    process.env.IDP_CANDIDATE_SSO_SECRET ||
    process.env.OIDC_CLIENT_SECRET ||
    process.env.SMART_HR_CLIENT_SECRET ||
    process.env.SMARTHR_CLIENT_SECRET ||
    ''
  ).trim(),
  issuer: String(process.env.IDP_CANDIDATE_SSO_ISSUER || 'aiin-idp').trim(),
  audience: String(process.env.IDP_CANDIDATE_SSO_AUDIENCE || 'recruiter-candidate-portal').trim()
});

const buildInvalidTokenError = (message, code = 'INVALID_CANDIDATE_SSO_TOKEN') => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const verifyCandidateSsoToken = (token) => {
  const { secret, issuer, audience } = getCandidateSsoConfig();
  if (!secret) {
    throw buildInvalidTokenError('Candidate SSO secret is not configured', 'CANDIDATE_SSO_NOT_CONFIGURED');
  }

  let claims;
  try {
    claims = jwt.verify(token, secret, { algorithms: ['HS256'], issuer, audience });
  } catch (error) {
    throw buildInvalidTokenError(error.message || 'Failed to verify candidate SSO token');
  }

  const idpAccountId = String(claims.idpAccountId || claims.sub || '').trim();
  const email = String(claims.email || '').trim().toLowerCase();
  const idpOrganizationId = String(claims.idpOrganizationId || '').trim();
  const jti = String(claims.jti || '').trim();

  if (!idpAccountId || !email || !idpOrganizationId || !jti) {
    throw buildInvalidTokenError('Candidate SSO token is missing required claims');
  }

  return {
    jti,
    exp: claims.exp,
    idpAccountId,
    email,
    name: String(claims.name || email).trim() || email,
    idpOrganizationId,
    employeeId: String(claims.employeeId || '').trim()
  };
};

const consumeCandidateSsoToken = (jti, exp) => {
  cleanupUsedCandidateSsoTokenIds();
  if (usedCandidateSsoTokenIds.has(jti)) {
    throw buildInvalidTokenError('Candidate SSO token has already been used', 'CANDIDATE_SSO_TOKEN_REPLAYED');
  }
  const expiresAtMs = Number.isFinite(exp) ? (exp * 1000) + 60 * 1000 : Date.now() + (5 * 60 * 1000);
  usedCandidateSsoTokenIds.set(jti, expiresAtMs);
};

module.exports = {
  verifyCandidateSsoToken,
  consumeCandidateSsoToken,
  getCandidateSsoConfig
};

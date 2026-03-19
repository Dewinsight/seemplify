const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');

const IDP_ADMIN_PERMISSION_KEYS = [
  'manageUsers',
  'manageOrganizations',
  'manageLicenses',
  'manageBilling',
  'viewAnalytics',
  'systemSettings'
];

const usedIdpAdminTokenIds = new Map();

const cleanupUsedIdpAdminTokenIds = () => {
  const now = Date.now();
  for (const [jti, expiresAt] of usedIdpAdminTokenIds.entries()) {
    if (expiresAt <= now) {
      usedIdpAdminTokenIds.delete(jti);
    }
  }
};

const cleanupTimer = setInterval(cleanupUsedIdpAdminTokenIds, 5 * 60 * 1000);
cleanupTimer.unref?.();

const getIdpAdminSsoConfig = () => ({
  secret: String(
    process.env.RECRUITER_ADMIN_SSO_SECRET ||
    process.env.IDP_RECRUITER_ADMIN_SSO_SECRET ||
    ''
  ).trim(),
  issuer: String(
    process.env.RECRUITER_ADMIN_SSO_ISSUER ||
    process.env.IDP_RECRUITER_ADMIN_SSO_ISSUER ||
    'aiin-idp-admin'
  ).trim(),
  audience: String(
    process.env.RECRUITER_ADMIN_SSO_AUDIENCE ||
    process.env.IDP_RECRUITER_ADMIN_SSO_AUDIENCE ||
    'recruiter-admin'
  ).trim()
});

const getFullAdminPermissions = () => ({
  manageUsers: true,
  manageOrganizations: true,
  manageLicenses: true,
  manageBilling: true,
  viewAnalytics: true,
  systemSettings: true
});

const sanitizePermissions = (permissions = {}) => {
  return IDP_ADMIN_PERMISSION_KEYS.reduce((acc, key) => {
    if (permissions[key] === true || permissions[key] === false) {
      acc[key] = permissions[key];
    }
    return acc;
  }, {});
};

const resolvePermissionsFromClaims = (claims) => {
  if (claims.role === 'super_admin') {
    return Admin.getSuperAdminPermissions();
  }

  const incomingPermissions = sanitizePermissions(claims.permissions || {});
  return Object.keys(incomingPermissions).length > 0
    ? { ...getFullAdminPermissions(), ...incomingPermissions }
    : getFullAdminPermissions();
};

const buildInvalidTokenError = (message, code = 'INVALID_IDP_ADMIN_SSO_TOKEN') => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const verifyIdpAdminSsoToken = (token) => {
  const { secret, issuer, audience } = getIdpAdminSsoConfig();
  if (!secret) {
    throw buildInvalidTokenError('Recruiter admin SSO secret is not configured', 'IDP_ADMIN_SSO_NOT_CONFIGURED');
  }

  let claims;
  try {
    claims = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer,
      audience
    });
  } catch (error) {
    throw buildInvalidTokenError(error.message || 'Failed to verify IDP admin SSO token');
  }

  const idpAccountId = String(claims.idpAccountId || claims.sub || '').trim();
  const email = String(claims.email || '').trim().toLowerCase();
  const role = claims.role === 'super_admin' ? 'super_admin' : claims.role === 'admin' ? 'admin' : '';
  const jti = String(claims.jti || '').trim();

  if (!idpAccountId || !email || !role || !jti) {
    throw buildInvalidTokenError('IDP admin SSO token is missing required claims');
  }

  const isAdminIdentity = claims.isSuperAdmin === true || claims.isSystemAdmin === true || role === 'super_admin' || role === 'admin';
  if (!isAdminIdentity) {
    throw buildInvalidTokenError('IDP admin SSO token does not grant admin access');
  }

  return {
    jti,
    exp: claims.exp,
    idpAccountId,
    email,
    name: String(claims.name || email).trim() || email,
    role,
    permissions: resolvePermissionsFromClaims(claims)
  };
};

const consumeIdpAdminSsoToken = (jti, exp) => {
  cleanupUsedIdpAdminTokenIds();

  if (usedIdpAdminTokenIds.has(jti)) {
    throw buildInvalidTokenError('IDP admin SSO token has already been used', 'IDP_ADMIN_SSO_TOKEN_REPLAYED');
  }

  const expiresAtMs = Number.isFinite(exp) ? (exp * 1000) + 60 * 1000 : Date.now() + (5 * 60 * 1000);
  usedIdpAdminTokenIds.set(jti, expiresAtMs);
};

const upsertAdminFromIdpIdentity = async (identity) => {
  let admin = await Admin.findOne({ idpAccountId: identity.idpAccountId });

  if (!admin) {
    admin = await Admin.findOne({ email: identity.email });
  }

  if (admin && admin.idpAccountId && admin.idpAccountId !== identity.idpAccountId) {
    const error = new Error('Recruiter admin account is already linked to another IDP admin');
    error.code = 'IDP_ADMIN_LINK_MISMATCH';
    throw error;
  }

  if (!admin) {
    admin = new Admin({
      email: identity.email,
      name: identity.name,
      role: identity.role,
      permissions: identity.permissions,
      authSource: 'idp',
      idpAccountId: identity.idpAccountId,
      isActive: true,
      lastSsoLoginAt: new Date(),
      lastIdpSyncAt: new Date()
    });
  } else {
    const hasLocalPassword = Boolean(admin.password);

    admin.email = identity.email;
    admin.name = identity.name;
    admin.role = identity.role;
    admin.permissions = identity.permissions;
    admin.idpAccountId = identity.idpAccountId;
    admin.authSource = hasLocalPassword ? 'local' : 'idp';
    admin.lastSsoLoginAt = new Date();
    admin.lastIdpSyncAt = new Date();
    admin.isActive = true;
  }

  await admin.save();
  return admin;
};

module.exports = {
  consumeIdpAdminSsoToken,
  getFullAdminPermissions,
  upsertAdminFromIdpIdentity,
  verifyIdpAdminSsoToken
};

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const UserSession = require('../models/UserSession');
const User = require('../models/User');

const ACCESS_TOKEN_TTL = process.env.JWT_ACCESS_TTL || '10m';
const REFRESH_TOKEN_TTL_MS = parseInt(process.env.JWT_REFRESH_TTL_MS || `${30 * 24 * 60 * 60 * 1000}`, 10); // default 30 days

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateRandomToken(bytes = 48) {
  return crypto.randomBytes(bytes).toString('base64url');
}

async function createSession({ user, fingerprint, userAgent, ip }) {
  const sessionId = crypto.randomUUID();
  const refreshToken = generateRandomToken();
  const refreshTokenHash = hashToken(refreshToken);

  const accessTokenPayload = {
    user: { id: user.id },
    jti: sessionId,
    sessionVersion: user.security?.sessionVersion || 1,
  };

  const accessToken = jwt.sign(accessTokenPayload, process.env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL,
  });

  const session = await UserSession.create({
    user: user._id,
    fingerprint,
    userAgent,
    ip,
    refreshTokenHash,
    accessTokenId: sessionId,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    lastActivityAt: new Date(),
  });
      
      return {
    accessToken,
    refreshToken,
    session,
  };
}

async function revokeSessionById(sessionId, reason = 'revoked') {
  const session = await UserSession.findOneAndUpdate(
    { accessTokenId: sessionId, revoked: { $ne: true } },
    { revoked: true, revokedAt: new Date(), reason },
    { new: true }
  );
  return session;
}

async function revokeSessionsByFingerprint(userId, fingerprint, reason = 'device_removed') {
  const result = await UserSession.updateMany(
    { user: userId, fingerprint, revoked: { $ne: true } },
    { revoked: true, revokedAt: new Date(), reason }
  );
  return result;
}

async function revokeAllSessionsExcept(userId, sessionId, reason = 'security_reset') {
  await UserSession.updateMany(
    { user: userId, accessTokenId: { $ne: sessionId } },
    { revoked: true, revokedAt: new Date(), reason }
  );
}

async function validateAccessToken(token) {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const session = await UserSession.findOne({ accessTokenId: decoded.jti });
      
      if (!session) {
    throw new Error('session_not_found');
  }

  if (session.revoked) {
    throw new Error('session_revoked');
  }

  const user = await User.findById(decoded.user.id).select('security');
  if (!user) {
    throw new Error('user_not_found');
  }

  const currentVersion = user.security?.sessionVersion || 1;
  if (decoded.sessionVersion < currentVersion) {
    throw new Error('session_version_mismatch');
  }

  return { decoded, session, user };
}

async function refreshSession(refreshToken, fingerprint, userAgent, ip) {
  const refreshHash = hashToken(refreshToken);
  const session = await UserSession.findOne({ refreshTokenHash: refreshHash });
  if (!session) {
    throw new Error('invalid_refresh_token');
  }

  if (session.revoked) {
    throw new Error('session_revoked');
  }

  if (session.expiresAt < new Date()) {
    throw new Error('refresh_expired');
  }

  const user = await User.findById(session.user);
  if (!user) {
    throw new Error('user_not_found');
  }

  // Rotate refresh token
  const newRefreshToken = generateRandomToken();
  session.refreshTokenHash = hashToken(newRefreshToken);
  session.userAgent = userAgent;
  session.ip = ip;
  session.fingerprint = fingerprint;
  session.lastActivityAt = new Date();
  await session.save();

  const accessTokenPayload = {
    user: { id: user.id },
    jti: session.accessTokenId,
    sessionVersion: user.security?.sessionVersion || 1,
  };

  const accessToken = jwt.sign(accessTokenPayload, process.env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL,
  });

  return { accessToken, refreshToken: newRefreshToken, session, user };
}

async function revokeSessionsForUser(userId, reason = 'security_reset') {
  await UserSession.updateMany(
    { user: userId, revoked: { $ne: true } },
    { revoked: true, revokedAt: new Date(), reason }
  );
}

async function getSessionById(sessionId) {
  return UserSession.findOne({ accessTokenId: sessionId });
}

async function getUserSessions(userId) {
  return UserSession.find({ user: userId }).sort({ createdAt: -1 });
}

async function deactivateSession(sessionId, reason = 'user_logout') {
  return revokeSessionById(sessionId, reason);
}

async function validateActiveSession(sessionId) {
  return UserSession.findOne({ accessTokenId: sessionId, revoked: { $ne: true } });
}

async function cleanupExpiredSessions() {
  const result = await UserSession.deleteMany({ expiresAt: { $lt: new Date() } });
  return result.deletedCount || 0;
}

async function getSessionStats() {
  const totalActiveSessions = await UserSession.countDocuments({ revoked: { $ne: true }, expiresAt: { $gt: new Date() } });
  const totalRevoked = await UserSession.countDocuments({ revoked: true });
      return {
        totalActiveSessions,
    totalRevoked,
  };
}

module.exports = {
  createSession,
  revokeSessionById,
  revokeSessionsByFingerprint,
  revokeAllSessionsExcept,
  validateAccessToken,
  refreshSession,
  revokeSessionsForUser,
  getSessionById,
  getUserSessions,
  deactivateSession,
  validateActiveSession,
  cleanupExpiredSessions,
  getSessionStats,
};


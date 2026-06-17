// JWT access/refresh session service — PostgreSQL/Prisma (migrated from Mongoose).
// Public API and behaviour are preserved exactly; only the data layer changed.
// Accepts either a Prisma user or a (legacy) Mongoose user document for createSession.
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../db/client');
const { oid } = require('../db/objectId');

const ACCESS_TOKEN_TTL = process.env.JWT_ACCESS_TTL || '10m';
const REFRESH_TOKEN_TTL_MS = parseInt(process.env.JWT_REFRESH_TTL_MS || `${30 * 24 * 60 * 60 * 1000}`, 10); // default 30 days

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateRandomToken(bytes = 48) {
  return crypto.randomBytes(bytes).toString('base64url');
}

// user may be a Prisma row (id is a string) or a Mongoose doc (id is the hex virtual).
function userIdOf(user) {
  return oid(user.id || user._id);
}

async function createSession({ user, fingerprint, userAgent, ip }) {
  const sessionId = crypto.randomUUID();
  const refreshToken = generateRandomToken();
  const refreshTokenHash = hashToken(refreshToken);

  const accessTokenPayload = {
    user: { id: userIdOf(user) },
    jti: sessionId,
    sessionVersion: user.security?.sessionVersion || 1,
  };

  const accessToken = jwt.sign(accessTokenPayload, process.env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL,
  });

  const session = await prisma.userSession.create({
    data: {
      userId: userIdOf(user),
      fingerprint,
      userAgent,
      ip,
      refreshTokenHash,
      accessTokenId: sessionId,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      lastActivityAt: new Date(),
    },
  });

  return { accessToken, refreshToken, session };
}

async function revokeSessionById(sessionId, reason = 'revoked') {
  const session = await prisma.userSession.findFirst({
    where: { accessTokenId: sessionId, revoked: false },
  });
  if (!session) return null;
  return prisma.userSession.update({
    where: { id: session.id },
    data: { revoked: true, revokedAt: new Date(), reason },
  });
}

async function revokeSessionsByFingerprint(userId, fingerprint, reason = 'device_removed') {
  return prisma.userSession.updateMany({
    where: { userId: oid(userId), fingerprint, revoked: false },
    data: { revoked: true, revokedAt: new Date(), reason },
  });
}

async function revokeAllSessionsExcept(userId, sessionId, reason = 'security_reset') {
  await prisma.userSession.updateMany({
    where: { userId: oid(userId), accessTokenId: { not: sessionId } },
    data: { revoked: true, revokedAt: new Date(), reason },
  });
}

async function validateAccessToken(token) {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const session = await prisma.userSession.findFirst({ where: { accessTokenId: decoded.jti } });

  if (!session) {
    throw new Error('session_not_found');
  }

  if (session.revoked) {
    throw new Error('session_revoked');
  }

  const user = await prisma.user.findUnique({
    where: { id: decoded.user.id },
    select: { id: true, security: true },
  });
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
  const session = await prisma.userSession.findFirst({ where: { refreshTokenHash: refreshHash } });
  if (!session) {
    throw new Error('invalid_refresh_token');
  }

  if (session.revoked) {
    throw new Error('session_revoked');
  }

  if (session.expiresAt < new Date()) {
    throw new Error('refresh_expired');
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) {
    throw new Error('user_not_found');
  }

  // Rotate refresh token
  const newRefreshToken = generateRandomToken();
  const updatedSession = await prisma.userSession.update({
    where: { id: session.id },
    data: {
      refreshTokenHash: hashToken(newRefreshToken),
      userAgent,
      ip,
      fingerprint,
      lastActivityAt: new Date(),
    },
  });

  const accessTokenPayload = {
    user: { id: user.id },
    jti: updatedSession.accessTokenId,
    sessionVersion: user.security?.sessionVersion || 1,
  };

  const accessToken = jwt.sign(accessTokenPayload, process.env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL,
  });

  return { accessToken, refreshToken: newRefreshToken, session: updatedSession, user };
}

async function revokeSessionsForUser(userId, reason = 'security_reset') {
  await prisma.userSession.updateMany({
    where: { userId: oid(userId), revoked: false },
    data: { revoked: true, revokedAt: new Date(), reason },
  });
}

async function getSessionById(sessionId) {
  return prisma.userSession.findFirst({ where: { accessTokenId: sessionId } });
}

async function getUserSessions(userId) {
  return prisma.userSession.findMany({
    where: { userId: oid(userId) },
    orderBy: { createdAt: 'desc' },
  });
}

async function deactivateSession(sessionId, reason = 'user_logout') {
  return revokeSessionById(sessionId, reason);
}

async function validateActiveSession(sessionId) {
  return prisma.userSession.findFirst({ where: { accessTokenId: sessionId, revoked: false } });
}

async function cleanupExpiredSessions() {
  const result = await prisma.userSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return result.count || 0;
}

async function getSessionStats() {
  const totalActiveSessions = await prisma.userSession.count({
    where: { revoked: false, expiresAt: { gt: new Date() } },
  });
  const totalRevoked = await prisma.userSession.count({ where: { revoked: true } });
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

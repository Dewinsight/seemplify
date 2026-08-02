const crypto = require('crypto');

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const HASH_ITERATIONS = 120000;
const HASH_KEY_LENGTH = 32;
const HASH_DIGEST = 'sha256';

function getAuthSecret() {
  const secret = process.env.AI_INTERVIEW_SESSION_SECRET || process.env.JWT_SECRET || 'dev-ai-interview-session-secret-change-me';
  if (process.env.NODE_ENV === 'production' && secret.includes('change-me')) {
    throw new Error('AI_INTERVIEW_SESSION_SECRET must be set in production.');
  }
  return secret;
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password || ''), salt, HASH_ITERATIONS, HASH_KEY_LENGTH, HASH_DIGEST).toString('hex');
}

function createPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, passwordHash: hashPassword(password, salt) };
}

function verifyPassword(password, user) {
  if (!user?.salt || !user?.passwordHash) return false;
  const candidate = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(user.passwordHash, 'hex'));
}

function signToken(user) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Date.now();
  const payload = Buffer.from(JSON.stringify({
    sub: user._id,
    email: user.email,
    role: user.role,
    name: user.name,
    iat: now,
    exp: now + TOKEN_TTL_MS
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', getAuthSecret()).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function verifyToken(token) {
  const [header, payload, signature] = String(token || '').split('.');
  if (!header || !payload || !signature) throw new Error('Invalid token');
  const expected = crypto.createHmac('sha256', getAuthSecret()).update(`${header}.${payload}`).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error('Invalid token signature');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (!claims.exp || Date.now() > claims.exp) throw new Error('Token expired');
  return claims;
}

function safeUser(user) {
  return {
    id: user._id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    lastLoginAt: user.lastLoginAt
  };
}

function seedUsers(nowIso) {
  const admin = createPasswordRecord(process.env.AI_INTERVIEW_ADMIN_PASSWORD || 'AdminPass123!');
  const recruiter = createPasswordRecord(process.env.AI_INTERVIEW_RECRUITER_PASSWORD || 'RecruiterPass123!');
  return [
    {
      _id: 'user_admin',
      email: (process.env.AI_INTERVIEW_ADMIN_EMAIL || 'admin@aiinterview.local').toLowerCase(),
      name: process.env.AI_INTERVIEW_ADMIN_NAME || 'AI Interview Admin',
      role: 'admin',
      status: 'active',
      ...admin,
      createdAt: nowIso,
      updatedAt: nowIso
    },
    {
      _id: 'user_recruiter',
      email: (process.env.AI_INTERVIEW_RECRUITER_EMAIL || 'recruiter@aiinterview.local').toLowerCase(),
      name: process.env.AI_INTERVIEW_RECRUITER_NAME || 'Recruiter',
      role: 'recruiter',
      status: 'active',
      ...recruiter,
      createdAt: nowIso,
      updatedAt: nowIso
    }
  ];
}

module.exports = {
  createPasswordRecord,
  verifyPassword,
  signToken,
  verifyToken,
  safeUser,
  seedUsers
};

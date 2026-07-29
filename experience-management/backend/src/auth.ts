import crypto from 'node:crypto';
import fs from 'node:fs';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { db } from './database.js';
import { sendPasswordResetEmail } from './emailService.js';

const cookieName = 'seemplify_experience_session';
const resetLifetimeMs = 30 * 60_000;
const scryptParameters = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
type UserRow = { id: string; email: string; name: string; password_hash: string; role: string; session_version: number };
type SessionUser = { id: string; email: string; name: string; role: string; sessionVersion: number };

function readRequired(path: string, label: string) {
  try { const value = fs.readFileSync(path, 'utf8').trim(); if (value.length < 20) throw new Error('too short'); return value; }
  catch { throw new Error(`${label} is not configured. Run the local setup script.`); }
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function normalizeEmail(value: unknown) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : '';
}

function passwordError(value: unknown) {
  const password = String(value || '');
  if (password.length < 12 || password.length > 128) return 'Password must be between 12 and 128 characters.';
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return 'Password must include uppercase, lowercase, and a number.';
  }
  return null;
}

function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const derived = crypto.scryptSync(password, salt, 64, scryptParameters).toString('base64url');
  return `scrypt$${scryptParameters.N}$${scryptParameters.r}$${scryptParameters.p}$${salt}$${derived}`;
}

function verifyPassword(password: string, encoded: string) {
  try {
    const [scheme, n, r, p, salt, expected] = String(encoded || '').split('$');
    if (scheme !== 'scrypt' || !salt || !expected) return false;
    const derived = crypto.scryptSync(password, salt, 64, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: scryptParameters.maxmem
    }).toString('base64url');
    return safeEqual(derived, expected);
  } catch { return false; }
}

const dummyPasswordHash = hashPassword(crypto.randomBytes(24).toString('base64url'));
function sign(encoded: string) {
  return crypto.createHmac('sha256', readRequired(config.sessionSecretFile, 'Session secret')).update(encoded).digest('base64url');
}

function makeSession(user: SessionUser) {
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    email: user.email,
    v: user.sessionVersion,
    exp: Date.now() + config.sessionHours * 3_600_000
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function parseCookies(request: Request) {
  return Object.fromEntries(String(request.headers.cookie || '').split(';')
    .map((part) => part.trim().split('=').map(decodeURIComponent)).filter((part) => part.length === 2));
}

function sessionUser(request: Request): SessionUser | null {
  const token = parseCookies(request)[cookieName]; if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeEqual(sign(payload), signature)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!parsed.sub || Number(parsed.exp) <= Date.now()) return null;
    const user = db.prepare('SELECT id,email,name,role,session_version FROM users WHERE id=?').get(parsed.sub) as UserRow | undefined;
    if (!user || user.email !== parsed.email || Number(user.session_version) !== Number(parsed.v)) return null;
    return { id: user.id, email: user.email, name: user.name, role: user.role, sessionVersion: Number(user.session_version) };
  } catch { return null; }
}

export function validSession(request: Request) { return Boolean(sessionUser(request)); }

function cookie(value: string, maxAge: number) {
  const secure = config.publicUrl.startsWith('https://') ? '; Secure' : '';
  return `${cookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function authenticatedResponse(response: Response, user: SessionUser, status = 200) {
  response.setHeader('Set-Cookie', cookie(makeSession(user), config.sessionHours * 3600));
  return response.status(status).json({
    authenticated: true,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    email: user.email
  });
}

const limits = new Map<string, number[]>();
function rateLimitKey(request: Request, bucket: string) { return `${bucket}:${String(request.ip || 'unknown')}`; }
function rateLimited(request: Request, bucket: string, maximum: number, windowMs = 15 * 60_000, record = true) {
  const key = rateLimitKey(request, bucket);
  const now = Date.now(); const recent = (limits.get(key) || []).filter((time) => now - time < windowMs);
  if (recent.length >= maximum) return true;
  if (record) { recent.push(now); limits.set(key, recent); }
  return false;
}

function userByEmail(email: string) {
  return db.prepare('SELECT id,email,name,password_hash,role,session_version FROM users WHERE email=?').get(email) as UserRow | undefined;
}

function createUser(email: string, name: string, password: string) {
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  const count = Number((db.prepare('SELECT COUNT(*) count FROM users').get() as any)?.count || 0);
  const role = count === 0 ? 'owner' : 'member';
  db.prepare(`INSERT INTO users (id,email,name,password_hash,role,session_version,created_at,updated_at)
    VALUES (?,?,?,?,?,1,?,?)`).run(id, email, name, hashPassword(password), role, now, now);
  return { id, email, name, role, sessionVersion: 1 } satisfies SessionUser;
}

export function signup(request: Request, response: Response) {
  if (rateLimited(request, 'signup', 6, 60 * 60_000)) return response.status(429).json({ error: 'Too many sign-up attempts. Try again later.' });
  const email = normalizeEmail(request.body?.email);
  const name = String(request.body?.name || '').trim().replace(/\s+/g, ' ');
  const password = String(request.body?.password || '');
  const invalidPassword = passwordError(password);
  if (!email) return response.status(400).json({ error: 'Enter a valid email address.' });
  if (name.length < 2 || name.length > 100) return response.status(400).json({ error: 'Name must be between 2 and 100 characters.' });
  if (invalidPassword) return response.status(400).json({ error: invalidPassword });
  if (userByEmail(email)) return response.status(409).json({ error: 'An account already exists for this email.' });
  try { return authenticatedResponse(response, createUser(email, name, password), 201); }
  catch (error: any) {
    if (String(error?.code || '').startsWith('SQLITE_CONSTRAINT')) return response.status(409).json({ error: 'An account already exists for this email.' });
    throw error;
  }
}

export function login(request: Request, response: Response) {
  if (rateLimited(request, 'login', 8, 15 * 60_000, false)) return response.status(429).json({ error: 'Too many sign-in attempts. Try again later.' });
  const email = normalizeEmail(request.body?.email); const password = String(request.body?.password || '');
  let user = email ? userByEmail(email) : undefined;
  let valid = user ? verifyPassword(password, user.password_hash) : verifyPassword(password, dummyPasswordHash);

  if (!user && email === config.adminEmail) {
    try {
      const legacyPassword = readRequired(config.adminPasswordFile, 'Admin password');
      valid = safeEqual(password, legacyPassword);
      if (valid) {
        const migrated = createUser(email, 'Workspace admin', password);
        user = { ...migrated, password_hash: hashPassword(password), session_version: migrated.sessionVersion };
      }
    } catch { valid = false; }
  }
  if (!user || !valid) {
    rateLimited(request, 'login', 8);
    return response.status(401).json({ error: 'Email or password is incorrect.' });
  }
  limits.delete(rateLimitKey(request, 'login'));
  return authenticatedResponse(response, {
    id: user.id, email: user.email, name: user.name, role: user.role, sessionVersion: Number(user.session_version)
  });
}

export function issuePasswordResetToken(email: string) {
  const user = userByEmail(normalizeEmail(email));
  if (!user) return null;
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const now = new Date(); const expiresAt = new Date(now.getTime() + resetLifetimeMs);
  const transaction = db.transaction(() => {
    db.prepare('UPDATE password_reset_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL').run(now.toISOString(), user.id);
    db.prepare(`INSERT INTO password_reset_tokens (id,user_id,token_hash,expires_at,used_at,created_at)
      VALUES (?,?,?,?,NULL,?)`).run(crypto.randomUUID(), user.id, tokenHash, expiresAt.toISOString(), now.toISOString());
    db.prepare('DELETE FROM password_reset_tokens WHERE expires_at < ? OR used_at IS NOT NULL AND used_at < ?')
      .run(new Date(now.getTime() - 24 * 60 * 60_000).toISOString(), new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString());
  });
  transaction();
  return { token, user: { email: user.email, name: user.name } };
}

export async function forgotPassword(request: Request, response: Response) {
  if (rateLimited(request, 'forgot', 5, 60 * 60_000)) return response.status(429).json({ error: 'Too many reset requests. Try again later.' });
  const issued = issuePasswordResetToken(String(request.body?.email || ''));
  if (issued) {
    try { await sendPasswordResetEmail({ ...issued.user, token: issued.token }); }
    catch (error) { console.error('Password reset email delivery failed:', error instanceof Error ? error.message : String(error)); }
  }
  return response.status(202).json({ message: 'If an account exists for that email, a reset link has been sent.' });
}

export function resetPassword(request: Request, response: Response) {
  if (rateLimited(request, 'reset', 10, 60 * 60_000)) return response.status(429).json({ error: 'Too many reset attempts. Try again later.' });
  const token = String(request.body?.token || '').trim(); const password = String(request.body?.password || '');
  const invalidPassword = passwordError(password);
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) return response.status(400).json({ error: 'This password reset link is invalid or expired.' });
  if (invalidPassword) return response.status(400).json({ error: invalidPassword });
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex'); const now = new Date().toISOString();
  const reset = db.prepare(`SELECT t.id token_id,u.id,u.email,u.name,u.role,u.session_version
    FROM password_reset_tokens t JOIN users u ON u.id=t.user_id
    WHERE t.token_hash=? AND t.used_at IS NULL AND t.expires_at>?`).get(tokenHash, now) as any;
  if (!reset) return response.status(400).json({ error: 'This password reset link is invalid or expired.' });
  const transaction = db.transaction(() => {
    db.prepare('UPDATE users SET password_hash=?,session_version=session_version+1,updated_at=? WHERE id=?')
      .run(hashPassword(password), now, reset.id);
    db.prepare('UPDATE password_reset_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL').run(now, reset.id);
  });
  transaction();
  return authenticatedResponse(response, {
    id: reset.id,
    email: reset.email,
    name: reset.name,
    role: reset.role,
    sessionVersion: Number(reset.session_version) + 1
  });
}

export function logout(_request: Request, response: Response) { response.setHeader('Set-Cookie', cookie('', 0)); return response.status(204).end(); }
export function requireAdmin(request: Request, response: Response, next: NextFunction) { if (!validSession(request)) return response.status(401).json({ error: 'Authentication required.' }); next(); }
export function session(request: Request, response: Response) {
  const user = sessionUser(request);
  return response.json({
    authenticated: Boolean(user),
    email: user?.email || null,
    user: user ? { id: user.id, email: user.email, name: user.name, role: user.role } : null
  });
}

import crypto from 'node:crypto';
import fs from 'node:fs';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { config } from './config.js';
import { db } from './database.js';
import { isDatabaseConstraintError } from './databaseAdapter.js';
import { sendEmailVerificationEmail, sendExistingAccountSignupNotice, sendPasswordResetEmail } from './emailService.js';
import { EsignError, getRecipientAccountInvitation } from './esign.js';
import {
  ensureDefaultSpaceForUser, pendingSpaceInvitationForSignup, renamePersonalSpaceForUser, spaceSession
} from './spaces.js';

const cookieName = 'seemplify_experience_session';
const resetLifetimeMs = 30 * 60_000;
const verificationLifetimeMs = 24 * 60 * 60_000;
const verificationResendCooldownMs = 60_000;
const verificationResendWindowMs = 60 * 60_000;
const verificationResendMaximum = 5;
export const currentOnboardingVersion = 1;
const scryptParameters = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
type UserRow = {
  id: string; email: string; name: string; password_hash: string; role: string; session_version: number;
  email_verified_at: string | null; password_claim_required: number;
};
export type SessionUser = {
  id: string; email: string; name: string; role: string; sessionVersion: number; emailVerifiedAt: string | null;
};
export type AccountProfile = {
  name: string;
  email: string;
  jobTitle: string;
  organizationName: string;
  timezone: string;
  primaryGoal: 'customer_experience' | 'employee_experience' | 'market_research' | 'all_experience' | null;
  onboardingVersion: number;
  completedAt: string | null;
};

class VerificationRateLimitError extends Error {
  retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super('Wait before requesting another verification email.');
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

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

function safeAccountReturnPath(value: unknown) {
  return String(value || '') === '/my-documents' ? '/my-documents' : null;
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

export function currentSessionUser(request: Request): SessionUser | null {
  const token = parseCookies(request)[cookieName]; if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeEqual(sign(payload), signature)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!parsed.sub || Number(parsed.exp) <= Date.now()) return null;
    const user = db.prepare(`SELECT id,email,name,role,session_version,email_verified_at,password_claim_required
      FROM users WHERE id=?`).get(parsed.sub) as UserRow | undefined;
    if (!user || user.email !== parsed.email || Number(user.session_version) !== Number(parsed.v)) return null;
    return {
      id: user.id, email: user.email, name: user.name, role: user.role,
      sessionVersion: Number(user.session_version), emailVerifiedAt: user.email_verified_at
    };
  } catch { return null; }
}

export function validSession(request: Request) { return Boolean(currentSessionUser(request)); }

function cookie(value: string, maxAge: number) {
  const secure = config.publicUrl.startsWith('https://') ? '; Secure' : '';
  return `${cookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function profileForUser(user: Pick<SessionUser, 'id' | 'email' | 'name'>): AccountProfile {
  const row = db.prepare(`SELECT job_title,organization_name,timezone,primary_goal,onboarding_version,onboarding_completed_at
    FROM user_profiles WHERE user_id=?`).get(user.id) as any;
  const primaryGoal = String(row?.primary_goal || '');
  return {
    name: user.name,
    email: user.email,
    jobTitle: String(row?.job_title || ''),
    organizationName: String(row?.organization_name || ''),
    timezone: String(row?.timezone || ''),
    primaryGoal: ['customer_experience', 'employee_experience', 'market_research', 'all_experience'].includes(primaryGoal)
      ? primaryGoal as AccountProfile['primaryGoal'] : null,
    onboardingVersion: Number(row?.onboarding_version || 0),
    completedAt: row?.onboarding_completed_at || null
  };
}

function onboardingRequired(profile: AccountProfile) {
  return profile.onboardingVersion < currentOnboardingVersion || !profile.completedAt;
}

function sessionPayload(user: SessionUser) {
  const profile = profileForUser(user);
  return {
    authenticated: true,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
    onboardingRequired: onboardingRequired(profile),
    profile,
    ...spaceSession(user.id)
  };
}

function authenticatedResponse(response: Response, user: SessionUser, status = 200) {
  response.setHeader('Set-Cookie', cookie(makeSession(user), config.sessionHours * 3600));
  return response.status(status).json(sessionPayload(user));
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
  return db.prepare(`SELECT id,email,name,password_hash,role,session_version,email_verified_at,password_claim_required
    FROM users WHERE email=?`).get(email) as UserRow | undefined;
}

function createUser(email: string, name: string, password: string, spaceName?: unknown, options: { verified?: boolean; onboarded?: boolean } = {}) {
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  const count = Number((db.prepare('SELECT COUNT(*) count FROM users').get() as any)?.count || 0);
  const role = count === 0 ? 'owner' : 'member';
  const verifiedAt = options.verified ? now : null;
  const completedAt = options.onboarded ? now : null;
  db.transaction(() => {
    db.prepare(`INSERT INTO users (id,email,name,password_hash,role,session_version,email_verified_at,created_at,updated_at)
      VALUES (?,?,?,?,?,1,?,?,?)`).run(id, email, name, hashPassword(password), role, verifiedAt, now, now);
    db.prepare(`INSERT INTO user_profiles
      (user_id,job_title,organization_name,timezone,primary_goal,onboarding_version,onboarding_completed_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(id, '', '', '', '', options.onboarded ? currentOnboardingVersion : 0, completedAt, now, now);
    ensureDefaultSpaceForUser({ id, name }, spaceName);
  })();
  return { id, email, name, role, sessionVersion: 1, emailVerifiedAt: verifiedAt } satisfies SessionUser;
}

function markBootstrapAccountReady(userId: string) {
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare('UPDATE users SET email_verified_at=COALESCE(email_verified_at,created_at),updated_at=? WHERE id=?').run(now, userId);
    db.prepare(`INSERT INTO user_profiles
      (user_id,job_title,organization_name,timezone,primary_goal,onboarding_version,onboarding_completed_at,created_at,updated_at)
      SELECT id,'','','','',?,?,created_at,? FROM users WHERE id=?
      ON CONFLICT(user_id) DO UPDATE SET onboarding_version=MAX(user_profiles.onboarding_version,excluded.onboarding_version),
        onboarding_completed_at=COALESCE(user_profiles.onboarding_completed_at,excluded.onboarding_completed_at),updated_at=excluded.updated_at`)
      .run(currentOnboardingVersion, now, now, userId);
  })();
}

export function bootstrapAdminAccount() {
  const existing = userByEmail(config.adminEmail);
  if (existing) {
    if (existing.role !== 'owner') db.prepare("UPDATE users SET role='owner',updated_at=? WHERE id=?").run(new Date().toISOString(), existing.id);
    markBootstrapAccountReady(existing.id);
    ensureDefaultSpaceForUser({ id: existing.id, name: existing.name });
    return existing.id;
  }
  const password = readRequired(config.adminPasswordFile, 'Admin password');
  const created = createUser(config.adminEmail, 'Workspace admin', password, undefined, { verified: true, onboarded: true });
  if (created.role !== 'owner') db.prepare("UPDATE users SET role='owner',updated_at=? WHERE id=?").run(new Date().toISOString(), created.id);
  return created.id;
}

type EmailVerificationIssue = {
  id: string;
  token: string;
  expiresAt: string;
  requiresPasswordSetup: boolean;
  returnPath: string | null;
  user: { id: string; email: string; name: string };
};

function createEmailVerificationToken(
  user: UserRow | SessionUser,
  pendingInvitationId?: string | null,
  enforceResendLimit = false,
  requiresPasswordSetup = false,
  returnPath: string | null = null
): EmailVerificationIssue {
  const now = new Date();
  const recentDelivered = enforceResendLimit ? db.prepare(`SELECT sent_at FROM email_verification_tokens
    WHERE user_id=? AND delivery_failed_at IS NULL ORDER BY sent_at DESC,id DESC LIMIT 1`).get(user.id) as { sent_at: string } | undefined : undefined;
  if (enforceResendLimit && recentDelivered) {
    const elapsed = now.getTime() - Date.parse(recentDelivered.sent_at);
    if (Number.isFinite(elapsed) && elapsed < verificationResendCooldownMs) {
      throw new VerificationRateLimitError(Math.max(1, Math.ceil((verificationResendCooldownMs - elapsed) / 1000)));
    }
    const windowStart = new Date(now.getTime() - verificationResendWindowMs).toISOString();
    const count = Number((db.prepare(`SELECT COUNT(*) count FROM email_verification_tokens
      WHERE user_id=? AND delivery_failed_at IS NULL AND sent_at>=?`).get(user.id, windowStart) as { count: number }).count || 0);
    if (count >= verificationResendMaximum) throw new VerificationRateLimitError(Math.ceil(verificationResendWindowMs / 1000));
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const id = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + verificationLifetimeMs).toISOString();
  const invitationId = pendingInvitationId || null;
  db.transaction(() => {
    if (requiresPasswordSetup) {
      // Once a duplicate signup has started a mailbox-owned claim, an older
      // first-signup link must never activate its preselected password.
      db.prepare('UPDATE users SET password_claim_required=1,updated_at=? WHERE id=? AND email_verified_at IS NULL')
        .run(now.toISOString(), user.id);
      db.prepare(`UPDATE email_verification_tokens SET used_at=?
        WHERE user_id=? AND used_at IS NULL AND requires_password_setup=0`)
        .run(now.toISOString(), user.id);
    }
    db.prepare(`INSERT INTO email_verification_tokens
      (id,user_id,token_hash,pending_invitation_id,pending_password_hash,requires_password_setup,return_path,expires_at,sent_at,used_at,created_at)
      VALUES (?,?,?,?,NULL,?,?,?,?,?,?)`).run(
        id, user.id, tokenHash, invitationId, requiresPasswordSetup ? 1 : 0,
        safeAccountReturnPath(returnPath), expiresAt, now.toISOString(), null, now.toISOString()
      );
    db.prepare(`DELETE FROM email_verification_tokens
      WHERE expires_at<? OR (used_at IS NOT NULL AND used_at<?)`)
      .run(new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString(), new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString());
  })();
  return { id, token, expiresAt, requiresPasswordSetup, returnPath: safeAccountReturnPath(returnPath), user: { id: user.id, email: user.email, name: user.name } };
}

export function issueEmailVerificationToken(emailValue: string, options: { enforceResendLimit?: boolean; requestId?: string } = {}) {
  const user = userByEmail(normalizeEmail(emailValue));
  if (!user || user.email_verified_at) return null;
  const reference = options.requestId && /^[0-9a-f-]{36}$/i.test(options.requestId)
    ? db.prepare(`SELECT pending_invitation_id,requires_password_setup,return_path,delivery_failed_at,resend_exemption_used_at FROM email_verification_tokens
      WHERE id=? AND user_id=?`).get(options.requestId, user.id) as {
        pending_invitation_id: string | null; requires_password_setup: number; delivery_failed_at: string | null;
        return_path: string | null; resend_exemption_used_at: string | null;
      } | undefined
    : undefined;
  if (options.requestId && !reference) return null;
  let failedDeliveryExemption = false;
  if (options.enforceResendLimit && reference?.delivery_failed_at && !reference.resend_exemption_used_at) {
    failedDeliveryExemption = db.prepare(`UPDATE email_verification_tokens SET resend_exemption_used_at=?
      WHERE id=? AND user_id=? AND delivery_failed_at IS NOT NULL AND resend_exemption_used_at IS NULL`)
      .run(new Date().toISOString(), options.requestId, user.id).changes === 1;
  }
  return createEmailVerificationToken(
    user,
    reference ? reference.pending_invitation_id : undefined,
    Boolean(options.enforceResendLimit) && !failedDeliveryExemption,
    Boolean(reference?.requires_password_setup) || Boolean(user.password_claim_required),
    safeAccountReturnPath(reference?.return_path)
  );
}

async function deliverEmailVerification(issue: EmailVerificationIssue) {
  try {
    await sendEmailVerificationEmail({
      verificationId: issue.id,
      email: issue.user.email,
      name: issue.user.name,
      token: issue.token,
      expiresAt: issue.expiresAt,
      requiresPasswordSetup: issue.requiresPasswordSetup,
      returnPath: issue.returnPath
    });
  } catch (error) {
    // A failed replacement send must not retire a link that may already be in
    // the recipient's inbox or consume the persistent resend allowance.
    const failedAt = new Date().toISOString();
    db.prepare(`UPDATE email_verification_tokens SET used_at=?,delivery_failed_at=?
      WHERE id=? AND used_at IS NULL`).run(failedAt, failedAt, issue.id);
    throw error;
  }
}

async function minimumResponseTime(startedAt: number, minimumMs: number) {
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

function verificationRequiredPayload(
  email: string,
  expiresAt: string,
  requestId: string,
  delivery: 'sent' | 'failed' = 'sent',
  returnPath: string | null = null
) {
  return {
    authenticated: false,
    verificationRequired: true,
    code: 'EMAIL_VERIFICATION_REQUIRED',
    email,
    expiresAt,
    verificationRequestId: requestId,
    delivery: { state: delivery },
    returnTo: safeAccountReturnPath(returnPath)
  } as const;
}

function beginAccountEmailAttempt(userId: string, kind: 'claim' | 'existing_notice' | 'password_reset', blockWhilePending = false) {
  const now = new Date();
  const windowStart = new Date(now.getTime() - verificationResendWindowMs).toISOString();
  const id = crypto.randomUUID();
  return db.transaction(() => {
    if (blockWhilePending) {
      const pendingSince = new Date(now.getTime() - 10 * 60_000).toISOString();
      const pending = db.prepare(`SELECT 1 FROM account_email_attempts
        WHERE user_id=? AND kind=? AND delivered_at IS NULL AND failed_at IS NULL AND created_at>=? LIMIT 1`)
        .get(userId, kind, pendingSince);
      if (pending) return null;
    }
    const recent = Number((db.prepare(`SELECT COUNT(*) count FROM account_email_attempts
      WHERE user_id=? AND kind=? AND failed_at IS NULL AND created_at>=?`).get(userId, kind, windowStart) as { count: number }).count || 0);
    if (recent >= verificationResendMaximum) return null;
    db.prepare(`INSERT INTO account_email_attempts (id,user_id,kind,created_at,delivered_at,failed_at)
      VALUES (?,?,?,?,NULL,NULL)`).run(id, userId, kind, now.toISOString());
    db.prepare('DELETE FROM account_email_attempts WHERE created_at<?')
      .run(new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString());
    return id;
  })();
}

function finishAccountEmailAttempt(id: string, failed: boolean) {
  const now = new Date().toISOString();
  db.prepare(`UPDATE account_email_attempts SET delivered_at=?,failed_at=? WHERE id=?`)
    .run(failed ? null : now, failed ? now : null, id);
}

async function deliverExistingSignupAttempt(
  user: UserRow,
  password: string,
  pendingInvitationId: string | null,
  inviteToken: string,
  returnPath: string | null = null
) {
  let expiresAt = new Date(Date.now() + verificationLifetimeMs).toISOString();
  let requestId: string = crypto.randomUUID();
  let state: 'sent' | 'failed' = 'sent';
  const attemptId = beginAccountEmailAttempt(user.id, user.email_verified_at ? 'existing_notice' : 'claim');
  if (!attemptId) {
    // Keep the public response generic while the persistent per-account limit
    // prevents distributed email bombing. A prior message remains usable.
    hashPassword(password);
    return { expiresAt, requestId, state };
  }
  try {
    if (user.email_verified_at) {
      // Match the password-hashing work of a new signup and send a real
      // mailbox notice so status and provider timing do not expose membership.
      verifyPassword(password, dummyPasswordHash);
      await sendExistingAccountSignupNotice({
        attemptId, email: user.email, name: user.name, inviteToken: inviteToken || undefined,
        returnPath: safeAccountReturnPath(returnPath)
      });
    } else {
      // The submitted password is deliberately not staged. Mailbox proof leads
      // to an explicit password-selection step, eliminating last-writer-wins
      // claim races and pre-registration takeover.
      hashPassword(password);
      const issue = createEmailVerificationToken(user, pendingInvitationId, false, true, safeAccountReturnPath(returnPath));
      expiresAt = issue.expiresAt;
      requestId = issue.id;
      await deliverEmailVerification(issue);
    }
    finishAccountEmailAttempt(attemptId, false);
  } catch (error) {
    state = 'failed';
    finishAccountEmailAttempt(attemptId, true);
    console.error('Email verification delivery failed:', error instanceof Error ? error.message : String(error));
  }
  return { expiresAt, requestId, state };
}

export async function signup(request: Request, response: Response) {
  const startedAt = Date.now();
  if (rateLimited(request, 'signup', 6, 60 * 60_000)) return response.status(429).json({ error: 'Too many sign-up attempts. Try again later.' });
  const email = normalizeEmail(request.body?.email);
  const name = String(request.body?.name || '').trim().replace(/\s+/g, ' ');
  const password = String(request.body?.password || '');
  const rawSpaceName = request.body?.spaceName;
  const inviteToken = String(request.body?.inviteToken || '').trim();
  const esignAccountToken = String(request.body?.esignAccountToken || '').trim();
  const invalidPassword = passwordError(password);
  if (!email) return response.status(400).json({ error: 'Enter a valid email address.' });
  if (name.length < 2 || name.length > 100) return response.status(400).json({ error: 'Name must be between 2 and 100 characters.' });
  if (invalidPassword) return response.status(400).json({ error: invalidPassword });
  let returnPath: string | null = null;
  if (esignAccountToken) {
    try {
      const invitation = getRecipientAccountInvitation(esignAccountToken);
      if (invitation.recipient.email !== email) {
        return response.status(400).json({ error: 'Use the recipient email address from the completed agreement.', code: 'ESIGN_ACCOUNT_EMAIL_MISMATCH' });
      }
      returnPath = '/my-documents';
    } catch (caught) {
      if (caught instanceof EsignError) return response.status(caught.status).json({ error: caught.message, code: caught.code });
      throw caught;
    }
  }
  const spaceName = rawSpaceName === undefined ? undefined : String(rawSpaceName || '').trim().replace(/\s+/g, ' ');
  if (spaceName !== undefined && spaceName && (spaceName.length < 2 || spaceName.length > 100)) {
    return response.status(400).json({ error: 'Space name must be between 2 and 100 characters.' });
  }
  const pendingInvitation = inviteToken ? pendingSpaceInvitationForSignup(email, inviteToken) : null;
  const existing = userByEmail(email);
  if (existing) {
    const delivery = await deliverExistingSignupAttempt(existing, password, pendingInvitation?.id || null, inviteToken, returnPath);
    await minimumResponseTime(startedAt, 500);
    return response.status(202).json(verificationRequiredPayload(
      email,
      delivery.expiresAt,
      delivery.requestId,
      delivery.state,
      returnPath
    ));
  }
  try {
    const created = db.transaction(() => {
      const created = createUser(email, name, password, spaceName);
      const verification = createEmailVerificationToken(created, pendingInvitation?.id || null, false, false, returnPath);
      return { user: created, verification };
    })();
    let delivery: { state: 'sent' | 'failed' } = { state: 'sent' };
    try { await deliverEmailVerification(created.verification); }
    catch (error) {
      delivery = { state: 'failed' };
      console.error('Email verification delivery failed:', error instanceof Error ? error.message : String(error));
    }
    await minimumResponseTime(startedAt, 500);
    return response.status(202).json(verificationRequiredPayload(
      created.user.email,
      created.verification.expiresAt,
      created.verification.id,
      delivery.state,
      returnPath
    ));
  }
  catch (error: any) {
    if (isDatabaseConstraintError(error)) {
      const racedUser = userByEmail(email);
      const delivery = racedUser
        ? await deliverExistingSignupAttempt(racedUser, password, pendingInvitation?.id || null, inviteToken, returnPath)
        : {
            expiresAt: new Date(startedAt + verificationLifetimeMs).toISOString(),
            requestId: crypto.randomUUID(),
            state: 'failed' as const
          };
      await minimumResponseTime(startedAt, 500);
      return response.status(202).json(verificationRequiredPayload(
        email,
        delivery.expiresAt,
        delivery.requestId,
        delivery.state,
        returnPath
      ));
    }
    throw error;
  }
}

export function login(request: Request, response: Response) {
  if (rateLimited(request, 'login', 8, 15 * 60_000, false)) return response.status(429).json({ error: 'Too many sign-in attempts. Try again later.' });
  const email = normalizeEmail(request.body?.email); const password = String(request.body?.password || '');
  const identityHash = loginIdentityHash(request.body?.email);
  let user = email ? userByEmail(email) : undefined;
  let valid = user ? verifyPassword(password, user.password_hash) : verifyPassword(password, dummyPasswordHash);

  if (!user && email === config.adminEmail) {
    try {
      const legacyPassword = readRequired(config.adminPasswordFile, 'Admin password');
      valid = safeEqual(password, legacyPassword);
      if (valid) {
        const migrated = createUser(email, 'Workspace admin', password, undefined, { verified: true, onboarded: true });
        user = {
          ...migrated, password_hash: hashPassword(password), session_version: migrated.sessionVersion,
          email_verified_at: migrated.emailVerifiedAt, password_claim_required: 0
        };
      }
    } catch { valid = false; }
  }
  if (!user || !valid) {
    if (loginIdentityRateLimited(identityHash)) {
      return response.status(429).json({ error: 'Too many sign-in attempts. Try again later.' });
    }
    rateLimited(request, 'login', 8);
    recordLoginIdentityFailure(identityHash);
    return response.status(401).json({ error: 'Email or password is incorrect.' });
  }
  clearLoginIdentityFailures(identityHash);
  if (!user.email_verified_at) {
    return response.status(403).json({
      error: 'Verify your email address before signing in.',
      code: 'EMAIL_VERIFICATION_REQUIRED',
      email: user.email,
      verificationRequired: true
    });
  }
  return authenticatedResponse(response, {
    id: user.id, email: user.email, name: user.name, role: user.role,
    sessionVersion: Number(user.session_version), emailVerifiedAt: user.email_verified_at
  });
}

function loginIdentityHash(emailValue: unknown) {
  const identity = String(emailValue || '').trim().toLowerCase().slice(0, 254);
  return crypto.createHmac('sha256', readRequired(config.sessionSecretFile, 'Session secret'))
    .update(`login-identity\0${identity}`).digest('hex');
}

function loginIdentityRateLimited(identityHash: string) {
  const windowStart = new Date(Date.now() - 15 * 60_000).toISOString();
  return Number((db.prepare(`SELECT COUNT(*) count FROM auth_identity_attempts WHERE identity_hash=? AND created_at>=?`)
    .get(identityHash, windowStart) as { count: number }).count || 0) >= 8;
}

function recordLoginIdentityFailure(identityHash: string) {
  const now = new Date();
  db.transaction(() => {
    db.prepare('INSERT INTO auth_identity_attempts (id,identity_hash,created_at) VALUES (?,?,?)')
      .run(crypto.randomUUID(), identityHash, now.toISOString());
    db.prepare('DELETE FROM auth_identity_attempts WHERE created_at<?')
      .run(new Date(now.getTime() - 24 * 60 * 60_000).toISOString());
  })();
}

function clearLoginIdentityFailures(identityHash: string) {
  db.prepare('DELETE FROM auth_identity_attempts WHERE identity_hash=?').run(identityHash);
}

export async function resendEmailVerification(request: Request, response: Response) {
  const startedAt = Date.now();
  const genericMessage = 'If an unverified account exists for that email, a new verification link has been sent.';
  if (rateLimited(request, 'verification-resend', 10, verificationResendWindowMs)) {
    return response.status(429).json({ error: 'Too many verification requests. Try again later.', code: 'VERIFICATION_RATE_LIMITED' });
  }
  const email = normalizeEmail(request.body?.email);
  if (!email) return response.status(202).json({ message: genericMessage });
  try {
    const requestId = String(request.body?.requestId || '').trim();
    const issue = issueEmailVerificationToken(email, {
      enforceResendLimit: true,
      requestId: requestId || undefined
    });
    if (issue) {
      void deliverEmailVerification(issue).catch((error) => {
        console.error('Email verification delivery failed:', error instanceof Error ? error.message : String(error));
      });
    }
    await minimumResponseTime(startedAt, 80);
    return response.status(202).json({ message: genericMessage });
  } catch (error) {
    if (error instanceof VerificationRateLimitError) {
      // Keep the response indistinguishable from an unknown or already
      // verified address while enforcing the persistent send cooldown.
      await minimumResponseTime(startedAt, 80);
      return response.status(202).json({ message: genericMessage });
    }
    throw error;
  }
}

export function verifyEmail(request: Request, response: Response) {
  const token = String(request.body?.token || '').trim();
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) {
    return response.status(400).json({ error: 'This verification link is invalid.', code: 'EMAIL_VERIFICATION_INVALID' });
  }
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const verification = db.prepare(`SELECT t.id token_id,t.pending_invitation_id,t.requires_password_setup,t.return_path,t.expires_at,t.used_at,
      u.id,u.email,u.name,u.role,u.session_version,u.email_verified_at,u.password_claim_required
    FROM email_verification_tokens t JOIN users u ON u.id=t.user_id
    WHERE t.token_hash=? AND u.email_verified_at IS NULL`).get(tokenHash) as any;
  if (!verification || verification.used_at) {
    return response.status(400).json({ error: 'This verification link is invalid or has already been used.', code: 'EMAIL_VERIFICATION_INVALID' });
  }
  if (Date.parse(verification.expires_at) <= Date.now()) {
    return response.status(400).json({ error: 'This verification link has expired. Request a new one.', code: 'EMAIL_VERIFICATION_EXPIRED' });
  }
  const now = new Date().toISOString();
  const requiresPasswordSetup = Boolean(verification.requires_password_setup || verification.password_claim_required);
  const passwordSetupToken = requiresPasswordSetup ? crypto.randomBytes(32).toString('base64url') : '';
  const passwordSetupTokenHash = passwordSetupToken
    ? crypto.createHash('sha256').update(passwordSetupToken).digest('hex')
    : '';
  const claimLockPasswordHash = requiresPasswordSetup
    ? hashPassword(crypto.randomBytes(32).toString('base64url'))
    : '';
  const passwordSetupExpiresAt = new Date(Date.now() + resetLifetimeMs).toISOString();
  const result = db.transaction(() => {
    const consumed = db.prepare('UPDATE email_verification_tokens SET used_at=? WHERE id=? AND used_at IS NULL').run(now, verification.token_id).changes;
    if (consumed !== 1) return null;
    db.prepare('UPDATE email_verification_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL')
      .run(now, verification.id);
    if (requiresPasswordSetup) {
      // Mailbox proof invalidates the password chosen before the mailbox was
      // proven. Only the password-setup token returned below can finish the
      // claim, so a pre-registering party loses its last usable credential.
      db.prepare(`UPDATE users SET password_hash=?,session_version=session_version+1,updated_at=?
        WHERE id=? AND email_verified_at IS NULL`).run(claimLockPasswordHash, now, verification.id);
      db.prepare('UPDATE password_reset_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL').run(now, verification.id);
      db.prepare(`INSERT INTO password_reset_tokens
        (id,user_id,token_hash,pending_invitation_id,return_path,expires_at,used_at,created_at)
        VALUES (?,?,?,?,?,?,NULL,?)`).run(
          crypto.randomUUID(), verification.id, passwordSetupTokenHash,
          verification.pending_invitation_id || null, safeAccountReturnPath(verification.return_path), passwordSetupExpiresAt, now
        );
      return { kind: 'password_setup' as const };
    }
    db.prepare(`UPDATE users SET email_verified_at=COALESCE(email_verified_at,?),password_claim_required=0,updated_at=?
      WHERE id=?`).run(now, now, verification.id);
    return {
      kind: 'authenticated' as const,
      user: {
      id: verification.id,
      email: verification.email,
      name: verification.name,
      role: verification.role,
      sessionVersion: Number(verification.session_version),
      emailVerifiedAt: verification.email_verified_at || now
      } satisfies SessionUser
    };
  })();
  if (!result) return response.status(400).json({ error: 'This verification link has already been used.', code: 'EMAIL_VERIFICATION_INVALID' });
  if (result.kind === 'password_setup') {
    return response.json({
      authenticated: false,
      email: verification.email,
      emailVerified: false,
      onboardingRequired: true,
      claimPasswordRequired: true,
      passwordSetupToken,
      passwordSetupExpiresAt,
      returnTo: safeAccountReturnPath(verification.return_path)
    });
  }
  response.setHeader('Set-Cookie', cookie(makeSession(result.user), config.sessionHours * 3600));
  return response.json({ ...sessionPayload(result.user), returnTo: safeAccountReturnPath(verification.return_path) });
}

function createPasswordResetToken(user: UserRow, pendingInvitationId: string | null = null, retireExisting = true) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const id = crypto.randomUUID();
  const now = new Date(); const expiresAt = new Date(now.getTime() + resetLifetimeMs);
  db.transaction(() => {
    if (retireExisting) {
      db.prepare('UPDATE password_reset_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL').run(now.toISOString(), user.id);
    }
    db.prepare(`INSERT INTO password_reset_tokens
      (id,user_id,token_hash,pending_invitation_id,expires_at,used_at,created_at)
      VALUES (?,?,?,?,?,NULL,?)`).run(
        id, user.id, tokenHash, pendingInvitationId, expiresAt.toISOString(), now.toISOString()
      );
    db.prepare('DELETE FROM password_reset_tokens WHERE expires_at < ? OR used_at IS NOT NULL AND used_at < ?')
      .run(new Date(now.getTime() - 24 * 60 * 60_000).toISOString(), new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString());
  })();
  return { id, token, user: { id: user.id, email: user.email, name: user.name } };
}

export function issuePasswordResetToken(email: string) {
  const user = userByEmail(normalizeEmail(email));
  if (!user) return null;
  return createPasswordResetToken(user);
}

export async function forgotPassword(request: Request, response: Response) {
  const startedAt = Date.now();
  if (rateLimited(request, 'forgot', 5, 60 * 60_000)) return response.status(429).json({ error: 'Too many reset requests. Try again later.' });
  const user = userByEmail(normalizeEmail(request.body?.email));
  const attemptId = user ? beginAccountEmailAttempt(user.id, 'password_reset', true) : null;
  if (user && attemptId) {
    const issued = createPasswordResetToken(user, null, false);
    void sendPasswordResetEmail({ email: issued.user.email, name: issued.user.name, token: issued.token }).then(() => {
      const deliveredAt = new Date().toISOString();
      db.transaction(() => {
        // A replacement becomes authoritative only after the provider accepts
        // it. Until then, any previously delivered recovery link stays valid.
        db.prepare(`UPDATE password_reset_tokens SET used_at=?
          WHERE user_id=? AND id<>? AND used_at IS NULL`).run(deliveredAt, issued.user.id, issued.id);
        finishAccountEmailAttempt(attemptId, false);
      })();
    }).catch((error) => {
      const failedAt = new Date().toISOString();
      db.transaction(() => {
        db.prepare('UPDATE password_reset_tokens SET used_at=? WHERE id=? AND used_at IS NULL').run(failedAt, issued.id);
        finishAccountEmailAttempt(attemptId, true);
      })();
      console.error('Password reset email delivery failed:', error instanceof Error ? error.message : String(error));
    });
  }
  await minimumResponseTime(startedAt, 120);
  return response.status(202).json({ message: 'If an account exists for that email, a reset link has been sent.' });
}

export function resetPassword(request: Request, response: Response) {
  if (rateLimited(request, 'reset', 10, 60 * 60_000)) return response.status(429).json({ error: 'Too many reset attempts. Try again later.' });
  const token = String(request.body?.token || '').trim(); const password = String(request.body?.password || '');
  const invalidPassword = passwordError(password);
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) return response.status(400).json({ error: 'This password reset link is invalid or expired.' });
  if (invalidPassword) return response.status(400).json({ error: invalidPassword });
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex'); const now = new Date().toISOString();
  const reset = db.prepare(`SELECT t.id token_id,t.pending_invitation_id,t.return_path,u.id,u.email,u.name,u.role,u.session_version,u.email_verified_at
    FROM password_reset_tokens t JOIN users u ON u.id=t.user_id
    WHERE t.token_hash=? AND t.used_at IS NULL AND t.expires_at>?`).get(tokenHash, now) as any;
  if (!reset) return response.status(400).json({ error: 'This password reset link is invalid or expired.' });
  const transaction = db.transaction(() => {
    const consumed = db.prepare('UPDATE password_reset_tokens SET used_at=? WHERE id=? AND used_at IS NULL').run(now, reset.token_id).changes;
    if (consumed !== 1) return false;
    db.prepare(`UPDATE users SET password_hash=?,session_version=session_version+1,
      email_verified_at=COALESCE(email_verified_at,?),password_claim_required=0,updated_at=? WHERE id=?`)
      .run(hashPassword(password), now, now, reset.id);
    db.prepare('UPDATE password_reset_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL').run(now, reset.id);
    // Password recovery proves mailbox ownership and signs the account in. Any
    // older verification URL must therefore stop being a second login path or
    // carrying a now-stale pending invitation.
    db.prepare('UPDATE email_verification_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL').run(now, reset.id);
    return true;
  });
  if (!transaction()) return response.status(400).json({ error: 'This password reset link is invalid or expired.' });
  const sessionUser = {
    id: reset.id,
    email: reset.email,
    name: reset.name,
    role: reset.role,
    sessionVersion: Number(reset.session_version) + 1,
    emailVerifiedAt: reset.email_verified_at || now
  } satisfies SessionUser;
  response.setHeader('Set-Cookie', cookie(makeSession(sessionUser), config.sessionHours * 3600));
  return response.json({ ...sessionPayload(sessionUser), returnTo: safeAccountReturnPath(reset.return_path) });
}

function validTimezone(value: string) {
  if (!value) return true;
  try { new Intl.DateTimeFormat('en-GB', { timeZone: value }).format(new Date()); return true; }
  catch { return false; }
}

const profileGoalSchema = z.enum(['customer_experience', 'employee_experience', 'market_research', 'all_experience']);

const profileUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  jobTitle: z.string().trim().max(120).optional(),
  organizationName: z.string().trim().max(160).optional(),
  timezone: z.string().trim().max(100).refine(validTimezone, 'Use a valid IANA timezone.').optional(),
  primaryGoal: profileGoalSchema.nullable().optional()
}).strict().refine((value) => ['name', 'jobTitle', 'organizationName', 'timezone', 'primaryGoal'].some((key) => key in value), 'Provide at least one profile field.');

const onboardingSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().optional(),
  jobTitle: z.string().trim().max(120).optional().default(''),
  organizationName: z.string().trim().max(160).optional().default(''),
  timezone: z.string().trim().min(1).max(100).refine(validTimezone, 'Use a valid IANA timezone.'),
  primaryGoal: profileGoalSchema,
  spaceName: z.string().trim().max(100).refine((value) => !value || value.length >= 2, 'Space name must be at least 2 characters.').optional()
}).strict();

function accountSetupUser(request: Request, response: Response) {
  const user = currentSessionUser(request);
  if (!user) {
    response.status(401).json({ error: 'Authentication required.', code: 'AUTHENTICATION_REQUIRED' });
    return null;
  }
  if (!user.emailVerifiedAt) {
    response.status(403).json({ error: 'Verify your email address first.', code: 'EMAIL_VERIFICATION_REQUIRED' });
    return null;
  }
  return user;
}

function profileResponse(user: SessionUser) {
  const profile = profileForUser(user);
  return { profile, emailVerified: Boolean(user.emailVerifiedAt), onboardingRequired: onboardingRequired(profile) };
}

export function accountProfile(request: Request, response: Response) {
  const user = accountSetupUser(request, response);
  if (!user) return;
  return response.json(profileResponse(user));
}

export function updateAccountProfile(request: Request, response: Response) {
  const user = accountSetupUser(request, response);
  if (!user) return;
  const parsed = profileUpdateSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: 'Profile validation failed.', code: 'PROFILE_INVALID', details: parsed.error.issues });
  const current = profileForUser(user);
  const next = { ...current, ...parsed.data };
  const now = new Date().toISOString();
  db.transaction(() => {
    if (parsed.data.name !== undefined) db.prepare('UPDATE users SET name=?,updated_at=? WHERE id=?').run(parsed.data.name, now, user.id);
    db.prepare(`INSERT INTO user_profiles
      (user_id,job_title,organization_name,timezone,primary_goal,onboarding_version,onboarding_completed_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET job_title=excluded.job_title,organization_name=excluded.organization_name,
        timezone=excluded.timezone,primary_goal=excluded.primary_goal,updated_at=excluded.updated_at`)
      .run(user.id, next.jobTitle, next.organizationName, next.timezone, next.primaryGoal || '',
        current.onboardingVersion, current.completedAt, now, now);
  })();
  const updatedUser = { ...user, name: parsed.data.name ?? user.name };
  return response.json(profileResponse(updatedUser));
}

export function completeAccountOnboarding(request: Request, response: Response) {
  const user = accountSetupUser(request, response);
  if (!user) return;
  const parsed = onboardingSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: 'Onboarding validation failed.', code: 'ONBOARDING_INVALID', details: parsed.error.issues });
  if (parsed.data.email && parsed.data.email.toLowerCase() !== user.email.toLowerCase()) {
    return response.status(400).json({ error: 'Email cannot be changed during onboarding.', code: 'PROFILE_EMAIL_READ_ONLY' });
  }
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare('UPDATE users SET name=?,updated_at=? WHERE id=?').run(parsed.data.name, now, user.id);
    db.prepare(`INSERT INTO user_profiles
      (user_id,job_title,organization_name,timezone,primary_goal,onboarding_version,onboarding_completed_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET job_title=excluded.job_title,organization_name=excluded.organization_name,
        timezone=excluded.timezone,primary_goal=excluded.primary_goal,onboarding_version=excluded.onboarding_version,
        onboarding_completed_at=excluded.onboarding_completed_at,updated_at=excluded.updated_at`)
      .run(user.id, parsed.data.jobTitle, parsed.data.organizationName, parsed.data.timezone, parsed.data.primaryGoal,
        currentOnboardingVersion, now, now, now);
    if (parsed.data.spaceName) renamePersonalSpaceForUser(user.id, parsed.data.spaceName);
  })();
  return response.json(sessionPayload({ ...user, name: parsed.data.name }));
}

export function logout(_request: Request, response: Response) { response.setHeader('Set-Cookie', cookie('', 0)); return response.status(204).end(); }
export function requireAdmin(request: Request, response: Response, next: NextFunction) {
  const user = currentSessionUser(request);
  if (!user) return response.status(401).json({ error: 'Authentication required.', code: 'AUTHENTICATION_REQUIRED' });
  if (!user.emailVerifiedAt) return response.status(403).json({ error: 'Verify your email address first.', code: 'EMAIL_VERIFICATION_REQUIRED' });
  if (onboardingRequired(profileForUser(user))) {
    return response.status(428).json({ error: 'Complete your account onboarding to continue.', code: 'ONBOARDING_REQUIRED' });
  }
  next();
}
export function requireOwner(request: Request, response: Response, next: NextFunction) {
  const user = currentSessionUser(request);
  if (!user) return response.status(401).json({ error: 'Authentication required.' });
  if (user.role !== 'owner') return response.status(403).json({ error: 'Workspace owner access is required.' });
  next();
}
export function session(request: Request, response: Response) {
  const user = currentSessionUser(request);
  if (user) return response.json(sessionPayload(user));
  return response.json({
    authenticated: false,
    email: null,
    user: null,
    emailVerified: false,
    onboardingRequired: false,
    profile: null,
    spaces: [],
    activeSpace: null
  });
}

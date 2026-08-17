import crypto from 'node:crypto';
import fs from 'node:fs';
import type { Request, Response } from 'express';
import { Issuer, generators, type Client } from 'openid-client';
import { config } from './config.js';
import {
  clearAuthenticatedSessionCookie, provisionIdpAdminIdentity, provisionIdpIdentity,
  setAuthenticatedSessionCookie
} from './auth.js';

const transactionCookieName = 'seemplify_experience_oidc_tx';
const transactionLifetimeMs = 10 * 60_000;
let cachedClient: Client | null = null;
let cachedClientKey = '';
const usedAdminTokens = new Map<string, number>();

function requiredSessionSecret() {
  try {
    const value = fs.readFileSync(config.sessionSecretFile, 'utf8').trim();
    if (value.length < 20) throw new Error('too short');
    return value;
  } catch { throw new Error('The Experience session secret is not configured.'); }
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookies(request: Request) {
  return Object.fromEntries(String(request.headers.cookie || '').split(';').flatMap((part) => {
    const separator = part.indexOf('=');
    if (separator < 1) return [];
    try { return [[decodeURIComponent(part.slice(0, separator).trim()), decodeURIComponent(part.slice(separator + 1).trim())]]; }
    catch { return []; }
  }));
}

function transactionCookie(value: string, maxAgeSeconds: number) {
  const secure = config.publicUrl.startsWith('https://') ? '; Secure' : '';
  return `${transactionCookieName}=${encodeURIComponent(value)}; Path=/api/auth/oidc; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function signTransaction(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', requiredSessionSecret()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function readTransaction(value: string) {
  const [encoded, signature] = String(value || '').split('.');
  if (!encoded || !signature) throw new Error('The sign-in transaction is missing or invalid.');
  const expected = crypto.createHmac('sha256', requiredSessionSecret()).update(encoded).digest('base64url');
  if (!safeEqual(signature, expected)) throw new Error('The sign-in transaction signature is invalid.');
  const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as Record<string, unknown>;
  if (Number(parsed.expiresAt) <= Date.now()) throw new Error('The sign-in transaction has expired.');
  return parsed;
}

function safeReturnPath(value: unknown) {
  const candidate = String(value || '').trim();
  if (candidate.startsWith('/') && !candidate.startsWith('//')) return candidate;
  try {
    const url = new URL(candidate);
    if (url.origin === new URL(config.publicUrl).origin) return `${url.pathname}${url.search}${url.hash}`;
  } catch { /* invalid or external targets return to the application root */ }
  return '/';
}

function clearTransaction(response: Response) {
  response.appendHeader('Set-Cookie', transactionCookie('', 0));
}

function redirectToLogin(response: Response, error: unknown) {
  return response.redirect(`/login?error=${encodeURIComponent(String(error || 'Single sign-on could not be completed.'))}`);
}

function oidcConfiguration() {
  const values = {
    issuerUrl: config.oidc.issuerUrl,
    clientId: config.oidc.clientId,
    clientSecret: config.oidc.clientSecret,
    redirectUri: config.oidc.redirectUri
  };
  const missing = Object.entries(values).filter(([, value]) => !String(value || '').trim()).map(([key]) => key);
  if (missing.length) throw new Error(`Experience OIDC configuration is missing: ${missing.join(', ')}.`);
  return values;
}

async function oidcClient() {
  const values = oidcConfiguration();
  const key = JSON.stringify(values);
  if (cachedClient && cachedClientKey === key) return cachedClient;
  const issuer = await Issuer.discover(values.issuerUrl);
  cachedClient = new issuer.Client({
    client_id: values.clientId,
    client_secret: values.clientSecret,
    redirect_uris: [values.redirectUri],
    response_types: ['code'],
    token_endpoint_auth_method: 'client_secret_basic'
  });
  cachedClientKey = key;
  return cachedClient;
}

export async function startOidc(request: Request, response: Response) {
  try {
    const client = await oidcClient();
    const state = generators.state();
    const nonce = generators.nonce();
    const codeVerifier = generators.codeVerifier();
    const transaction = signTransaction({
      state, nonce, codeVerifier,
      returnTo: safeReturnPath(request.query.returnTo),
      expiresAt: Date.now() + transactionLifetimeMs
    });
    response.setHeader('Set-Cookie', transactionCookie(transaction, Math.floor(transactionLifetimeMs / 1000)));
    const parameters: Record<string, string> = {
      scope: 'openid email profile', state, nonce,
      code_challenge: generators.codeChallenge(codeVerifier), code_challenge_method: 'S256'
    };
    if (request.query.force_login === 'true') parameters.prompt = 'login';
    if (typeof request.query.hub_token === 'string' && request.query.hub_token) parameters.hub_token = request.query.hub_token;
    return response.redirect(client.authorizationUrl(parameters));
  } catch (error) {
    console.error('Experience OIDC start failed:', error instanceof Error ? error.message : String(error));
    return redirectToLogin(response, 'The Seemplify identity service is temporarily unavailable.');
  }
}

export async function finishOidc(request: Request, response: Response) {
  if (request.query.error) {
    clearTransaction(response);
    return redirectToLogin(response, request.query.error_description || request.query.error);
  }
  try {
    const transaction = readTransaction(parseCookies(request)[transactionCookieName]);
    const client = await oidcClient();
    const tokenSet = await client.callback(config.oidc.redirectUri, client.callbackParams(request), {
      state: String(transaction.state), nonce: String(transaction.nonce), code_verifier: String(transaction.codeVerifier)
    });
    const idTokenClaims = tokenSet.claims();
    const userInfo = tokenSet.access_token ? await client.userinfo(tokenSet.access_token) : {};
    const user = provisionIdpIdentity({ ...idTokenClaims, ...userInfo });
    setAuthenticatedSessionCookie(response, user);
    clearTransaction(response);
    return response.redirect(safeReturnPath(transaction.returnTo));
  } catch (error) {
    clearAuthenticatedSessionCookie(response);
    clearTransaction(response);
    console.error('Experience OIDC callback failed:', error instanceof Error ? error.message : String(error));
    const message = error instanceof Error && ['EXPERIENCE_ACCESS_DENIED', 'OIDC_ACCOUNT_CONFLICT'].includes(String((error as any).code))
      ? error.message : 'Single sign-on could not be completed.';
    return redirectToLogin(response, message);
  }
}

export function oidcLogout(_request: Request, response: Response) {
  clearAuthenticatedSessionCookie(response);
  clearTransaction(response);
  return response.redirect(`${config.oidc.issuerUrl}/logout`);
}

export function oidcStatus(_request: Request, response: Response) {
  try {
    oidcConfiguration();
    return response.json({ configured: true, localAuthEnabled: config.localAuthEnabled });
  } catch { return response.json({ configured: false, localAuthEnabled: config.localAuthEnabled }); }
}

function decodeAdminToken(token: string) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('The administrator launch token is invalid.');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as Record<string, unknown>;
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as Record<string, unknown>;
  if (header.alg !== 'HS256') throw new Error('The administrator launch token algorithm is invalid.');
  const secret = String(process.env.EXPERIENCE_ADMIN_SSO_SECRET || '').trim();
  if (secret.length < 32) throw new Error('Experience administrator SSO is not configured.');
  const expected = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  if (!safeEqual(parts[2], expected)) throw new Error('The administrator launch token signature is invalid.');
  const now = Math.floor(Date.now() / 1000);
  const audience = Array.isArray(claims.aud) ? claims.aud.map(String) : [String(claims.aud || '')];
  if (claims.iss !== 'aiin-idp-admin' || !audience.includes('experience-admin')
    || Number(claims.exp) <= now || Number(claims.iat) > now + 30 || Number(claims.exp) - Number(claims.iat) > 120) {
    throw new Error('The administrator launch token claims are invalid or expired.');
  }
  const jti = String(claims.jti || '');
  if (!jti || usedAdminTokens.has(jti)) throw new Error('The administrator launch token has already been used.');
  for (const [key, expiry] of usedAdminTokens) if (expiry <= now) usedAdminTokens.delete(key);
  usedAdminTokens.set(jti, Number(claims.exp));
  return claims;
}

export function finishIdpAdminSso(request: Request, response: Response) {
  try {
    const claims = decodeAdminToken(String(request.query.token || ''));
    const user = provisionIdpAdminIdentity({
      sub: claims.sub, email: claims.email, email_verified: true, name: claims.name,
      isSuperAdmin: claims.isSuperAdmin === true, isSystemAdmin: claims.isSystemAdmin === true
    });
    setAuthenticatedSessionCookie(response, user);
    return response.redirect('/admin');
  } catch (error) {
    clearAuthenticatedSessionCookie(response);
    console.error('Experience administrator SSO failed:', error instanceof Error ? error.message : String(error));
    return response.status(403).send('Experience administrator access could not be verified. Return to Seemplify IdP Admin and try again.');
  }
}

export { safeReturnPath };

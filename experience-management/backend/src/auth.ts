import crypto from 'node:crypto';
import fs from 'node:fs';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';

const cookieName = 'seemplify_experience_session';
function readRequired(path: string, label: string) {
  try { const value = fs.readFileSync(path, 'utf8').trim(); if (value.length < 20) throw new Error('too short'); return value; }
  catch { throw new Error(`${label} is not configured. Run the local setup script.`); }
}
function safeEqual(left: string, right: string) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function sign(encoded: string) { return crypto.createHmac('sha256', readRequired(config.sessionSecretFile, 'Session secret')).update(encoded).digest('base64url'); }
function makeSession() {
  const payload = Buffer.from(JSON.stringify({ email: config.adminEmail, exp: Date.now() + config.sessionHours * 3_600_000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function parseCookies(request: Request) {
  return Object.fromEntries(String(request.headers.cookie || '').split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter((part) => part.length === 2));
}
export function validSession(request: Request) {
  const token = parseCookies(request)[cookieName]; if (!token) return false;
  const [payload, signature] = token.split('.'); if (!payload || !signature || !safeEqual(sign(payload), signature)) return false;
  try { const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()); return parsed.email === config.adminEmail && Number(parsed.exp) > Date.now(); } catch { return false; }
}
function cookie(value: string, maxAge: number) {
  const secure = config.publicUrl.startsWith('https://') ? '; Secure' : '';
  return `${cookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}
const attempts = new Map<string, number[]>();
export function login(request: Request, response: Response) {
  const key = String(request.ip || 'unknown'); const now = Date.now(); const recent = (attempts.get(key) || []).filter((time) => now - time < 15 * 60_000);
  if (recent.length >= 8) return response.status(429).json({ error: 'Too many sign-in attempts. Try again later.' });
  const email = String(request.body?.email || '').trim().toLowerCase(); const password = String(request.body?.password || '');
  let expected = ''; try { expected = readRequired(config.adminPasswordFile, 'Admin password'); } catch (error) { return response.status(503).json({ error: error instanceof Error ? error.message : String(error) }); }
  if (email !== config.adminEmail || !safeEqual(password, expected)) { recent.push(now); attempts.set(key, recent); return response.status(401).json({ error: 'Email or password is incorrect.' }); }
  attempts.delete(key); response.setHeader('Set-Cookie', cookie(makeSession(), config.sessionHours * 3600)); return response.json({ authenticated: true, email: config.adminEmail });
}
export function logout(_request: Request, response: Response) { response.setHeader('Set-Cookie', cookie('', 0)); return response.status(204).end(); }
export function requireAdmin(request: Request, response: Response, next: NextFunction) { if (!validSession(request)) return response.status(401).json({ error: 'Authentication required.' }); next(); }
export function session(request: Request, response: Response) { const authenticated = validSession(request); return response.json({ authenticated, email: authenticated ? config.adminEmail : null }); }

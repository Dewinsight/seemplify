// Playwright API e2e: proves the migrated auth stack (authMiddleware ->
// sessionService -> PostgreSQL/Prisma) works over real HTTP.
//
// Mounts the REAL authMiddleware on a protected route in an ephemeral Express
// server, mints a session for a throwaway Postgres user, and exercises the
// happy path + the missing-token and revoked-session rejections.
//
//   npx playwright test
const { test, expect, request } = require('@playwright/test');
const http = require('http');
const express = require('express');
require('dotenv').config();
const prisma = require('../db/client');
const { newId } = require('../db/objectId');
const sessionService = require('../services/sessionService');
const authMiddleware = require('../middleware/authMiddleware');

let server;
let baseURL;
let testUserId;
let token;
let accessTokenId;

test.beforeAll(async () => {
  // Throwaway Postgres user + a real session (token validates against Postgres).
  testUserId = newId();
  const user = await prisma.user.create({
    data: { id: testUserId, email: `pw-${Date.now()}@local.test`, isActive: true, security: { sessionVersion: 1 } },
  });
  const s = await sessionService.createSession({ user, fingerprint: 'pw', userAgent: 'pw', ip: '127.0.0.1' });
  token = s.accessToken;
  accessTokenId = s.session.accessTokenId;

  const app = express();
  app.get('/protected', authMiddleware, (req, res) => res.json({ ok: true, userId: req.user.id }));
  await new Promise((resolve) => {
    server = http.createServer(app).listen(0, '127.0.0.1', resolve);
  });
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (testUserId) {
    try { await prisma.userSession.deleteMany({ where: { userId: testUserId } }); } catch (_) {}
    try { await prisma.user.delete({ where: { id: testUserId } }); } catch (_) {}
  }
  await prisma.$disconnect();
});

test('valid token -> authMiddleware validates session against Postgres (200)', async () => {
  const ctx = await request.newContext();
  const res = await ctx.get(`${baseURL}/protected`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.userId).toBe(testUserId);
  await ctx.dispose();
});

test('missing token -> rejected (401)', async () => {
  const ctx = await request.newContext();
  const res = await ctx.get(`${baseURL}/protected`);
  expect(res.status()).toBe(401);
  await ctx.dispose();
});

test('revoked session -> rejected with session_revoked (401)', async () => {
  await sessionService.revokeSessionById(accessTokenId, 'pw_revoke');
  const ctx = await request.newContext();
  const res = await ctx.get(`${baseURL}/protected`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.code).toBe('session_revoked');
  await ctx.dispose();
});

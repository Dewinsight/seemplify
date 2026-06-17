// Playwright e2e against the RUNNING backend (:5001): proves the first full
// vertical is on Postgres — login reads users from Postgres (bcrypt), and an
// authenticated, org-scoped request returns department data from Postgres
// through authMiddleware -> requireOrganization -> departmentController.
const { test, expect, request } = require('@playwright/test');
require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('../db/client');
const { newId } = require('../db/objectId');
const sessionService = require('../services/sessionService');

const BACKEND = 'http://127.0.0.1:5001';
const PASSWORD = 'TestPass123!';

let orgId, userId, deptId, email, token;

async function waitForBackend() {
  const ctx = await request.newContext();
  for (let i = 0; i < 40; i++) {
    try {
      const r = await ctx.get(`${BACKEND}/`, { timeout: 3000 });
      if (r.ok()) { await ctx.dispose(); return; }
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 1500));
  }
  await ctx.dispose();
  throw new Error('backend not reachable on :5001');
}

test.beforeAll(async () => {
  await waitForBackend();

  userId = newId();
  orgId = newId();
  email = `login-vertical-${Date.now()}@local.test`;
  const hash = await bcrypt.hash(PASSWORD, 10);

  await prisma.user.create({
    data: { id: userId, email, password: hash, isActive: true, security: { sessionVersion: 1, mfaEnabled: false } },
  });
  await prisma.organization.create({ data: { id: orgId, name: 'PW Vertical Org', ownerId: userId } });
  await prisma.user.update({ where: { id: userId }, data: { currentOrganizationId: orgId } });
  await prisma.organizationMember.create({
    data: { organizationId: orgId, userId, role: 'owner', status: 'active' },
  });
  const dept = await prisma.department.create({
    data: { id: newId(), name: 'PW Test Dept', organizationId: orgId, createdById: userId, isActive: true },
  });
  deptId = dept.id;

  // Mint a real session token (validates against Postgres via authMiddleware).
  const s = await sessionService.createSession({ user: { id: userId, security: { sessionVersion: 1 } }, fingerprint: 'pw', userAgent: 'pw', ip: '127.0.0.1' });
  token = s.accessToken;
});

test.afterAll(async () => {
  try { await prisma.userSession.deleteMany({ where: { userId } }); } catch (_) {}
  try { await prisma.department.deleteMany({ where: { organizationId: orgId } }); } catch (_) {}
  try { await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } }); } catch (_) {}
  try { await prisma.organization.delete({ where: { id: orgId } }); } catch (_) {}
  try { await prisma.user.delete({ where: { id: userId } }); } catch (_) {}
  await prisma.$disconnect();
});

test('POST /api/auth/login with correct password is accepted (user read from Postgres + bcrypt)', async () => {
  const ctx = await request.newContext();
  const res = await ctx.post(`${BACKEND}/api/auth/login`, { data: { email, password: PASSWORD } });
  expect(res.status()).toBe(200);
  const body = await res.json();
  // Correct password -> either a token (trusted) or an OTP challenge (new browser);
  // both prove the user was found in Postgres and the password verified.
  expect(body.token || body.requiresOTP).toBeTruthy();
  await ctx.dispose();
});

test('POST /api/auth/login with wrong password is rejected', async () => {
  const ctx = await request.newContext();
  const res = await ctx.post(`${BACKEND}/api/auth/login`, { data: { email, password: 'definitely-wrong' } });
  expect(res.status()).toBe(400);
  await ctx.dispose();
});

test('GET /api/departments returns org-scoped data from Postgres (auth + org middleware + controller)', async () => {
  const ctx = await request.newContext();
  const res = await ctx.get(`${BACKEND}/api/departments`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  const names = (body.departments || []).map((d) => d.name);
  expect(names).toContain('PW Test Dept');
  // _id compatibility preserved for the frontend
  expect((body.departments || [])[0]._id).toBeTruthy();
  await ctx.dispose();
});

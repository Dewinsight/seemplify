// Broad smoke against the RUNNING backend (:5001): seeds a test org + sample
// data, mints a token, and hits many migrated GET endpoints. A 500 means a
// broken Prisma query to fix; 200/4xx are acceptable (auth/empty/not-found).
const { test, expect, request } = require('@playwright/test');
require('dotenv').config();
const prisma = require('../db/client');
const { newId } = require('../db/objectId');
const sessionService = require('../services/sessionService');

const BACKEND = 'http://127.0.0.1:5001';
let orgId, userId, token;
const created = {};

const ENDPOINTS = [
  '/api/departments',
  '/api/candidates',
  '/api/jobs',
  '/api/currencies',
  '/api/notifications',
  '/api/plans',
  '/api/credit-packs',
  '/api/candidate-lists',
  '/api/feedback-forms',
  '/api/subscription',
  '/api/credits/balance',
  '/api/interview-stages',
  '/api/screening-questions',
  '/api/users/profile',
  '/api/organizations/current',
];

test.beforeAll(async () => {
  userId = newId(); orgId = newId();
  await prisma.user.create({ data: { id: userId, email: `smoke-${Date.now()}@local.test`, isActive: true, security: { sessionVersion: 1 }, profile: { firstName: 'Smoke', lastName: 'Test' } } });
  await prisma.organization.create({ data: { id: orgId, name: 'Smoke Org', ownerId: userId, subscription: { plan: 'free', creditUsage: { totalCredits: 100, usedCredits: 0, remainingCredits: 100 } } } });
  await prisma.user.update({ where: { id: userId }, data: { currentOrganizationId: orgId } });
  await prisma.organizationMember.create({ data: { organizationId: orgId, userId, role: 'owner', status: 'active' } });
  created.dept = (await prisma.department.create({ data: { id: newId(), name: 'Smoke Dept', organizationId: orgId, createdById: userId, isActive: true } })).id;
  created.cand = (await prisma.candidate.create({ data: { id: newId(), firstName: 'Jane', lastName: 'Doe', email: 'jane@x.com', status: 'New', organizationId: orgId, createdBy: userId } })).id;
  created.job = (await prisma.job.create({ data: { id: newId(), title: 'Smoke Engineer', status: 'active', organizationId: orgId, departmentId: created.dept, createdById: userId } })).id;
  const s = await sessionService.createSession({ user: { id: userId, security: { sessionVersion: 1 } }, fingerprint: 'smoke', userAgent: 'smoke', ip: '127.0.0.1' });
  token = s.accessToken;
});

test.afterAll(async () => {
  try { await prisma.userSession.deleteMany({ where: { userId } }); } catch (_) {}
  try { await prisma.job.deleteMany({ where: { organizationId: orgId } }); } catch (_) {}
  try { await prisma.candidate.deleteMany({ where: { organizationId: orgId } }); } catch (_) {}
  try { await prisma.department.deleteMany({ where: { organizationId: orgId } }); } catch (_) {}
  try { await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } }); } catch (_) {}
  try { await prisma.organization.delete({ where: { id: orgId } }); } catch (_) {}
  try { await prisma.user.delete({ where: { id: userId } }); } catch (_) {}
  await prisma.$disconnect();
});

test('migrated GET endpoints do not 500', async () => {
  const ctx = await request.newContext();
  const broken = [];
  for (const ep of ENDPOINTS) {
    let status = 0, body = '';
    try {
      const res = await ctx.get(`${BACKEND}${ep}`, { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 });
      status = res.status();
      if (status >= 500) { body = (await res.text()).slice(0, 200); broken.push(`${ep} -> ${status}  ${body}`); }
    } catch (e) {
      broken.push(`${ep} -> THREW ${e.message}`);
    }
    console.log(`  ${String(status).padEnd(4)} ${ep}`);
  }
  await ctx.dispose();
  if (broken.length) console.log('\nBROKEN (500/throw):\n' + broken.join('\n'));
  expect(broken, `broken endpoints:\n${broken.join('\n')}`).toEqual([]);
});

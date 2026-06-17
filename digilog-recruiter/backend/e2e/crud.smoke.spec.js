// Verifies a WRITE round-trips through Postgres and more domains respond.
const { test, expect, request } = require('@playwright/test');
require('dotenv').config();
const prisma = require('../db/client');
const { newId } = require('../db/objectId');
const sessionService = require('../services/sessionService');

const BACKEND = 'http://127.0.0.1:5001';
let orgId, userId, token;

test.beforeAll(async () => {
  userId = newId(); orgId = newId();
  await prisma.user.create({ data: { id: userId, email: `crud-${Date.now()}@local.test`, isActive: true, security: { sessionVersion: 1 } } });
  await prisma.organization.create({ data: { id: orgId, name: 'CRUD Org', ownerId: userId } });
  await prisma.user.update({ where: { id: userId }, data: { currentOrganizationId: orgId } });
  await prisma.organizationMember.create({ data: { organizationId: orgId, userId, role: 'owner', status: 'active' } });
  token = (await sessionService.createSession({ user: { id: userId, security: { sessionVersion: 1 } }, fingerprint: 'crud', userAgent: 'crud', ip: '127.0.0.1' })).accessToken;
});

test.afterAll(async () => {
  try { await prisma.userSession.deleteMany({ where: { userId } }); } catch (_) {}
  try { await prisma.department.deleteMany({ where: { organizationId: orgId } }); } catch (_) {}
  try { await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } }); } catch (_) {}
  try { await prisma.organization.delete({ where: { id: orgId } }); } catch (_) {}
  try { await prisma.user.delete({ where: { id: userId } }); } catch (_) {}
  await prisma.$disconnect();
});

test('POST creates a department in Postgres and it reads back', async () => {
  const ctx = await request.newContext();
  const name = `CRUD Dept ${Date.now()}`;
  const create = await ctx.post(`${BACKEND}/api/departments`, { headers: { Authorization: `Bearer ${token}` }, data: { name, description: 'made via API' } });
  expect(create.status()).toBe(201);
  const created = await create.json();
  expect(created.success).toBe(true);
  expect(created.department.name).toBe(name);

  // confirm it persisted in Postgres directly
  const row = await prisma.department.findUnique({ where: { id: created.department.id } });
  expect(row).toBeTruthy();
  expect(row.organizationId).toBe(orgId);

  // and it shows in the list endpoint
  const list = await ctx.get(`${BACKEND}/api/departments`, { headers: { Authorization: `Bearer ${token}` } });
  const names = (await list.json()).departments.map((d) => d.name);
  expect(names).toContain(name);
  await ctx.dispose();
});

test('more domains respond without 500', async () => {
  const ctx = await request.newContext();
  const broken = [];
  for (const ep of ['/api/candidates', '/api/jobs', '/api/interviews', '/api/ai-interviews', '/api/notifications', '/api/credit-packs', '/api/currencies']) {
    const res = await ctx.get(`${BACKEND}${ep}`, { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 });
    console.log(`  ${res.status()}  ${ep}`);
    if (res.status() >= 500) broken.push(`${ep} -> ${res.status()} ${(await res.text()).slice(0, 150)}`);
  }
  await ctx.dispose();
  expect(broken, broken.join('\n')).toEqual([]);
});

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-experience-idp-'));
const frontendDist = path.join(root, 'frontend');
const sessionFile = path.join(root, 'session-secret');
fs.mkdirSync(frontendDist, { recursive: true });
fs.writeFileSync(path.join(frontendDist, 'index.html'), '<!doctype html><title>Experience IdP test</title>');
fs.writeFileSync(sessionFile, 'test-session-secret-that-is-long-and-random-enough');

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_PATH: path.join(root, 'test.sqlite'),
  UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: frontendDist,
  PUBLIC_URL: 'http://127.0.0.1:5412',
  ADMIN_EMAIL: 'qa@seemplify.local',
  SESSION_SECRET_FILE: sessionFile,
  EMAIL_MODE: 'log',
  LOCAL_AUTH_ENABLED: 'false',
  OIDC_CLIENT_SECRET: 'test-experience-oidc-secret',
  EXPERIENCE_ADMIN_SSO_SECRET: 'test-experience-admin-sso-secret-that-is-long-enough',
  EXPERIENCE_AI_SHARED_SECRET: 'test-experience-ai-gateway-secret-that-is-long-enough',
  SEEMPLIFY_SHARED_AI_URL: 'https://shared-ai.example.test'
});

const { db } = await import('../src/database.js');
const {
  idpSubjectForUser,
  platformRolesForUser,
  provisionIdpAdminIdentity,
  provisionIdpIdentity
} = await import('../src/auth.js');
const { idpOrganizationIdForSpace } = await import('../src/spaces.js');
const { app } = await import('../src/app.js');
const { SharedAiGatewayClient } = await import('../src/sharedAiGateway.js');

after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('IdP provisioning links the user and mirrors entitled organization spaces', () => {
  const user = provisionIdpIdentity({
    sub: 'idp-user-123',
    email: 'research.lead@example.test',
    email_verified: true,
    name: 'Research Lead',
    current_organization: { id: 'org-current' },
    organizations: [
      { id: 'org-current', name: 'Current Organisation', role: 'admin', appAccess: { mode: 'all' } },
      {
        id: 'org-selected', name: 'Selected Organisation', role: 'member',
        appAccess: { mode: 'selected', appIds: ['experience-management'] }
      },
      {
        id: 'org-denied', name: 'Denied Organisation', role: 'owner',
        appAccess: { mode: 'selected', appIds: ['payroll-management'] }
      }
    ]
  });

  assert.equal(idpSubjectForUser(user.id), 'idp-user-123');
  const memberships = db.prepare(`SELECT spaces.id,spaces.name,space_memberships.role
    FROM space_memberships JOIN spaces ON spaces.id=space_memberships.space_id
    WHERE space_memberships.user_id=? AND spaces.slug LIKE 'idp-%' ORDER BY spaces.name`)
    .all(user.id) as Array<{ id: string; name: string; role: string }>;
  assert.deepEqual(memberships.map(({ name, role }) => ({ name, role })), [
    { name: 'Current Organisation', role: 'admin' },
    { name: 'Selected Organisation', role: 'member' }
  ]);

  const active = db.prepare('SELECT active_space_id FROM users WHERE id=?').get(user.id) as { active_space_id: string };
  assert.equal(idpOrganizationIdForSpace(active.active_space_id), 'org-current');

  provisionIdpIdentity({
    sub: 'idp-user-123',
    email: 'research.lead@example.test',
    email_verified: true,
    name: 'Research Lead Renamed',
    organizations: [
      { id: 'org-selected', name: 'Selected Organisation Renamed', role: 'owner', appAccess: { mode: 'all' } }
    ]
  });
  const remaining = db.prepare(`SELECT spaces.id,spaces.name,space_memberships.role
    FROM space_memberships JOIN spaces ON spaces.id=space_memberships.space_id
    WHERE space_memberships.user_id=? AND spaces.slug LIKE 'idp-%'`)
    .all(user.id) as Array<{ id: string; name: string; role: string }>;
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].name, 'Selected Organisation Renamed');
  assert.equal(remaining[0].role, 'owner');
  assert.equal(idpOrganizationIdForSpace(remaining[0].id), 'org-selected');
});

test('IdP provisioning rejects incomplete or unentitled identities', () => {
  assert.throws(() => provisionIdpIdentity({
    sub: 'unverified-user', email: 'unverified@example.test', email_verified: false,
    organizations: [{ id: 'org-1', name: 'Organisation', role: 'member', appAccess: { mode: 'all' } }]
  }), (error: unknown) => (error as { code?: string }).code === 'OIDC_IDENTITY_INCOMPLETE');

  assert.throws(() => provisionIdpIdentity({
    sub: 'denied-user', email: 'denied@example.test', email_verified: true,
    organizations: [{
      id: 'org-1', name: 'Organisation', role: 'member',
      appAccess: { mode: 'selected', appIds: ['recruiter'] }
    }]
  }), (error: unknown) => (error as { code?: string }).code === 'EXPERIENCE_ACCESS_DENIED');
});

test('IdP Admin SSO grants the matching Experience platform role', () => {
  const admin = provisionIdpAdminIdentity({
    sub: 'idp-admin-123',
    email: 'system.admin@example.test',
    email_verified: true,
    name: 'System Admin',
    isSystemAdmin: true
  });
  assert.deepEqual(platformRolesForUser(admin.id), ['support']);

  const superAdmin = provisionIdpAdminIdentity({
    sub: 'idp-superadmin-123',
    email: 'super.admin@example.test',
    email_verified: true,
    name: 'Super Admin',
    isSuperAdmin: true
  });
  assert.deepEqual(platformRolesForUser(superAdmin.id), ['superadmin']);
});

function adminLaunchToken(jti: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'aiin-idp-admin', aud: 'experience-admin', sub: 'route-admin-123',
    email: 'route.admin@example.test', name: 'Route Admin', isSuperAdmin: true,
    isSystemAdmin: true, iat: now, exp: now + 60, jti
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', process.env.EXPERIENCE_ADMIN_SSO_SECRET!)
    .update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

test('production auth routes require IdP and accept a one-time IdP Admin launch', async () => {
  const status = await request(app).get('/api/auth/oidc/status').expect(200);
  assert.deepEqual(status.body, { configured: true, localAuthEnabled: false });
  await request(app).post('/api/auth/login').send({}).expect(410)
    .expect(({ body }) => assert.equal(body.code, 'IDENTITY_PROVIDER_REQUIRED'));

  const token = adminLaunchToken('one-time-admin-token');
  const launched = await request(app).get(`/api/auth/idp-admin?token=${encodeURIComponent(token)}`).expect(302);
  assert.equal(launched.headers.location, '/admin');
  assert.match(String(launched.headers['set-cookie']), /seemplify_experience_session=/);
  await request(app).get(`/api/auth/idp-admin?token=${encodeURIComponent(token)}`).expect(403);
});

test('Experience signs shared-gateway calls with its IdP user and organization identity', async () => {
  const user = provisionIdpIdentity({
    sub: 'gateway-user-123', email: 'gateway.user@example.test', email_verified: true,
    name: 'Gateway User', current_organization: { id: 'gateway-org' },
    organizations: [{ id: 'gateway-org', name: 'Gateway Organisation', role: 'member', appAccess: { mode: 'all' } }]
  });
  const originalFetch = globalThis.fetch;
  let captured: { url?: string; options?: RequestInit } = {};
  globalThis.fetch = (async (url: string | URL | Request, options?: RequestInit) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({
      content: 'Shared result', model: 'gpt-test', reasoningEffort: 'high', requestId: 'gateway-request'
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const result = await new SharedAiGatewayClient(user.id).complete({
      action: 'analyst.chat', model: 'gpt-test', reasoningEffort: 'high', timeoutMs: 5_000,
      messages: [{ role: 'user', content: 'Summarise this feedback.' }]
    });
    assert.equal(result.content, 'Shared result');
    assert.equal(captured.url, 'https://shared-ai.example.test/api/internal/ai/v1/complete');
    const headers = captured.options?.headers as Record<string, string>;
    assert.equal(headers['x-seemplify-service'], 'experience-management');
    assert.equal(headers['x-seemplify-signature-version'], '2');
    const body = String(captured.options?.body || '');
    const payload = JSON.parse(body);
    assert.equal(payload.activity, 'experience.analyst.chat');
    assert.deepEqual(payload.identity, {
      sub: 'gateway-user-123', email: 'gateway.user@example.test', displayName: 'Gateway User',
      organizationId: 'gateway-org', organizationName: 'Gateway Organisation'
    });
    const pathname = '/api/internal/ai/v1/complete';
    const canonical = `${headers['x-seemplify-timestamp']}\n${headers['x-seemplify-nonce']}\nexperience-management\nPOST\n${pathname}\n${body}`;
    const signature = crypto.createHmac('sha256', process.env.EXPERIENCE_AI_SHARED_SECRET!)
      .update(canonical).digest('hex');
    assert.equal(headers['x-seemplify-signature'], signature);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

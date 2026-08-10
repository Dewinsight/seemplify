import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', 'src');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const client = read('lib', 'journeyKillSwitches.ts');
const page = read('pages', 'JourneyKillSwitchPage.tsx');
const app = read('App.tsx');
const shell = read('components', 'AppShell.tsx');
const adminShell = read('components', 'platform-admin', 'PlatformAdminShell.tsx');
const routes = fs.readFileSync(path.resolve(root, '..', '..', 'backend', 'src', 'journeyKillSwitchRoutes.ts'), 'utf8');

test('journey safety is routed for spaces and platform administration without inventing a second backend', () => {
  assert.match(app, /const JourneyKillSwitchPage = lazy/u);
  assert.match(app, /path="\/journey-safety"/u); assert.match(app, /path="\/admin\/journey-safety"/u);
  assert.match(shell, /to: '\/journey-safety'.*feature: 'journeyOrchestration'/u);
  assert.match(adminShell, /to: '\/admin\/journey-safety'/u);
});

test('strict client covers all five-level control, audit, pause and effective-resolution contracts', () => {
  for (const path of ['/space','/platform','/scopes/','/effective','/audit','/pauses']) assert.ok(client.includes(path), path);
  for (const level of ['platform','space','workflow','adapter','profile']) assert.ok(client.includes(`'${level}'`), level);
  assert.ok((client.match(/\.strict\(\)/gu) || []).length >= 8);
  assert.match(client, /Idempotency-Key/u); assert.match(client, /expectedRevision/u);
  assert.doesNotMatch(client, /spaceId.*mutationOptions/u);
  assert.match(routes, /resolveRequestSpace\(request, sessionUser\.id\)/u);
});

test('control surface keeps authority, lease release, recovery and narrow-layout consequences explicit', () => {
  for (const phrase of ['Active leases will be released','only space owners and administrators',
    'Enabling never bypasses another switch, safety gate, or paused workflow','Platform administrators only',
    '64-character SHA-256 profile reference','No pending work has been paused']) assert.ok(page.includes(phrase), phrase);
  assert.match(page, /session\?\.permissions\?\.platformAdmin/u);
  assert.match(page, /session\.activeSpace\.role !== 'member'/u);
  assert.match(page, /window\.confirm/u); assert.match(page, /overflow-x-auto/u); assert.match(page, /min-w-\[720px\]/u);
  assert.doesNotMatch(page, /gradient|backdrop-blur|rounded-\[2|shadow-2xl/iu);
});

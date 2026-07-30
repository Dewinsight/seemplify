import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const source = path.resolve(import.meta.dirname, '..', 'src');
const read = (...parts) => fs.readFileSync(path.join(source, ...parts), 'utf8');

test('only retries stale-space reads and makes direct API resources space-explicit', () => {
  const api = read('lib', 'api.ts');
  const esign = read('lib', 'esign.ts');
  const agreement = read('pages', 'AgreementWorkspacePage.tsx');
  const journeys = read('pages', 'JourneysPage.tsx');

  assert.match(api, /const method = String\(options\.method \|\| 'GET'\)\.toUpperCase\(\)/);
  assert.match(api, /const safeToRetry = method === 'GET' \|\| method === 'HEAD'/);
  assert.match(api, /canRecoverSpace && safeToRetry && response\.status === 403/);
  assert.match(api, /url\.searchParams\.set\('spaceId', selectedSpace\)/);
  assert.match(api, /path\.startsWith\('\/api\/public\/'\)/);

  assert.match(esign, /spaceScopedApiUrl/);
  assert.match(esign, /adminDocumentContentUrl/);
  assert.match(esign, /adminArtifactContentUrl/);
  assert.match(agreement, /href=\{adminDocumentContentUrl\(/);
  assert.match(agreement, /href=\{adminArtifactContentUrl\(/);
  assert.match(journeys, /link\.href = spaceScopedApiUrl\(/);
});

test('guards every interactive space switch before changing server state and remounts atomically', () => {
  const shell = read('components', 'AppShell.tsx');
  const settings = read('pages', 'SpaceSettingsPage.tsx');
  const unsaved = read('lib', 'unsavedChanges.ts');
  const hook = read('hooks', 'useUnsavedChanges.ts');

  for (const page of [shell, settings]) {
    const switchStart = page.indexOf('async function switchSpace');
    const guard = page.indexOf('confirmDiscardForSpaceSwitch()', switchStart);
    const mutation = page.indexOf('/select', switchStart);
    assert.ok(switchStart >= 0 && guard > switchStart && mutation > guard, 'confirmation must precede the select mutation');
    assert.ok(page.indexOf('allowConfirmedSpaceSwitchUnload()', mutation) > mutation, 'the successful switch must authorize exactly one unload');
    assert.match(page.slice(switchStart), /storeActiveSpaceId\([^\n]+, false\)/);
    assert.match(page.slice(switchStart), /window\.location\.replace\(/);
  }

  assert.match(unsaved, /unsavedChangeSources = new Set<symbol>/);
  assert.match(unsaved, /window\.confirm\('Switch spaces and discard your unsaved changes\?'\)/);
  assert.match(unsaved, /if \(allowNextUnload\)/);
  assert.match(hook, /beforeunload/);
  assert.match(hook, /shouldBlockBeforeUnload\(\)/);
  for (const pageName of ['CampaignWorkspacePage.tsx', 'AgreementWorkspacePage.tsx', 'SurveyStudioPage.tsx']) {
    assert.match(read('pages', pageName), /useUnsavedChanges\(/);
  }
});

test('uses unique responsive selector ids and keeps invitation acceptance failures recoverable', () => {
  const shell = read('components', 'AppShell.tsx');
  const login = read('pages', 'LoginPage.tsx');
  const join = read('pages', 'JoinSpacePage.tsx');

  assert.equal(shell.match(/selectorId="active-space-desktop"/g)?.length, 1);
  assert.equal(shell.match(/selectorId="active-space-mobile"/g)?.length, 1);
  assert.doesNotMatch(shell, /id="active-space"/);
  assert.match(shell, /htmlFor=\{selectorId\}/);
  assert.match(shell, /id=\{selectorId\}/);

  const loginRequest = login.indexOf("'/api/auth/login'");
  const invitationAcceptance = login.indexOf('/api/spaces/invitations/');
  assert.ok(loginRequest >= 0 && invitationAcceptance > loginRequest);
  assert.match(login, /signedIn=1&accept=failed/);
  assert.match(login, /storeActiveSpaceId\(signedIn\.activeSpace\?\.id \|\| null, false\)/);
  assert.match(join, /Signed in successfully\./);
  assert.match(join, /Open my spaces/);
  assert.match(join, /Accept invitation/);
});

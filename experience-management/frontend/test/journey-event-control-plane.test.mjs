import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8');

const app = read('App.tsx');
const shell = read('components', 'AppShell.tsx');
const page = read('pages', 'JourneyEventSourcesPage.tsx');
const client = read('lib', 'journeyEventControlPlane.ts');
const secretDialog = read('components', 'journey-events', 'CredentialSecretDialog.tsx');
const credentials = read('components', 'journey-events', 'EventSourceCredentials.tsx');
const trackingPlan = read('components', 'journey-events', 'TrackingPlanWorkspace.tsx');
const debuggerView = read('components', 'journey-events', 'EventSourceDebugger.tsx');
const deadLetters = read('components', 'journey-events', 'EventSourceDeadLetters.tsx');
const usage = read('components', 'journey-events', 'EventSourceUsage.tsx');
const backendRoot = path.resolve(root, '..', '..', 'backend', 'src');
const backendRoutes = fs.readFileSync(path.join(backendRoot, 'journeyEventControlPlaneRoutes.ts'), 'utf8');
const backendRepository = fs.readFileSync(path.join(backendRoot, 'journeyEventControlPlaneRepository.ts'), 'utf8');

test('the developer workspace remains implemented but is not published', () => {
  assert.doesNotMatch(app, /path="\/settings\/developer"/u);
  assert.doesNotMatch(shell, /to: '\/settings\/developer'/u);
  assert.match(page, /useSessionFeature\('journeyConnected'\)/u);
  assert.match(page, /if \(!connectedJourneysEnabled\) return null/u);
  assert.match(page, /if \(!connectedJourneysEnabled\) return;[\s\S]*void load\(\)/u);
});

test('control-plane client uses the agreed resource routes and fresh bounded idempotency keys', () => {
  const routes = [
    '/sources',
    '/sources/${encodeURIComponent(sourceId)}',
    '/sources/${encodeURIComponent(sourceId)}/credentials',
    '/credentials/${encodeURIComponent(credentialId)}/rotate',
    '/credentials/${encodeURIComponent(credentialId)}/revoke',
    '/sources/${encodeURIComponent(sourceId)}/schemas',
    '/schemas/${encodeURIComponent(schemaId)}',
    '/schemas/${encodeURIComponent(schemaId)}/versions',
    '/schema-versions/${encodeURIComponent(versionId)}/publish',
    '/schema-versions/${encodeURIComponent(versionId)}/deprecate',
    '/sources/${encodeURIComponent(sourceId)}/audit',
    '/sources/${encodeURIComponent(sourceId)}/debug-events',
    '/sources/${encodeURIComponent(sourceId)}/dead-letters',
    '/dead-letters/${encodeURIComponent(deadLetterId)}/replay',
    '/sources/${encodeURIComponent(sourceId)}/ingestion-usage'
  ];
  for (const route of routes) assert.ok(client.includes(route), `missing route ${route}`);
  assert.match(client, /crypto\.randomUUID\(\)/u);
  assert.match(client, /`journey-\$\{operation\}-\$\{entropy\}`\.slice\(0, 96\)/u);
  assert.match(client, /'Idempotency-Key': idempotencyKey\(operation\)/u);
  for (const operation of ['source-create', 'credential-create', 'credential-rotate', 'credential-revoke', 'schema-create', 'schema-version-create', 'schema-version-publish', 'schema-version-deprecate', 'dead-letter-replay']) {
    assert.match(client, new RegExp(`'${operation}'`, 'u'));
  }
});

test('frontend envelopes match the real route and repository contract', () => {
  assert.match(backendRoutes, /quota: journeyEventSourceQuota\(space\.id\)/u);
  assert.match(client, /quota: \{ used: number; limit: number; remaining: number \}/u);
  assert.match(backendRoutes, /expectedRevision: z\.number\(\)\.int\(\)\.min\(1\)/u);
  assert.match(client, /json\('PATCH', \{ expectedRevision, \.\.\.input \}\)/u);
  assert.match(backendRepository, /return \{ credential, secret: issued\.secret, replayed: false \}/u);
  assert.match(client, /secret\?: string; credential: JourneyEventCredential; replayed: boolean/u);
  assert.match(backendRoutes, /z\.object\(\{ eventName: z\.string\(\)\.min\(1\)\.max\(128\) \}\)\.strict\(\)/u);
  assert.match(client, /\{ eventName: input\.eventName \}/u);
  assert.match(client, /await post<\{ version: JourneyEventSchemaVersion; replayed: boolean \}>\([\s\S]*schema-version-create/u);
  assert.match(backendRoutes, /cursor: z\.string\(\)\.min\(1\)\.max\(500\)\.optional\(\)/u);
  assert.match(client, /if \(cursor\) params\.set\('cursor', cursor\)/u);
  assert.match(client, /events: JourneyControlPlaneAuditEvent\[\]; nextCursor: string \| null/u);
});

test('space members are viewers and cannot mount mutation controls', () => {
  assert.match(page, /const canManage = \['owner', 'admin'\]\.includes/u);
  assert.match(page, /canManage && <Button[^\n]*Create source/u);
  assert.match(page, /canManage=\{canManage\}/u);
  assert.match(credentials, /if \(!canManage \|\| source\.status !== 'active'/u);
  assert.match(trackingPlan, /const mutable = canManage && source\.status !== 'revoked'/u);
  assert.match(page, /<EventSourceDeadLetters source=\{selected\} canManage=\{canManage\}/u);
  assert.match(deadLetters, /if \(!confirming \|\| !canManage \|\| !replayEligibility\(confirming\)\) return/u);
});

test('ingestion operations stay bounded, filtered, and explicitly opt in to polling', () => {
  assert.match(page, /<TabsTrigger value="debugger"/u);
  assert.match(page, /<TabsTrigger value="dead-letters"/u);
  assert.match(page, /<TabsTrigger value="usage"/u);
  assert.match(client, /new URLSearchParams\(\{ limit: String\(options\.limit \?\? 50\) \}\)/u);
  assert.match(client, /if \(options\.outcome\) params\.set\('outcome', options\.outcome\)/u);
  assert.match(client, /if \(options\.state\) params\.set\('state', options\.state\)/u);
  assert.match(client, /'content_conflict' \|\s*'rejected' \| 'rate_limited' \| 'over_quota' \| 'consent_denied'/u);
  assert.match(client, /'pending' \| 'replay_scheduled' \| 'resolved' \| 'terminal'/u);
  assert.match(client, /warningLevel: 'normal' \| 'approaching' \| 'warning' \| 'exhausted'/u);
  assert.doesNotMatch(client, /failureCode\?:|attemptCount\?:|canReplay\?:/u);
  assert.match(debuggerView, /const \[pollMs, setPollMs\] = useState\(0\)/u);
  assert.match(debuggerView, /document\.visibilityState === 'visible'/u);
  assert.match(debuggerView, /<option value=\{0\}>Off<\/option>/u);
  assert.match(debuggerView, /issues\.slice\(0, 5\)/u);
});

test('debugger and dead-letter UI can render only redacted receipt and routing metadata', () => {
  for (const forbidden of ['identityId', 'anonymousId', 'userId', 'payloadJson', 'contextJson', 'consentJson', 'envelopeSha256', 'propertyValues', 'credentialSecret']) {
    assert.doesNotMatch(debuggerView, new RegExp(`event\\.${forbidden}`, 'u'));
    assert.doesNotMatch(deadLetters, new RegExp(`letter\\.${forbidden}`, 'u'));
  }
  assert.match(debuggerView, /Privacy-safe metadata only/u);
  assert.match(debuggerView, /navigator\.clipboard\.writeText\(receiptId\)/u);
  assert.match(deadLetters, /title="Replay this dead letter\?"/u);
  assert.match(client, /\{ confirmation: true \}/u);
  assert.match(usage, /No per-source allocation or estimated breakdown is shown/u);
  assert.doesNotMatch(usage, /sourceBreakdown|bySource|estimatedSource/u);
});

test('credential history never renders a stored secret and one-time reveal requires explicit dismissal', () => {
  assert.doesNotMatch(credentials, /credential\.secret/u);
  assert.match(secretDialog, /This secret is shown once/u);
  assert.match(secretDialog, /showCloseButton=\{false\}/u);
  assert.match(secretDialog, /onEscapeKeyDown=\{\(event\) => \{ if \(!acknowledged\) event\.preventDefault\(\); \}\}/u);
  assert.match(secretDialog, /onPointerDownOutside=\{\(event\) => event\.preventDefault\(\)\}/u);
  assert.match(secretDialog, /disabled=\{!acknowledged\}/u);
  assert.match(secretDialog, /onDismiss\(\)/u);
});

test('source operations use confirmations and schema versions expose compatibility before publication', () => {
  assert.match(credentials, /<DialogTitle>Rotate credential<\/DialogTitle>/u);
  assert.match(credentials, /title="Revoke this credential\?"/u);
  assert.match(trackingPlan, /Published versions are immutable/u);
  assert.match(trackingPlan, /version\.compatibility\?\.issues/u);
  assert.match(trackingPlan, /disabled=\{working \|\| !compatible\}/u);
  assert.match(trackingPlan, /title=\{`Publish version/u);
  assert.match(trackingPlan, /title=\{`Deprecate version/u);
});

test('wide control-plane tables have captions and narrow-screen alternatives', () => {
  const audit = read('components', 'journey-events', 'EventSourceAudit.tsx');
  for (const source of [credentials, trackingPlan, audit, debuggerView, deadLetters]) {
    assert.match(source, /<caption className="sr-only">/u);
    assert.match(source, /scope="col"/u);
  }
  assert.match(credentials, /sm:hidden/u);
  assert.match(audit, /sm:hidden/u);
  assert.match(trackingPlan, /lg:hidden/u);
  assert.doesNotMatch(audit, /event\.detail/u, 'raw audit detail must never reach the rendered workspace');
});

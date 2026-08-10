import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', 'src');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const client = read('lib', 'journeyConnectors.ts');
const page = read('pages', 'JourneyConnectorsPage.tsx');
const app = read('App.tsx');
const shell = read('components', 'AppShell.tsx');
const routes = fs.readFileSync(path.resolve(root, '..', '..', 'backend', 'src', 'journeyConnectorImportRoutes.ts'), 'utf8');

test('connector workspace is lazy routed and follows its dedicated plan entitlement', () => {
  assert.match(app, /const JourneyConnectorsPage = lazy/u);
  assert.match(app, /<Route path="\/journey-connectors"><JourneyConnectorsPage \/><\/Route>/u);
  assert.match(shell, /to: '\/journey-connectors'.*feature: 'journeyConnectors'/u);
  assert.match(page, /useSessionFeature\('journeyConnectors'\)/u);
});

test('strict client covers every mounted connector contract and mutation idempotency', () => {
  for (const path of ['/connectors', '/imports/', '/pages', '/receipts', '/audit']) assert.ok(client.includes(path), path);
  for (const call of ['createJourneyConnector', 'setJourneyConnectorState', 'startJourneyConnectorImport', 'readJourneyConnectorImport',
    'submitJourneyConnectorPage', 'listJourneyConnectorReceipts', 'listJourneyConnectorAudit']) assert.ok(client.includes(call), call);
  assert.ok((client.match(/\.strict\(\)/gu) || []).length >= 8);
  assert.match(client, /Idempotency-Key/u);
  assert.match(client, /expectedRevision/u);
  assert.match(client, /expectedCheckpointRevision/u);
  assert.doesNotMatch(client, /spaceId/u);
  assert.match(routes, /resolveRequestSpace\(request,user\.id\)/u);
});

test('approved staging, partial receipts, retries and tombstones remain explicit', () => {
  for (const phrase of ['No live provider connections or credentials', 'approved local CSV/JSONL staging', 'Submit staged page',
    'partially accepted', 'immutable rejection receipts', 'Deletes always create irreversible tombstones', 'Retry attempt',
    'Tombstoned identifiers cannot be resurrected', 'External identifiers are shown only as SHA-256 hashes']) assert.ok(page.includes(phrase), phrase);
  for (const kind of ['csv_upload', 'jsonl_upload', 'approved_object_store']) assert.ok(client.includes(kind), kind);
});

test('roles, resilient states, content-safe audit and narrow layouts are implemented', () => {
  for (const phrase of ['Read-only: connector creation', 'Loading journey connectors', 'No approved staging connectors have been created',
    'Connector or checkpoint changed elsewhere', 'No item receipts have been recorded', 'No connector audit events have been recorded', 'role="alert"']) assert.ok(page.includes(phrase), phrase);
  assert.match(page, /session\.activeSpace\.role !== 'member'/u);
  assert.match(page, /reason instanceof ApiError && reason\.status === 409/u);
  assert.match(page, /overflow-x-auto/u);
  assert.match(page, /min-w-\[720px\]/u);
  assert.doesNotMatch(page, /JSON\.stringify\(item\.detail/u);
  assert.doesNotMatch(page, /gradient|backdrop-blur|rounded-\[2/iu);
});

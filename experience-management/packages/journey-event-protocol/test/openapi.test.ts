import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { journeyEventCalls, journeyEventSchemaFiles } from '../src/index.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const openApiFile = path.join(packageRoot, 'openapi', 'v1', 'openapi.json');

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as any;
}

function collectRefs(value: unknown, refs: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((entry) => collectRefs(entry, refs));
  else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (key === '$ref' && typeof entry === 'string') refs.push(entry);
      else collectRefs(entry, refs);
    }
  }
  return refs;
}

test('OpenAPI 3.1 publishes only the two future contract endpoints', () => {
  const document = readJson(openApiFile);
  assert.equal(document.openapi, '3.1.0');
  assert.equal(document.jsonSchemaDialect, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(document['x-seemplify-contract-status'], 'future-not-deployed');
  assert.deepEqual(Object.keys(document.paths).sort(), ['/v1/batch', '/v1/events']);
  assert.equal(document.paths['/v1/events'].post.operationId, 'acceptJourneyEvent');
  assert.equal(document.paths['/v1/batch'].post.operationId, 'acceptJourneyEventBatch');
  assert.match(document.info.description, /No production ingestion service/i);
  assert.ok(document.servers.every((server: { url: string }) => new URL(server.url).hostname.endsWith('.invalid')));
});

test('OpenAPI operations use the published request, result and error schemas', () => {
  const document = readJson(openApiFile);
  const externalRefs = collectRefs(document).filter((reference) => !reference.startsWith('#'));
  assert.ok(externalRefs.length > 0);
  for (const reference of externalRefs) {
    const relative = reference.split('#')[0];
    assert.ok(relative);
    const target = path.resolve(path.dirname(openApiFile), relative);
    assert.equal(fs.existsSync(target), true, `OpenAPI reference does not resolve: ${reference}`);
    assert.ok(journeyEventSchemaFiles.includes(path.basename(target) as never), `Unexpected schema reference: ${reference}`);
  }
  assert.equal(document.paths['/v1/events'].post.requestBody.content['application/json'].schema.$ref,
    '../../schemas/v1/event-envelope.schema.json');
  assert.equal(document.paths['/v1/batch'].post.requestBody.content['application/json'].schema.$ref,
    '../../schemas/v1/event-batch.schema.json');
  for (const status of ['200', '202']) {
    assert.equal(document.paths['/v1/events'].post.responses[status].content['application/json'].schema.$ref,
      '../../schemas/v1/event-result.schema.json');
  }
  for (const status of ['200', '202', '207']) {
    assert.equal(document.paths['/v1/batch'].post.responses[status].content['application/json'].schema.$ref,
      '../../schemas/v1/batch-result.schema.json');
  }
  assert.equal(document.components.responses.ProtocolError.content['application/json'].schema.$ref,
    '../../schemas/v1/protocol-error.schema.json');
});

test('OpenAPI security distinguishes ingestion-only public keys and server secrets', () => {
  const document = readJson(openApiFile);
  const publicKey = document.components.securitySchemes.publicWriteKey;
  const serverSecret = document.components.securitySchemes.serverSecret;
  assert.equal(publicKey.type, 'http');
  assert.equal(publicKey.scheme, 'bearer');
  assert.match(publicKey.description, /never grants read access/i);
  assert.match(serverSecret.description, /never be embedded in browser or mobile/i);
  for (const pathname of ['/v1/events', '/v1/batch']) {
    assert.deepEqual(document.paths[pathname].post.security, [{ publicWriteKey: [] }, { serverSecret: [] }]);
  }
});

test('event naming guide and schema enforce the same protocol-v1 grammar', () => {
  const guide = fs.readFileSync(path.join(packageRoot, 'EVENT-NAMING.md'), 'utf8');
  const envelope = readJson(path.join(packageRoot, 'schemas', 'v1', 'event-envelope.schema.json'));
  const eventPattern = new RegExp(envelope.properties.event.pattern);
  for (const name of ['auth_signup_started', 'survey_published', 'agreement_completed', 'feature_limit_reached']) {
    assert.equal(eventPattern.test(name), true, name);
    assert.match(guide, new RegExp(name));
  }
  for (const name of ['Button Clicked', 'signup-v2', 'Auth.Signup.Completed']) assert.equal(eventPattern.test(name), false, name);
  for (const call of journeyEventCalls) assert.match(guide, new RegExp(`\\b${call}\\b`));
});

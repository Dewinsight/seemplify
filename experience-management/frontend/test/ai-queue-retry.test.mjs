import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (...segments) => fs.readFileSync(path.join(source, ...segments), 'utf8');

test('AI queue retry follows server eligibility and reuses the durable job', () => {
  const page = read('pages', 'AiQueuePage.tsx');
  const types = read('types.ts');

  assert.match(types, /interface AiJobRetry \{ eligible: boolean; reason: string \| null \}/);
  assert.match(page, /job\.retry\?\.eligible/);
  assert.match(page, /job\.retry\?\.reason/);
  assert.match(page, /\/api\/ai\/jobs\/\$\{encodeURIComponent\(job\.id\)\}\/retry/);
  assert.match(page, /json\('POST', \{\}\)/);
  assert.doesNotMatch(page, /\/api\/social\/reports\/.*\/retry/);
  assert.match(page, /same durable job and saved inputs/);
});

test('AI queue retry exposes pending, ineligible, failure, and audit states', () => {
  const page = read('pages', 'AiQueuePage.tsx');

  assert.match(page, /aria-busy=\{retryingJobId === job\.id\}/);
  assert.match(page, /disabled=\{!job\.retry\?\.eligible \|\| Boolean\(retryingJobId\)\}/);
  assert.match(page, /retryErrors\[job\.id\][\s\S]*role="alert"/);
  assert.match(page, /<JobAudit job=\{jobDetails\[job\.id\]\}/);
  assert.match(page, /Recorded failure/);
  assert.match(page, /This activity cannot be retried safely from the queue\./);
});

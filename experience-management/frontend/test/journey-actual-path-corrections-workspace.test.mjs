import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const client = fs.readFileSync(path.join(root, 'src/lib/journeyActualPathCorrections.ts'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'src/components/journeys/JourneyActualPathCorrectionPanel.tsx'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src/pages/JourneyMetricsPage.tsx'), 'utf8');

test('strict correction client accepts only the content-safe durable run projection', () => {
  assert.match(client, /exact\(value, 'actual path correction run'/u);
  assert.match(client, /\^\[a-f0-9\]\{64\}\$/u);
  assert.match(client, /requestReasonProof/u);
  assert.match(client, /actual-path-corrections/u);
  assert.match(client, /Idempotency-Key/u);
  assert.doesNotMatch(client, /requestedByUserId|sourceId|lastRawEventId/u);
});

test('correction workspace is restrained, accessible and keeps members read-only', () => {
  assert.match(page, /JourneyActualPathCorrectionPanel/u);
  assert.match(panel, /aria-labelledby="actual-path-correction-heading"/u);
  assert.match(panel, /<caption className="sr-only">Durable stage correction runs/u);
  assert.match(panel, /<th scope="row"/u);
  assert.match(panel, /canManage \? <form/u);
  assert.match(panel, /Editing permission is required/u);
  assert.match(panel, /only one can run for this journey at a time/u);
  assert.doesNotMatch(panel, /gradient|rounded-\[2[0-9]px\]|shadow-2xl/u);
});

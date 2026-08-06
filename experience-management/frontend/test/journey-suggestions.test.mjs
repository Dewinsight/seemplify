import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const client = fs.readFileSync(path.join(root, 'src/lib/journeySuggestions.ts'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src/pages/JourneySuggestionReviewPage.tsx'), 'utf8');
const mapsPage = fs.readFileSync(path.join(root, 'src/pages/JourneyMapsPage.tsx'), 'utf8');

test('journey suggestion client exposes durable review and optimistic apply contracts', () => {
  assert.match(client, /createJourneySuggestion/);
  assert.match(client, /expectedRunRevision/);
  assert.match(client, /expectedDefinitionRevision/);
  assert.match(client, /changes\/\$\{encodeURIComponent\(changeId\)\}\/decision/);
  assert.match(client, /'applied' \| 'dismissed'/);
});

test('journey suggestion review is an explicit evidence-aware human gate', () => {
  assert.match(page, /Nothing enters the journey draft until every change has a recorded human decision/);
  assert.match(page, /Accept/);
  assert.match(page, /Reject/);
  assert.match(page, /Decision reason/);
  assert.match(page, /Cited selected evidence/);
  assert.match(page, /No selected evidence supports this proposed change/);
  assert.match(page, /Apply reviewed changes/);
  assert.match(page, /expectedDefinitionRevision: detail\.run\.baseDefinitionRevision/);
  assert.doesNotMatch(page, /gradient|backdrop-blur|rounded-2xl|rounded-3xl/u);
});

test('native map workspace launches grounded suggestions and preserves review history', () => {
  assert.match(client, /listJourneySuggestionEvidence/);
  assert.match(mapsPage, /data-testid="journey-ai-suggestions"/);
  assert.match(mapsPage, /Generate reviewable suggestions/);
  assert.match(mapsPage, /Only checked, currently authorised records are frozen into this run/);
  assert.match(mapsPage, /Suggestion history/);
  assert.match(mapsPage, /canManageSuggestions/);
  assert.doesNotMatch(mapsPage, /AI magic|one-click optimisation/iu);
});

test('legacy journey audit copy no longer claims direct automatic replacement', () => {
  const legacyPage = fs.readFileSync(path.join(root, 'src/pages/JourneysPage.tsx'), 'utf8');
  assert.match(legacyPage, /Nothing is applied automatically/);
  assert.match(legacyPage, /navigate\(queued\.reviewUrl\)/);
  assert.doesNotMatch(legacyPage, /Journey improvements applied/);
});

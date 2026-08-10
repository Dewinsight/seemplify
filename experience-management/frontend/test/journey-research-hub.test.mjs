import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const sourceRoot = path.resolve(import.meta.dirname, '..', 'src');
const read = (...segments) => fs.readFileSync(path.join(sourceRoot, ...segments), 'utf8');
const app = read('App.tsx');
const shell = read('components', 'AppShell.tsx');
const page = read('pages', 'JourneyResearchHubPage.tsx');
const client = read('lib', 'journeyResearch.ts');

test('the Research Hub remains implemented but is not published', () => {
  assert.doesNotMatch(app, /path="\/journey-research"/u);
  assert.doesNotMatch(shell, /to: '\/journey-research'/u);
  assert.match(page, /useSessionFeature\('journeyEvidence'\)/u);
  assert.match(page, /if \(!enabled\) return null/u);
});

test('the typed client covers every P2-01 through P2-04 resource without accepting raw tenant identity', () => {
  for (const suffix of [
    '/catalogue', '/inbox', '/sources', '/snapshots/', '/links', '/assessments', '/gaps', '/intakes',
    '/monitors', '/refresh-runs', '/notifications', '/audit'
  ]) assert.ok(client.includes(suffix), `missing Research Hub API resource ${suffix}`);
  assert.match(client, /crypto\.randomUUID\(\)/u);
  assert.match(client, /'Idempotency-Key': crypto\.randomUUID\(\)/u);
  assert.match(client, /itemKind: 'notification'/u);
  assert.match(client, /itemKind: 'existing_evidence_link'/u);
  assert.doesNotMatch(client, /spaceId\??:/u, 'space identity is supplied by the authenticated API boundary, not callers');
});

test('source discovery, exact inspection, target linking and lifecycle actions are present', () => {
  assert.match(page, /listJourneyResearchCatalogue/u);
  assert.match(page, /getJourneyResearchSource/u);
  assert.match(page, /createJourneyResearchLink/u);
  assert.match(page, /targetType === 'stage'/u);
  assert.match(page, /targetType === 'card'/u);
  assert.match(page, /targetMap\.personas/u);
  assert.match(page, /createJourneyResearchMonitor/u);
  assert.match(page, /queueJourneyResearchRefresh/u);
  assert.match(page, /Authorised source viewer/u);
  assert.match(page, /Retention expires/u);
});

test('research intake reuses the knowledge pipeline and requires an explicit retention and consent basis', () => {
  assert.match(page, /getKnowledgeBases\(\)/u);
  assert.match(page, /createJourneyResearchIntake/u);
  assert.match(page, /knowledgeBaseId: intakeDraft\.knowledgeBaseId/u);
  assert.match(page, /retentionExpiresAt:/u);
  assert.match(page, /consentBasis: intakeDraft\.consentBasis/u);
  assert.match(page, /Add to knowledge and research/u);
  assert.doesNotMatch(page, /vector|embedding|chunker/iu, 'the Research Hub must not present a second knowledge engine');
});

test('the workspace exposes native responsive tables, viewer restrictions and explicit failure states', () => {
  assert.match(page, /const canManage = Boolean\(session\?\.activeSpace && session\.activeSpace\.role !== 'member'\)/u);
  assert.match(page, /You have viewer access/u);
  assert.match(page, /role="alert"/u);
  assert.match(page, /overflow-x-auto/u);
  assert.match(page, /<caption className="sr-only"/u);
  assert.match(page, /aria-label="Research Hub sections"/u);
  assert.match(page, /role="status"/u);
  assert.doesNotMatch(page, /[\u00c2\u00c3]|\u00e2/u, 'the new Research Hub files must not contain mojibake');
});

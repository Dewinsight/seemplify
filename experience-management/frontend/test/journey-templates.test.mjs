import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const source = path.resolve(import.meta.dirname, '..', 'src');
const read = (...parts) => fs.readFileSync(path.join(source, ...parts), 'utf8');

const client = read('lib', 'journeyTemplates.ts');
const manager = read('components', 'journeys', 'JourneyTemplateManager.tsx');
const governance = read('components', 'journeys', 'GovernedJourneyTemplateWorkspace.tsx');
const editor = read('components', 'journeys', 'JourneyTemplateContentEditor.tsx');
const preview = read('components', 'journeys', 'JourneyTemplatePreview.tsx');

test('journey template client carries version, scope, optimistic revision, and pinned map contracts', () => {
  for (const state of ['draft', 'in_review', 'published', 'retired']) assert.match(client, new RegExp(`'${state}'`, 'u'));
  for (const field of [
    'scope', 'currentVersionId', 'publishedVersionId', 'contentChecksum', 'expectedTemplateRevision',
    'expectedVersionRevision', 'templateVersionId'
  ]) assert.match(client, new RegExp(`\\b${field}\\b`, 'u'));
  for (const endpoint of ['/api/journey-templates', '/api/platform-admin/journey-templates', '/create-map']) {
    assert.match(client, new RegExp(endpoint.replaceAll('/', '\\/'), 'u'));
  }
  assert.match(client, /action: 'review' \| 'reject' \| 'publish' \| 'retire'/u);
  assert.match(client, /json\('POST', name\?\.trim\(\) \? \{ name: name\.trim\(\) \} : \{\}\)/u);
});

test('typed template governance client exposes bounded audit history and reject-to-draft', () => {
  assert.match(client, /export interface JourneyTemplateAuditEvent/u);
  assert.match(client, /export interface JourneyTemplateAuditPage/u);
  assert.match(client, /listPlatformJourneyTemplateAuditEvents\(templateId: string, limit = 20/u);
  assert.match(client, /listSpaceJourneyTemplateAuditEvents\(templateId: string, limit = 20/u);
  assert.match(client, /\/audit\?\$\{journeyTemplateAuditQuery\(limit, before\)\}/u);
  assert.match(client, /export function rejectPlatformJourneyTemplateReview/u);
  assert.match(client, /'reject', templateId, versionId, expectedTemplateRevision/u);
});

test('template UI disappears entirely when the plan feature is disabled', () => {
  assert.match(manager, /useSessionFeature\('journeyTemplates'\)/u);
  assert.match(manager, /if \(!enabled\) return null/u);
  assert.ok(manager.indexOf('if (!enabled) return null') < manager.indexOf('return <Dialog'));
  assert.match(manager, /listJourneyTemplates\(canManage\)/u);
});

test('published gallery previews a version and creates a map from that exact version', () => {
  assert.match(manager, /version\.state === 'published' && version\.id === template\.publishedVersionId/u);
  assert.match(manager, /previewJourneyTemplate\(template\.id, version\.id\)/u);
  assert.match(manager, /createJourneyMapFromPublishedTemplate\(selectedTemplateId, selected\.id, mapName\)/u);
  assert.match(manager, /designed hypotheses until evidence is attached/u);
  assert.match(manager, /data-testid="create-map-from-template"/u);
  assert.match(preview, /<caption className="sr-only">/u);
  assert.match(preview, /scope="col"/u);
  assert.match(preview, /scope="row"/u);
});

test('governance keeps drafts editable and published content read-only', () => {
  assert.match(governance, /selectedVersion\?\.state === 'draft'/u);
  assert.match(governance, /draftDirty/u);
  assert.match(governance, /Submit for review/u);
  assert.match(governance, /Publish reviewed version/u);
  assert.match(governance, /Publish version/u);
  assert.match(governance, /New draft version/u);
  assert.match(governance, /Retire version/u);
  assert.match(governance, /contentFromJourneyTemplateVersion\(selectedVersion\)/u);
  assert.match(governance, /JOURNEY_TEMPLATE_REVISION/u, 'conflict handling should identify journey template revisions');
});

test('system template governance enforces two-person publication and renders read-only audit history', () => {
  const page = read('pages', 'platform-admin', 'JourneyTemplatesPage.tsx');
  assert.match(page, /currentUserId=\{access\.user\.id\}/u);
  assert.match(governance, /selectedVersion\.reviewedByUserId === currentUserId/u);
  assert.match(governance, /disabled=\{Boolean\(work\) \|\| !reasonReady \|\| isReviewAuthor\}/u);
  assert.match(governance, /A different administrator must publish this reviewed version/u);
  assert.match(governance, /Reject to draft/u);
  assert.match(governance, /transition\('reject'\)/u);
  assert.match(governance, /Latest 20 events/u);
  assert.match(governance, /Read-only governance history for this template/u);
  assert.match(governance, /scope === 'system'\s*\? listPlatformJourneyTemplateAuditEvents/u);
  assert.match(governance, /: listSpaceJourneyTemplateAuditEvents/u);
});

test('authoring validates stable stage keys, unique lanes, and accessible structural controls', () => {
  assert.match(editor, /Every lane must use a different lane type/u);
  assert.match(editor, /Stage keys must be unique lower-kebab-case values/u);
  assert.match(editor, /Every card must belong to an available lane/u);
  assert.match(editor, /aria-label=\{`Move \$\{lane\.title\} up`\}/u);
  assert.match(editor, /aria-label=\{`Move \$\{stage\.name\} earlier`\}/u);
  assert.match(editor, /Service-blueprint lane only/u);
});

test('platform Journey templates remain implemented but are not published', () => {
  const app = read('App.tsx');
  const shell = read('components', 'platform-admin', 'PlatformAdminShell.tsx');
  const types = read('pages', 'platform-admin', 'types.ts');
  const page = read('pages', 'platform-admin', 'JourneyTemplatesPage.tsx');
  assert.doesNotMatch(app, /path="\/admin\/journey-templates"/u);
  assert.doesNotMatch(shell, /to: '\/admin\/journey-templates'/u);
  assert.doesNotMatch(shell, /capability: 'journey_templates\.read'/u);
  assert.match(types, /'journey_templates\.manage'/u);
  assert.match(page, /platformAdminHasPermission\(access, 'journey_templates\.manage'\)/u);
  assert.match(page, /scope="system"/u);
});

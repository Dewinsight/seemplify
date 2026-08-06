import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const sourceRoot = path.resolve(import.meta.dirname, '..', 'src');
const clientPath = path.join(sourceRoot, 'lib', 'journeyRichCards.ts');
const editor = fs.readFileSync(path.join(sourceRoot, 'components', 'journeys', 'JourneyRichTextEditor.tsx'), 'utf8');
const workspace = fs.readFileSync(path.join(sourceRoot, 'components', 'journeys', 'JourneyRichCardWorkspace.tsx'), 'utf8');
const page = fs.readFileSync(path.join(sourceRoot, 'pages', 'JourneyMapsPage.tsx'), 'utf8');

const bundled = await build({
  entryPoints: [clientPath], bundle: true, write: false, format: 'esm', platform: 'browser',
  alias: { '@': sourceRoot }, minify: false, logLevel: 'silent'
});
const client = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

function documentWith(marks) {
  return { version: 1, blocks: [{ type: 'paragraph', text: 'Overlapping links', marks }] };
}

test('strict client parsing rejects malicious and overlapping links before React rendering', () => {
  assert.throws(() => client.parseJourneyRichText(documentWith([
    { type: 'link', start: 0, end: 6, href: 'javascript:alert(1)' }
  ])), /must use HTTPS/u);
  assert.throws(() => client.parseJourneyRichText(documentWith([
    { type: 'link', start: 0, end: 11, href: 'https://research.example/one' },
    { type: 'link', start: 5, end: 17, href: 'https://research.example/two' }
  ])), /cannot overlap/u);
  assert.deepEqual(client.parseJourneyRichText(documentWith([
    { type: 'link', start: 0, end: 5, href: 'https://research.example/one' },
    { type: 'bold', start: 0, end: 5 },
    { type: 'link', start: 5, end: 17, href: 'https://research.example/two' }
  ])).blocks[0].marks.length, 3, 'adjacent links and non-link formatting remain lossless');
});

test('the editor deterministically replaces intersecting link marks and never renders raw HTML', () => {
  assert.match(editor, /type === 'link' \? block\.marks\.filter\([\s\S]*mark\.end <= selection\.start \|\| mark\.start >= selection\.end/u);
  assert.doesNotMatch(editor, /dangerouslySetInnerHTML|innerHTML\s*=/u);
  assert.match(editor, /target="_blank" rel="noopener noreferrer"/u);
});

test('rich cards reach editor, inspector, outline workspace, presentation, media, and the exact curve', () => {
  assert.match(page, /useSessionFeature\('journeyRichCards'\)/u);
  assert.match(page, /<TabsTrigger value="rich-cards"/u);
  assert.match(page, /<JourneyRichCardWorkspace/u);
  assert.match(page, /richDetail=\{richMap\?\.cards\.find/u);
  assert.match(page, /function JourneyPresentation\(\{ map, richMap/u);
  assert.match(page, /<JourneyRichCardReadView card=\{card\} detail=\{richDetailFor\(card\.id\)\}/u);
  assert.match(page, /<JourneyEmotionalCurve points=\{richMap\.emotionalCurve\} compact/u);
  assert.match(workspace, /No average or inferred score is added/u);
  assert.match(workspace, /readJourneyCardRichDetail\(map\.definition\.id, selectedCardId, true\)/u);
  assert.match(workspace, /recoverable until/u);
  assert.match(workspace, /rel="noopener noreferrer"/u);
});

test('member and published views cannot mount rich-card mutation controls', () => {
  assert.match(page, /editable=\{Boolean\(editable && session\?\.activeSpace\?\.role !== 'member'\)\}/u);
  assert.match(workspace, /\{editable \? <>[\s\S]*JourneyRichTextEditor/u);
  assert.match(workspace, /editable && <Button/u);
  assert.match(workspace, /editable && <form/u);
});

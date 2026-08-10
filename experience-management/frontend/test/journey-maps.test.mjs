import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const frontend = path.resolve(import.meta.dirname, '..', 'src');
const backend = path.resolve(import.meta.dirname, '..', '..', 'backend', 'src');

const page = fs.readFileSync(path.join(frontend, 'pages', 'JourneyMapsPage.tsx'), 'utf8');
const client = fs.readFileSync(path.join(frontend, 'lib', 'journeyMaps.ts'), 'utf8');
const comparison = fs.readFileSync(path.join(frontend, 'components', 'journeys', 'JourneyMapComparison.tsx'), 'utf8');
const cardSurface = fs.readFileSync(path.join(frontend, 'components', 'journeys', 'JourneyCardSurface.tsx'), 'utf8');
const comparisonLogic = fs.readFileSync(path.join(frontend, 'lib', 'journeyMapComparison.ts'), 'utf8');
const templateEditor = fs.readFileSync(path.join(frontend, 'components', 'journeys', 'JourneyTemplateContentEditor.tsx'), 'utf8');

test('the journey workspace remains implemented but is not published', () => {
  const app = fs.readFileSync(path.join(frontend, 'App.tsx'), 'utf8');
  const shell = fs.readFileSync(path.join(frontend, 'components', 'AppShell.tsx'), 'utf8');
  assert.doesNotMatch(app, /path="\/journey-maps"/);
  assert.doesNotMatch(app, /JourneyMapsPage/);
  assert.doesNotMatch(shell, /to: '\/journey-maps'/);
  assert.ok(fs.existsSync(path.join(frontend, 'pages', 'JourneyMapsPage.tsx')));
});

test('every evidence state is presented with an explanation rather than a bare verdict', () => {
  const states = ['hypothesis', 'anecdotal', 'supported', 'strongly_supported', 'contradicted', 'stale', 'invalidated'];
  for (const state of states) {
    assert.match(client, new RegExp(`\\b${state}:\\s*\\{`, 'u'), `${state} needs a display descriptor`);
  }
  const descriptions = [...client.matchAll(/description:\s*$|description:\s*'/gmu)];
  assert.ok(descriptions.length >= states.length, 'each evidence state needs a description');
  // The computed reason has to reach the surface; a label alone reads as a
  // judgement the deterministic rules never made.
  assert.match(page, /card\.evidence\.reason/u);
  assert.match(page, /data-evidence-state=\{card\.evidence\.state\}/u);
});

test('evidence attachment selects an authorised canonical source instead of accepting spoofable metadata', () => {
  assert.match(client, /export function searchEvidenceSources\(/u);
  assert.match(client, /\/api\/journey-evidence\/sources\?/u);
  assert.match(client, /export function readEvidenceSource\(/u);
  assert.match(page, /data-testid="evidence-source-search"/u);
  assert.match(page, /data-testid="evidence-source-choice"/u);
  assert.match(page, /Labels, excerpts, dates, samples, and source links come from the current authorised record/u);
  assert.match(page, /<Link to=\{source\.path\}>Open source<\/Link>/u);
  for (const editableField of [
    'evidence-source-ref', 'evidence-label', 'evidence-sample', 'evidence-population', 'evidence-excerpt'
  ]) {
    assert.doesNotMatch(page, new RegExp(`(?:id|data-testid)="${editableField}"`, 'u'));
  }
  const attachContract = client.slice(client.indexOf('export function attachEvidence('), client.indexOf('export function detachEvidence('));
  for (const callerMetadata of ['sourceLabel', 'excerpt', 'sampleSize', 'population', 'collectedAt']) {
    assert.doesNotMatch(attachContract, new RegExp(`\\b${callerMetadata}\\b`, 'u'));
  }
});

test('evidence lifecycle access, refresh, and audit contracts reach the drawer without leaking unavailable sources', () => {
  for (const field of [
    'sourceAccess', 'refreshStatus', 'changedFields', 'snapshotFingerprint', 'sourceUpdatedAt', 'lastValidatedAt'
  ]) {
    assert.match(client, new RegExp(`\\b${field}:`, 'u'), `${field} must reach the client evidence contract`);
  }
  assert.match(client, /export function refreshEvidence\(linkId: string, expectedFingerprint: string\)/u);
  assert.match(client, /\/api\/journey-evidence\/\$\{encodeURIComponent\(linkId\)\}\/refresh/u);
  assert.match(client, /json\('POST', \{ expectedFingerprint \}\)/u);
  assert.match(client, /export function listEvidenceAudit\(/u);
  assert.match(client, /\/api\/journey-evidence\/\$\{encodeURIComponent\(linkId\)\}\/audit\?/u);

  // Source-of-record reads are allowed only after the list contract has said
  // the current viewer can still access the source.
  assert.match(page, /result\.links\.filter\(\(link\) => link\.sourceAccess === 'available'\)/u);
  assert.match(page, /if \(link\.sourceAccess === 'inaccessible'\)/u);
  assert.match(page, /Linked source unavailable/u);
  assert.match(page, /Its saved content is hidden and does not[\s\S]*contribute to the journey evidence state/u);
  assert.match(page, /link\.refreshStatus === 'changed'/u);
  assert.match(page, /Source changed/u);
  assert.match(page, /Last validated/u);
  assert.match(page, /refreshEvidence\(link\.id, link\.snapshotFingerprint\)/u);
  assert.match(page, /data-testid=\{`refresh-evidence-\$\{link\.id\}`\}/u);
});

test('the visual grid always ships with a keyboard path and a text alternative', () => {
  assert.match(cardSurface, /aria-label=\{`Move stage \$\{stage\.name\} earlier`\}/u);
  assert.match(cardSurface, /aria-label=\{`Move stage \$\{stage\.name\} later`\}/u);
  assert.match(cardSurface, /aria-label=\{`Move card \$\{card\.title\} to the previous stage`\}/u);
  assert.match(cardSurface, /data-testid="journey-outline"/u);
  assert.match(cardSurface, /<caption className="sr-only">/u);
  assert.match(cardSurface, /scope="col"/u);
  assert.match(cardSurface, /scope="row"/u);
});

test('governed exports use authenticated binary downloads with a fresh idempotency key', () => {
  assert.match(client, /export type JourneyMapExportFormat = 'json' \| 'csv' \| 'pdf' \| 'png' \| 'pptx'/u);
  assert.match(client, /const idempotencyKey = crypto\.randomUUID\(\)/u);
  assert.match(client, /'Idempotency-Key': idempotencyKey/u);
  assert.match(client, /credentials: 'same-origin'/u);
  assert.match(client, /headers\.set\('x-seemplify-space', selectedSpace\)/u);
  assert.match(client, /new URLSearchParams\(\{ versionId \}\)/u);
  assert.match(client, /response\.headers\.get\('content-disposition'\)/u);
  assert.match(client, /blob: await response\.blob\(\)/u);
  assert.match(page, /saveExportBlob\(artifact\.blob, artifact\.filename\)/u);
  assert.match(page, /data-testid="journey-export-progress"/u);
  assert.match(page, /setError\(detail\);[\s\S]*toast\.error\(detail\)/u);
  for (const format of ['json', 'csv', 'pdf', 'png', 'pptx']) {
    assert.match(page, new RegExp(`format: '${format}'`, 'u'));
  }
});

test('presentation mode is truthful, read-only, printable, responsive, and keyboard escapable', () => {
  const presentation = page.slice(page.indexOf('function JourneyPresentation('), page.indexOf('function EvidenceDrawer('));
  assert.match(presentation, /journeyModeLabels\[map\.version\.mode\]/u);
  assert.match(presentation, /v\{map\.version\.versionNumber\} · \{map\.version\.state\}/u);
  assert.match(presentation, /event\.key !== 'Escape'/u);
  assert.match(presentation, /window\.print\(\)/u);
  assert.match(presentation, /data-testid="presentation-stage-grid"/u);
  assert.match(presentation, /data-testid="presentation-stage-cards"/u);
  assert.match(presentation, /data-testid="presentation-outline"/u);
  assert.doesNotMatch(presentation, /Publish version|Add stage|Edit card|Delete card/u);
});

test('the client never lets the workspace declare a journey mode by hand', () => {
  // Mode is derived server-side from evidence. The client may render it but
  // must not offer it as an editable field.
  assert.doesNotMatch(page, /setMode\(/u);
  assert.doesNotMatch(client, /mode:\s*JourneyMode\s*\}\s*\)\s*\{/u);
  const backendMaps = fs.readFileSync(path.join(backend, 'journeyMaps.ts'), 'utf8');
  assert.match(backendMaps, /mode: computeJourneyMode\(/u);
});

test('the legacy audience is surfaced as unvalidated free text', () => {
  assert.match(page, /unvalidated free text, not a researched persona/u);
  assert.match(page, /data-testid="convert-audience"/u);
});

test('optimistic concurrency is carried on every structural write', () => {
  for (const call of ['addStage', 'moveStage', 'removeStage', 'addCard', 'updateCard', 'moveCard', 'removeCard', 'publishJourneyMap', 'updatePersona']) {
    const signature = new RegExp(`export function ${call}\\([^)]*expectedRevision: number`, 'u');
    assert.match(client, signature, `${call} must require the expected revision`);
  }
  assert.match(page, /JOURNEY_MAP_REVISION_CONFLICT/u);
});

test('publish reads the synchronously committed map revision after a structural mutation', () => {
  assert.match(page, /const mapRef = useRef<JourneyMapReadModel \| null>\(null\)/u);
  assert.match(page, /mapRef\.current = next;[\s\S]*setMap\(next\)/u);
  assert.match(page, /const next = await run\(\);[\s\S]*commitMap\(next\)/u);
  assert.match(page, /const currentMap = mapRef\.current;[\s\S]*publishJourneyMap\(currentMap\.definition\.id, currentMap\.definition\.revision\)/u);
  assert.match(page, /data-testid="publish-map" disabled=\{!editable \|\| Boolean\(busy\)\}/u);
  assert.doesNotMatch(page, /publishJourneyMap\(map\.definition\.id, revision\)/u);
});

test('personas are editable research artefacts and can be compared without cloning a map', () => {
  for (const field of ['summary', 'attributes', 'goals', 'behaviours', 'needs', 'barriers', 'reviewAt']) {
    assert.match(client, new RegExp(`\\b${field}:`, 'u'), `persona ${field} must reach the client contract`);
  }
  assert.match(page, /data-testid="persona-editor"/u);
  assert.match(page, /data-testid="persona-comparison"/u);
  assert.match(page, /Shared across personas/u);
  assert.match(page, /!card\.personaId \|\| card\.personaId === personaId/u);
  assert.match(page, /Persona updated everywhere it is reused/u);
});

test('plan-disabled persona and evidence subfeatures disappear without mounting their API surfaces', () => {
  assert.match(page, /useSessionFeature\('journeyPersonas'\)/u);
  assert.match(page, /useSessionFeature\('journeyEvidence'\)/u);
  assert.match(page, /personasEnabled && <TabsTrigger value="personas"/u);
  assert.match(page, /personasEnabled && <TabsTrigger value="persona-compare"/u);
  assert.match(page, /personasEnabled && map\.version\.legacyAudience/u);
  assert.match(page, /personasEnabled && personaEditor && <PersonaEditor/u);
  assert.match(page, /if \(!map \|\| !personasEnabled\) return/u);
  assert.match(page, /if \(!personasEnabled\) return;[\s\S]*setBusy\('persona'\)/u);

  assert.match(page, /evidenceEnabled && <TabsTrigger value="gaps"/u);
  assert.match(page, /renderEvidence=\{\(card\) => <EvidenceBadge card=\{card\} \/>\}/u);
  assert.match(cardSurface, /evidenceEnabled && renderEvidence\?\.\(card\)/u);
  assert.match(cardSurface, /evidenceEnabled && <Button[\s\S]*card-evidence-open/u);
  assert.match(page, /evidenceEnabled && evidenceCard && <EvidenceDrawer/u);
  assert.match(page, /if \(!evidenceEnabled\) \{[\s\S]*setEvidenceCard\(null\)/u);

  assert.match(page, /useSessionFeature\('journeyExports'\)/u);
  assert.match(page, /exportsEnabled && <details[^>]*data-testid="journey-export-menu"/u);
  assert.match(page, /if \(!exportsEnabled \|\| !map \|\| exporting\) return/u);
  assert.match(page, /if \(exportsEnabled\) return;[\s\S]*exportMenuRef\.current\?\.removeAttribute\('open'\)/u);
});

test('custom lanes use stable unique keys and expose the complete optimistic API surface', () => {
  for (const operation of ['addLane', 'updateLane', 'moveLane', 'setLaneVisibility', 'removeLane']) {
    assert.match(client, new RegExp(`export function ${operation}\\(`, 'u'));
  }
  assert.match(client, /\/lanes\/\$\{encodeURIComponent\(laneKey\)\}\/move/u);
  assert.match(client, /\/lanes\/\$\{encodeURIComponent\(laneKey\)\}\/visibility/u);
  assert.match(page, /useSessionFeature\('journeyDesign'\)/u);
  assert.match(page, /designEnabled && editable && <details[^>]*data-testid="lane-manager"/u);
  assert.match(page, /data-testid="new-lane-title"/u);
  assert.match(page, /data-testid="add-lane"/u);
  assert.match(page, /lane\.laneType\.startsWith\('custom_'\)/u);
  assert.match(page, /Move or remove every card before deleting this lane/u);
  assert.match(page, /if \(!designEnabled \|\| !map \|\| !newLaneTitle\.trim\(\)\) return/u);
  assert.match(page, /if \(!designEnabled \|\| !map \|\| !lane\.laneType\.startsWith\('custom_'\)\) return/u);
  assert.doesNotMatch(client, /\bcustom:\s*\['note'\]/u,
    'a literal custom lane would conflate multiple user-defined lane cells');
});

test('lane controls are keyboard-native and custom titles survive map and presentation views', () => {
  assert.match(page, /<form[^>]*[\s\S]*onSubmit=\{\(event\) => \{ event\.preventDefault\(\); void onAddLane\(\); \}\}/u);
  assert.match(page, /aria-label=\{`Move lane \$\{lane\.title\} earlier`\}/u);
  assert.match(page, /aria-label=\{`Move lane \$\{lane\.title\} later`\}/u);
  assert.match(page, /aria-label=\{`\$\{lane\.visible \? 'Hide' : 'Show'\} lane \$\{lane\.title\}`\}/u);
  assert.match(cardSurface, /laneTitles\.get\(card\.laneType\)/u);
  assert.match(page, /const laneTitleFor = \(laneType: string\)/u);
  assert.match(page, /laneTitleFor\(card\.laneType\)/u);
});

test('governed template editing preserves distinct custom keys with note-only semantics', () => {
  assert.match(templateEditor, /const customLanePattern = \/\^custom_/u);
  assert.match(templateEditor, /crypto\.randomUUID\(\)/u);
  assert.match(templateEditor, /data-testid=\{`\$\{idPrefix\}-add-custom-lane`\}/u);
  assert.match(templateEditor, /value=\{lane\.laneType\} disabled aria-readonly="true"/u);
  assert.match(templateEditor, /Custom lanes accept note cards only/u);
  assert.match(templateEditor, /laneCardKinds\[card\.laneType\] \|\| \['note'\]/u);
});

test('journey comparison reads both explicit versions and labels the exact identity on each side', () => {
  assert.match(page, /<TabsTrigger value="structure-compare" data-testid="tab-compare">Compare<\/TabsTrigger>/u);
  assert.match(page, /<JourneyMapComparison/u);
  assert.match(comparison, /readJourneyMap\(currentMap\.definition\.id, fromVersionId\)/u);
  assert.match(comparison, /readJourneyMap\(currentMap\.definition\.id, toVersionId\)/u);
  assert.match(comparison, /readJourneyMap\(currentMap\.definition\.id, currentMap\.version\.id\)/u);
  assert.match(comparison, /readJourneyMap\(targetDefinition\.id, targetDefinition\.currentVersionId\)/u);
  assert.match(comparison, /journeyModeLabels\[map\.version\.mode\]/u);
  assert.match(comparison, /mapTypeLabels\[map\.version\.mapType\]/u);
  assert.match(comparison, /v\{map\.version\.versionNumber\}[^\n]*\{map\.version\.state\}/u);
  assert.match(comparison, /Definition ID[\s\S]*map\.definition\.id/u);
  assert.match(comparison, /Version ID[\s\S]*map\.version\.id/u);
});

test('journey comparison is deterministic and never claims fuzzy identity', () => {
  assert.match(comparisonLogic, /new Map\(before\.stages\.map\(\(stage\) => \[stage\.stageKey, stage\]\)\)/u);
  assert.match(comparisonLogic, /rightRemaining\.get\(id\)/u);
  assert.match(comparisonLogic, /leftCards\.length !== 1 \|\| rightCards\.length !== 1/u);
  assert.match(comparisonLogic, /function cardSlot\(card: JourneyMapCard\)/u);
  assert.match(comparisonLogic, /changes: \[left \? 'removed' : 'added'\]/u);
  assert.match(comparisonLogic, /leftOrder - rightOrder \|\| left\.key\.localeCompare\(right\.key\)/u);
  assert.match(comparison, /Unmatched content stays separate; titles are never fuzzy-matched/u);
  assert.match(comparison, /Added, removed, changed, and reordered stages/u);
  assert.match(comparison, /Added|Removed|Changed|Reordered/u);
  assert.doesNotMatch(comparison, /saved view/iu);
});

test('journey comparison remains accessible and redacts disabled persona and evidence signals', () => {
  assert.match(comparison, /role="tablist" aria-label="Comparison scope"/u);
  assert.match(comparison, /<caption className="sr-only">/u);
  assert.match(comparison, /scope="col"/u);
  assert.match(comparison, /personasEnabled && <th scope="col"[^>]*>Persona<\/th>/u);
  assert.match(comparison, /evidenceEnabled && <th scope="col"[^>]*>Evidence<\/th>/u);
  assert.match(comparison, /includePersonas: personasEnabled, includeEvidence: evidenceEnabled/u);
  assert.match(comparisonLogic, /if \(options\.includePersonas\) fieldNames\.push\('personaId'\)/u);
  assert.match(comparisonLogic, /if \(options\.includeEvidence\) fieldNames\.push\('evidence', 'evidenceLinkCount'\)/u);
});

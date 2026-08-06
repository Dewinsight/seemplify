import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const frontend = path.resolve(import.meta.dirname, '..', 'src');
const page = fs.readFileSync(path.join(frontend, 'pages', 'JourneyMapsPage.tsx'), 'utf8');
const session = fs.readFileSync(path.join(frontend, 'lib', 'journeyMapEditorSession.ts'), 'utf8');
const client = fs.readFileSync(path.join(frontend, 'lib', 'journeyMaps.ts'), 'utf8');
const surface = fs.readFileSync(path.join(frontend, 'components', 'journeys', 'JourneyCardSurface.tsx'), 'utf8');

test('the touched editor source contains no mojibake sequences', () => {
  for (const [name, source] of [
    ['JourneyMapsPage.tsx', page], ['journeyMapEditorSession.ts', session], ['JourneyCardSurface.tsx', surface]
  ]) {
    assert.doesNotMatch(source, /[\u00c2\u00c3]|\u00e2/u, `${name} contains a mis-decoded UTF-8 sequence`);
  }
});

test('session history stores server-derived inverse operations and stays bounded', () => {
  assert.match(page, /executeEditorOperation\(current, operation, \{ compactMoveLimits \}\)/u);
  assert.match(page, /operation: result\.inverse/u);
  assert.match(page, /history\.slice\(-49\)/u);
  assert.match(page, /data-testid="journey-undo"/u);
  assert.match(page, /data-testid="journey-redo"/u);
  assert.match(page, /event\.key\.toLowerCase\(\)[\s\S]*key === 'z'/u);
  assert.match(page, /setUndoStack\(\[\]\);[\s\S]*setRedoStack\(\[\]\);[\s\S]*removeCard/u,
    'destructive card deletion must invalidate dependent session history');
  assert.match(page, /current\.evidenceLinkCount > 0[\s\S]*cannot be removed by session undo/u);
});

test('the session clipboard cannot carry evidence, identifiers, or provenance into a new claim', () => {
  const clipboardContract = session.slice(
    session.indexOf('export interface JourneyCardClipboardItem'),
    session.indexOf('export interface JourneyCardClipboard')
  );
  for (const forbidden of ['id:', 'evidence', 'origin', 'sourceRef', 'snapshot']) {
    assert.doesNotMatch(clipboardContract, new RegExp(forbidden, 'iu'));
  }
  assert.match(session, /A pasted card is a new[\s\S]*workspace hypothesis/u);
  assert.match(page, /never evidence links/u);
  assert.match(session, /Custom lanes accept note cards only/u);
  assert.match(session, /linkedPersonaIds\.has\(item\.personaId\)/u,
    'a copied persona assignment must be re-authorised against the target map');
});

test('multi-select editing uses one atomic revision-checked request and keeps an inverse', () => {
  assert.match(surface, /data-testid=\{`card-select-\$\{card\.id\}`\}/u);
  assert.match(page, /data-testid="apply-bulk-status"/u);
  assert.match(page, /data-testid="apply-bulk-persona"/u);
  assert.match(page, /data-testid="apply-bulk-stage"/u);
  assert.match(page, /type: 'bulk_patch_cards', label, cardIds, patch/u);
  assert.match(page, /bulkPatchCards\(definitionId, revision/u);
  assert.match(page, /one[\s\S]*revision-checked transaction/u);
  assert.match(page, /every selected card is saved, or none are/u);
  assert.match(page, /inverseGroups[\s\S]*bulk_patch_cards/u,
    'the successful atomic write must still produce a server-derived session inverse');
});

test('keyboard editing uses a roving cell stop and the same move operation as buttons', () => {
  assert.match(surface, /data-cell-focus=\{`\$\{stageKey\}\|\$\{laneType\}`\}/u);
  assert.match(surface, /tabIndex=\{cellActive \? 0 : -1\}/u);
  assert.match(surface, /Press Enter or N to add a card/u);
  assert.match(surface, /Alt plus an arrow key moves the card/u);
  assert.match(surface, /actions\.moveCardByKeyboard\(card, event\.key/u);
  assert.match(page, /type: 'move_card', cardId: card\.id, target/u);
  assert.match(page, /data-testid="card-inspector"/u);
  assert.match(surface, /data-testid="journey-outline"/u);
  assert.match(surface, /journey-mobile-card-list/u);
});

test('pointer drag plans a deterministic ordinal and announces every outcome', () => {
  for (const dependency of ['DndContext', 'PointerSensor', 'useDraggable', 'DragOverlay']) {
    assert.match(surface, new RegExp(dependency, 'u'));
  }
  assert.match(surface, /armed[\s\S]*<ArmedJourneyCardHandle/u,
    'only the pointer-armed card should subscribe to draggable state at scale');
  assert.match(surface, /useFocusedPointer[\s\S]*<FocusedPointerJourneyCardHandle/u,
    'the reference scale surface must use the isolated pointer controller');
  assert.match(session, /sort\(\(left, right\) => left\.ordinal - right\.ordinal \|\| left\.id\.localeCompare\(right\.id\)\)/u);
  assert.match(surface, /planJourneyCardDrop\(map, card\.id, destination/u);
  assert.match(surface, /role="status" aria-live="polite" aria-atomic="true"/u);
  assert.match(surface, /Picked up \$\{card\.title\} from/u);
  assert.match(surface, /Its authoritative position has been restored/u);
});

test('compact pointer responses are strictly validated, reconciled, and fully recovered on mismatch', () => {
  assert.match(client, /responseMode: 'affected_cells'/u);
  assert.match(client, /value\.revision !== expectedRevision \+ 1/u);
  assert.match(client, /value\.cardsPerCellLimit !== expectation\.limits\.cardsPerCell/u);
  assert.match(client, /compactCardKinds\.has\(value\.kind/u);
  assert.match(client, /compactEvidenceStates\.has\(value\.evidence\.state/u);
  assert.match(client, /card ordinals are not contiguous and exact/u);
  assert.match(client, /the authoritative source\/destination cell set is incomplete/u);
  assert.match(page, /reason instanceof JourneyCompactMoveResponseError[\s\S]*readJourneyMap\(definitionId\)/u);
  assert.match(session, /researchGaps: map\.researchGaps\.map/u);
  assert.match(session, /stageName: stageNames\.get\(card\.stageKey\)/u);
});

test('read-only, busy, and conflict state disable every pointer mutation path', () => {
  assert.match(page, /mutationLocked=\{Boolean\(busy\) \|\| saveState === 'conflict'\}/u);
  assert.match(surface, /const canMutate = props\.editable && !props\.mutationLocked/u);
  assert.match(surface, /disabled: !(?:props\.)?canMutate/u);
  assert.match(surface, /inert=\{mutationLocked \? true : undefined\}/u);
  assert.match(surface, /<fieldset className="contents" disabled=\{mutationLocked\}>/u);
  assert.match(surface, /if \(!canMutate\)[\s\S]*editing is unavailable/u);
  assert.match(page, /current\.version\.state !== 'draft'[\s\S]*mutationInFlightRef\.current[\s\S]*saveState === 'conflict'/u);
});

test('optimistic autosave never reports saved before an authoritative response', () => {
  assert.match(page, /setSaveState\('saving'\);[\s\S]*applyOptimisticJourneyOperation/u);
  assert.match(page, /const result = await executeEditorOperation\(current, operation, \{ compactMoveLimits \}\);[\s\S]*setSaveState\('saved'\)/u);
  assert.match(page, /window\.setTimeout\(\(\) => \{ void saveNow\(false\); \}, 700\)/u);
  assert.match(page, /Changes autosave after you pause/u);
  assert.match(page, /data-testid="journey-conflict-recovery"/u);
  assert.match(page, /A newer server version replaced the optimistic view/u);
  assert.match(page, /data-testid="reapply-conflict"/u);
  assert.match(page, /readJourneyMap\(current\.definition\.id\)/u,
    'conflict recovery must load the authoritative server map before offering reapply');
});

test('published versions cannot mount editor session mutations', () => {
  assert.match(page, /const editable = map\?\.version\.state === 'draft'/u);
  assert.match(page, /\{editable && <div[^>]*data-testid="editor-session-toolbar"/u);
  assert.match(page, /\{editable && <section[^>]*data-testid="card-bulk-toolbar"/u);
  assert.match(page, /if \(!current \|\| current\.version\.state !== 'draft'\)/u);
  assert.match(surface, /canMutate=\{canMutate\}/u);
});

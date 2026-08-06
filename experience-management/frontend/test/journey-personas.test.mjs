import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const sourceRoot = path.resolve(import.meta.dirname, '..', 'src');
const client = fs.readFileSync(path.join(sourceRoot, 'lib', 'journeyPersonas.ts'), 'utf8');
const library = fs.readFileSync(path.join(sourceRoot, 'components', 'journeys', 'JourneyPersonaLibrary.tsx'), 'utf8');
const page = fs.readFileSync(path.join(sourceRoot, 'pages', 'JourneyPersonasPage.tsx'), 'utf8');

test('persona API responses are runtime-validated instead of trusted generic casts', () => {
  assert.match(client, /api<unknown>/u);
  assert.match(client, /function record\(value: unknown/u);
  assert.match(client, /export function parsePersonaVersion/u);
  assert.match(client, /PersonaResponseError/u);
  assert.match(client, /sourceAccessValue/u);
  assert.match(client, /createLibraryPersona\(input: PersonaWriteInput\)/u);
  assert.match(client, /updateLibraryPersona\(personaId: string, expectedRevision: number, input:/u);
  assert.doesNotMatch(client, /json\([^\n]*spaceId|spaceId:\s*input\./u,
    'tenant identity comes from the authenticated request boundary, not persona mutation payloads');
});

test('the persona library exposes structured editing, exact claims, version history and controlled reuse', () => {
  assert.match(library, /Each save creates an immutable working version/u);
  assert.match(library, /Claims and evidence/u);
  assert.match(library, /Bind to claim/u);
  assert.match(library, /Published maps retain the exact version/u);
  assert.match(library, /Working journeys/u);
  assert.match(library, /Published pins/u);
  assert.match(library, /Current persona comparison/u);
  assert.match(library, /Version \{version\.versionNumber\}/u);
});

test('persona review is permission-aware, two-person, and honest about conflicts and stale evidence', () => {
  assert.match(library, /session\?\.activeSpace\?\.role === 'owner'/u);
  assert.match(library, /session\?\.activeSpace\?\.role === 'admin'/u);
  assert.match(library, /A different space owner or administrator must approve/u);
  assert.match(library, /JOURNEY_PERSONA_TWO_PERSON_APPROVAL_REQUIRED/u);
  assert.match(library, /JOURNEY_PERSONA_REVISION_CONFLICT/u);
  assert.match(library, /Review is blocked:/u);
  assert.match(library, /You have read-only access to persona governance/u);
});

test('persona layout has a deliberate small-screen list/detail alternative and no generic generated-UI styling', () => {
  assert.match(library, /hidden lg:block/u);
  assert.match(library, /All personas/u);
  assert.match(library, /overflow-x-auto/u);
  assert.match(library, /role="alert"/u);
  assert.doesNotMatch(library, /gradient|rounded-2xl|rounded-3xl|glass|backdrop-blur/iu);
  assert.doesNotMatch(library, /[\u00c2\u00c3]|\u00e2/u, 'new persona surfaces must not contain mojibake');
});

test('the page fails closed when persona entitlement is disabled', () => {
  assert.match(page, /useSessionFeature\('journeyPersonas'\)/u);
  assert.match(page, /if \(!enabled\)/u);
  assert.match(page, /Personas are not available/u);
});

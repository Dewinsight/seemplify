import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import test from 'node:test';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const client=fs.readFileSync(path.join(root,'src/lib/journeyExportBrand.ts'),'utf8');
const settings=fs.readFileSync(path.join(root,'src/components/settings/JourneyExportBrandSettings.tsx'),'utf8');
const savedViews=fs.readFileSync(path.join(root,'src/components/journeys/JourneySavedViewBar.tsx'),'utf8');
const space=fs.readFileSync(path.join(root,'src/pages/SpaceSettingsPage.tsx'),'utf8');

test('brand client parses exact server contracts and uses authenticated uploads',()=>{assert.match(client,/exact\(value,'brand catalog',\['profiles','assets','settings'\]\)/u);
  assert.match(client,/api<unknown>\('\/api\/uploads',multipart\('POST',body\)\)/u);assert.match(client,/\/api\/journey-export-brand\/assets/u);
  assert.match(client,/\/api\/journey-export-brand\/profiles/u);assert.match(client,/\/api\/journey-export-brand\/default/u);
  assert.match(client,/readJourneySavedViewBrand/u);assert.match(client,/expectedRevision:catalog\.settings\.revision/u);
  assert.match(client,/const\{viewId,\.\.\.body\}=input/u);assert.match(client,/json\('PUT',\{\.\.\.body,idempotencyKey/u);});

test('space settings supports restrained manager editing and member effective-brand reads',()=>{assert.match(space,/<JourneyExportBrandSettings \/>/u);
  assert.match(settings,/access\.canEdit&&<Button[^>]*>New profile/u);assert.match(settings,/access\.canEdit\?<div className="p-5">/u);
  assert.match(settings,/data-testid="journey-export-brand-effective"/u);assert.match(settings,/No export brand has been configured for this space/u);
  assert.match(settings,/status===409/u);assert.match(settings,/contrastRatio<4\.5/u);assert.match(settings,/Logo alternative text/u);
  assert.doesNotMatch(settings,/gradient|rounded-\[2[0-9]px\]|backdrop-blur|shadow-2xl/u);});

test('saved-view branding reads exact binding and keeps members read-only',()=>{assert.match(savedViews,/readJourneySavedViewBrand\(availableSelected\.id\)/u);
  assert.match(savedViews,/canEditShared&&brandAccess\?\.canManageViews/u);assert.match(savedViews,/data-testid="journey-saved-view-brand-effective"/u);
  assert.match(savedViews,/brandPolicy==='pinned'/u);assert.match(savedViews,/expectedRevision:brandBinding\.revision/u);assert.match(savedViews,/reason instanceof ApiError&&reason\.status===409/u);});

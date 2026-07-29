import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const source = path.resolve(import.meta.dirname, '..', 'src');
test('registers protected admin and public response routes', () => {
  const app = fs.readFileSync(path.join(source, 'App.tsx'), 'utf8');
  assert.match(app, /path="\/login"/);
  assert.match(app, /path="\/signup"/);
  assert.match(app, /path="\/forgot-password"/);
  assert.match(app, /path="\/reset-password"/);
  assert.match(app, /path="\/legal\/terms"/);
  assert.match(app, /path="\/legal\/privacy"/);
  assert.match(app, /path="\/s\/:slug"/);
  assert.match(app, /SurveyStudioPage/);
  assert.match(app, /SocialListeningPage/);
  assert.match(app, /JourneysPage/);
  assert.match(app, /path="\/campaigns"/);
  assert.match(app, /path="\/campaigns\/:id"/);
});
test('exposes an X connector, Terra social analysis, and journey mapping as first-class workspaces', () => {
  const social = fs.readFileSync(path.join(source, 'pages', 'SocialListeningPage.tsx'), 'utf8');
  const journeys = fs.readFileSync(path.join(source, 'pages', 'JourneysPage.tsx'), 'utf8');
  assert.match(social, /\/api\/integrations\/x\/mentions/);
  for (const endpoint of ['/api/integrations/x', '/api/integrations/x/connect', '/api/integrations/x/sync', '/api/integrations/x/queries']) assert.match(social, new RegExp(endpoint.replaceAll('/', '\\/')));
  for (const feature of ['Connect with X', 'Reconnect with X', 'Listening queries', 'Sync history', 'Automatic sync', 'Bearer token', 'Delete X history', 'Remove X developer app', 'Cancelled']) assert.match(social, new RegExp(feature));
  assert.match(social, /Promise\.allSettled/);
  assert.match(social, /setCredentialDialogOpen/);
  assert.match(social, /\/api\/integrations\/x\/history/);
  assert.doesNotMatch(social, /Import pasted text|Choose CSV, JSON or TXT/);
  assert.match(journeys, /\/api\/ai\/journeys/);
  assert.match(journeys, /Journey stages/);
  assert.match(journeys, /Audit and improve/);
});
test('publishes public X-aware terms and privacy links at authentication surfaces', () => {
  const legal = fs.readFileSync(path.join(source, 'pages', 'LegalPage.tsx'), 'utf8');
  const login = fs.readFileSync(path.join(source, 'pages', 'LoginPage.tsx'), 'utf8');
  const signup = fs.readFileSync(path.join(source, 'pages', 'SignupPage.tsx'), 'utf8');
  for (const phrase of ['X credentials and data', 'Terms of Service', 'Privacy Policy', 'support@seemplify.com']) assert.match(legal, new RegExp(phrase));
  for (const page of [login, signup]) { assert.match(page, /\/legal\/terms/); assert.match(page, /\/legal\/privacy/); }
});
test('ships a survey-specific email campaign workspace with audience, sequencing and delivery history', () => {
  const list = fs.readFileSync(path.join(source, 'pages', 'CampaignsPage.tsx'), 'utf8');
  const workspace = fs.readFileSync(path.join(source, 'pages', 'CampaignWorkspacePage.tsx'), 'utf8');
  const contactImport = fs.readFileSync(path.join(source, 'lib', 'contactImport.ts'), 'utf8');
  assert.match(list, /\/api\/campaigns/);
  assert.doesNotMatch(list, /surveyRows\[0\]/);
  assert.match(list, /No survey is selected automatically/);
  for (const section of ['Setup', 'Audience', 'Sequence', 'Schedule', 'Review', 'Activity']) assert.match(workspace, new RegExp(section));
  assert.match(workspace, /Plain text \(recommended\)/);
  assert.match(workspace, /Load sequence template/);
  assert.match(workspace, /Embed a question/);
  assert.match(workspace, /Stop follow-ups after a response/);
  assert.match(workspace, /Secured provider events then update delivery/);
  assert.match(workspace, /providerStatus/);
  assert.match(workspace, /campaign-settings-survey/);
  assert.match(workspace, /surveyId: selectedSurveyId/);
  assert.match(workspace, /Start time required/);
  assert.match(workspace, /Set a campaign start time/);
  assert.match(workspace, /aria-required="true"/);
  assert.match(workspace, /Review and launch/);
  assert.match(workspace, /forceMount/);
  for (const contactFeature of ['Add person', 'Job title \/ position', 'Add custom field', 'Import an audience list']) assert.match(workspace, new RegExp(contactFeature));
  assert.match(contactImport, /jobTitle/);
  assert.match(contactImport, /customData/);
  assert.match(contactImport, /knownIndexes/);
});
test('keeps every Experience AI action visible in the survey workspace', () => {
  const ai = fs.readFileSync(path.join(source, 'components', 'survey', 'AiTab.tsx'), 'utf8');
  for (const action of ['improve', 'insights', 'report', 'translate', 'ask']) assert.match(ai, new RegExp(`['\"]${action}['\"]`));
});
test('recovers a stale lazy-loaded deployment asset at most once per recovery window', () => {
  const main = fs.readFileSync(path.join(source, 'main.tsx'), 'utf8');
  assert.match(main, /vite:preloadError/);
  assert.match(main, /event\.preventDefault\(\)/);
  assert.match(main, /STALE_ASSET_RECOVERY_WINDOW_MS = 60_000/);
  assert.match(main, /sessionStorage\.getItem\(STALE_ASSET_RECOVERY_KEY/);
  assert.match(main, /sessionStorage\.setItem\(STALE_ASSET_RECOVERY_KEY/);
  assert.ok(main.indexOf('vite:preloadError') < main.indexOf('createRoot('));
  assert.match(main, /window\.location\.reload\(\)/);
});
test('retains versioned assets before an isolated release becomes active', () => {
  const deploy = fs.readFileSync(path.resolve(source, '..', '..', 'scripts', 'auto-deploy.ps1'), 'utf8');
  assert.match(deploy, /function Merge-RetainedFrontendAssets/);
  assert.match(deploy, /Copy-Item -LiteralPath \$file\.FullName/);
  const build = deploy.indexOf('& npm.cmd run build');
  const merge = deploy.indexOf('Merge-RetainedFrontendAssets -ReleaseProject $releaseProject', build);
  const activate = deploy.indexOf('Set-Content -LiteralPath $ActiveProjectFile', merge);
  assert.ok(build >= 0 && merge > build && activate > merge);
});
test('ships the extended question library and executable respondent logic', () => {
  const types = fs.readFileSync(path.join(source, 'types.ts'), 'utf8');
  const respondent = fs.readFileSync(path.join(source, 'pages', 'PublicSurveyPage.tsx'), 'utf8');
  for (const type of ['dropdown', 'multi_nps', 'multi_text', 'graphical_rating']) assert.match(types, new RegExp(`['"]${type}['"]`));
  for (const action of ['show', 'hide', 'skip_to']) assert.match(respondent, new RegExp(`['"]${action}['"]`));
});
test('makes survey questions visibly selectable and accessibly draggable', () => {
  const builder = fs.readFileSync(path.join(source, 'components', 'survey', 'BuilderTab.tsx'), 'utf8');
  for (const feature of ['DndContext', 'PointerSensor', 'KeyboardSensor', 'sortableKeyboardCoordinates', 'SortableContext', 'DragOverlay']) assert.match(builder, new RegExp(feature));
  assert.match(builder, /aria-pressed=\{active\}/);
  assert.match(builder, /data-selected=\{active \? 'true' : 'false'\}/);
  assert.match(builder, /Question \{selectedIndex \+ 1\} settings/);
  assert.match(builder, /Drag \$\{definition\.label\} into the question list/);
  assert.match(builder, /destinationPage = questions\[to\]\.page/);
  assert.match(builder, /page: destinationPage/);
});

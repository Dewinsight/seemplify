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
  assert.match(app, /IntelligencePage/);
  assert.match(app, /PersonalAssistantPage/);
  assert.match(app, /JourneysPage/);
  assert.match(app, /path="\/intelligence"/);
  assert.match(app, /path="\/assistant"/);
  assert.match(app, /path="\/campaigns"/);
  assert.match(app, /path="\/campaigns\/:id"/);
  assert.match(app, /path="\/agreements"/);
  assert.match(app, /path="\/agreements\/:id"/);
  assert.match(app, /path="\/agreements\/:id\/prepare"/);
  assert.match(app, /path="\/sign"/);
  assert.match(app, /CertificateVerificationPage/);
  assert.match(app, /path="\/join\/:token"/);
  assert.match(app, /path="\/settings\/space"/);
});
test('keeps the Experience personal assistant private, durable, grounded, and human reviewed', () => {
  const assistant = fs.readFileSync(path.join(source, 'pages', 'PersonalAssistantPage.tsx'), 'utf8');
  const shell = fs.readFileSync(path.join(source, 'components', 'AppShell.tsx'), 'utf8');
  for (const endpoint of [
    '/api/assistant/overview', '/api/assistant/threads', '/api/assistant/runs'
  ]) assert.match(assistant, new RegExp(endpoint.replaceAll('/', '\\/')));
  for (const activity of ['email-summary', 'email-draft', 'knowledge-answer']) assert.match(assistant, new RegExp(activity));
  for (const feature of [
    'Personal assistant', 'Mailbox connections', 'Workspace knowledge', 'Assistant history',
    'Draft only — nothing has been sent', 'Original generation is retained for audit',
    'The selected evidence is snapshotted before queueing', 'Private to your account within the active space'
  ]) assert.match(assistant, new RegExp(feature));
  assert.doesNotMatch(assistant, />Send<|name="Send"|\/send/);
  assert.match(shell, /label: 'Personal assistant'/);
});
test('keeps space selection, membership management, invitations, uploads, and live events tenant-aware', () => {
  const api = fs.readFileSync(path.join(source, 'lib', 'api.ts'), 'utf8');
  const shell = fs.readFileSync(path.join(source, 'components', 'AppShell.tsx'), 'utf8');
  const settings = fs.readFileSync(path.join(source, 'pages', 'SpaceSettingsPage.tsx'), 'utf8');
  const join = fs.readFileSync(path.join(source, 'pages', 'JoinSpacePage.tsx'), 'utf8');
  const signup = fs.readFileSync(path.join(source, 'pages', 'SignupPage.tsx'), 'utf8');
  const live = fs.readFileSync(path.join(source, 'hooks', 'useLiveRefresh.ts'), 'utf8');
  const publicSurvey = fs.readFileSync(path.join(source, 'pages', 'PublicSurveyPage.tsx'), 'utf8');
  for (const feature of ['x-seemplify-space', 'BroadcastChannel', 'SPACE_ACCESS_DENIED', 'storeActiveSpaceId']) assert.match(api, new RegExp(feature));
  for (const feature of ['Active space', 'Create space', 'Space settings', 'session?.user?.email']) assert.match(shell, new RegExp(feature.replaceAll('?', '\\?')));
  for (const endpoint of ['/api/spaces', '/members', '/invitations']) assert.match(settings, new RegExp(endpoint.replaceAll('/', '\\/')));
  for (const feature of ['Only people listed here', 'Personal', 'pending invitation', 'Remove']) assert.match(settings, new RegExp(feature, 'i'));
  assert.match(join, /\/api\/public\/spaces\/invitations/);
  assert.match(join, /\/accept/);
  assert.match(signup, /spaceName/);
  assert.match(signup, /inviteToken/);
  assert.match(live, /spaceId=/);
  assert.match(publicSurvey, /\/api\/public\/collectors\/\$\{encodeURIComponent\(collectorSlug\)\}\/uploads/);
  assert.doesNotMatch(publicSurvey, /api\('\/api\/uploads/);
});
test('ships the native agreement preparation and signing workspaces', () => {
  const shell = fs.readFileSync(path.join(source, 'components', 'AppShell.tsx'), 'utf8');
  const workspace = fs.readFileSync(path.join(source, 'pages', 'AgreementWorkspacePage.tsx'), 'utf8');
  const prepare = fs.readFileSync(path.join(source, 'pages', 'AgreementPreparePage.tsx'), 'utf8');
  const fields = fs.readFileSync(path.join(source, 'components', 'esign', 'AgreementFieldsStep.tsx'), 'utf8');
  const editor = fs.readFileSync(path.join(source, 'components', 'esign', 'PdfAgreementEditor.tsx'), 'utf8');
  const signing = fs.readFileSync(path.join(source, 'pages', 'PublicSigningPage.tsx'), 'utf8');
  assert.match(shell, /Agreements/);
  for (const section of ['Documents', 'Recipients', 'Fields', 'Message', 'Review']) assert.match(workspace, new RegExp(section));
  for (const activity of ['Recipient progress', 'Email delivery', 'retry-finalization', 'Retry finalization']) assert.match(workspace, new RegExp(activity));
  for (const feature of ['Agreement preparation', 'Next:', 'Review and send', 'fieldDirty']) assert.match(workspace, new RegExp(feature));
  assert.match(prepare, /step=fields/);
  for (const feature of ['PdfAgreementEditor', 'Save fields', 'Unsaved changes']) assert.match(fields, new RegExp(feature));
  for (const feature of ['pdfjs-dist', 'DndContext', 'PointerSensor', 'KeyboardSensor', 'DragOverlay', 'placementType']) assert.match(editor, new RegExp(feature));
  for (const feature of ['access-code', 'consent', 'SignatureCanvas', 'Next required', 'Decline agreement', 'Finish']) assert.match(signing, new RegExp(feature));
});
test('exposes multi-account X listening, human-reviewed replies, cross-source intelligence, and journey mapping', () => {
  const social = fs.readFileSync(path.join(source, 'pages', 'SocialListeningPage.tsx'), 'utf8');
  const intelligence = fs.readFileSync(path.join(source, 'pages', 'IntelligencePage.tsx'), 'utf8');
  const journeys = fs.readFileSync(path.join(source, 'pages', 'JourneysPage.tsx'), 'utf8');
  const shell = fs.readFileSync(path.join(source, 'components', 'AppShell.tsx'), 'utf8');
  for (const endpoint of ['/api/integrations/x', '/api/integrations/x/connect', '/api/integrations/x/mentions', '/api/social/reports', '/api/social/reply-drafts']) assert.match(social, new RegExp(endpoint.replaceAll('/', '\\/')));
  assert.match(social, /connections\/\$\{connection\.id\}\/sync/);
  assert.match(social, /connections\/\$\{connection\.id\}\/queries/);
  assert.match(social, /mentions\/\$\{replyMention\.id\}\/reply-drafts/);
  for (const feature of ['X accounts', 'Add X account', 'X API credits are depleted', 'Listening queries', 'Reply assistant', 'Draft a reply with Terra', 'Draft only', 'Sync history', 'Automatic sync', 'Bearer token', 'Delete X history', 'Platform X settings', 'Remove platform X app', 'waiting_billing']) assert.match(social, new RegExp(feature));
  assert.match(social, /Promise\.allSettled/);
  assert.match(social, /selectedConnectionId/);
  assert.match(social, /selectedConnectionRef/);
  assert.doesNotMatch(social, /Import pasted text|Choose CSV, JSON or TXT/);
  for (const endpoint of ['/api/intelligence/sources', '/api/intelligence/reports']) assert.match(intelligence, new RegExp(endpoint.replaceAll('/', '\\/')));
  for (const feature of ['Build an analysis', 'Choose 2', 'Source snapshots are captured', 'Survey reports', 'Social reports', 'Run analysis', 'Executive summary', 'Where sources converge', 'Where sources diverge', 'Limitations']) assert.match(intelligence, new RegExp(feature));
  assert.match(intelligence, /selectedRefs\.length < 2/);
  assert.match(intelligence, /current\.length < 12/);
  assert.match(shell, /label: 'Intelligence'/);
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
test('focuses the survey workspace on saved intelligence instead of translation', () => {
  const ai = fs.readFileSync(path.join(source, 'components', 'survey', 'AiTab.tsx'), 'utf8');
  for (const action of ['improve', 'insights', 'report', 'ask']) assert.match(ai, new RegExp(`['\"]${action}['\"]`));
  assert.doesNotMatch(ai, /run\(['\"]translate['\"]/);
  assert.doesNotMatch(ai, /French/);
  assert.match(ai, /Saved survey intelligence/);
  assert.match(ai, /IntelligenceOutput/);
  assert.match(ai, /research_answer/);
  assert.match(ai, /knowledge_entry/);
  assert.match(ai, /Add to knowledge base/);
  assert.match(ai, /Answers are saved automatically/);
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

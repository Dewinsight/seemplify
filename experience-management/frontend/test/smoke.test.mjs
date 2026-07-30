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
  assert.match(app, /path="\/my-documents"/);
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
    'The selected evidence is snapshotted before queueing', 'Private to your account within the active space',
    'connectedConnectionIds', "connection.status === 'connected'", 'This connection is inactive'
  ]) assert.match(assistant, new RegExp(feature));
  assert.doesNotMatch(assistant, />Send<|name="Send"|\/send/);
  assert.match(shell, /label: 'Personal assistant'/);
});
test('keeps the populated dashboard table inside its responsive grid track', () => {
  const dashboard = fs.readFileSync(path.join(source, 'pages', 'DashboardPage.tsx'), 'utf8');
  assert.match(dashboard, /grid min-w-0 items-start/);
  assert.match(dashboard, /Card className="min-w-0"/);
  assert.match(dashboard, /CardContent className="min-w-0 px-0 pb-0"/);
  assert.match(dashboard, /max-w-full overflow-x-auto/);
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
  const agreements = fs.readFileSync(path.join(source, 'pages', 'AgreementsPage.tsx'), 'utf8');
  const workspace = fs.readFileSync(path.join(source, 'pages', 'AgreementWorkspacePage.tsx'), 'utf8');
  const prepare = fs.readFileSync(path.join(source, 'pages', 'AgreementPreparePage.tsx'), 'utf8');
  const fields = fs.readFileSync(path.join(source, 'components', 'esign', 'AgreementFieldsStep.tsx'), 'utf8');
  const editor = fs.readFileSync(path.join(source, 'components', 'esign', 'PdfAgreementEditor.tsx'), 'utf8');
  const signing = fs.readFileSync(path.join(source, 'pages', 'PublicSigningPage.tsx'), 'utf8');
  const recipientDocuments = fs.readFileSync(path.join(source, 'pages', 'MyDocumentsPage.tsx'), 'utf8');
  const recipientDocumentLibrary = fs.readFileSync(path.join(source, 'components', 'esign', 'RecipientDocumentLibrary.tsx'), 'utf8');
  assert.match(shell, /Agreements/);
  for (const section of ['Documents', 'Recipients', 'Fields', 'Message', 'Review']) assert.match(workspace, new RegExp(section));
  for (const activity of ['Recipient progress', 'Email delivery', 'retry-finalization', 'Retry finalization']) assert.match(workspace, new RegExp(activity));
  for (const feature of ['Agreement preparation', 'Next:', 'Review and send', 'fieldDirty']) assert.match(workspace, new RegExp(feature));
  assert.match(prepare, /step=fields/);
  for (const feature of ['PdfAgreementEditor', 'Save fields', 'Unsaved changes']) assert.match(fields, new RegExp(feature));
  for (const feature of ['pdfjs-dist', 'DndContext', 'PointerSensor', 'KeyboardSensor', 'DragOverlay', 'placementType']) assert.match(editor, new RegExp(feature));
  for (const feature of ['access-code', 'consent', 'SignatureCanvas', 'Next required', 'Decline agreement', 'Finish']) assert.match(signing, new RegExp(feature));
  for (const feature of ['Create optional account', 'An account is not required', 'Keep your signed documents together']) assert.match(signing, new RegExp(feature));
  assert.match(recipientDocuments, /My documents/);
  for (const feature of ['/api/recipient-documents', 'Waiting for others', 'Completed document', 'Completion certificate']) assert.match(recipientDocumentLibrary, new RegExp(feature.replaceAll('/', '\\/')));
  for (const view of ['Sent by this space', 'Signed by me']) assert.match(agreements, new RegExp(view));
  assert.match(agreements, /RecipientDocumentLibrary/);
  assert.match(recipientDocuments, /RecipientDocumentLibrary/);
  assert.match(agreements, /across (?:every|all) space/i);
  assert.match(shell, /My signed documents/);
  assert.doesNotMatch(recipientDocumentLibrary, /spaceScopedApiUrl|X-Seemplify-Space/);
});
test('exposes multi-account X listening, human-reviewed replies, cross-source intelligence, and journey mapping', () => {
  const social = fs.readFileSync(path.join(source, 'pages', 'SocialListeningPage.tsx'), 'utf8');
  const intelligence = fs.readFileSync(path.join(source, 'pages', 'IntelligencePage.tsx'), 'utf8');
  const journeys = fs.readFileSync(path.join(source, 'pages', 'JourneysPage.tsx'), 'utf8');
  const shell = fs.readFileSync(path.join(source, 'components', 'AppShell.tsx'), 'utf8');
  for (const endpoint of ['/api/integrations/x', '/api/integrations/x/connect', '/api/integrations/x/mentions', '/api/social/reports', '/api/social/reply-drafts']) assert.match(social, new RegExp(endpoint.replaceAll('/', '\\/')));
  assert.match(social, /connections\/\$\{connection\.id\}\/sync/);
  assert.match(social, /connections\/\$\{selectedConnectionId\}\/expansion-estimate/);
  assert.match(social, /connections\/\$\{connection\.id\}\/expand/);
  assert.match(social, /planFingerprint: expansionEstimate\.planFingerprint/);
  assert.match(social, /connections\/\$\{connection\.id\}\/queries/);
  assert.match(social, /mentions\/\$\{replyMention\.id\}\/reply-drafts/);
  for (const feature of ['X accounts', 'Add X account', 'X API credits are depleted', 'Sync latest 50', 'posts saved in this space', 'Estimate &amp; fetch older', 'Fetch older posts from X', 'Payable-post upper bound', 'Latest 50 saved (default)', 'Show {Math.min', 'Listening queries', 'Reply assistant', 'Draft a reply with Terra', 'Draft only', 'Sync history', 'Automatic sync', 'Bearer token', 'Delete X history', 'Platform X settings', 'Remove platform X app', 'waiting_billing']) assert.match(social, new RegExp(feature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(social, /mentionIds: reportMentionIds/);
  assert.doesNotMatch(social, /latest 200 posts/);
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
  const authLayout = fs.readFileSync(path.join(source, 'components', 'auth', 'AuthLayout.tsx'), 'utf8');
  for (const phrase of ['X credentials and data', 'Terms of Service', 'Privacy Policy', 'support@seemplify.com']) assert.match(legal, new RegExp(phrase));
  for (const page of [login, signup]) assert.match(page, /AuthLayout/);
  assert.match(authLayout, /\/legal\/terms/);
  assert.match(authLayout, /\/legal\/privacy/);
});
test('ships branded authentication, verified signup, onboarding, and profile management', () => {
  const app = fs.readFileSync(path.join(source, 'App.tsx'), 'utf8');
  const layout = fs.readFileSync(path.join(source, 'components', 'auth', 'AuthLayout.tsx'), 'utf8');
  const brand = fs.readFileSync(path.join(source, 'components', 'brand', 'ExperienceBrand.tsx'), 'utf8');
  const signup = fs.readFileSync(path.join(source, 'pages', 'SignupPage.tsx'), 'utf8');
  const verification = fs.readFileSync(path.join(source, 'pages', 'EmailVerificationPage.tsx'), 'utf8');
  const passwordSetup = fs.readFileSync(path.join(source, 'pages', 'ResetPasswordPage.tsx'), 'utf8');
  const onboarding = fs.readFileSync(path.join(source, 'pages', 'OnboardingPage.tsx'), 'utf8');
  const profile = fs.readFileSync(path.join(source, 'pages', 'ProfilePage.tsx'), 'utf8');
  const shell = fs.readFileSync(path.join(source, 'components', 'AppShell.tsx'), 'utf8');
  for (const route of ['/verify-email', '/onboarding', '/settings/profile']) assert.match(app, new RegExp(route.replaceAll('/', '\\/')));
  for (const asset of ['/images/auth-research.webp', '/images/auth-listening.webp']) assert.match(layout, new RegExp(asset.replaceAll('/', '\\/')));
  assert.match(brand, /Experience Management/);
  assert.match(brand, /experience-mark\.png/);
  assert.doesNotMatch(brand, /Experience management, simplified\./);
  assert.match(signup, /EMAIL_VERIFICATION_REQUIRED/);
  assert.match(signup, /formStep/);
  assert.match(signup, /delivery=failed/);
  assert.match(verification, /\/api\/auth\/verify-email/);
  assert.match(verification, /\/api\/auth\/resend-verification/);
  assert.match(verification, /deliveryFailed/);
  for (const claimFeature of ['claimPasswordRequired', 'passwordSetupToken', 'claim=1']) assert.match(verification, new RegExp(claimFeature));
  assert.match(verification, /Confirm email address/);
  assert.match(verification, /experience:password-setup-token/);
  assert.doesNotMatch(verification, /reset-password\?token=/);
  assert.match(passwordSetup, /isAccountClaim/);
  assert.match(passwordSetup, /Secure your account/);
  assert.match(onboarding, /\/api\/account\/onboarding/);
  assert.match(profile, /\/api\/account\/profile/);
  assert.match(shell, /nextSession\.onboardingRequired/);
  assert.match(shell, /to="\/settings\/profile"/);
  assert.match(shell, /function Brand\(\)[\s\S]*?\/brand\/experience-mark\.png/);
  for (const invitationFeature of ['pendingSpaceInvitations', 'Space invitation', 'content remains private until then', 'Accept invitation to', '/api/account/space-invitations/']) {
    assert.match(shell, new RegExp(invitationFeature.replaceAll('/', '\\/')));
  }
  for (const asset of ['brand/experience-mark.png', 'images/auth-research.webp', 'images/auth-listening.webp']) {
    assert.ok(fs.statSync(path.resolve(source, '..', 'public', asset)).size > 5_000);
  }
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
  assert.match(workspace, /Sender display name/);
  assert.match(workspace, /senderName/);
  assert.match(workspace, /senderEmail/);
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
test('ships explicit knowledge grounding with durable indexing, retrieval citations, and graph provenance', () => {
  const app = fs.readFileSync(path.join(source, 'App.tsx'), 'utf8');
  const shell = fs.readFileSync(path.join(source, 'components', 'AppShell.tsx'), 'utf8');
  const picker = fs.readFileSync(path.join(source, 'components', 'knowledge', 'KnowledgeBasePicker.tsx'), 'utf8');
  const list = fs.readFileSync(path.join(source, 'pages', 'KnowledgeBasesPage.tsx'), 'utf8');
  const workspace = fs.readFileSync(path.join(source, 'pages', 'KnowledgeBaseWorkspacePage.tsx'), 'utf8');
  const knowledgeApi = fs.readFileSync(path.join(source, 'lib', 'knowledgeBases.ts'), 'utf8');
  const api = fs.readFileSync(path.join(source, 'lib', 'api.ts'), 'utf8');
  const live = fs.readFileSync(path.join(source, 'hooks', 'useLiveRefresh.ts'), 'utf8');
  const createSurvey = fs.readFileSync(path.join(source, 'pages', 'CreateSurveyPage.tsx'), 'utf8');
  const surveyAi = fs.readFileSync(path.join(source, 'components', 'survey', 'AiTab.tsx'), 'utf8');
  const intelligence = fs.readFileSync(path.join(source, 'pages', 'IntelligencePage.tsx'), 'utf8');
  const journeys = fs.readFileSync(path.join(source, 'pages', 'JourneysPage.tsx'), 'utf8');

  assert.match(app, /path="\/knowledge-bases"/);
  assert.match(app, /path="\/knowledge-bases\/:id"/);
  assert.match(shell, /label: 'Knowledge bases'/);
  for (const feature of ['New knowledge base', 'Allow as Terra context', 'Everyone in this space', 'Private to me']) assert.match(list, new RegExp(feature));
  for (const feature of ['Drop files here', 'Upload and index', 'Search & test', 'Citations', 'Graph & provenance', 'Relationship provenance', 'Indexing history', 'Durable attempts remain visible']) assert.match(workspace, new RegExp(feature));
  for (const endpoint of ['/api/knowledge-bases', '/documents', '/indexing-jobs', '/search', '/graph']) assert.match(knowledgeApi, new RegExp(endpoint.replaceAll('/', '\\/')));
  assert.match(api, /export function multipart/);
  assert.match(knowledgeApi, /multipart\('POST', body\)/);
  assert.match(live, /knowledge-base/);
  assert.match(live, /knowledge-job/);
  assert.match(live, /knowledge-indexing-job/);

  assert.match(picker, /max = 5/);
  assert.match(picker, /Nothing is selected automatically/);
  assert.match(picker, /item\.privacy === 'space'/);
  assert.doesNotMatch(picker, /knowledgeBases\[0\]/);
  assert.match(list, /terraContextEnabled: false/);
  assert.match(list, /relevant excerpts may be sent to the Terra local-cloud runtime/);
  assert.match(workspace, /\.png,\.jpg,\.jpeg,\.tif,\.tiff/);
  assert.doesNotMatch(workspace, /\.doc,\.docx|\.ppt,\.pptx|\.xls,\.xlsx|\.rtf|\.json/);
  for (const consumer of [createSurvey, intelligence, journeys]) {
    assert.match(consumer, /useState<string\[\]>\(\[\]\)/);
    assert.match(consumer, /knowledgeBaseIds/);
    assert.match(consumer, /KnowledgeBasePicker/);
  }
  assert.match(surveyAi, /useState<string\[\] \| null>\(null\)/);
  assert.match(surveyAi, /\/knowledge-bases`,\s*json\('PUT', \{ knowledgeBaseIds: nextIds \}\)/);
  assert.match(surveyAi, /knowledgeBaseIds === null \? body : \{ \.\.\.body, knowledgeBaseIds \}/);
  assert.match(picker, /Uses a different embedding profile/);
  assert.match(surveyAi, /requestId !== insightRequestRef\.current/);
  assert.match(surveyAi, /aria-expanded=\{expanded\}/);
  assert.match(surveyAi, /<TranslationDetails/);
  assert.match(surveyAi, /await loadInsights\(savedInsightKind\[path\]\)/);

  for (const deterministicFile of [
    path.join(source, 'components', 'survey', 'AnalyticsTab.tsx'),
    path.join(source, 'pages', 'CampaignWorkspacePage.tsx'),
    path.join(source, 'pages', 'AgreementWorkspacePage.tsx')
  ]) {
    const deterministicSource = fs.readFileSync(deterministicFile, 'utf8');
    assert.doesNotMatch(deterministicSource, /KnowledgeBasePicker|knowledgeBaseIds/);
  }
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
test('refuses an incompatible rollback after the PostgreSQL runtime-v4 upgrade starts', () => {
  const deploy = fs.readFileSync(path.resolve(source, '..', '..', 'scripts', 'auto-deploy.ps1'), 'utf8');
  assert.match(deploy, /Test-ProjectSupportsPostgresRuntimeVersion \$previousProject 4/);
  assert.doesNotMatch(deploy, /Test-ProjectSupportsPostgresRuntimeVersion \$previousProject 2/);
  assert.match(deploy, /started runtime-4 upgrade/);
});
test('ships the extended question library and executable respondent logic', () => {
  const types = fs.readFileSync(path.join(source, 'types.ts'), 'utf8');
  const respondent = fs.readFileSync(path.join(source, 'pages', 'PublicSurveyPage.tsx'), 'utf8');
  for (const type of ['dropdown', 'multi_nps', 'multi_text', 'graphical_rating']) assert.match(types, new RegExp(`['"]${type}['"]`));
  for (const action of ['show', 'hide', 'skip_to']) assert.match(respondent, new RegExp(`['"]${action}['"]`));
});
test('ships a complete manual service recovery workflow', () => {
  const tickets = fs.readFileSync(path.join(source, 'pages', 'TicketsPage.tsx'), 'utf8');
  const types = fs.readFileSync(path.join(source, 'types.ts'), 'utf8');
  for (const feature of [
    'New recovery case', "api<RecoveryTicket[]>('/api/tickets')", "api<RecoveryTicketDetail>('/api/tickets'",
    'Search recovery cases', 'Filter by status', 'Customer and response context', 'Activity', 'Reopen case',
    'setResponses([])', 'Responses unavailable', 'Loading recovery case', '!loaded ? null'
  ]) assert.match(tickets, new RegExp(feature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  assert.match(tickets, /item\.responseId \?/);
  assert.match(types, /interface RecoveryTicketDetail extends RecoveryTicket/);
  assert.match(types, /events: RecoveryTicketEvent\[\]/);
});
test('ships capability-scoped platform administration and subscription controls', () => {
  const app = fs.readFileSync(path.join(source, 'App.tsx'), 'utf8');
  const shell = fs.readFileSync(path.join(source, 'components', 'platform-admin', 'PlatformAdminShell.tsx'), 'utf8');
  const user = fs.readFileSync(path.join(source, 'pages', 'platform-admin', 'UserDetailPage.tsx'), 'utf8');
  const subscriptions = fs.readFileSync(path.join(source, 'pages', 'platform-admin', 'SubscriptionsPage.tsx'), 'utf8');
  const requestDetail = fs.readFileSync(path.join(source, 'pages', 'platform-admin', 'SubscriptionRequestDetailPage.tsx'), 'utf8');
  const analytics = fs.readFileSync(path.join(source, 'pages', 'platform-admin', 'AnalyticsPage.tsx'), 'utf8');
  for (const capability of ['readUsers', 'readSpaces', 'readSubscriptions', 'readAnalytics', 'readAudit']) assert.match(shell, new RegExp(capability));
  assert.match(shell, /routeAllowed/);
  assert.match(app, /\/admin\/subscriptions/);
  assert.match(subscriptions, /\/api\/platform-admin\/subscriptions/);
  assert.match(user, /Grant role/);
  assert.match(user, /Revoke .* role/);
  assert.match(user, /manageRoles/);
  assert.match(requestDetail, /Use root break-glass approval/);
  assert.match(requestDetail, /breakGlass:/);
  assert.match(analytics, /<Legend/);
  assert.match(analytics, /View accessible daily data/);
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
test('ships persistent section tutorials with every referenced lesson image', () => {
  const shell = fs.readFileSync(path.join(source, 'components', 'AppShell.tsx'), 'utf8');
  const component = fs.readFileSync(path.join(source, 'components', 'tutorials', 'SectionTutorial.tsx'), 'utf8');
  const registry = fs.readFileSync(path.join(source, 'lib', 'tutorials.ts'), 'utf8');
  assert.match(shell, /SectionTutorial/);
  assert.match(shell, /tutorialForPath\(location\.pathname\)/);
  assert.match(shell, /max-\[439px\]:sr-only/);
  assert.match(shell, /min-w-0 truncate text-sm font-semibold/);
  for (const feature of ['/api/tutorials/progress', 'Maybe later', 'Previous', 'Next', 'Finish tutorial', 'aria-label="Tutorial"']) {
    assert.match(component, new RegExp(feature.replaceAll('/', '\\/')));
  }
  assert.match(component, /sm:max-w-\[960px\]/);
  assert.match(component, /overflow-x-hidden/);
  assert.match(component, /data-section-tutorial-open/);
  const keys = ['overview', 'surveys', 'campaigns', 'agreements', 'social-listening', 'intelligence', 'knowledge-bases', 'journey-maps', 'ai-queue', 'service-recovery', 'space-settings'];
  for (const key of keys) {
    assert.match(registry, new RegExp(`key: ['"]${key}['"]`));
    const image = path.resolve(source, '..', 'public', 'tutorials', `${key}.png`);
    assert.ok(fs.existsSync(image), `tutorial image is missing for ${key}`);
    assert.ok(fs.statSync(image).size > 5_000, `tutorial image is unexpectedly small for ${key}`);
  }
});

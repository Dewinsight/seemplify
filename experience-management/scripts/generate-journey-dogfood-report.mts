import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

type SqlRow = Record<string, unknown>;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '..');
const repositoryDir = path.resolve(projectDir, '..');
const runtimeDir = path.join(repositoryDir, '.local-runtime', 'experience-management');
const postgresCutoverMarker = path.join(runtimeDir, 'postgres-cutover-v1');
const postgresPasswordFile = path.join(runtimeDir, 'postgres-password');

function latestRuntimeSchemaVersionFromMarkers(baseDir: string) {
  if (!fs.existsSync(baseDir)) return null;
  let maximum: number | null = null;
  for (const name of fs.readdirSync(baseDir)) {
    const match = /^postgres-runtime-schema-v(\d+)-started$/u.exec(name);
    if (!match) continue;
    const value = Number.parseInt(match[1] || '', 10);
    if (!Number.isFinite(value)) continue;
    maximum = maximum === null ? value : Math.max(maximum, value);
  }
  return maximum;
}

if (!process.env.DATABASE_PROVIDER && fs.existsSync(postgresCutoverMarker) && fs.existsSync(postgresPasswordFile)) {
  process.env.DATABASE_PROVIDER = 'postgres';
  process.env.POSTGRES_HOST = process.env.POSTGRES_HOST || '127.0.0.1';
  process.env.POSTGRES_PORT = process.env.POSTGRES_PORT || '5432';
  process.env.POSTGRES_DATABASE = process.env.POSTGRES_DATABASE || 'seemplify_experience';
  process.env.POSTGRES_USER = process.env.POSTGRES_USER || 'seemplify_experience_app';
  process.env.POSTGRES_PASSWORD_FILE = process.env.POSTGRES_PASSWORD_FILE || '../../.local-runtime/experience-management/postgres-password';
  process.env.POSTGRES_SSL = process.env.POSTGRES_SSL || 'false';
  process.env.POSTGRES_SCHEMA_VERSION = process.env.POSTGRES_SCHEMA_VERSION || '1';
  const runtimeVersion = latestRuntimeSchemaVersionFromMarkers(runtimeDir);
  if (runtimeVersion !== null && !process.env.POSTGRES_RUNTIME_SCHEMA_VERSION) {
    process.env.POSTGRES_RUNTIME_SCHEMA_VERSION = String(runtimeVersion);
  }
}

const [{ config }, { getAiProviderState }, { stopCodexClients }, { db }] = await Promise.all([
  import('../backend/src/config.ts'),
  import('../backend/src/aiProvider.ts'),
  import('../backend/src/codexAppServer.ts'),
  import('../backend/src/database.ts')
]);

function parseJson<T>(value: unknown, fallback: T): T {
  try { return value ? JSON.parse(String(value)) as T : fallback; }
  catch { return fallback; }
}

function iso(value: unknown) {
  const text = String(value || '').trim();
  return text && Number.isFinite(Date.parse(text)) ? text : null;
}

function optionalString(value: unknown) {
  const text = String(value || '').trim();
  return text || null;
}

function ensureDirectory(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function safeRuntimeKey(userId: string) {
  return crypto.createHash('sha256').update(`experience-codex:${userId}`).digest('hex');
}

function tableExists(tableName: string) {
  if (db.provider === 'postgres') {
    const row = db.prepare(`SELECT 1 AS present
      FROM pg_tables
      WHERE schemaname='public' AND tablename=?
      LIMIT 1`).get(tableName) as SqlRow | undefined;
    return Boolean(row?.present);
  }
  const row = db.prepare(`SELECT 1 AS present
    FROM sqlite_master
    WHERE type='table' AND name=?
    LIMIT 1`).get(tableName) as SqlRow | undefined;
  return Boolean(row?.present);
}

const now = new Date().toISOString();
const outputDir = path.join(projectDir, 'docs', 'journey-management', 'dogfood');
const jsonPath = path.join(outputDir, 'latest-activation-report.json');
const markdownPath = path.join(outputDir, 'latest-activation-report.md');
const providerPreferencePath = path.join(config.codexRuntimeDir, 'provider-preferences.json');
const providerPreferenceFileExists = fs.existsSync(providerPreferencePath);
const providerPreferenceFile = providerPreferenceFileExists
  ? parseJson<{ preferences?: Record<string, Record<string, unknown>> }>(
    fs.readFileSync(providerPreferencePath, 'utf8'),
    {}
  )
  : {};

const users = (db.prepare(`SELECT u.id,u.email,u.name,u.created_at,u.email_verified_at,
    profile.onboarding_completed_at
  FROM users u
  LEFT JOIN user_profiles profile ON profile.user_id=u.id
  ORDER BY u.created_at,u.id`).all() as SqlRow[]).map((row) => ({
  id: String(row.id),
  email: String(row.email),
  name: String(row.name),
  accountCreatedAt: iso(row.created_at),
  emailVerifiedAt: iso(row.email_verified_at),
  onboardingCompletedAt: iso(row.onboarding_completed_at)
}));

const spaces = db.prepare(`SELECT id,name,created_by_user_id,personal_for_user_id,created_at
  FROM spaces ORDER BY created_at,id`).all() as SqlRow[];

const surveyMilestones = tableExists('surveys')
  ? db.prepare(`SELECT space_id,MIN(created_at) created_at,
      MIN(CASE WHEN status='live' OR published_at IS NOT NULL THEN COALESCE(published_at,created_at) END) published_at
    FROM surveys GROUP BY space_id`).all() as SqlRow[]
  : [];
const surveyBySpace = new Map(surveyMilestones.map((row) => [String(row.space_id), row]));

const journeyMilestones = tableExists('journey_definitions') && tableExists('journey_map_versions')
  ? db.prepare(`SELECT definition.space_id,
      MIN(definition.created_at) created_at,
      MIN(version.published_at) published_at
    FROM journey_definitions definition
    LEFT JOIN journey_map_versions version ON version.id=definition.published_version_id
    GROUP BY definition.space_id`).all() as SqlRow[]
  : [];
const journeyBySpace = new Map(journeyMilestones.map((row) => [String(row.space_id), row]));

const subscriptionRequests = tableExists('platform_subscription_requests')
  ? db.prepare(`SELECT space_id,requested_by_user_id,MIN(created_at) created_at
    FROM platform_subscription_requests
    GROUP BY space_id,requested_by_user_id`).all() as SqlRow[]
  : [];

const subscriptionActivations = tableExists('platform_subscription_events') && tableExists('platform_subscriptions')
  ? db.prepare(`SELECT subscription.space_id,MIN(event.created_at) created_at
    FROM platform_subscription_events event
    JOIN platform_subscriptions subscription ON subscription.id=event.subscription_id
    WHERE event.event_type IN ('activated','approved','created','seeded')
    GROUP BY subscription.space_id`).all() as SqlRow[]
  : [];
const activationBySpace = new Map(subscriptionActivations.map((row) => [String(row.space_id), row]));

const aiRuntimeAudit = db.prepare(`SELECT actor_user_id,space_id,action,before_json,after_json,created_at
  FROM platform_audit_events
  WHERE action IN ('ai_runtime.codex_login_started','ai_runtime.codex_connected','ai_runtime.runtime_selected','ai_runtime.codex_disconnected')
  ORDER BY created_at,id`).all() as SqlRow[];

const activationAudit = db.prepare(`SELECT actor_user_id,space_id,action,target_id,after_json,created_at
  FROM platform_audit_events
  WHERE action IN ('onboarding_completed','space_created')
  ORDER BY created_at,id`).all() as SqlRow[];

const aiRuntimeByUser = new Map<string, SqlRow[]>();
for (const row of aiRuntimeAudit) {
  const key = String(row.actor_user_id || '');
  if (!key) continue;
  aiRuntimeByUser.set(key, [...(aiRuntimeByUser.get(key) || []), row]);
}

const activationByUser = new Map<string, SqlRow[]>();
for (const row of activationAudit) {
  const key = String(row.actor_user_id || '').trim();
  if (!key) continue;
  activationByUser.set(key, [...(activationByUser.get(key) || []), row]);
}

function firstOwnedSpace(userId: string) {
  return spaces.find((row) => String(row.created_by_user_id || row.personal_for_user_id || '') === userId) || null;
}

const records: Array<Record<string, unknown>> = [];
try {
  for (const user of users) {
    const space = firstOwnedSpace(user.id);
    const spaceId = space ? String(space.id) : null;
    const runtimeEvents = aiRuntimeByUser.get(user.id) || [];
    const activationEvents = activationByUser.get(user.id) || [];
    const onboardingCompleted = activationEvents.find((row) => row.action === 'onboarding_completed');
    const spaceCreated = activationEvents.find((row) => {
      if (row.action !== 'space_created') return false;
      if (spaceId && String(row.target_id || '') === spaceId) return true;
      const after = parseJson<Record<string, unknown>>(row.after_json, {});
      return !spaceId && after.space_kind === 'personal';
    });
    const loginStarted = runtimeEvents.find((row) => row.action === 'ai_runtime.codex_login_started');
    const codexConnected = runtimeEvents.find((row) => row.action === 'ai_runtime.codex_connected');
    const runtimeSelected = runtimeEvents.find((row) => {
      if (row.action !== 'ai_runtime.runtime_selected') return false;
      const after = parseJson<Record<string, unknown>>(row.after_json, {});
      return after.runtimeChoice === 'chatgpt';
    });
    const localSelected = runtimeEvents.find((row) => {
      if (row.action !== 'ai_runtime.runtime_selected') return false;
      const after = parseJson<Record<string, unknown>>(row.after_json, {});
      return after.runtimeChoice === 'local';
    });
    const survey = spaceId ? surveyBySpace.get(spaceId) : null;
    const journey = spaceId ? journeyBySpace.get(spaceId) : null;
    const subscriptionRequested = subscriptionRequests.find((row) =>
      String(row.requested_by_user_id || '') === user.id && String(row.space_id || '') === (spaceId || '__none__'));
    const subscriptionActivated = spaceId ? activationBySpace.get(spaceId) : null;
    const preferenceKey = spaceId ? `${user.id}:${spaceId}` : null;
    const storedPreference = preferenceKey ? providerPreferenceFile.preferences?.[preferenceKey] : undefined;
    const runtimeHome = path.join(config.codexRuntimeDir, 'users', safeRuntimeKey(user.id));
    const authFile = path.join(runtimeHome, 'auth.json');
    const currentRuntimeHomePresent = fs.existsSync(runtimeHome);
    const currentAuthFilePresent = fs.existsSync(authFile);
    const providerState = spaceId && currentAuthFilePresent ? await getAiProviderState(user.id, spaceId) : null;
    const currentAccount = providerState?.codex?.account ?? null;
    const currentPreference = providerState?.preference ?? null;
    const currentRuntimePolicy = providerState?.runtimePolicy ?? null;
    records.push({
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      },
      scope: {
        primaryOwnedSpaceId: spaceId,
        primaryOwnedSpaceName: space ? String(space.name) : null
      },
      milestones: {
        accountCreatedAt: user.accountCreatedAt,
        emailVerifiedAt: user.emailVerifiedAt,
        onboardingCompletedAt: iso(onboardingCompleted?.created_at) || user.onboardingCompletedAt,
        spaceCreatedAt: iso(spaceCreated?.created_at) || iso(space?.created_at),
        chatGptLoginStartedAt: iso(loginStarted?.created_at),
        chatGptConnectedAt: iso(codexConnected?.created_at),
        chatGptSelectedAt: iso(runtimeSelected?.created_at),
        localRuntimeSelectedAt: iso(localSelected?.created_at),
        surveyCreatedAt: iso(survey?.created_at),
        surveyPublishedAt: iso(survey?.published_at),
        journeyCreatedAt: iso(journey?.created_at),
        journeyPublishedAt: iso(journey?.published_at),
        subscriptionRequestedAt: iso(subscriptionRequested?.created_at),
        subscriptionActivatedAt: iso(subscriptionActivated?.created_at)
      },
      evidence: {
        activationAuditEvents: activationEvents.length,
        aiRuntimeAuditEvents: runtimeEvents.length,
        providerPreferenceStored: Boolean(storedPreference),
        providerPreferencePath: providerPreferenceFileExists ? providerPreferencePath : null,
        runtimePreferenceProvider: optionalString(storedPreference?.provider),
        runtimePreferenceChoice: optionalString(storedPreference?.runtimeChoice),
        runtimePreferenceUpdatedAt: iso(storedPreference?.updatedAt),
        codexRuntimeHomePresent: currentRuntimeHomePresent,
        codexAuthFilePresent: currentAuthFilePresent,
        currentRuntimeConnected: Boolean(currentAccount?.connected),
        currentRuntimeEmail: optionalString(currentAccount?.email),
        currentRuntimePlanType: optionalString(currentAccount?.planType),
        currentRuntimeAuthMode: optionalString(currentAccount?.authMode),
        currentRuntimePendingLogin: Boolean(currentAccount?.pendingLogin),
        currentRuntimePreferenceChoice: optionalString(currentPreference?.runtimeChoice),
        currentRuntimeEffectiveProvider: optionalString(currentPreference?.effectiveProvider),
        currentRuntimePolicyDefault: optionalString(currentRuntimePolicy?.defaultRuntime),
        surveyScope: survey ? 'space' : null,
        journeyScope: journey ? 'space' : null,
        subscriptionScope: subscriptionActivated ? 'space' : subscriptionRequested ? 'requester+space' : null
      }
    });
  }
} finally {
  await stopCodexClients();
}

const totals = {
  users: records.length,
  withEmailVerified: records.filter((record) => record.milestones.emailVerifiedAt).length,
  withOnboardingCompleted: records.filter((record) => record.milestones.onboardingCompletedAt).length,
  withOwnedSpace: records.filter((record) => record.scope.primaryOwnedSpaceId).length,
  withChatGptConnected: records.filter((record) => record.milestones.chatGptConnectedAt).length,
  withChatGptSelected: records.filter((record) => record.milestones.chatGptSelectedAt).length,
  withCurrentRuntimeConnected: records.filter((record) => record.evidence.currentRuntimeConnected).length,
  withCurrentRuntimeSelectedChatGpt: records.filter((record) =>
    record.evidence.currentRuntimePreferenceChoice === 'chatgpt'
    || record.evidence.currentRuntimeEffectiveProvider === 'codex').length,
  withStoredChatGptPreference: records.filter((record) => record.evidence.runtimePreferenceProvider === 'codex'
    || record.evidence.runtimePreferenceChoice === 'chatgpt').length,
  withCodexRuntimeHome: records.filter((record) => record.evidence.codexRuntimeHomePresent).length,
  withCodexAuthFile: records.filter((record) => record.evidence.codexAuthFilePresent).length,
  withSurveyCreated: records.filter((record) => record.milestones.surveyCreatedAt).length,
  withJourneyCreated: records.filter((record) => record.milestones.journeyCreatedAt).length,
  withSubscriptionRequested: records.filter((record) => record.milestones.subscriptionRequestedAt).length,
  withSubscriptionActivated: records.filter((record) => record.milestones.subscriptionActivatedAt).length
};

const caveats = [
  'Survey and journey milestones are reconciled at the owned-space level where legacy tables do not retain a direct creator user for every artifact.',
  'ChatGPT connection and runtime-selection proof depends on platform_audit_events actions emitted by current AI runtime routes; older connections made before this audit hook may be absent.',
  'Current runtime-connected signals come from live getAiProviderState resolution and may diverge from the audited event trail when a different local runtime instance handled sign-in.',
  'Stored runtime preferences and Codex runtime-home/auth-file presence are supportive local signals only; they are not treated as equivalent to a fresh audited ChatGPT connection event.',
  'Onboarding and explicit workspace-creation milestones prefer authoritative platform_audit_events when present and fall back to durable account/space records for older histories.',
  'This artifact is for internal Seemplify dogfood evidence only and is not customer telemetry ingestion.'
];

const report = {
  generatedAt: now,
  databaseProvider: db.provider,
  databasePath: db.provider === 'sqlite' ? config.databasePath : null,
  providerPreferencePath: providerPreferenceFileExists ? providerPreferencePath : null,
  summary: totals,
  caveats,
  records
};

const lines = [
  '# Seemplify activation dogfood reconciliation report',
  '',
  `Generated at: ${now}`,
  '',
  '## Summary',
  '',
  `- Accounts: ${totals.users}`,
  `- Email verified: ${totals.withEmailVerified}`,
  `- Onboarding completed: ${totals.withOnboardingCompleted}`,
  `- Owned space created: ${totals.withOwnedSpace}`,
  `- ChatGPT connected (audited): ${totals.withChatGptConnected}`,
  `- ChatGPT selected (audited): ${totals.withChatGptSelected}`,
  `- ChatGPT connected (current runtime): ${totals.withCurrentRuntimeConnected}`,
  `- ChatGPT selected (current runtime): ${totals.withCurrentRuntimeSelectedChatGpt}`,
  `- Stored ChatGPT runtime preference: ${totals.withStoredChatGptPreference}`,
  `- Codex runtime home present: ${totals.withCodexRuntimeHome}`,
  `- Codex auth file present: ${totals.withCodexAuthFile}`,
  `- Survey created in owned space: ${totals.withSurveyCreated}`,
  `- Journey created in owned space: ${totals.withJourneyCreated}`,
  `- Subscription requested: ${totals.withSubscriptionRequested}`,
  `- Subscription activated: ${totals.withSubscriptionActivated}`,
  '',
  '## Caveats',
  '',
  ...caveats.map((item) => `- ${item}`),
  '',
  '## Per-account evidence',
  ''
];

for (const record of records) {
  lines.push(`### ${record.user.name} <${record.user.email}>`);
  lines.push('');
  lines.push(`- User ID: ${record.user.id}`);
  lines.push(`- Owned space: ${record.scope.primaryOwnedSpaceName || 'None'}${record.scope.primaryOwnedSpaceId ? ` (${record.scope.primaryOwnedSpaceId})` : ''}`);
  lines.push(`- Account created: ${record.milestones.accountCreatedAt || '—'}`);
  lines.push(`- Email verified: ${record.milestones.emailVerifiedAt || '—'}`);
  lines.push(`- Onboarding completed: ${record.milestones.onboardingCompletedAt || '—'}`);
  lines.push(`- Space created: ${record.milestones.spaceCreatedAt || '—'}`);
  lines.push(`- ChatGPT login started (audited): ${record.milestones.chatGptLoginStartedAt || '—'}`);
  lines.push(`- ChatGPT connected (audited): ${record.milestones.chatGptConnectedAt || '—'}`);
  lines.push(`- ChatGPT selected (audited): ${record.milestones.chatGptSelectedAt || '—'}`);
  lines.push(`- Local runtime selected (audited): ${record.milestones.localRuntimeSelectedAt || '—'}`);
  lines.push(`- Stored runtime provider: ${record.evidence.runtimePreferenceProvider || '—'}`);
  lines.push(`- Stored runtime choice: ${record.evidence.runtimePreferenceChoice || '—'}`);
  lines.push(`- Stored runtime preference updated: ${record.evidence.runtimePreferenceUpdatedAt || '—'}`);
  lines.push(`- Codex runtime home present: ${record.evidence.codexRuntimeHomePresent ? 'yes' : 'no'}`);
  lines.push(`- Codex auth file present: ${record.evidence.codexAuthFilePresent ? 'yes' : 'no'}`);
  lines.push(`- Survey created (space scope): ${record.milestones.surveyCreatedAt || '—'}`);
  lines.push(`- Survey published (space scope): ${record.milestones.surveyPublishedAt || '—'}`);
  lines.push(`- Journey created (space scope): ${record.milestones.journeyCreatedAt || '—'}`);
  lines.push(`- Journey published (space scope): ${record.milestones.journeyPublishedAt || '—'}`);
  lines.push(`- Subscription requested: ${record.milestones.subscriptionRequestedAt || '—'}`);
  lines.push(`- Subscription activated: ${record.milestones.subscriptionActivatedAt || '—'}`);
  lines.push(`- Activation audit events: ${record.evidence.activationAuditEvents}`);
  lines.push(`- AI runtime audit events: ${record.evidence.aiRuntimeAuditEvents}`);
  lines.push('');
}

ensureDirectory(jsonPath);
ensureDirectory(markdownPath);
fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(markdownPath, `${lines.join('\n')}\n`);

console.log(JSON.stringify({
  ok: true,
  generatedAt: now,
  jsonPath,
  markdownPath,
  summary: totals
}));

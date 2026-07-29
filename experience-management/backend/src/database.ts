import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { config } from './config.js';
import type { AiJob, Collector, Journey, Question, ResponseRecord, SocialMention, Survey } from './types.js';

export const db = new Database(config.databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    session_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS password_reset_lookup ON password_reset_tokens(token_hash, used_at, expires_at);
  CREATE TABLE IF NOT EXISTS surveys (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    purpose TEXT NOT NULL,
    audience TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    primary_metric TEXT NOT NULL DEFAULT 'nps',
    language TEXT NOT NULL DEFAULT 'English',
    thank_you_message TEXT NOT NULL DEFAULT 'Thank you for sharing your feedback.',
    theme_json TEXT NOT NULL DEFAULT '{}',
    settings_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_at TEXT
  );
  CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    page INTEGER NOT NULL DEFAULT 1,
    position INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    required INTEGER NOT NULL DEFAULT 0,
    options_json TEXT NOT NULL DEFAULT '[]',
    settings_json TEXT NOT NULL DEFAULT '{}',
    logic_json TEXT NOT NULL DEFAULT '[]'
  );
  CREATE INDEX IF NOT EXISTS questions_survey_position ON questions(survey_id, page, position);
  CREATE TABLE IF NOT EXISTS collectors (
    id TEXT PRIMARY KEY,
    survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'open',
    settings_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS recipients (
    id TEXT PRIMARY KEY,
    collector_id TEXT NOT NULL REFERENCES collectors(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    invite_sent_at TEXT,
    reminder_sent_at TEXT,
    responded_at TEXT,
    message_id TEXT,
    error TEXT,
    first_attempt_at TEXT,
    updated_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS responses (
    id TEXT PRIMARY KEY,
    survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    collector_id TEXT NOT NULL REFERENCES collectors(id) ON DELETE CASCADE,
    respondent_token TEXT NOT NULL,
    status TEXT NOT NULL,
    answers_json TEXT NOT NULL DEFAULT '{}',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    started_at TEXT NOT NULL,
    completed_at TEXT,
    duration_seconds INTEGER,
    ai_analysis_json TEXT,
    analyzed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS responses_survey_completed ON responses(survey_id, completed_at);
  CREATE TABLE IF NOT EXISTS insights (
    id TEXT PRIMARY KEY,
    survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ai_jobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    survey_id TEXT,
    response_id TEXT,
    state TEXT NOT NULL DEFAULT 'queued',
    stage TEXT NOT NULL DEFAULT 'queued',
    progress INTEGER NOT NULL DEFAULT 0,
    attempt INTEGER NOT NULL DEFAULT 0,
    input_json TEXT NOT NULL DEFAULT '{}',
    result_json TEXT,
    error TEXT,
    retry_at TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ai_jobs_dispatch ON ai_jobs(state, retry_at, created_at);
  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    response_id TEXT REFERENCES responses(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal',
    status TEXT NOT NULL DEFAULT 'open',
    owner TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS social_mentions (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    external_id TEXT,
    x_connection_id TEXT,
    ingestion_kind TEXT,
    author TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    url TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT '',
    published_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    analysis_json TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS social_mentions_published ON social_mentions(published_at DESC);
  CREATE TABLE IF NOT EXISTS x_apps (
    id TEXT PRIMARY KEY,
    consumer_key_enc TEXT,
    consumer_secret_enc TEXT,
    bearer_token_enc TEXT,
    credential_version INTEGER NOT NULL DEFAULT 1,
    configured_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS x_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    app_id TEXT NOT NULL REFERENCES x_apps(id) ON DELETE CASCADE,
    access_token_enc TEXT NOT NULL,
    access_token_secret_enc TEXT NOT NULL,
    x_user_id TEXT,
    username TEXT,
    display_name TEXT,
    profile_image_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending_verification',
    generation INTEGER NOT NULL DEFAULT 1,
    auto_sync INTEGER NOT NULL DEFAULT 0,
    sync_interval_minutes INTEGER NOT NULL DEFAULT 60,
    next_sync_at TEXT,
    last_sync_at TEXT,
    last_success_at TEXT,
    last_post_id TEXT,
    last_mention_id TEXT,
    last_error TEXT,
    rate_limit_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS x_connections_schedule ON x_connections(auto_sync,next_sync_at);
  CREATE TABLE IF NOT EXISTS x_oauth_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    app_id TEXT NOT NULL REFERENCES x_apps(id) ON DELETE CASCADE,
    credential_version INTEGER NOT NULL,
    request_token_hash TEXT NOT NULL UNIQUE,
    request_secret_enc TEXT NOT NULL,
    handshake_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS x_oauth_requests_expiry ON x_oauth_requests(expires_at,consumed_at);
  CREATE TABLE IF NOT EXISTS x_listening_queries (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES x_connections(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    query TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    since_id TEXT,
    last_sync_at TEXT,
    last_success_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS x_listening_queries_connection ON x_listening_queries(connection_id,enabled,created_at);
  CREATE TABLE IF NOT EXISTS x_sync_jobs (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES x_connections(id) ON DELETE CASCADE,
    trigger_type TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued',
    stage TEXT NOT NULL DEFAULT 'queued',
    progress INTEGER NOT NULL DEFAULT 0,
    attempt INTEGER NOT NULL DEFAULT 0,
    run_after TEXT,
    posts_fetched INTEGER NOT NULL DEFAULT 0,
    mentions_fetched INTEGER NOT NULL DEFAULT 0,
    search_fetched INTEGER NOT NULL DEFAULT 0,
    imported_count INTEGER NOT NULL DEFAULT 0,
    analysis_job_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS x_sync_jobs_dispatch ON x_sync_jobs(state,run_after,created_at);
  CREATE UNIQUE INDEX IF NOT EXISTS x_sync_jobs_one_active ON x_sync_jobs(connection_id) WHERE state IN ('queued','processing','waiting_rate_limit');
  CREATE TABLE IF NOT EXISTS x_connection_mentions (
    connection_id TEXT NOT NULL REFERENCES x_connections(id) ON DELETE CASCADE,
    mention_id TEXT NOT NULL REFERENCES social_mentions(id) ON DELETE CASCADE,
    streams_json TEXT NOT NULL DEFAULT '[]',
    query_ids_json TEXT NOT NULL DEFAULT '[]',
    discovered_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    PRIMARY KEY(connection_id,mention_id)
  );
  CREATE INDEX IF NOT EXISTS x_connection_mentions_recent ON x_connection_mentions(connection_id,last_seen_at DESC);
  CREATE TABLE IF NOT EXISTS journeys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    audience TEXT NOT NULL DEFAULT '',
    objective TEXT NOT NULL DEFAULT '',
    industry TEXT NOT NULL DEFAULT '',
    stages_json TEXT NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    collector_id TEXT NOT NULL REFERENCES collectors(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    stop_on_response INTEGER NOT NULL DEFAULT 1,
    start_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    launched_at TEXT,
    paused_at TEXT,
    completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS campaigns_status_updated ON campaigns(status, updated_at DESC);
  CREATE TABLE IF NOT EXISTS campaign_steps (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    delay_minutes INTEGER NOT NULL DEFAULT 0,
    subject TEXT NOT NULL,
    content_mode TEXT NOT NULL DEFAULT 'plain',
    body_text TEXT NOT NULL DEFAULT '',
    body_html TEXT NOT NULL DEFAULT '',
    embed_question_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(campaign_id, position)
  );
  CREATE TABLE IF NOT EXISTS campaign_contacts (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    email TEXT NOT NULL COLLATE NOCASE,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    job_title TEXT NOT NULL DEFAULT '',
    company TEXT NOT NULL DEFAULT '',
    token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active',
    custom_json TEXT NOT NULL DEFAULT '{}',
    current_step INTEGER NOT NULL DEFAULT -1,
    last_sent_at TEXT,
    responded_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(campaign_id, email)
  );
  CREATE INDEX IF NOT EXISTS campaign_contacts_campaign_status ON campaign_contacts(campaign_id, status, created_at);
  CREATE TABLE IF NOT EXISTS campaign_deliveries (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    step_id TEXT NOT NULL REFERENCES campaign_steps(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL REFERENCES campaign_contacts(id) ON DELETE CASCADE,
    step_position INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued',
    scheduled_at TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    first_attempt_at TEXT,
    provider_message_id TEXT,
    provider_status TEXT,
    delivered_at TEXT,
    opened_at TEXT,
    clicked_at TEXT,
    bounced_at TEXT,
    complained_at TEXT,
    unsubscribed_at TEXT,
    provider_updated_at TEXT,
    error TEXT,
    sent_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(contact_id, step_id)
  );
  CREATE INDEX IF NOT EXISTS campaign_deliveries_dispatch ON campaign_deliveries(state, scheduled_at, created_at);
  CREATE TABLE IF NOT EXISTS email_suppressions (
    email TEXT PRIMARY KEY COLLATE NOCASE,
    reason TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS campaign_delivery_events (
    id TEXT PRIMARY KEY,
    delivery_id TEXT NOT NULL REFERENCES campaign_deliveries(id) ON DELETE CASCADE,
    provider_event_id TEXT,
    provider_message_id TEXT,
    event_type TEXT NOT NULL,
    event_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS campaign_delivery_events_delivery ON campaign_delivery_events(delivery_id,event_at);
  CREATE INDEX IF NOT EXISTS campaign_deliveries_provider_message ON campaign_deliveries(provider_message_id);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );
`);

const applyEsignSchema = db.transaction(() => {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(1);
  if (applied) return;
  db.exec(`
    CREATE TABLE esign_envelopes (
      id TEXT PRIMARY KEY,
      created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      source_envelope_id TEXT REFERENCES esign_envelopes(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      routing_mode TEXT NOT NULL DEFAULT 'sequential',
      expires_at TEXT,
      expiration_days INTEGER,
      reminder_interval_hours INTEGER,
      last_reminder_at TEXT,
      finalization_attempt INTEGER NOT NULL DEFAULT 0,
      finalization_retry_at TEXT,
      finalization_error TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sent_at TEXT,
      completed_at TEXT,
      declined_at TEXT,
      voided_at TEXT,
      void_reason TEXT
    );
    CREATE INDEX esign_envelopes_owner_updated ON esign_envelopes(created_by_user_id,updated_at DESC);
    CREATE INDEX esign_envelopes_worker ON esign_envelopes(status,expires_at,updated_at);

    CREATE TABLE esign_documents (
      id TEXT PRIMARY KEY,
      envelope_id TEXT NOT NULL REFERENCES esign_envelopes(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      page_count INTEGER NOT NULL,
      storage_key TEXT NOT NULL UNIQUE,
      sha256 TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'ready',
      error TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(envelope_id,position)
    );
    CREATE INDEX esign_documents_envelope ON esign_documents(envelope_id,position);

    CREATE TABLE esign_recipients (
      id TEXT PRIMARY KEY,
      envelope_id TEXT NOT NULL REFERENCES esign_envelopes(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      routing_order INTEGER NOT NULL DEFAULT 1,
      role TEXT NOT NULL DEFAULT 'signer',
      name TEXT NOT NULL,
      email TEXT NOT NULL COLLATE NOCASE,
      status TEXT NOT NULL DEFAULT 'pending',
      access_token_hash TEXT NOT NULL UNIQUE,
      access_token_enc TEXT NOT NULL,
      access_code_hash TEXT,
      code_failed_attempts INTEGER NOT NULL DEFAULT 0,
      code_locked_until TEXT,
      invitation_sent_at TEXT,
      viewed_at TEXT,
      authenticated_at TEXT,
      consented_at TEXT,
      completed_at TEXT,
      declined_at TEXT,
      decline_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(envelope_id,position)
    );
    CREATE INDEX esign_recipients_route ON esign_recipients(envelope_id,routing_order,status,position);
    CREATE INDEX esign_recipients_email ON esign_recipients(email,envelope_id);

    CREATE TABLE esign_fields (
      id TEXT PRIMARY KEY,
      envelope_id TEXT NOT NULL REFERENCES esign_envelopes(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL REFERENCES esign_documents(id) ON DELETE CASCADE,
      recipient_id TEXT NOT NULL REFERENCES esign_recipients(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      page INTEGER NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      width REAL NOT NULL,
      height REAL NOT NULL,
      required INTEGER NOT NULL DEFAULT 1,
      label TEXT NOT NULL DEFAULT '',
      placeholder TEXT NOT NULL DEFAULT '',
      tab_order INTEGER NOT NULL DEFAULT 0,
      options_json TEXT NOT NULL DEFAULT '[]',
      validation_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX esign_fields_envelope ON esign_fields(envelope_id,document_id,page,tab_order);
    CREATE INDEX esign_fields_recipient ON esign_fields(recipient_id,tab_order);

    CREATE TABLE esign_signature_assets (
      id TEXT PRIMARY KEY,
      envelope_id TEXT NOT NULL REFERENCES esign_envelopes(id) ON DELETE CASCADE,
      recipient_id TEXT NOT NULL REFERENCES esign_recipients(id) ON DELETE CASCADE,
      mode TEXT NOT NULL,
      mime_type TEXT,
      display_text TEXT,
      storage_key TEXT UNIQUE,
      sha256 TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE esign_field_values (
      field_id TEXT PRIMARY KEY REFERENCES esign_fields(id) ON DELETE CASCADE,
      recipient_id TEXT NOT NULL REFERENCES esign_recipients(id) ON DELETE CASCADE,
      value_json TEXT NOT NULL DEFAULT '{}',
      signature_asset_id TEXT REFERENCES esign_signature_assets(id) ON DELETE SET NULL,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE esign_signing_sessions (
      id TEXT PRIMARY KEY,
      recipient_id TEXT NOT NULL REFERENCES esign_recipients(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      authenticated INTEGER NOT NULL DEFAULT 0,
      consented_at TEXT,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE INDEX esign_signing_sessions_lookup ON esign_signing_sessions(token_hash,expires_at,revoked_at);

    CREATE TABLE esign_email_deliveries (
      id TEXT PRIMARY KEY,
      envelope_id TEXT NOT NULL REFERENCES esign_envelopes(id) ON DELETE CASCADE,
      recipient_id TEXT NOT NULL REFERENCES esign_recipients(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'queued',
      scheduled_at TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 4,
      idempotency_key TEXT NOT NULL UNIQUE,
      provider_message_id TEXT,
      provider_status TEXT,
      provider_updated_at TEXT,
      delivered_at TEXT,
      opened_at TEXT,
      bounced_at TEXT,
      debug_link_enc TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sent_at TEXT
    );
    CREATE INDEX esign_email_dispatch ON esign_email_deliveries(state,scheduled_at,created_at);

    CREATE TABLE esign_email_events (
      id TEXT PRIMARY KEY,
      delivery_id TEXT NOT NULL REFERENCES esign_email_deliveries(id) ON DELETE CASCADE,
      provider_event_id TEXT,
      provider_message_id TEXT,
      event_type TEXT NOT NULL,
      event_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX esign_email_events_delivery ON esign_email_events(delivery_id,event_at);

    CREATE TABLE esign_artifacts (
      id TEXT PRIMARY KEY,
      envelope_id TEXT NOT NULL REFERENCES esign_envelopes(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/pdf',
      size_bytes INTEGER NOT NULL,
      page_count INTEGER NOT NULL,
      storage_key TEXT NOT NULL UNIQUE,
      sha256 TEXT NOT NULL,
      public_id TEXT UNIQUE,
      state TEXT NOT NULL DEFAULT 'ready',
      created_at TEXT NOT NULL,
      UNIQUE(envelope_id,kind)
    );
    CREATE INDEX esign_artifacts_envelope ON esign_artifacts(envelope_id,kind);

    CREATE TABLE esign_audit_events (
      id TEXT PRIMARY KEY,
      envelope_id TEXT NOT NULL REFERENCES esign_envelopes(id) ON DELETE CASCADE,
      recipient_id TEXT REFERENCES esign_recipients(id) ON DELETE SET NULL,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      actor_type TEXT NOT NULL,
      event_type TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      previous_hash TEXT,
      event_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE INDEX esign_audit_envelope ON esign_audit_events(envelope_id,created_at,id);
  `);
  db.prepare('INSERT INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)')
    .run(1, 'native_esign_core', new Date().toISOString());
});
applyEsignSchema();
const esignEnvelopeColumns = new Set((db.prepare('PRAGMA table_info(esign_envelopes)').all() as any[]).map((column) => String(column.name)));
if (!esignEnvelopeColumns.has('expiration_days')) db.exec('ALTER TABLE esign_envelopes ADD COLUMN expiration_days INTEGER');
if (!esignEnvelopeColumns.has('finalization_attempt')) db.exec('ALTER TABLE esign_envelopes ADD COLUMN finalization_attempt INTEGER NOT NULL DEFAULT 0');
if (!esignEnvelopeColumns.has('finalization_retry_at')) db.exec('ALTER TABLE esign_envelopes ADD COLUMN finalization_retry_at TEXT');
if (!esignEnvelopeColumns.has('finalization_error')) db.exec('ALTER TABLE esign_envelopes ADD COLUMN finalization_error TEXT');
db.prepare(`UPDATE esign_envelopes SET expiration_days=MAX(1,CAST(julianday(expires_at)-julianday(created_at) AS INTEGER))
  WHERE expiration_days IS NULL AND expires_at IS NOT NULL AND status='draft'`).run();
const esignEmailColumns = new Set((db.prepare('PRAGMA table_info(esign_email_deliveries)').all() as any[]).map((column) => String(column.name)));
for (const column of ['provider_status', 'provider_updated_at', 'delivered_at', 'opened_at', 'bounced_at']) {
  if (!esignEmailColumns.has(column)) db.exec(`ALTER TABLE esign_email_deliveries ADD COLUMN ${column} TEXT`);
}
db.exec(`CREATE TABLE IF NOT EXISTS esign_email_events (
  id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL REFERENCES esign_email_deliveries(id) ON DELETE CASCADE,
  provider_event_id TEXT, provider_message_id TEXT, event_type TEXT NOT NULL, event_at TEXT NOT NULL, created_at TEXT NOT NULL
); CREATE INDEX IF NOT EXISTS esign_email_events_delivery ON esign_email_events(delivery_id,event_at);`);
db.prepare('INSERT OR IGNORE INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)').run(2, 'native_esign_hardening', new Date().toISOString());

const campaignDeliveryColumns = new Set((db.prepare('PRAGMA table_info(campaign_deliveries)').all() as any[]).map((column) => String(column.name)));
for (const column of [
  'first_attempt_at', 'provider_status', 'delivered_at', 'opened_at', 'clicked_at', 'bounced_at',
  'complained_at', 'unsubscribed_at', 'provider_updated_at'
]) {
  if (!campaignDeliveryColumns.has(column)) db.exec(`ALTER TABLE campaign_deliveries ADD COLUMN ${column} TEXT`);
}
const recipientColumns = new Set((db.prepare('PRAGMA table_info(recipients)').all() as any[]).map((column) => String(column.name)));
for (const column of ['first_attempt_at', 'updated_at']) {
  if (!recipientColumns.has(column)) db.exec(`ALTER TABLE recipients ADD COLUMN ${column} TEXT`);
}
const campaignContactColumns = new Set((db.prepare('PRAGMA table_info(campaign_contacts)').all() as any[]).map((column) => String(column.name)));
if (!campaignContactColumns.has('job_title')) db.exec("ALTER TABLE campaign_contacts ADD COLUMN job_title TEXT NOT NULL DEFAULT ''");
const socialMentionColumns = new Set((db.prepare('PRAGMA table_info(social_mentions)').all() as any[]).map((column) => String(column.name)));
if (!socialMentionColumns.has('external_id')) db.exec('ALTER TABLE social_mentions ADD COLUMN external_id TEXT');
if (!socialMentionColumns.has('x_connection_id')) db.exec('ALTER TABLE social_mentions ADD COLUMN x_connection_id TEXT');
if (!socialMentionColumns.has('ingestion_kind')) db.exec('ALTER TABLE social_mentions ADD COLUMN ingestion_kind TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS social_mentions_x_external ON social_mentions(source,external_id) WHERE external_id IS NOT NULL');
const xConnectionColumns = new Set((db.prepare('PRAGMA table_info(x_connections)').all() as any[]).map((column) => String(column.name)));
if (!xConnectionColumns.has('last_post_id')) db.exec('ALTER TABLE x_connections ADD COLUMN last_post_id TEXT');
if (!xConnectionColumns.has('last_mention_id')) db.exec('ALTER TABLE x_connections ADD COLUMN last_mention_id TEXT');
if (!xConnectionColumns.has('generation')) db.exec('ALTER TABLE x_connections ADD COLUMN generation INTEGER NOT NULL DEFAULT 1');

const parseJson = <T>(value: unknown, fallback: T): T => {
  try { return value ? JSON.parse(String(value)) as T : fallback; } catch { return fallback; }
};

const rowSurvey = (row: any): Survey => ({
  id: row.id, title: row.title, description: row.description, purpose: row.purpose,
  audience: row.audience, status: row.status, primaryMetric: row.primary_metric,
  language: row.language, thankYouMessage: row.thank_you_message,
  theme: parseJson(row.theme_json, {}), settings: parseJson(row.settings_json, {}),
  createdAt: row.created_at, updatedAt: row.updated_at, publishedAt: row.published_at
});

const rowQuestion = (row: any): Question => ({
  id: row.id, surveyId: row.survey_id, page: row.page, position: row.position, type: row.type,
  title: row.title, description: row.description, required: Boolean(row.required),
  options: parseJson(row.options_json, []), settings: parseJson(row.settings_json, {}),
  logic: parseJson(row.logic_json, [])
});

export function listSurveys(): Survey[] {
  return (db.prepare(`SELECT s.*, COUNT(DISTINCT r.id) response_count, COUNT(DISTINCT c.id) collector_count
    FROM surveys s LEFT JOIN responses r ON r.survey_id=s.id LEFT JOIN collectors c ON c.survey_id=s.id
    GROUP BY s.id ORDER BY s.updated_at DESC`).all() as any[]).map((row) => ({
      ...rowSurvey(row), responseCount: Number(row.response_count), collectorCount: Number(row.collector_count)
    } as Survey));
}

export function getSurvey(id: string): Survey | null {
  const row = db.prepare('SELECT * FROM surveys WHERE id=?').get(id) as any;
  if (!row) return null;
  return {
    ...rowSurvey(row),
    questions: (db.prepare('SELECT * FROM questions WHERE survey_id=? ORDER BY page, position').all(id) as any[]).map(rowQuestion)
  };
}

export const saveSurvey = db.transaction((input: Partial<Survey> & { title: string }, questions?: Partial<Question>[]) => {
  const now = new Date().toISOString();
  const id = input.id || crypto.randomUUID();
  db.prepare(`INSERT INTO surveys (id,title,description,purpose,audience,status,primary_metric,language,thank_you_message,theme_json,settings_json,created_at,updated_at,published_at)
    VALUES (@id,@title,@description,@purpose,@audience,@status,@primaryMetric,@language,@thankYouMessage,@theme,@settings,@createdAt,@updatedAt,@publishedAt)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,purpose=excluded.purpose,audience=excluded.audience,status=excluded.status,primary_metric=excluded.primary_metric,language=excluded.language,thank_you_message=excluded.thank_you_message,theme_json=excluded.theme_json,settings_json=excluded.settings_json,updated_at=excluded.updated_at,published_at=excluded.published_at`).run({
      id, title: input.title.trim(), description: input.description || '', purpose: input.purpose || 'customer_experience',
      audience: input.audience || '', status: input.status || 'draft', primaryMetric: input.primaryMetric || 'nps',
      language: input.language || 'English', thankYouMessage: input.thankYouMessage || 'Thank you for sharing your feedback.',
      theme: JSON.stringify(input.theme || {}), settings: JSON.stringify(input.settings || {}), createdAt: input.createdAt || now,
      updatedAt: now, publishedAt: input.publishedAt || null
    });
  if (questions) {
    db.prepare('DELETE FROM questions WHERE survey_id=?').run(id);
    const insert = db.prepare(`INSERT INTO questions (id,survey_id,page,position,type,title,description,required,options_json,settings_json,logic_json)
      VALUES (@id,@surveyId,@page,@position,@type,@title,@description,@required,@options,@settings,@logic)`);
    questions.forEach((question, index) => insert.run({
      id: question.id || crypto.randomUUID(), surveyId: id, page: Number(question.page || 1), position: index,
      type: question.type || 'short_text', title: String(question.title || 'Untitled question'),
      description: String(question.description || ''), required: question.required ? 1 : 0,
      options: JSON.stringify(question.options || []), settings: JSON.stringify(question.settings || {}),
      logic: JSON.stringify(question.logic || [])
    }));
  }
  return getSurvey(id)!;
});

export function deleteSurvey(id: string) { return db.prepare('DELETE FROM surveys WHERE id=?').run(id).changes > 0; }

const rowCollector = (row: any): Collector => ({
  id: row.id, surveyId: row.survey_id, name: row.name, type: row.type, slug: row.slug,
  status: row.status, settings: parseJson(row.settings_json, {}), createdAt: row.created_at,
  publicUrl: `${config.publicUrl}/s/${row.slug}`
});

export function listCollectors(surveyId: string) {
  return (db.prepare(`SELECT c.*, COUNT(DISTINCT r.id) response_count, COUNT(DISTINCT p.id) recipient_count
    FROM collectors c LEFT JOIN responses r ON r.collector_id=c.id LEFT JOIN recipients p ON p.collector_id=c.id
    WHERE c.survey_id=? GROUP BY c.id ORDER BY c.created_at DESC`).all(surveyId) as any[]).map((row) => ({
      ...rowCollector(row), responseCount: Number(row.response_count), recipientCount: Number(row.recipient_count)
    }));
}

export function getCollectorBySlug(slug: string): Collector | null {
  const row = db.prepare('SELECT * FROM collectors WHERE slug=?').get(slug) as any;
  return row ? rowCollector(row) : null;
}

export function getCollector(id: string): Collector | null {
  const row = db.prepare('SELECT * FROM collectors WHERE id=?').get(id) as any;
  return row ? rowCollector(row) : null;
}

export function createCollector(surveyId: string, input: Partial<Collector>) {
  const id = crypto.randomUUID();
  const slug = String(input.slug || `${input.type || 'web'}-${crypto.randomBytes(6).toString('hex')}`).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  db.prepare('INSERT INTO collectors (id,survey_id,name,type,slug,status,settings_json,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, surveyId, input.name || 'Web link', input.type || 'web', slug, input.status || 'open', JSON.stringify(input.settings || {}), new Date().toISOString());
  return getCollectorBySlug(slug)!;
}

const rowResponse = (row: any): ResponseRecord => ({
  id: row.id, surveyId: row.survey_id, collectorId: row.collector_id, respondentToken: row.respondent_token,
  status: row.status, answers: parseJson(row.answers_json, {}), metadata: parseJson(row.metadata_json, {}),
  startedAt: row.started_at, completedAt: row.completed_at, durationSeconds: row.duration_seconds,
  aiAnalysis: parseJson(row.ai_analysis_json, null), analyzedAt: row.analyzed_at
});

export function listResponses(surveyId: string, limit = 500) {
  return (db.prepare('SELECT * FROM responses WHERE survey_id=? ORDER BY COALESCE(completed_at,started_at) DESC LIMIT ?').all(surveyId, limit) as any[]).map(rowResponse);
}

export function getResponse(id: string): ResponseRecord | null {
  const row = db.prepare('SELECT * FROM responses WHERE id=?').get(id) as any;
  return row ? rowResponse(row) : null;
}

export function createResponse(input: { surveyId: string; collectorId: string; respondentToken?: string; answers: Record<string, unknown>; metadata?: Record<string, unknown>; startedAt?: string; status?: 'partial' | 'completed' }) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const startedAt = input.startedAt || now;
  const completedAt = input.status === 'partial' ? null : now;
  const duration = completedAt ? Math.max(0, Math.round((Date.parse(completedAt) - Date.parse(startedAt)) / 1000)) : null;
  db.prepare(`INSERT INTO responses (id,survey_id,collector_id,respondent_token,status,answers_json,metadata_json,started_at,completed_at,duration_seconds)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, input.surveyId, input.collectorId, input.respondentToken || crypto.randomBytes(16).toString('hex'), input.status || 'completed', JSON.stringify(input.answers), JSON.stringify(input.metadata || {}), startedAt, completedAt, duration);
  return getResponse(id)!;
}

export function setResponseAnalysis(id: string, analysis: unknown) {
  db.prepare('UPDATE responses SET ai_analysis_json=?, analyzed_at=? WHERE id=?').run(JSON.stringify(analysis), new Date().toISOString(), id);
}

export function insertInsight(surveyId: string, kind: string, payload: unknown) {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO insights (id,survey_id,kind,payload_json,created_at) VALUES (?,?,?,?,?)').run(id, surveyId, kind, JSON.stringify(payload), new Date().toISOString());
  return { id, surveyId, kind, payload, createdAt: new Date().toISOString() };
}

export function listInsights(surveyId: string) {
  return (db.prepare('SELECT * FROM insights WHERE survey_id=? ORDER BY created_at DESC').all(surveyId) as any[]).map((row) => ({
    id: row.id, surveyId: row.survey_id, kind: row.kind, payload: parseJson(row.payload_json, {}), createdAt: row.created_at
  }));
}

export function rowJob(row: any): AiJob {
  return {
    id: row.id, kind: row.kind, surveyId: row.survey_id, responseId: row.response_id, state: row.state,
    stage: row.stage, progress: row.progress, attempt: row.attempt, input: parseJson(row.input_json, {}),
    result: parseJson(row.result_json, null), error: row.error, retryAt: row.retry_at,
    createdAt: row.created_at, startedAt: row.started_at, completedAt: row.completed_at, updatedAt: row.updated_at
  };
}

export function getJob(id: string): AiJob | null {
  const row = db.prepare('SELECT * FROM ai_jobs WHERE id=?').get(id) as any;
  return row ? rowJob(row) : null;
}

export function listJobs(limit = 100) {
  return (db.prepare('SELECT * FROM ai_jobs ORDER BY created_at DESC LIMIT ?').all(limit) as any[]).map(rowJob);
}

export function createJob(kind: AiJob['kind'], input: Record<string, unknown>, surveyId?: string | null, responseId?: string | null) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO ai_jobs (id,kind,survey_id,response_id,state,stage,progress,attempt,input_json,created_at,updated_at)
    VALUES (?,?,?,?, 'queued','queued',0,0,?,?,?)`).run(id, kind, surveyId || null, responseId || null, JSON.stringify(input), now, now);
  return getJob(id)!;
}

export const claimNextJob = db.transaction((): AiJob | null => {
  const now = new Date().toISOString();
  const row = db.prepare(`SELECT * FROM ai_jobs WHERE state='queued' AND (retry_at IS NULL OR retry_at<=?) ORDER BY created_at LIMIT 1`).get(now) as any;
  if (!row) return null;
  const changed = db.prepare(`UPDATE ai_jobs SET state='processing',stage='dispatching',progress=5,attempt=attempt+1,started_at=?,updated_at=? WHERE id=? AND state='queued'`).run(now, now, row.id).changes;
  return changed ? getJob(row.id) : null;
});

export function updateJob(id: string, values: { state?: AiJob['state']; stage?: string; progress?: number; result?: unknown; error?: string | null; retryAt?: string | null; completedAt?: string | null }) {
  const current = getJob(id);
  if (!current) return null;
  const now = new Date().toISOString();
  db.prepare(`UPDATE ai_jobs SET state=?,stage=?,progress=?,result_json=?,error=?,retry_at=?,completed_at=?,updated_at=? WHERE id=?`).run(
    values.state || current.state, values.stage || current.stage, values.progress ?? current.progress,
    values.result === undefined ? (current.result == null ? null : JSON.stringify(current.result)) : JSON.stringify(values.result),
    values.error === undefined ? current.error : values.error, values.retryAt === undefined ? current.retryAt : values.retryAt,
    values.completedAt === undefined ? current.completedAt : values.completedAt, now, id
  );
  return getJob(id);
}

const rowMention = (row: any): SocialMention => ({
  id: row.id, source: row.source, externalId: row.external_id, xConnectionId: row.x_connection_id,
  ingestionKind: row.ingestion_kind, author: row.author, content: row.content, url: row.url,
  language: row.language, publishedAt: row.published_at, metadata: parseJson(row.metadata_json, {}),
  analysis: parseJson(row.analysis_json, null), createdAt: row.created_at
});

export function listSocialMentions(limit = 500) {
  return (db.prepare('SELECT * FROM social_mentions ORDER BY published_at DESC LIMIT ?').all(limit) as any[]).map(rowMention);
}

export function listSocialMentionsByIds(ids: string[]) {
  const unique = [...new Set(ids)].slice(0, 200);
  if (!unique.length) return [];
  const placeholders = unique.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM social_mentions WHERE id IN (${placeholders})`).all(...unique) as any[];
  const byId = new Map(rows.map((row) => [row.id, rowMention(row)]));
  return unique.map((id) => byId.get(id)).filter((item): item is SocialMention => Boolean(item));
}

export const insertSocialMentions = db.transaction((items: Array<Partial<SocialMention> & { content: string; source: SocialMention['source'] }>) => {
  const insert = db.prepare(`INSERT OR IGNORE INTO social_mentions (id,source,external_id,x_connection_id,ingestion_kind,author,content,url,language,published_at,metadata_json,analysis_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const now = new Date().toISOString();
  return items.map((item) => {
    const id = item.id || crypto.randomUUID();
    insert.run(id, item.source, item.externalId || null, item.xConnectionId || null, item.ingestionKind || null, item.author || '', item.content.trim(), item.url || '', item.language || '', item.publishedAt || now, JSON.stringify(item.metadata || {}), item.analysis ? JSON.stringify(item.analysis) : null, now);
    const row = db.prepare('SELECT * FROM social_mentions WHERE id=?').get(id)
      || (item.externalId ? db.prepare('SELECT * FROM social_mentions WHERE source=? AND external_id=?').get(item.source, item.externalId) : null);
    return rowMention(row);
  });
});

export function setSocialMentionAnalysis(id: string, analysis: unknown) {
  db.prepare('UPDATE social_mentions SET analysis_json=? WHERE id=?').run(JSON.stringify(analysis), id);
}

const rowJourney = (row: any): Journey => ({
  id: row.id, name: row.name, audience: row.audience, objective: row.objective, industry: row.industry,
  stages: parseJson(row.stages_json, []), summary: row.summary, createdAt: row.created_at, updatedAt: row.updated_at
});

export function listJourneys() { return (db.prepare('SELECT * FROM journeys ORDER BY updated_at DESC').all() as any[]).map(rowJourney); }
export function getJourney(id: string): Journey | null { const row = db.prepare('SELECT * FROM journeys WHERE id=?').get(id) as any; return row ? rowJourney(row) : null; }
export function saveJourney(input: Partial<Journey> & { name: string }) {
  const now = new Date().toISOString(); const id = input.id || crypto.randomUUID();
  db.prepare(`INSERT INTO journeys (id,name,audience,objective,industry,stages_json,summary,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,audience=excluded.audience,objective=excluded.objective,industry=excluded.industry,stages_json=excluded.stages_json,summary=excluded.summary,updated_at=excluded.updated_at`)
    .run(id, input.name.trim(), input.audience || '', input.objective || '', input.industry || '', JSON.stringify(input.stages || []), input.summary || '', input.createdAt || now, now);
  return getJourney(id)!;
}
export function deleteJourney(id: string) { return db.prepare('DELETE FROM journeys WHERE id=?').run(id).changes > 0; }

db.prepare(`UPDATE ai_jobs SET state='queued',stage='recovered_after_restart',progress=0,started_at=NULL,retry_at=NULL,updated_at=? WHERE state='processing'`).run(new Date().toISOString());
db.prepare(`UPDATE x_sync_jobs SET state='queued',stage='recovered_after_restart',progress=0,started_at=NULL,run_after=NULL,updated_at=? WHERE state='processing'`).run(new Date().toISOString());
db.prepare("UPDATE campaigns SET status='active' WHERE status='running'").run();

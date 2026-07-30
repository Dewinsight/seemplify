import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { config } from './config.js';
import type { AiJob, Collector, Journey, JourneyProvenance, JourneyVersion, JourneyVersionSummary, Question, ResponseRecord, SocialMention, Survey } from './types.js';

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
    requested_by TEXT REFERENCES users(id) ON DELETE CASCADE,
    state TEXT NOT NULL DEFAULT 'queued',
    stage TEXT NOT NULL DEFAULT 'queued',
    progress INTEGER NOT NULL DEFAULT 0,
    attempt INTEGER NOT NULL DEFAULT 0,
    input_json TEXT NOT NULL DEFAULT '{}',
    provider_result_json TEXT,
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
    client_id_enc TEXT,
    client_secret_enc TEXT,
    billing_status TEXT NOT NULL DEFAULT 'unknown',
    billing_problem_type TEXT,
    billing_checked_at TEXT,
    credential_version INTEGER NOT NULL DEFAULT 1,
    configured_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS x_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    app_id TEXT NOT NULL REFERENCES x_apps(id) ON DELETE CASCADE,
    access_token_enc TEXT NOT NULL,
    access_token_secret_enc TEXT,
    refresh_token_enc TEXT,
    auth_type TEXT NOT NULL DEFAULT 'oauth1',
    scopes_json TEXT NOT NULL DEFAULT '[]',
    token_expires_at TEXT,
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
    oldest_post_id TEXT,
    oldest_mention_id TEXT,
    post_backlog_token TEXT,
    post_backlog_since_id TEXT,
    post_backlog_newest_id TEXT,
    post_backlog_low_id TEXT,
    post_history_exhausted INTEGER NOT NULL DEFAULT 0,
    mention_backlog_token TEXT,
    mention_backlog_since_id TEXT,
    mention_backlog_newest_id TEXT,
    mention_backlog_low_id TEXT,
    mention_history_exhausted INTEGER NOT NULL DEFAULT 0,
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
    flow TEXT NOT NULL DEFAULT 'oauth1',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS x_oauth_requests_expiry ON x_oauth_requests(expires_at,consumed_at);
  CREATE TABLE IF NOT EXISTS x_listening_queries (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES x_connections(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    query TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    configuration_version INTEGER NOT NULL DEFAULT 1,
    since_id TEXT,
    oldest_id TEXT,
    backlog_token TEXT,
    backlog_since_id TEXT,
    backlog_newest_id TEXT,
    backlog_low_id TEXT,
    history_exhausted INTEGER NOT NULL DEFAULT 0,
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
    credit_probe INTEGER NOT NULL DEFAULT 0,
    requested_limit INTEGER NOT NULL DEFAULT 50,
    streams_json TEXT NOT NULL DEFAULT '["account_posts","mentions","searches"]',
    reused_count INTEGER NOT NULL DEFAULT 0,
    provider_requests INTEGER NOT NULL DEFAULT 0,
    maximum_posts_read INTEGER NOT NULL DEFAULT 50,
    has_more INTEGER NOT NULL DEFAULT 0,
    deferred_search_queries INTEGER NOT NULL DEFAULT 0,
    selected_query_ids_json TEXT NOT NULL DEFAULT '[]',
    idempotency_key TEXT,
    estimate_json TEXT,
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
  CREATE INDEX IF NOT EXISTS x_sync_jobs_connection_state ON x_sync_jobs(connection_id,state,created_at);
  CREATE TABLE IF NOT EXISTS x_sync_target_checkpoints (
    job_id TEXT NOT NULL REFERENCES x_sync_jobs(id) ON DELETE CASCADE,
    target_key TEXT NOT NULL,
    target_order INTEGER NOT NULL,
    stream TEXT NOT NULL,
    query_id TEXT,
    query_text TEXT,
    query_updated_at TEXT,
    query_version INTEGER,
    budget INTEGER NOT NULL,
    fetched_count INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'queued',
    pagination_token TEXT,
    start_since_id TEXT,
    start_until_id TEXT,
    target_newest_id TEXT,
    last_low_id TEXT,
    token_fallback_used INTEGER NOT NULL DEFAULT 0,
    empty_page_hops INTEGER NOT NULL DEFAULT 0,
    page_requests INTEGER NOT NULL DEFAULT 0,
    has_more INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(job_id,target_key)
  );
  CREATE INDEX IF NOT EXISTS x_sync_target_checkpoints_state ON x_sync_target_checkpoints(job_id,state,target_order);
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
  CREATE TABLE IF NOT EXISTS social_reply_drafts (
    id TEXT PRIMARY KEY,
    mention_id TEXT NOT NULL REFERENCES social_mentions(id) ON DELETE CASCADE,
    connection_id TEXT REFERENCES x_connections(id) ON DELETE SET NULL,
    requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tone TEXT NOT NULL DEFAULT 'helpful',
    instructions TEXT NOT NULL DEFAULT '',
    source_snapshot_json TEXT NOT NULL DEFAULT '{}',
    state TEXT NOT NULL DEFAULT 'queued',
    generated_content TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    rationale TEXT NOT NULL DEFAULT '',
    safety_flags_json TEXT NOT NULL DEFAULT '[]',
    runtime_json TEXT,
    ai_job_id TEXT UNIQUE,
    idempotency_key TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS social_reply_drafts_mention ON social_reply_drafts(mention_id,created_at DESC);
  CREATE TABLE IF NOT EXISTS social_intelligence_reports (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id TEXT REFERENCES x_connections(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    mention_ids_json TEXT NOT NULL DEFAULT '[]',
    source_snapshot_json TEXT NOT NULL DEFAULT '[]',
    state TEXT NOT NULL DEFAULT 'queued',
    result_json TEXT,
    runtime_json TEXT,
    ai_job_id TEXT UNIQUE,
    idempotency_key TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS social_intelligence_reports_user ON social_intelligence_reports(user_id,created_at DESC);
  CREATE TABLE IF NOT EXISTS intelligence_reports (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    objective TEXT NOT NULL DEFAULT '',
    source_refs_json TEXT NOT NULL DEFAULT '{}',
    source_snapshot_json TEXT NOT NULL DEFAULT '[]',
    knowledge_refs_json TEXT NOT NULL DEFAULT '[]',
    state TEXT NOT NULL DEFAULT 'queued',
    result_json TEXT,
    runtime_json TEXT,
    ai_job_id TEXT UNIQUE,
    idempotency_key TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS intelligence_reports_user ON intelligence_reports(user_id,created_at DESC);
  CREATE TABLE IF NOT EXISTS journeys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    audience TEXT NOT NULL DEFAULT '',
    objective TEXT NOT NULL DEFAULT '',
    industry TEXT NOT NULL DEFAULT '',
    stages_json TEXT NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL DEFAULT '',
    provenance_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS journey_versions (
    id TEXT PRIMARY KEY,
    journey_id TEXT NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    actor TEXT NOT NULL,
    source_job_id TEXT,
    snapshot_json TEXT NOT NULL,
    snapshot_name TEXT NOT NULL,
    stage_count INTEGER NOT NULL,
    snapshot_bytes INTEGER NOT NULL,
    snapshot_updated_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(journey_id,snapshot_updated_at)
  );
  CREATE INDEX IF NOT EXISTS journey_versions_history ON journey_versions(journey_id,created_at DESC);
  CREATE TABLE IF NOT EXISTS journey_ai_applications (
    job_id TEXT PRIMARY KEY REFERENCES ai_jobs(id) ON DELETE CASCADE,
    journey_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS journey_ai_applications_journey ON journey_ai_applications(journey_id,created_at DESC);
  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    collector_id TEXT NOT NULL REFERENCES collectors(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sender_name TEXT NOT NULL DEFAULT '' CHECK(length(sender_name) <= 150),
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

const applyAccountLifecycleSchema = db.transaction(() => {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(3);
  if (applied) return;
  const existingUsers = Number((db.prepare('SELECT COUNT(*) count FROM users').get() as { count: number }).count || 0);
  const userColumns = new Set((db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>).map((column) => column.name));
  if (!userColumns.has('email_verified_at')) db.exec('ALTER TABLE users ADD COLUMN email_verified_at TEXT');
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      pending_invitation_id TEXT,
      expires_at TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS email_verification_lookup
      ON email_verification_tokens(token_hash,used_at,expires_at);
    CREATE INDEX IF NOT EXISTS email_verification_user_recent
      ON email_verification_tokens(user_id,sent_at DESC);
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      job_title TEXT NOT NULL DEFAULT '',
      organization_name TEXT NOT NULL DEFAULT '',
      timezone TEXT NOT NULL DEFAULT '',
      primary_goal TEXT NOT NULL DEFAULT '',
      onboarding_version INTEGER NOT NULL DEFAULT 0,
      onboarding_completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  if (existingUsers > 0) {
    // Accounts that predate verification and onboarding have already been in
    // active use. Grandfather them exactly once so rollout cannot lock them out.
    db.prepare('UPDATE users SET email_verified_at=COALESCE(email_verified_at,created_at)').run();
    db.prepare(`INSERT OR IGNORE INTO user_profiles
      (user_id,job_title,organization_name,timezone,primary_goal,onboarding_version,onboarding_completed_at,created_at,updated_at)
      SELECT id,'','','','',1,created_at,created_at,updated_at FROM users`).run();
  }
  db.prepare('INSERT INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)')
    .run(3, 'account_verification_and_profiles', new Date().toISOString());
});
applyAccountLifecycleSchema();

const applyAccountClaimSchema = db.transaction(() => {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(4);
  if (applied) return;
  const verificationColumns = new Set((db.prepare('PRAGMA table_info(email_verification_tokens)').all() as Array<{ name: string }>).map((column) => column.name));
  if (!verificationColumns.has('pending_password_hash')) {
    db.exec('ALTER TABLE email_verification_tokens ADD COLUMN pending_password_hash TEXT');
  }
  db.prepare('INSERT INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)')
    .run(4, 'safe_unverified_account_claims', new Date().toISOString());
});
applyAccountClaimSchema();

const applyVerifiedClaimSchema = db.transaction(() => {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(5);
  if (applied) return;
  const verificationColumns = new Set((db.prepare('PRAGMA table_info(email_verification_tokens)').all() as Array<{ name: string }>).map((column) => column.name));
  if (!verificationColumns.has('requires_password_setup')) {
    db.exec('ALTER TABLE email_verification_tokens ADD COLUMN requires_password_setup INTEGER NOT NULL DEFAULT 0');
  }
  if (!verificationColumns.has('delivery_failed_at')) {
    db.exec('ALTER TABLE email_verification_tokens ADD COLUMN delivery_failed_at TEXT');
  }
  const resetColumns = new Set((db.prepare('PRAGMA table_info(password_reset_tokens)').all() as Array<{ name: string }>).map((column) => column.name));
  if (!resetColumns.has('pending_invitation_id')) {
    db.exec('ALTER TABLE password_reset_tokens ADD COLUMN pending_invitation_id TEXT');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_email_attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL,
      delivered_at TEXT,
      failed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS account_email_attempts_user_recent
      ON account_email_attempts(user_id,created_at DESC);
  `);
  db.prepare('INSERT INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)')
    .run(5, 'verified_account_claims_and_mail_limits', new Date().toISOString());
});
applyVerifiedClaimSchema();

const applyPersistentAccountClaimState = db.transaction(() => {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(6);
  if (applied) return;
  const userColumns = new Set((db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>).map((column) => column.name));
  if (!userColumns.has('password_claim_required')) {
    db.exec('ALTER TABLE users ADD COLUMN password_claim_required INTEGER NOT NULL DEFAULT 0');
  }
  db.prepare('INSERT INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)')
    .run(6, 'persistent_account_claim_state', new Date().toISOString());
});
applyPersistentAccountClaimState();

const applyAccountAbuseProtection = db.transaction(() => {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(7);
  if (applied) return;
  const verificationColumns = new Set((db.prepare('PRAGMA table_info(email_verification_tokens)').all() as Array<{ name: string }>).map((column) => column.name));
  if (!verificationColumns.has('resend_exemption_used_at')) {
    db.exec('ALTER TABLE email_verification_tokens ADD COLUMN resend_exemption_used_at TEXT');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_login_attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS auth_login_attempts_user_recent
      ON auth_login_attempts(user_id,created_at DESC);
  `);
  db.prepare('INSERT INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)')
    .run(7, 'account_abuse_protection', new Date().toISOString());
});
applyAccountAbuseProtection();

const applyPrivateLoginIdentityThrottle = db.transaction(() => {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(8);
  if (applied) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_identity_attempts (
      id TEXT PRIMARY KEY,
      identity_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS auth_identity_attempts_recent
      ON auth_identity_attempts(identity_hash,created_at DESC);
  `);
  db.prepare('INSERT INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)')
    .run(8, 'private_login_identity_throttle', new Date().toISOString());
});
applyPrivateLoginIdentityThrottle();

const applyAccountReturnIntent = db.transaction(() => {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(10);
  if (applied) return;
  const verificationColumns = new Set((db.prepare('PRAGMA table_info(email_verification_tokens)').all() as Array<{ name: string }>).map((column) => column.name));
  if (!verificationColumns.has('return_path')) {
    db.exec('ALTER TABLE email_verification_tokens ADD COLUMN return_path TEXT');
  }
  const resetColumns = new Set((db.prepare('PRAGMA table_info(password_reset_tokens)').all() as Array<{ name: string }>).map((column) => column.name));
  if (!resetColumns.has('return_path')) {
    db.exec('ALTER TABLE password_reset_tokens ADD COLUMN return_path TEXT');
  }
  db.prepare('INSERT INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)')
    .run(10, 'account_return_intent', new Date().toISOString());
});
applyAccountReturnIntent();

const applyTutorialProgressSchema = db.transaction(() => {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(11);
  if (applied) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS tutorial_progress (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tutorial_key TEXT NOT NULL,
      version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 10000),
      status TEXT NOT NULL CHECK(status IN ('in_progress','completed','dismissed')),
      last_step INTEGER CHECK(last_step IS NULL OR last_step BETWEEN 0 AND 10000),
      first_opened_at TEXT NOT NULL,
      completed_at TEXT,
      dismissed_at TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,tutorial_key)
    );
    CREATE INDEX IF NOT EXISTS tutorial_progress_user_updated
      ON tutorial_progress(user_id,updated_at DESC);
  `);
  db.prepare('INSERT INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)')
    .run(11, 'account_tutorial_progress', new Date().toISOString());
});
applyTutorialProgressSchema();

const applyCampaignSenderNameSchema = db.transaction(() => {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(12);
  if (applied) return;
  const columns = new Set((db.prepare('PRAGMA table_info(campaigns)').all() as Array<{ name: string }>).map((column) => column.name));
  if (!columns.has('sender_name')) {
    db.exec("ALTER TABLE campaigns ADD COLUMN sender_name TEXT NOT NULL DEFAULT '' CHECK(length(sender_name) <= 150)");
  }
  const senderName = String(config.brevoFromName || '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 150) || 'Experience Management';
  db.prepare("UPDATE campaigns SET sender_name=? WHERE trim(sender_name)='' ").run(senderName);
  db.prepare('INSERT INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)')
    .run(12, 'campaign_sender_display_name', new Date().toISOString());
});
applyCampaignSenderNameSchema();

const applyReusableEsignSignatureSchema = db.transaction(() => {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(13);
  if (applied) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS esign_saved_signatures (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      recipient_identity_hash TEXT,
      mode TEXT NOT NULL CHECK(mode IN ('typed','drawn','uploaded')),
      label TEXT NOT NULL DEFAULT '',
      mime_type TEXT,
      display_text_enc TEXT,
      storage_key TEXT UNIQUE,
      sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT,
      CHECK(owner_user_id IS NOT NULL OR recipient_identity_hash IS NOT NULL),
      CHECK(
        (mode='typed' AND display_text_enc IS NOT NULL AND storage_key IS NULL AND mime_type IS NULL)
        OR (mode IN ('drawn','uploaded') AND display_text_enc IS NULL AND storage_key IS NOT NULL AND mime_type IN ('image/png','image/jpeg'))
      )
    );
    CREATE INDEX IF NOT EXISTS esign_saved_signatures_user
      ON esign_saved_signatures(owner_user_id,updated_at DESC) WHERE owner_user_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS esign_saved_signatures_recipient
      ON esign_saved_signatures(recipient_identity_hash,updated_at DESC) WHERE recipient_identity_hash IS NOT NULL;

    CREATE TABLE IF NOT EXISTS esign_saved_signature_events (
      id TEXT PRIMARY KEY,
      signature_id TEXT,
      owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      recipient_identity_hash TEXT,
      envelope_id TEXT REFERENCES esign_envelopes(id) ON DELETE SET NULL,
      recipient_id TEXT REFERENCES esign_recipients(id) ON DELETE SET NULL,
      actor_type TEXT NOT NULL,
      event_type TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS esign_saved_signature_events_user
      ON esign_saved_signature_events(owner_user_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS esign_saved_signature_events_recipient
      ON esign_saved_signature_events(recipient_identity_hash,created_at DESC);
  `);
  db.prepare('INSERT INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)')
    .run(13, 'reusable_esign_signatures', new Date().toISOString());
});
applyReusableEsignSignatureSchema();

// Migration 13 briefly shipped during development with an exclusive owner
// constraint. Rebuild only that early table shape so account-owned signatures
// can also carry the recipient identity used by a later signing invitation.
const applyReusableEsignSignatureIdentitySchema = db.transaction(() => {
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(14);
  if (applied) return;
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='esign_saved_signatures'").get() as { sql?: string } | undefined;
  const supportsDualIdentity = /CHECK\s*\(\s*owner_user_id\s+IS\s+NOT\s+NULL\s+OR\s+recipient_identity_hash\s+IS\s+NOT\s+NULL\s*\)/iu.test(table?.sql || '');
  if (!supportsDualIdentity) {
    db.exec(`
      DROP TABLE IF EXISTS esign_saved_signatures_v14;
      CREATE TABLE esign_saved_signatures_v14 (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        recipient_identity_hash TEXT,
        mode TEXT NOT NULL CHECK(mode IN ('typed','drawn','uploaded')),
        label TEXT NOT NULL DEFAULT '',
        mime_type TEXT,
        display_text_enc TEXT,
        storage_key TEXT UNIQUE,
        sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_used_at TEXT,
        CHECK(owner_user_id IS NOT NULL OR recipient_identity_hash IS NOT NULL),
        CHECK(
          (mode='typed' AND display_text_enc IS NOT NULL AND storage_key IS NULL AND mime_type IS NULL)
          OR (mode IN ('drawn','uploaded') AND display_text_enc IS NULL AND storage_key IS NOT NULL AND mime_type IN ('image/png','image/jpeg'))
        )
      );
      INSERT INTO esign_saved_signatures_v14
        (id,owner_user_id,recipient_identity_hash,mode,label,mime_type,display_text_enc,storage_key,sha256,created_at,updated_at,last_used_at)
      SELECT id,owner_user_id,recipient_identity_hash,mode,label,mime_type,display_text_enc,storage_key,sha256,created_at,updated_at,last_used_at
        FROM esign_saved_signatures;
      DROP TABLE esign_saved_signatures;
      ALTER TABLE esign_saved_signatures_v14 RENAME TO esign_saved_signatures;
      CREATE INDEX esign_saved_signatures_user
        ON esign_saved_signatures(owner_user_id,updated_at DESC) WHERE owner_user_id IS NOT NULL;
      CREATE INDEX esign_saved_signatures_recipient
        ON esign_saved_signatures(recipient_identity_hash,updated_at DESC) WHERE recipient_identity_hash IS NOT NULL;
    `);
  }
  db.prepare('INSERT INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)')
    .run(14, 'reusable_esign_signature_identity_scope', new Date().toISOString());
});
applyReusableEsignSignatureIdentitySchema();

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
const journeyColumns = new Set((db.prepare('PRAGMA table_info(journeys)').all() as any[]).map((column) => String(column.name)));
if (!journeyColumns.has('provenance_json')) db.exec("ALTER TABLE journeys ADD COLUMN provenance_json TEXT NOT NULL DEFAULT '{}'");
const journeyVersionColumns = new Set((db.prepare('PRAGMA table_info(journey_versions)').all() as any[]).map((column) => String(column.name)));
if (!journeyVersionColumns.has('snapshot_name')) db.exec("ALTER TABLE journey_versions ADD COLUMN snapshot_name TEXT NOT NULL DEFAULT ''");
if (!journeyVersionColumns.has('stage_count')) db.exec('ALTER TABLE journey_versions ADD COLUMN stage_count INTEGER NOT NULL DEFAULT 0');
if (!journeyVersionColumns.has('snapshot_bytes')) db.exec('ALTER TABLE journey_versions ADD COLUMN snapshot_bytes INTEGER NOT NULL DEFAULT 0');
for (const row of db.prepare('SELECT id,snapshot_json FROM journey_versions WHERE snapshot_bytes=0 OR snapshot_name=?').all('') as Array<{ id: string; snapshot_json: string }>) {
  let name = ''; let stageCount = 0;
  try { const snapshot = JSON.parse(row.snapshot_json); name = String(snapshot?.name || ''); stageCount = Array.isArray(snapshot?.stages) ? snapshot.stages.length : 0; } catch { /* retain safe migration defaults for corrupt legacy snapshots */ }
  db.prepare('UPDATE journey_versions SET snapshot_name=?,stage_count=?,snapshot_bytes=? WHERE id=?')
    .run(name, stageCount, Buffer.byteLength(row.snapshot_json, 'utf8'), row.id);
}
const activeJourneyOptimizations = db.prepare(`SELECT id,state,input_json FROM ai_jobs
  WHERE kind='journey.optimize' AND state IN ('queued','processing')
  ORDER BY CASE state WHEN 'processing' THEN 0 ELSE 1 END,created_at,id`).all() as Array<{ id: string; state: string; input_json: string }>;
const retainedJourneyOptimizations = new Set<string>();
for (const row of activeJourneyOptimizations) {
  let journeyId = '';
  try { journeyId = String(JSON.parse(row.input_json || '{}').journeyId || ''); } catch { /* malformed legacy jobs cannot be deduplicated */ }
  if (!journeyId || !retainedJourneyOptimizations.has(journeyId)) { if (journeyId) retainedJourneyOptimizations.add(journeyId); continue; }
  const now = new Date().toISOString();
  db.prepare(`UPDATE ai_jobs SET state='failed',stage='duplicate_journey_optimization',progress=100,
    error='A duplicate optimization was removed during queue recovery.',retry_at=NULL,completed_at=?,updated_at=? WHERE id=?`)
    .run(now, now, row.id);
}
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ai_jobs_one_active_journey_optimize
  ON ai_jobs(CASE WHEN json_valid(input_json) THEN json_extract(input_json,'$.journeyId') END)
  WHERE kind='journey.optimize' AND state IN ('queued','processing')`);
if (!new Set((db.prepare('PRAGMA table_info(social_mentions)').all() as Array<{ name: string }>).map((column) => column.name)).has('space_id')) {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS social_mentions_x_external ON social_mentions(source,external_id) WHERE external_id IS NOT NULL');
}
const xAppColumns = new Set((db.prepare('PRAGMA table_info(x_apps)').all() as any[]).map((column) => String(column.name)));
if (!xAppColumns.has('client_id_enc')) db.exec('ALTER TABLE x_apps ADD COLUMN client_id_enc TEXT');
if (!xAppColumns.has('client_secret_enc')) db.exec('ALTER TABLE x_apps ADD COLUMN client_secret_enc TEXT');
if (!xAppColumns.has('billing_status')) db.exec("ALTER TABLE x_apps ADD COLUMN billing_status TEXT NOT NULL DEFAULT 'unknown'");
if (!xAppColumns.has('billing_problem_type')) db.exec('ALTER TABLE x_apps ADD COLUMN billing_problem_type TEXT');
if (!xAppColumns.has('billing_checked_at')) db.exec('ALTER TABLE x_apps ADD COLUMN billing_checked_at TEXT');
const xOAuthColumns = new Set((db.prepare('PRAGMA table_info(x_oauth_requests)').all() as any[]).map((column) => String(column.name)));
if (!xOAuthColumns.has('flow')) db.exec("ALTER TABLE x_oauth_requests ADD COLUMN flow TEXT NOT NULL DEFAULT 'oauth1'");
const xConnectionCursorColumns = new Set((db.prepare('PRAGMA table_info(x_connections)').all() as any[]).map((column) => String(column.name)));
if (!xConnectionCursorColumns.has('oldest_post_id')) db.exec('ALTER TABLE x_connections ADD COLUMN oldest_post_id TEXT');
if (!xConnectionCursorColumns.has('oldest_mention_id')) db.exec('ALTER TABLE x_connections ADD COLUMN oldest_mention_id TEXT');
if (!xConnectionCursorColumns.has('post_backlog_token')) db.exec('ALTER TABLE x_connections ADD COLUMN post_backlog_token TEXT');
if (!xConnectionCursorColumns.has('post_backlog_since_id')) db.exec('ALTER TABLE x_connections ADD COLUMN post_backlog_since_id TEXT');
if (!xConnectionCursorColumns.has('post_backlog_newest_id')) db.exec('ALTER TABLE x_connections ADD COLUMN post_backlog_newest_id TEXT');
if (!xConnectionCursorColumns.has('post_backlog_low_id')) db.exec('ALTER TABLE x_connections ADD COLUMN post_backlog_low_id TEXT');
if (!xConnectionCursorColumns.has('post_history_exhausted')) db.exec('ALTER TABLE x_connections ADD COLUMN post_history_exhausted INTEGER NOT NULL DEFAULT 0');
if (!xConnectionCursorColumns.has('mention_backlog_token')) db.exec('ALTER TABLE x_connections ADD COLUMN mention_backlog_token TEXT');
if (!xConnectionCursorColumns.has('mention_backlog_since_id')) db.exec('ALTER TABLE x_connections ADD COLUMN mention_backlog_since_id TEXT');
if (!xConnectionCursorColumns.has('mention_backlog_newest_id')) db.exec('ALTER TABLE x_connections ADD COLUMN mention_backlog_newest_id TEXT');
if (!xConnectionCursorColumns.has('mention_backlog_low_id')) db.exec('ALTER TABLE x_connections ADD COLUMN mention_backlog_low_id TEXT');
if (!xConnectionCursorColumns.has('mention_history_exhausted')) db.exec('ALTER TABLE x_connections ADD COLUMN mention_history_exhausted INTEGER NOT NULL DEFAULT 0');
const xQueryCursorColumns = new Set((db.prepare('PRAGMA table_info(x_listening_queries)').all() as any[]).map((column) => String(column.name)));
if (!xQueryCursorColumns.has('oldest_id')) db.exec('ALTER TABLE x_listening_queries ADD COLUMN oldest_id TEXT');
if (!xQueryCursorColumns.has('backlog_token')) db.exec('ALTER TABLE x_listening_queries ADD COLUMN backlog_token TEXT');
if (!xQueryCursorColumns.has('backlog_since_id')) db.exec('ALTER TABLE x_listening_queries ADD COLUMN backlog_since_id TEXT');
if (!xQueryCursorColumns.has('backlog_newest_id')) db.exec('ALTER TABLE x_listening_queries ADD COLUMN backlog_newest_id TEXT');
if (!xQueryCursorColumns.has('backlog_low_id')) db.exec('ALTER TABLE x_listening_queries ADD COLUMN backlog_low_id TEXT');
if (!xQueryCursorColumns.has('history_exhausted')) db.exec('ALTER TABLE x_listening_queries ADD COLUMN history_exhausted INTEGER NOT NULL DEFAULT 0');
if (!xQueryCursorColumns.has('configuration_version')) db.exec('ALTER TABLE x_listening_queries ADD COLUMN configuration_version INTEGER NOT NULL DEFAULT 1');
const xSyncJobColumns = new Set((db.prepare('PRAGMA table_info(x_sync_jobs)').all() as any[]).map((column) => String(column.name)));
if (!xSyncJobColumns.has('credit_probe')) db.exec('ALTER TABLE x_sync_jobs ADD COLUMN credit_probe INTEGER NOT NULL DEFAULT 0');
if (!xSyncJobColumns.has('requested_limit')) db.exec('ALTER TABLE x_sync_jobs ADD COLUMN requested_limit INTEGER NOT NULL DEFAULT 50');
if (!xSyncJobColumns.has('streams_json')) db.exec(`ALTER TABLE x_sync_jobs ADD COLUMN streams_json TEXT NOT NULL DEFAULT '["account_posts","mentions","searches"]'`);
if (!xSyncJobColumns.has('reused_count')) db.exec('ALTER TABLE x_sync_jobs ADD COLUMN reused_count INTEGER NOT NULL DEFAULT 0');
if (!xSyncJobColumns.has('provider_requests')) db.exec('ALTER TABLE x_sync_jobs ADD COLUMN provider_requests INTEGER NOT NULL DEFAULT 0');
if (!xSyncJobColumns.has('maximum_posts_read')) db.exec('ALTER TABLE x_sync_jobs ADD COLUMN maximum_posts_read INTEGER NOT NULL DEFAULT 50');
if (!xSyncJobColumns.has('has_more')) db.exec('ALTER TABLE x_sync_jobs ADD COLUMN has_more INTEGER NOT NULL DEFAULT 0');
if (!xSyncJobColumns.has('deferred_search_queries')) db.exec('ALTER TABLE x_sync_jobs ADD COLUMN deferred_search_queries INTEGER NOT NULL DEFAULT 0');
if (!xSyncJobColumns.has('selected_query_ids_json')) db.exec("ALTER TABLE x_sync_jobs ADD COLUMN selected_query_ids_json TEXT NOT NULL DEFAULT '[]'");
if (!xSyncJobColumns.has('idempotency_key')) db.exec('ALTER TABLE x_sync_jobs ADD COLUMN idempotency_key TEXT');
if (!xSyncJobColumns.has('estimate_json')) db.exec('ALTER TABLE x_sync_jobs ADD COLUMN estimate_json TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS x_sync_jobs_idempotency ON x_sync_jobs(connection_id,idempotency_key) WHERE idempotency_key IS NOT NULL');
db.exec('DROP INDEX IF EXISTS x_sync_jobs_one_active; CREATE INDEX IF NOT EXISTS x_sync_jobs_connection_state ON x_sync_jobs(connection_id,state,created_at)');
db.exec(`CREATE TABLE IF NOT EXISTS x_sync_target_checkpoints (
    job_id TEXT NOT NULL REFERENCES x_sync_jobs(id) ON DELETE CASCADE,
    target_key TEXT NOT NULL,target_order INTEGER NOT NULL,stream TEXT NOT NULL,query_id TEXT,query_text TEXT,query_updated_at TEXT,query_version INTEGER,
    budget INTEGER NOT NULL,fetched_count INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL DEFAULT 'queued',pagination_token TEXT,
    start_since_id TEXT,start_until_id TEXT,target_newest_id TEXT,last_low_id TEXT,token_fallback_used INTEGER NOT NULL DEFAULT 0,
    empty_page_hops INTEGER NOT NULL DEFAULT 0,page_requests INTEGER NOT NULL DEFAULT 0,has_more INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,completed_at TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(job_id,target_key)
  );
  CREATE INDEX IF NOT EXISTS x_sync_target_checkpoints_state ON x_sync_target_checkpoints(job_id,state,target_order);`);
const xSyncTargetColumns = new Set((db.prepare('PRAGMA table_info(x_sync_target_checkpoints)').all() as any[]).map((column) => String(column.name)));
if (!xSyncTargetColumns.has('last_low_id')) db.exec('ALTER TABLE x_sync_target_checkpoints ADD COLUMN last_low_id TEXT');
if (!xSyncTargetColumns.has('query_version')) db.exec('ALTER TABLE x_sync_target_checkpoints ADD COLUMN query_version INTEGER');
if (!xSyncTargetColumns.has('token_fallback_used')) db.exec('ALTER TABLE x_sync_target_checkpoints ADD COLUMN token_fallback_used INTEGER NOT NULL DEFAULT 0');
if (!xSyncTargetColumns.has('empty_page_hops')) db.exec('ALTER TABLE x_sync_target_checkpoints ADD COLUMN empty_page_hops INTEGER NOT NULL DEFAULT 0');
if (!xSyncTargetColumns.has('page_requests')) db.exec('ALTER TABLE x_sync_target_checkpoints ADD COLUMN page_requests INTEGER NOT NULL DEFAULT 0');
// Jobs created by releases before page checkpoints cannot safely resume after
// any provider rows were counted: granting a fresh budget could exceed the
// advertised ceiling and charge for the first page twice. Keep the audit row,
// but require the operator to start a new cursor-safe request.
const cursorUpgradeAt = new Date().toISOString();
db.prepare(`UPDATE x_sync_jobs SET state='cancelled',stage='cursor_upgrade_required',progress=100,
  error='This X job predates immutable cursor checkpoints. Start a new sync to continue safely.',
  run_after=NULL,completed_at=?,updated_at=?
  WHERE state IN ('queued','processing','waiting_rate_limit','waiting_billing')
    AND ((trigger_type='expansion' AND (estimate_json IS NULL OR NOT EXISTS (
      SELECT 1 FROM x_sync_target_checkpoints checkpoint WHERE checkpoint.job_id=x_sync_jobs.id)))
      OR (posts_fetched+mentions_fetched+search_fetched>0 AND NOT EXISTS (
        SELECT 1 FROM x_sync_target_checkpoints checkpoint WHERE checkpoint.job_id=x_sync_jobs.id)))`)
  .run(cursorUpgradeAt, cursorUpgradeAt);
// Preserve both ends of each collected stream. The high-water IDs prevent
// routine syncs from paying for already-seen posts, while the low-water IDs
// let an explicit historical expansion continue backwards without changing
// the incremental cursor or re-reading the current page.
db.exec(`UPDATE x_connections SET oldest_post_id=(
    SELECT m.external_id FROM x_connection_mentions cm JOIN social_mentions m ON m.id=cm.mention_id
    WHERE cm.connection_id=x_connections.id AND m.external_id IS NOT NULL AND json_valid(cm.streams_json)
      AND EXISTS (SELECT 1 FROM json_each(cm.streams_json) WHERE value='account_post')
    ORDER BY length(m.external_id),m.external_id LIMIT 1
  ) WHERE oldest_post_id IS NULL;
  UPDATE x_connections SET oldest_mention_id=(
    SELECT m.external_id FROM x_connection_mentions cm JOIN social_mentions m ON m.id=cm.mention_id
    WHERE cm.connection_id=x_connections.id AND m.external_id IS NOT NULL AND json_valid(cm.streams_json)
      AND EXISTS (SELECT 1 FROM json_each(cm.streams_json) WHERE value='mention')
    ORDER BY length(m.external_id),m.external_id LIMIT 1
  ) WHERE oldest_mention_id IS NULL;
  UPDATE x_listening_queries SET oldest_id=(
    SELECT m.external_id FROM x_connection_mentions cm JOIN social_mentions m ON m.id=cm.mention_id
    WHERE cm.connection_id=x_listening_queries.connection_id AND m.external_id IS NOT NULL AND json_valid(cm.query_ids_json)
      AND EXISTS (SELECT 1 FROM json_each(cm.query_ids_json) WHERE value=x_listening_queries.id)
    ORDER BY length(m.external_id),m.external_id LIMIT 1
  ) WHERE oldest_id IS NULL;`);
const aiJobColumns = new Set((db.prepare('PRAGMA table_info(ai_jobs)').all() as any[]).map((column) => String(column.name)));
if (!aiJobColumns.has('requested_by')) db.exec('ALTER TABLE ai_jobs ADD COLUMN requested_by TEXT REFERENCES users(id) ON DELETE SET NULL');
if (!aiJobColumns.has('provider_result_json')) db.exec('ALTER TABLE ai_jobs ADD COLUMN provider_result_json TEXT');
const replyDraftColumns = new Set((db.prepare('PRAGMA table_info(social_reply_drafts)').all() as any[]).map((column) => String(column.name)));
if (!replyDraftColumns.has('idempotency_key')) db.exec('ALTER TABLE social_reply_drafts ADD COLUMN idempotency_key TEXT');
const socialReportColumns = new Set((db.prepare('PRAGMA table_info(social_intelligence_reports)').all() as any[]).map((column) => String(column.name)));
if (!socialReportColumns.has('idempotency_key')) db.exec('ALTER TABLE social_intelligence_reports ADD COLUMN idempotency_key TEXT');
const intelligenceReportColumns = new Set((db.prepare('PRAGMA table_info(intelligence_reports)').all() as any[]).map((column) => String(column.name)));
if (!intelligenceReportColumns.has('idempotency_key')) db.exec('ALTER TABLE intelligence_reports ADD COLUMN idempotency_key TEXT');

// Backfill ownership wherever an artifact or X sync supplies an authoritative
// user. Historical social jobs that cannot be attributed remain hidden below.
db.exec(`UPDATE ai_jobs SET requested_by=(
    SELECT d.requested_by FROM social_reply_drafts d
    WHERE d.id=json_extract(ai_jobs.input_json,'$.draftId')
  ) WHERE requested_by IS NULL AND kind='social.reply_draft' AND json_valid(input_json);
  UPDATE ai_jobs SET requested_by=(
    SELECT r.user_id FROM social_intelligence_reports r
    WHERE r.id=json_extract(ai_jobs.input_json,'$.reportId')
  ) WHERE requested_by IS NULL AND kind='social.report' AND json_valid(input_json);
  UPDATE ai_jobs SET requested_by=(
    SELECT r.user_id FROM intelligence_reports r
    WHERE r.id=json_extract(ai_jobs.input_json,'$.reportId')
  ) WHERE requested_by IS NULL AND kind='intelligence.synthesize' AND json_valid(input_json);
  UPDATE ai_jobs SET requested_by=(
    SELECT c.user_id FROM x_sync_jobs s JOIN x_connections c ON c.id=s.connection_id
    WHERE s.id=json_extract(ai_jobs.input_json,'$.xSyncJobId')
  ) WHERE requested_by IS NULL AND kind='social.analyze' AND json_valid(input_json);`);
db.exec(`CREATE TRIGGER IF NOT EXISTS users_delete_owned_ai_jobs
  BEFORE DELETE ON users BEGIN DELETE FROM ai_jobs WHERE requested_by=OLD.id; END;`);

// Normalize columns used by the rebuild before reading the legacy table. Some
// singleton-account releases predate cursors and generation guards entirely.
const xConnectionCompatibilityColumns = new Set((db.prepare('PRAGMA table_info(x_connections)').all() as any[]).map((column) => String(column.name)));
if (!xConnectionCompatibilityColumns.has('last_post_id')) db.exec('ALTER TABLE x_connections ADD COLUMN last_post_id TEXT');
if (!xConnectionCompatibilityColumns.has('last_mention_id')) db.exec('ALTER TABLE x_connections ADD COLUMN last_mention_id TEXT');
if (!xConnectionCompatibilityColumns.has('generation')) db.exec('ALTER TABLE x_connections ADD COLUMN generation INTEGER NOT NULL DEFAULT 1');
if (!xConnectionCompatibilityColumns.has('refresh_token_enc')) db.exec('ALTER TABLE x_connections ADD COLUMN refresh_token_enc TEXT');
if (!xConnectionCompatibilityColumns.has('auth_type')) db.exec("ALTER TABLE x_connections ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'oauth1'");
if (!xConnectionCompatibilityColumns.has('scopes_json')) db.exec("ALTER TABLE x_connections ADD COLUMN scopes_json TEXT NOT NULL DEFAULT '[]'");
if (!xConnectionCompatibilityColumns.has('token_expires_at')) db.exec('ALTER TABLE x_connections ADD COLUMN token_expires_at TEXT');

// Early versions allowed only one X account per Seemplify user by declaring
// user_id UNIQUE. Rebuild the parent table in place so existing sync history,
// listening queries, and collected evidence retain their foreign keys while a
// user can authorize several distinct X identities.
const xConnectionSql = String((db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='x_connections'").get() as any)?.sql || '');
if (/user_id\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(xConnectionSql)) {
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`CREATE TABLE x_connections_next (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        app_id TEXT NOT NULL REFERENCES x_apps(id) ON DELETE CASCADE,
        access_token_enc TEXT NOT NULL,
        access_token_secret_enc TEXT,
        refresh_token_enc TEXT,
        auth_type TEXT NOT NULL DEFAULT 'oauth1',
        scopes_json TEXT NOT NULL DEFAULT '[]',
        token_expires_at TEXT,
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
        oldest_post_id TEXT,
        oldest_mention_id TEXT,
        post_backlog_token TEXT,
        post_backlog_since_id TEXT,
        post_backlog_newest_id TEXT,
        post_backlog_low_id TEXT,
        post_history_exhausted INTEGER NOT NULL DEFAULT 0,
        mention_backlog_token TEXT,
        mention_backlog_since_id TEXT,
        mention_backlog_newest_id TEXT,
        mention_backlog_low_id TEXT,
        mention_history_exhausted INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        rate_limit_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO x_connections_next (
        id,user_id,app_id,access_token_enc,access_token_secret_enc,refresh_token_enc,auth_type,scopes_json,token_expires_at,x_user_id,username,display_name,profile_image_url,status,
        generation,auto_sync,sync_interval_minutes,next_sync_at,last_sync_at,last_success_at,last_post_id,last_mention_id,oldest_post_id,oldest_mention_id,
        post_backlog_token,post_backlog_since_id,post_backlog_newest_id,post_backlog_low_id,post_history_exhausted,
        mention_backlog_token,mention_backlog_since_id,mention_backlog_newest_id,mention_backlog_low_id,mention_history_exhausted,last_error,rate_limit_json,created_at,updated_at
      ) SELECT id,user_id,app_id,access_token_enc,access_token_secret_enc,refresh_token_enc,auth_type,scopes_json,token_expires_at,x_user_id,username,display_name,profile_image_url,status,
        generation,auto_sync,sync_interval_minutes,next_sync_at,last_sync_at,last_success_at,last_post_id,last_mention_id,oldest_post_id,oldest_mention_id,
        post_backlog_token,post_backlog_since_id,post_backlog_newest_id,post_backlog_low_id,post_history_exhausted,
        mention_backlog_token,mention_backlog_since_id,mention_backlog_newest_id,mention_backlog_low_id,mention_history_exhausted,last_error,rate_limit_json,created_at,updated_at
        FROM x_connections;
      DROP TABLE x_connections;
      ALTER TABLE x_connections_next RENAME TO x_connections;`);
    })();
  } finally { db.pragma('foreign_keys = ON'); }
}
const xConnectionColumns = new Set((db.prepare('PRAGMA table_info(x_connections)').all() as any[]).map((column) => String(column.name)));
if (!xConnectionColumns.has('refresh_token_enc')) db.exec('ALTER TABLE x_connections ADD COLUMN refresh_token_enc TEXT');
if (!xConnectionColumns.has('auth_type')) db.exec("ALTER TABLE x_connections ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'oauth1'");
if (!xConnectionColumns.has('scopes_json')) db.exec("ALTER TABLE x_connections ADD COLUMN scopes_json TEXT NOT NULL DEFAULT '[]'");
if (!xConnectionColumns.has('token_expires_at')) db.exec('ALTER TABLE x_connections ADD COLUMN token_expires_at TEXT');
if (!xConnectionColumns.has('oldest_post_id')) db.exec('ALTER TABLE x_connections ADD COLUMN oldest_post_id TEXT');
if (!xConnectionColumns.has('oldest_mention_id')) db.exec('ALTER TABLE x_connections ADD COLUMN oldest_mention_id TEXT');
if (!xConnectionColumns.has('post_backlog_token')) db.exec('ALTER TABLE x_connections ADD COLUMN post_backlog_token TEXT');
if (!xConnectionColumns.has('post_backlog_since_id')) db.exec('ALTER TABLE x_connections ADD COLUMN post_backlog_since_id TEXT');
if (!xConnectionColumns.has('post_backlog_newest_id')) db.exec('ALTER TABLE x_connections ADD COLUMN post_backlog_newest_id TEXT');
if (!xConnectionColumns.has('post_backlog_low_id')) db.exec('ALTER TABLE x_connections ADD COLUMN post_backlog_low_id TEXT');
if (!xConnectionColumns.has('post_history_exhausted')) db.exec('ALTER TABLE x_connections ADD COLUMN post_history_exhausted INTEGER NOT NULL DEFAULT 0');
if (!xConnectionColumns.has('mention_backlog_token')) db.exec('ALTER TABLE x_connections ADD COLUMN mention_backlog_token TEXT');
if (!xConnectionColumns.has('mention_backlog_since_id')) db.exec('ALTER TABLE x_connections ADD COLUMN mention_backlog_since_id TEXT');
if (!xConnectionColumns.has('mention_backlog_newest_id')) db.exec('ALTER TABLE x_connections ADD COLUMN mention_backlog_newest_id TEXT');
if (!xConnectionColumns.has('mention_backlog_low_id')) db.exec('ALTER TABLE x_connections ADD COLUMN mention_backlog_low_id TEXT');
if (!xConnectionColumns.has('mention_history_exhausted')) db.exec('ALTER TABLE x_connections ADD COLUMN mention_history_exhausted INTEGER NOT NULL DEFAULT 0');
db.exec('CREATE INDEX IF NOT EXISTS x_connections_schedule ON x_connections(auto_sync,next_sync_at)');
if (!new Set((db.prepare('PRAGMA table_info(x_connections)').all() as Array<{ name: string }>).map((column) => column.name)).has('space_id')) {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS x_connections_user_account ON x_connections(user_id,x_user_id) WHERE x_user_id IS NOT NULL');
}
const xForeignKeyViolations = db.prepare('PRAGMA foreign_key_check').all();
if (xForeignKeyViolations.length) throw new Error('X connection migration left invalid foreign keys.');
// Upgrade an in-flight probe created by releases that predate the durable
// marker. While checking credits, every other dispatchable job is blocked in
// waiting_billing, so the first dispatchable row is the probe to retain.
const legacyCreditProbe = db.prepare(`SELECT s.id FROM x_sync_jobs s JOIN x_connections c ON c.id=s.connection_id
  JOIN x_apps a ON a.id=c.app_id
  WHERE a.billing_status='checking_credits' AND s.state IN ('queued','processing','waiting_rate_limit')
  ORDER BY CASE WHEN s.credit_probe=1 THEN 0 WHEN s.stage='checking_credits' THEN 1 WHEN s.state='processing' THEN 2 ELSE 3 END,s.created_at,s.id LIMIT 1`).get() as { id: string } | undefined;
if (legacyCreditProbe) {
  db.prepare(`UPDATE x_sync_jobs SET credit_probe=CASE WHEN id=? THEN 1 ELSE 0 END
    WHERE state IN ('queued','processing','waiting_rate_limit','waiting_billing')`).run(legacyCreditProbe.id);
} else {
  const retainedCreditProbe = db.prepare(`SELECT id FROM x_sync_jobs WHERE credit_probe=1
    AND state IN ('queued','processing','waiting_rate_limit','waiting_billing') ORDER BY created_at,id LIMIT 1`).get() as { id: string } | undefined;
  if (retainedCreditProbe) db.prepare(`UPDATE x_sync_jobs SET credit_probe=CASE WHEN id=? THEN 1 ELSE 0 END
    WHERE credit_probe=1 AND state IN ('queued','processing','waiting_rate_limit','waiting_billing')`).run(retainedCreditProbe.id);
}
db.exec(`DROP INDEX IF EXISTS x_sync_jobs_one_active;
  CREATE INDEX IF NOT EXISTS x_sync_jobs_connection_state ON x_sync_jobs(connection_id,state,created_at);
  DROP INDEX IF EXISTS x_sync_jobs_one_credit_probe;
  CREATE UNIQUE INDEX x_sync_jobs_one_credit_probe ON x_sync_jobs(credit_probe)
  WHERE credit_probe=1 AND state IN ('queued','processing','waiting_rate_limit','waiting_billing');`);

function normalizeQueuedIntelligenceArtifacts(table: string, keyColumns: string[]) {
  const scopedKeyColumns = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name)).has('space_id')
    ? ['space_id', ...keyColumns]
    : keyColumns;
  const columns = scopedKeyColumns.map((column) => `a.${column}`).join(',');
  const rows = db.prepare(`SELECT a.id,a.ai_job_id,${columns},COALESCE(j.state,'missing') job_state,a.created_at
    FROM ${table} a LEFT JOIN ai_jobs j ON j.id=a.ai_job_id WHERE a.state='queued'
    ORDER BY CASE COALESCE(j.state,'missing') WHEN 'processing' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,a.created_at,a.id`).all() as any[];
  const retained = new Set<string>(); const timestamp = new Date().toISOString();
  for (const row of rows) {
    const key = JSON.stringify(scopedKeyColumns.map((column) => row[column]));
    if (!retained.has(key)) { retained.add(key); continue; }
    db.prepare(`UPDATE ${table} SET state='failed',error='A duplicate queued request was removed during migration.',updated_at=? WHERE id=?`)
      .run(timestamp, row.id);
    if (row.ai_job_id) db.prepare(`UPDATE ai_jobs SET state='failed',stage='duplicate_request_recovered',progress=100,
      error='A duplicate queued request was removed during migration.',retry_at=NULL,completed_at=?,updated_at=?
      WHERE id=? AND state IN ('queued','processing')`).run(timestamp, timestamp, row.ai_job_id);
  }
}
if (!new Set((db.prepare('PRAGMA table_info(intelligence_reports)').all() as Array<{ name: string }>).map((column) => column.name)).has('knowledge_refs_json')) {
  db.exec("ALTER TABLE intelligence_reports ADD COLUMN knowledge_refs_json TEXT NOT NULL DEFAULT '[]'");
}
normalizeQueuedIntelligenceArtifacts('social_reply_drafts', ['requested_by', 'mention_id', 'tone', 'instructions']);
normalizeQueuedIntelligenceArtifacts('social_intelligence_reports', ['user_id', 'connection_id', 'title', 'mention_ids_json']);
normalizeQueuedIntelligenceArtifacts('intelligence_reports', ['user_id', 'title', 'objective', 'source_refs_json', 'knowledge_refs_json']);
if (!new Set((db.prepare('PRAGMA table_info(social_reply_drafts)').all() as Array<{ name: string }>).map((column) => column.name)).has('space_id')) {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS social_reply_drafts_one_active_request
      ON social_reply_drafts(requested_by,mention_id,tone,instructions) WHERE state='queued';
    CREATE UNIQUE INDEX IF NOT EXISTS social_reply_drafts_idempotency
      ON social_reply_drafts(requested_by,idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS social_intelligence_reports_one_active_request
      ON social_intelligence_reports(user_id,connection_id,title,mention_ids_json) WHERE state='queued';
    CREATE UNIQUE INDEX IF NOT EXISTS social_intelligence_reports_idempotency
      ON social_intelligence_reports(user_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS intelligence_reports_one_active_request
      ON intelligence_reports(user_id,title,objective,source_refs_json,knowledge_refs_json) WHERE state='queued';
    CREATE UNIQUE INDEX IF NOT EXISTS intelligence_reports_idempotency
      ON intelligence_reports(user_id,idempotency_key) WHERE idempotency_key IS NOT NULL;`);
}

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

export function listSurveys(spaceId: string): Survey[] {
  return (db.prepare(`SELECT s.*, COUNT(DISTINCT r.id) response_count, COUNT(DISTINCT c.id) collector_count
    FROM surveys s LEFT JOIN responses r ON r.survey_id=s.id LEFT JOIN collectors c ON c.survey_id=s.id
    WHERE s.space_id=? GROUP BY s.id ORDER BY s.updated_at DESC`).all(spaceId) as any[]).map((row) => ({
      ...rowSurvey(row), responseCount: Number(row.response_count), collectorCount: Number(row.collector_count)
    } as Survey));
}

export function getSurvey(id: string, spaceId?: string): Survey | null {
  const row = spaceId
    ? db.prepare('SELECT * FROM surveys WHERE id=? AND space_id=?').get(id, spaceId) as any
    : db.prepare('SELECT * FROM surveys WHERE id=?').get(id) as any;
  if (!row) return null;
  return {
    ...rowSurvey(row),
    questions: (db.prepare('SELECT * FROM questions WHERE survey_id=? ORDER BY page, position').all(id) as any[]).map(rowQuestion)
  };
}

export const saveSurvey = db.transaction((input: Partial<Survey> & { title: string }, questions: Partial<Question>[] | undefined, spaceId: string) => {
  if (!spaceId) throw new Error('A space is required to save a survey.');
  const now = new Date().toISOString();
  const id = input.id || crypto.randomUUID();
  const existing = db.prepare('SELECT space_id FROM surveys WHERE id=?').get(id) as { space_id: string } | undefined;
  if (existing && existing.space_id !== spaceId) throw new Error('Survey not found.');
  db.prepare(`INSERT INTO surveys (id,space_id,title,description,purpose,audience,status,primary_metric,language,thank_you_message,theme_json,settings_json,created_at,updated_at,published_at)
    VALUES (@id,@spaceId,@title,@description,@purpose,@audience,@status,@primaryMetric,@language,@thankYouMessage,@theme,@settings,@createdAt,@updatedAt,@publishedAt)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,purpose=excluded.purpose,audience=excluded.audience,status=excluded.status,primary_metric=excluded.primary_metric,language=excluded.language,thank_you_message=excluded.thank_you_message,theme_json=excluded.theme_json,settings_json=excluded.settings_json,updated_at=excluded.updated_at,published_at=excluded.published_at`).run({
      id, spaceId, title: input.title.trim(), description: input.description || '', purpose: input.purpose || 'customer_experience',
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
  return getSurvey(id, spaceId)!;
});

export function deleteSurvey(id: string, spaceId: string) { return db.prepare('DELETE FROM surveys WHERE id=? AND space_id=?').run(id, spaceId).changes > 0; }

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
    id: row.id, spaceId: row.space_id, kind: row.kind, surveyId: row.survey_id, responseId: row.response_id, requestedBy: row.requested_by, state: row.state,
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

export function getJobForSpace(id: string, spaceId: string): AiJob | null {
  const row = db.prepare('SELECT * FROM ai_jobs WHERE id=? AND space_id=?').get(id, spaceId) as any;
  return row ? rowJob(row) : null;
}

export function listJobsForSpace(spaceId: string, limit = 100) {
  return (db.prepare('SELECT * FROM ai_jobs WHERE space_id=? ORDER BY created_at DESC LIMIT ?').all(spaceId, limit) as any[]).map(rowJob);
}

export function getJobProviderResult(id: string): { activity: string; schemaName: string; output: unknown; runtime: unknown } | null {
  const row = db.prepare('SELECT provider_result_json FROM ai_jobs WHERE id=?').get(id) as { provider_result_json: string | null } | undefined;
  return row ? parseJson<{ activity: string; schemaName: string; output: unknown; runtime: unknown } | null>(row.provider_result_json, null) : null;
}

export function saveJobProviderResult(id: string, value: { activity: string; schemaName: string; output: unknown; runtime: unknown }) {
  db.prepare('UPDATE ai_jobs SET provider_result_json=COALESCE(provider_result_json,?),updated_at=? WHERE id=?')
    .run(JSON.stringify(value), new Date().toISOString(), id);
  return getJobProviderResult(id);
}

export function createJob(kind: AiJob['kind'], input: Record<string, unknown>, spaceId: string, surveyId?: string | null, responseId?: string | null, requestedBy?: string | null) {
  if (!spaceId) throw new Error('A space is required to queue AI work.');
  if (surveyId && !db.prepare('SELECT 1 FROM surveys WHERE id=? AND space_id=?').get(surveyId, spaceId)) {
    throw new Error('Survey not found.');
  }
  if (responseId && !db.prepare(`SELECT 1 FROM responses r JOIN surveys s ON s.id=r.survey_id
    WHERE r.id=? AND s.space_id=? AND (? IS NULL OR r.survey_id=?)`).get(responseId, spaceId, surveyId || null, surveyId || null)) {
    throw new Error('Response not found.');
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO ai_jobs (id,space_id,kind,survey_id,response_id,requested_by,state,stage,progress,attempt,input_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'queued','queued',0,0,?,?,?)`).run(id, spaceId, kind, surveyId || null, responseId || null, requestedBy || null, JSON.stringify(input), now, now);
  return getJob(id)!;
}

export const claimNextJob = db.transaction((): AiJob | null => {
  const now = new Date().toISOString();
  // JavaScript timestamps have millisecond precision, so rowid preserves
  // insertion-order FIFO when several durable jobs are enqueued together.
  const row = db.prepare(`SELECT candidate.* FROM ai_jobs candidate
    WHERE candidate.state='queued' AND (candidate.retry_at IS NULL OR candidate.retry_at<=?)
      AND candidate.id=(
        SELECT queued.id FROM ai_jobs queued
        WHERE queued.space_id=candidate.space_id AND queued.state='queued' AND (queued.retry_at IS NULL OR queued.retry_at<=?)
        ORDER BY queued.created_at,queued.rowid LIMIT 1
      )
    ORDER BY
      (SELECT COUNT(*) FROM ai_jobs active WHERE active.space_id=candidate.space_id AND active.state='processing'),
      COALESCE((SELECT MAX(started_at) FROM ai_jobs served
        WHERE served.space_id=candidate.space_id AND served.started_at IS NOT NULL),''),
      candidate.created_at,candidate.rowid
    LIMIT 1`).get(now, now) as any;
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

export function listSocialMentionsForSpace(spaceId: string, limit = 500) {
  return (db.prepare(`SELECT * FROM social_mentions
    WHERE space_id=? ORDER BY published_at DESC LIMIT ?`).all(spaceId, limit) as any[]).map(rowMention);
}

export function listSocialMentionsByIds(ids: string[]) {
  const unique = [...new Set(ids)].slice(0, 200);
  if (!unique.length) return [];
  const placeholders = unique.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM social_mentions WHERE id IN (${placeholders})`).all(...unique) as any[];
  const byId = new Map(rows.map((row) => [row.id, rowMention(row)]));
  return unique.map((id) => byId.get(id)).filter((item): item is SocialMention => Boolean(item));
}

export function listSocialMentionsByIdsForSpace(ids: string[], spaceId: string) {
  const unique = [...new Set(ids)].slice(0, 200);
  if (!unique.length) return [];
  const placeholders = unique.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM social_mentions
    WHERE id IN (${placeholders}) AND space_id=?`).all(...unique, spaceId) as any[];
  const byId = new Map(rows.map((row) => [row.id, rowMention(row)]));
  return unique.map((id) => byId.get(id)).filter((item): item is SocialMention => Boolean(item));
}

export const insertSocialMentions = db.transaction((items: Array<Partial<SocialMention> & { content: string; source: SocialMention['source'] }>, spaceId: string) => {
  if (!spaceId) throw new Error('A space is required to import social mentions.');
  const insert = db.prepare(`INSERT OR IGNORE INTO social_mentions (id,space_id,source,external_id,x_connection_id,ingestion_kind,author,content,url,language,published_at,metadata_json,analysis_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const now = new Date().toISOString();
  return items.map((item) => {
    const id = item.id || crypto.randomUUID();
    insert.run(id, spaceId, item.source, item.externalId || null, item.xConnectionId || null, item.ingestionKind || null, item.author || '', item.content.trim(), item.url || '', item.language || '', item.publishedAt || now, JSON.stringify(item.metadata || {}), item.analysis ? JSON.stringify(item.analysis) : null, now);
    const row = db.prepare('SELECT * FROM social_mentions WHERE id=?').get(id)
      || (item.externalId ? db.prepare('SELECT * FROM social_mentions WHERE space_id=? AND source=? AND external_id=?').get(spaceId, item.source, item.externalId) : null);
    return rowMention(row);
  });
});

export function setSocialMentionAnalysis(id: string, analysis: unknown) {
  db.prepare('UPDATE social_mentions SET analysis_json=? WHERE id=?').run(JSON.stringify(analysis), id);
}

const legacyJourneyProvenance: JourneyProvenance = {
  origin: 'legacy', lastModifiedBy: 'unknown', evidenceBasis: 'unknown', evidenceLevel: 'hypothesis',
  generatedAt: null, optimizedAt: null
};

function journeyProvenance(value: unknown): JourneyProvenance {
  const parsed = parseJson(value, {} as Partial<JourneyProvenance>);
  return { ...legacyJourneyProvenance, ...parsed, evidenceLevel: 'hypothesis' };
}

const rowJourney = (row: any): Journey => ({
  id: row.id, name: row.name, audience: row.audience, objective: row.objective, industry: row.industry,
  stages: parseJson(row.stages_json, []), summary: row.summary, provenance: journeyProvenance(row.provenance_json),
  createdAt: row.created_at, updatedAt: row.updated_at
});

export function listJourneys(spaceId: string) { return (db.prepare('SELECT * FROM journeys WHERE space_id=? ORDER BY updated_at DESC').all(spaceId) as any[]).map(rowJourney); }
export function getJourney(id: string, spaceId?: string): Journey | null {
  const row = spaceId ? db.prepare('SELECT * FROM journeys WHERE id=? AND space_id=?').get(id, spaceId) : db.prepare('SELECT * FROM journeys WHERE id=?').get(id) as any;
  return row ? rowJourney(row) : null;
}
export function createJourney(input: Partial<Journey> & { name: string }, spaceId: string) {
  if (!spaceId) throw new Error('A space is required to create a journey.');
  const now = new Date().toISOString(); const id = input.id || crypto.randomUUID();
  db.prepare(`INSERT INTO journeys (id,space_id,name,audience,objective,industry,stages_json,summary,provenance_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, spaceId, input.name.trim(), input.audience || '', input.objective || '', input.industry || '', JSON.stringify(input.stages || []),
      input.summary || '', JSON.stringify(input.provenance || legacyJourneyProvenance), input.createdAt || now, now);
  return getJourney(id, spaceId)!;
}

type JourneyVersionMetadata = Pick<JourneyVersion, 'reason' | 'actor'> & { sourceJobId?: string | null };
type JourneyJobOutput = { output: unknown; runtime: unknown };

const rowJourneyVersion = (row: any): JourneyVersion => ({
  id: row.id, journeyId: row.journey_id, reason: row.reason, actor: row.actor, sourceJobId: row.source_job_id,
  snapshot: parseJson(row.snapshot_json, null as unknown as Journey), snapshotUpdatedAt: row.snapshot_updated_at, createdAt: row.created_at
});

const rowJourneyVersionSummary = (row: any): JourneyVersionSummary => ({
  id: row.id, journeyId: row.journey_id, reason: row.reason, actor: row.actor, sourceJobId: row.source_job_id,
  name: row.snapshot_name, stageCount: Number(row.stage_count), snapshotUpdatedAt: row.snapshot_updated_at, createdAt: row.created_at
});

export function listJourneyVersionSummaries(journeyId: string, limit = 10) {
  return (db.prepare(`SELECT id,journey_id,reason,actor,source_job_id,snapshot_name,stage_count,snapshot_updated_at,created_at
    FROM journey_versions WHERE journey_id=? ORDER BY snapshot_updated_at DESC,id DESC LIMIT ?`).all(journeyId, limit) as any[]).map(rowJourneyVersionSummary);
}

export function getJourneyVersion(journeyId: string, versionId: string): JourneyVersion | null {
  const row = db.prepare('SELECT * FROM journey_versions WHERE journey_id=? AND id=?').get(journeyId, versionId) as any;
  return row ? rowJourneyVersion(row) : null;
}

function insertJourneyVersion(journey: Journey, metadata: JourneyVersionMetadata) {
  const now = new Date().toISOString(); const snapshot = JSON.stringify(journey); const snapshotBytes = Buffer.byteLength(snapshot, 'utf8');
  if (snapshotBytes > JOURNEY_VERSION_MAX_BYTES) throw new Error('Journey is too large to version safely.');
  db.prepare(`INSERT INTO journey_versions (id,journey_id,reason,actor,source_job_id,snapshot_json,snapshot_name,stage_count,snapshot_bytes,snapshot_updated_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), journey.id, metadata.reason, metadata.actor, metadata.sourceJobId || null,
    snapshot, journey.name, journey.stages.length, snapshotBytes, journey.updatedAt, now);
  pruneJourneyVersions(journey.id);
}

const JOURNEY_VERSION_MAX_COUNT = 20;
const JOURNEY_VERSION_MAX_BYTES = 16 * 1024 * 1024;
function pruneJourneyVersions(journeyId: string) {
  const rows = db.prepare(`SELECT id,snapshot_bytes FROM journey_versions WHERE journey_id=?
    ORDER BY snapshot_updated_at DESC,id DESC`).all(journeyId) as Array<{ id: string; snapshot_bytes: number }>;
  let kept = 0; let bytes = 0; let exhausted = false; const remove: string[] = [];
  for (const row of rows) {
    const size = Math.max(0, Number(row.snapshot_bytes || 0));
    if (!exhausted && (kept === 0 || (kept < JOURNEY_VERSION_MAX_COUNT && bytes + size <= JOURNEY_VERSION_MAX_BYTES))) { kept += 1; bytes += size; }
    else { exhausted = true; remove.push(row.id); }
  }
  const removeVersion = db.prepare('DELETE FROM journey_versions WHERE journey_id=? AND id=?');
  for (const id of remove) removeVersion.run(journeyId, id);
}

function pruneAllJourneyVersions() {
  const journeys = db.prepare('SELECT DISTINCT journey_id FROM journey_versions').all() as Array<{ journey_id: string }>;
  for (const row of journeys) pruneJourneyVersions(row.journey_id);
}

function updateJourneyRecord(id: string, input: Partial<Omit<Journey, 'id' | 'createdAt' | 'updatedAt'>>, expectedUpdatedAt: string, metadata: JourneyVersionMetadata, spaceId?: string): Journey | null {
  const current = getJourney(id, spaceId);
  if (!current || current.updatedAt !== expectedUpdatedAt) return null;
  insertJourneyVersion(current, metadata);
  const currentTime = Date.parse(current.updatedAt);
  const updatedAt = new Date(Math.max(Date.now(), Number.isFinite(currentTime) ? currentTime + 1 : 0)).toISOString();
  const changed = db.prepare(`UPDATE journeys SET name=?,audience=?,objective=?,industry=?,stages_json=?,summary=?,provenance_json=?,updated_at=?
    WHERE id=? AND updated_at=?`).run(
    input.name === undefined ? current.name : input.name.trim(), input.audience === undefined ? current.audience : input.audience,
    input.objective === undefined ? current.objective : input.objective, input.industry === undefined ? current.industry : input.industry,
    JSON.stringify(input.stages === undefined ? current.stages : input.stages), input.summary === undefined ? current.summary : input.summary,
    JSON.stringify(input.provenance === undefined ? current.provenance : input.provenance), updatedAt, id, expectedUpdatedAt
  ).changes;
  if (!changed) throw new Error('Journey changed while its version snapshot was being saved.');
  return getJourney(id, spaceId);
}

export const updateJourney = db.transaction((id: string, input: Partial<Omit<Journey, 'id' | 'createdAt' | 'updatedAt'>>, expectedUpdatedAt: string, metadata: JourneyVersionMetadata, spaceId?: string): Journey | null => {
  return updateJourneyRecord(id, input, expectedUpdatedAt, metadata, spaceId);
});

export function getJourneyAiApplication(jobId: string): JourneyJobOutput | null {
  const row = db.prepare('SELECT result_json FROM journey_ai_applications WHERE job_id=?').get(jobId) as { result_json: string } | undefined;
  if (!row) return null;
  const result = JSON.parse(row.result_json) as JourneyJobOutput;
  if (!result || typeof result !== 'object' || !('output' in result) || !('runtime' in result)) throw new Error('Recorded journey AI application is invalid.');
  return result;
}

export const applyGeneratedJourney = db.transaction((jobId: string, spaceId: string, input: Partial<Journey> & { name: string }, runtime: unknown): JourneyJobOutput => {
  const previous = getJourneyAiApplication(jobId);
  if (previous) return previous;
  const journey = createJourney(input, spaceId);
  const result: JourneyJobOutput = { output: { journey }, runtime };
  db.prepare(`INSERT INTO journey_ai_applications (job_id,journey_id,kind,result_json,created_at) VALUES (?,?,'journey.generate',?,?)`)
    .run(jobId, journey.id, JSON.stringify(result), new Date().toISOString());
  return getJourneyAiApplication(jobId)!;
});

export const applyOptimizedJourney = db.transaction((jobId: string, spaceId: string, journeyId: string,
  input: Partial<Omit<Journey, 'id' | 'createdAt' | 'updatedAt'>>, expectedUpdatedAt: string, runtime: unknown):
  { status: 'applied' | 'replayed'; result: JourneyJobOutput } | { status: 'conflict' | 'not_found' } => {
  const previous = getJourneyAiApplication(jobId);
  if (previous) return { status: 'replayed', result: previous };
  const current = getJourney(journeyId, spaceId);
  if (!current) return { status: 'not_found' };
  if (current.updatedAt !== expectedUpdatedAt) return { status: 'conflict' };
  const journey = updateJourneyRecord(journeyId, input, expectedUpdatedAt, { reason: 'terra_optimize', actor: 'terra', sourceJobId: jobId }, spaceId);
  if (!journey) return { status: 'conflict' };
  const result: JourneyJobOutput = { output: { journey }, runtime };
  db.prepare(`INSERT INTO journey_ai_applications (job_id,journey_id,kind,result_json,created_at) VALUES (?,?,'journey.optimize',?,?)`)
    .run(jobId, journey.id, JSON.stringify(result), new Date().toISOString());
  return { status: 'applied', result: getJourneyAiApplication(jobId)! };
});

export const restoreJourneyVersion = db.transaction((journeyId: string, versionId: string, expectedUpdatedAt: string, spaceId?: string):
  { status: 'restored'; journey: Journey } | { status: 'not_found' | 'version_not_found' | 'conflict'; current?: Journey } => {
  const current = getJourney(journeyId, spaceId);
  if (!current) return { status: 'not_found' };
  const version = getJourneyVersion(journeyId, versionId);
  if (!version) return { status: 'version_not_found' };
  if (current.updatedAt !== expectedUpdatedAt) return { status: 'conflict', current };
  const target = version.snapshot;
  const journey = updateJourneyRecord(journeyId, {
    name: target.name, audience: target.audience, objective: target.objective, industry: target.industry,
    stages: target.stages, summary: target.summary,
    provenance: { ...target.provenance, lastModifiedBy: 'workspace', evidenceLevel: 'hypothesis' }
  }, expectedUpdatedAt, { reason: 'restore_displaced', actor: 'workspace' }, spaceId);
  if (!journey) return { status: 'conflict', current: getJourney(journeyId, spaceId) || undefined };
  return { status: 'restored', journey };
});

export function findActiveJourneyOptimization(journeyId: string, spaceId?: string): AiJob | null {
  const row = spaceId
    ? db.prepare(`SELECT * FROM ai_jobs WHERE kind='journey.optimize' AND state IN ('queued','processing')
      AND CASE WHEN json_valid(input_json) THEN json_extract(input_json,'$.journeyId') END=? AND space_id=?
      ORDER BY CASE state WHEN 'processing' THEN 0 ELSE 1 END,created_at,id LIMIT 1`).get(journeyId, spaceId) as any
    : db.prepare(`SELECT * FROM ai_jobs WHERE kind='journey.optimize' AND state IN ('queued','processing')
      AND CASE WHEN json_valid(input_json) THEN json_extract(input_json,'$.journeyId') END=?
      ORDER BY CASE state WHEN 'processing' THEN 0 ELSE 1 END,created_at,id LIMIT 1`).get(journeyId) as any;
  return row ? rowJob(row) : null;
}

export const deleteJourney = db.transaction((id: string, expectedUpdatedAt: string, spaceId?: string): 'deleted' | 'not_found' | 'conflict' => {
  const current = getJourney(id, spaceId);
  if (!current) return 'not_found';
  if (current.updatedAt !== expectedUpdatedAt) return 'conflict';
  db.prepare(`DELETE FROM ai_jobs WHERE kind IN ('journey.generate','journey.optimize') AND (
    id IN (SELECT job_id FROM journey_ai_applications WHERE journey_id=?)
    OR CASE WHEN json_valid(input_json) THEN json_extract(input_json,'$.journeyId') END=?
    OR CASE WHEN json_valid(result_json) THEN json_extract(result_json,'$.output.journey.id') END=?
  )`).run(id, id, id);
  db.prepare('DELETE FROM journey_ai_applications WHERE journey_id=?').run(id);
  const deleted = spaceId
    ? db.prepare('DELETE FROM journeys WHERE id=? AND updated_at=? AND space_id=?').run(id, expectedUpdatedAt, spaceId).changes
    : db.prepare('DELETE FROM journeys WHERE id=? AND updated_at=?').run(id, expectedUpdatedAt).changes;
  if (!deleted) throw new Error('Journey changed while it was being deleted.');
  return 'deleted';
});

pruneAllJourneyVersions();
db.prepare(`UPDATE ai_jobs SET state='queued',stage='recovered_after_restart',progress=0,started_at=NULL,retry_at=NULL,updated_at=? WHERE state='processing'`).run(new Date().toISOString());
db.prepare(`UPDATE x_sync_jobs SET state='queued',stage='recovered_after_restart',progress=0,started_at=NULL,run_after=NULL,updated_at=? WHERE state='processing'`).run(new Date().toISOString());
db.prepare(`UPDATE x_apps SET billing_status='credits_depleted',billing_problem_type=COALESCE(billing_problem_type,'credits-depleted'),
  billing_checked_at=?,updated_at=? WHERE billing_status='checking_credits' AND NOT EXISTS (
    SELECT 1 FROM x_sync_jobs s JOIN x_connections c ON c.id=s.connection_id
    WHERE c.app_id=x_apps.id AND s.credit_probe=1 AND s.state IN ('queued','processing','waiting_rate_limit')
  )`).run(new Date().toISOString(), new Date().toISOString());
db.prepare("UPDATE campaigns SET status='active' WHERE status='running'").run();

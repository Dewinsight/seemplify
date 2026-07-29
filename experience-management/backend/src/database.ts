import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { config } from './config.js';
import type { AiJob, Collector, Question, ResponseRecord, Survey } from './types.js';

export const db = new Database(config.databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
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
`);

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

db.prepare(`UPDATE ai_jobs SET state='queued',stage='recovered_after_restart',progress=0,started_at=NULL,retry_at=NULL,updated_at=? WHERE state='processing'`).run(new Date().toISOString());

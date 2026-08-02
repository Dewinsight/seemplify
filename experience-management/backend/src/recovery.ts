import crypto from 'node:crypto';
import { db, getResponse, getSurvey } from './database.js';

export type RecoveryTicketStatus = 'open' | 'in_progress' | 'closed';
export type RecoveryTicketPriority = 'normal' | 'high' | 'urgent';

export type RecoveryTicketWrite = {
  title?: string;
  priority?: RecoveryTicketPriority;
  status?: RecoveryTicketStatus;
  owner?: string;
  notes?: string;
};

export type RecoveryTicketCreate = Required<Pick<RecoveryTicketWrite, 'title'>> & {
  surveyId: string;
  responseId?: string | null;
  priority?: RecoveryTicketPriority;
  owner?: string;
  notes?: string;
};

export type RecoveryTicketFilters = {
  status?: RecoveryTicketStatus;
  priority?: RecoveryTicketPriority;
  owner?: string;
  query?: string;
};

type TicketRow = {
  id: string;
  survey_id: string;
  response_id: string | null;
  title: string;
  priority: RecoveryTicketPriority;
  status: RecoveryTicketStatus;
  owner: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  survey_title?: string;
  respondent_name?: string | null;
  respondent_email?: string | null;
  response_completed_at?: string | null;
  event_count?: number | string;
};

export class RecoveryTicketError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = 'RECOVERY_TICKET_ERROR') {
    super(message);
    this.name = 'RecoveryTicketError';
    this.status = status;
    this.code = code;
  }
}

function parseJson(value: unknown, fallback: Record<string, unknown> = {}) {
  if (!value) return fallback;
  try { return JSON.parse(String(value)) as Record<string, unknown>; }
  catch { return fallback; }
}

function ticketSummary(row: TicketRow) {
  return {
    id: row.id,
    surveyId: row.survey_id,
    responseId: row.response_id || null,
    title: row.title,
    priority: row.priority,
    status: row.status,
    owner: row.owner || '',
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    survey: { id: row.survey_id, title: row.survey_title || row.survey_id },
    respondent: row.respondent_name || row.respondent_email
      ? { name: row.respondent_name || '', email: row.respondent_email || '' }
      : null,
    responseCompletedAt: row.response_completed_at || null,
    eventCount: Number(row.event_count || 0)
  };
}

function ticketRow(ticketId: string, spaceId: string) {
  return db.prepare(`SELECT t.*,s.title survey_title,r.completed_at response_completed_at,
      recipient.name respondent_name,recipient.email respondent_email,
      (SELECT COUNT(*) FROM ticket_events te_count WHERE te_count.ticket_id=t.id) event_count
    FROM tickets t
    JOIN surveys s ON s.id=t.survey_id
    LEFT JOIN responses r ON r.id=t.response_id
    LEFT JOIN recipients recipient ON recipient.collector_id=r.collector_id AND recipient.token=r.respondent_token
    WHERE t.id=? AND s.space_id=?`).get(ticketId, spaceId) as TicketRow | undefined;
}

function eventRows(ticketId: string) {
  return (db.prepare(`SELECT te.*,actor.name actor_name,actor.email actor_email
    FROM ticket_events te
    LEFT JOIN users actor ON actor.id=te.actor_user_id
    WHERE te.ticket_id=? ORDER BY te.created_at ASC,te.id ASC`).all(ticketId) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      eventType: String(row.event_type),
      detail: parseJson(row.detail_json),
      createdAt: String(row.created_at),
      actor: row.actor_user_id ? {
        id: String(row.actor_user_id),
        name: String(row.actor_name || ''),
        email: String(row.actor_email || '')
      } : null
    }));
}

function respondentFromAnswers(survey: NonNullable<ReturnType<typeof getSurvey>>, answers: Record<string, unknown>) {
  let name = '';
  let email = '';
  for (const question of survey.questions || []) {
    const answer = answers[question.id];
    if (question.type === 'email' && typeof answer === 'string') email ||= answer.trim();
    if (question.type !== 'contact' || !answer || typeof answer !== 'object' || Array.isArray(answer)) continue;
    const contact = answer as Record<string, unknown>;
    email ||= typeof contact.email === 'string' ? contact.email.trim() : '';
    name ||= [contact.firstName, contact.lastName].filter((value) => typeof value === 'string' && value.trim()).join(' ').trim();
    name ||= typeof contact.name === 'string' ? contact.name.trim() : '';
  }
  return name || email ? { name, email } : null;
}

export function listRecoveryTickets(spaceId: string, filters: RecoveryTicketFilters = {}) {
  const predicates = ['s.space_id=?'];
  const parameters: unknown[] = [spaceId];
  if (filters.status) { predicates.push('t.status=?'); parameters.push(filters.status); }
  if (filters.priority) { predicates.push('t.priority=?'); parameters.push(filters.priority); }
  if (filters.owner !== undefined) { predicates.push('LOWER(t.owner)=LOWER(?)'); parameters.push(filters.owner); }
  if (filters.query) {
    predicates.push('(LOWER(t.title) LIKE LOWER(?) OR LOWER(t.notes) LIKE LOWER(?) OR LOWER(s.title) LIKE LOWER(?))');
    const query = `%${filters.query}%`;
    parameters.push(query, query, query);
  }
  return (db.prepare(`SELECT t.*,s.title survey_title,r.completed_at response_completed_at,
      recipient.name respondent_name,recipient.email respondent_email,
      (SELECT COUNT(*) FROM ticket_events te_count WHERE te_count.ticket_id=t.id) event_count
    FROM tickets t
    JOIN surveys s ON s.id=t.survey_id
    LEFT JOIN responses r ON r.id=t.response_id
    LEFT JOIN recipients recipient ON recipient.collector_id=r.collector_id AND recipient.token=r.respondent_token
    WHERE ${predicates.join(' AND ')}
    ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
      CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,t.updated_at DESC`).all(...parameters) as TicketRow[]).map(ticketSummary);
}

export function getRecoveryTicket(ticketId: string, spaceId: string) {
  const row = ticketRow(ticketId, spaceId);
  if (!row) return null;
  const survey = getSurvey(row.survey_id, spaceId);
  if (!survey) return null;
  const response = row.response_id ? getResponse(row.response_id) : null;
  const storedRespondent = row.respondent_name || row.respondent_email
    ? { name: row.respondent_name || '', email: row.respondent_email || '' }
    : null;
  return {
    ...ticketSummary(row),
    survey,
    response: response ? {
      id: response.id,
      status: response.status,
      answers: response.answers,
      metadata: response.metadata,
      startedAt: response.startedAt,
      completedAt: response.completedAt,
      durationSeconds: response.durationSeconds,
      aiAnalysis: response.aiAnalysis,
      analyzedAt: response.analyzedAt
    } : null,
    respondent: storedRespondent || (response ? respondentFromAnswers(survey, response.answers) : null),
    events: eventRows(row.id)
  };
}

export function recordRecoveryTicketEvent(
  ticketId: string,
  actorUserId: string | null,
  eventType: string,
  detail: Record<string, unknown>,
  createdAt = new Date().toISOString()
) {
  db.prepare(`INSERT INTO ticket_events (id,ticket_id,actor_user_id,event_type,detail_json,created_at)
    VALUES (?,?,?,?,?,?)`).run(crypto.randomUUID(), ticketId, actorUserId, eventType, JSON.stringify(detail), createdAt);
}

export function createRecoveryTicket(spaceId: string, actorUserId: string, input: RecoveryTicketCreate) {
  const survey = getSurvey(input.surveyId, spaceId);
  if (!survey) throw new RecoveryTicketError('Survey not found.', 404, 'SURVEY_NOT_FOUND');
  if (input.responseId) {
    const response = getResponse(input.responseId);
    if (!response || response.surveyId !== survey.id) {
      throw new RecoveryTicketError('Response not found for this survey.', 404, 'RESPONSE_NOT_FOUND');
    }
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const priority = input.priority || 'normal';
  const owner = input.owner || '';
  const notes = input.notes || '';
  db.transaction(() => {
    db.prepare(`INSERT INTO tickets (id,survey_id,response_id,title,priority,status,owner,notes,created_at,updated_at)
      VALUES (?,?,?,?,?,'open',?,?,?,?)`).run(id, survey.id, input.responseId || null, input.title, priority, owner, notes, now, now);
    recordRecoveryTicketEvent(id, actorUserId, 'created', {
      title: input.title, priority, status: 'open', owner, responseId: input.responseId || null
    }, now);
  })();
  return getRecoveryTicket(id, spaceId)!;
}

export function updateRecoveryTicket(ticketId: string, spaceId: string, actorUserId: string, input: RecoveryTicketWrite) {
  const current = ticketRow(ticketId, spaceId);
  if (!current) throw new RecoveryTicketError('Recovery case not found.', 404, 'RECOVERY_TICKET_NOT_FOUND');
  const next = {
    title: input.title ?? current.title,
    priority: input.priority ?? current.priority,
    status: input.status ?? current.status,
    owner: input.owner ?? (current.owner || ''),
    notes: input.notes ?? (current.notes || '')
  };
  const changes: Record<string, { from: string; to: string }> = {};
  for (const field of ['title', 'priority', 'status', 'owner', 'notes'] as const) {
    if (next[field] !== (current[field] || '')) changes[field] = { from: String(current[field] || ''), to: String(next[field]) };
  }
  if (!Object.keys(changes).length) return getRecoveryTicket(ticketId, spaceId)!;
  const now = new Date().toISOString();
  const eventType = next.status === 'closed' && current.status !== 'closed'
    ? 'closed'
    : current.status === 'closed' && next.status !== 'closed' ? 'reopened' : 'updated';
  db.transaction(() => {
    db.prepare(`UPDATE tickets SET title=?,priority=?,status=?,owner=?,notes=?,updated_at=? WHERE id=?`)
      .run(next.title, next.priority, next.status, next.owner, next.notes, now, current.id);
    recordRecoveryTicketEvent(current.id, actorUserId, eventType, { changes }, now);
  })();
  return getRecoveryTicket(ticketId, spaceId)!;
}

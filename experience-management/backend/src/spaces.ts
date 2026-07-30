import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Request } from 'express';
import { config } from './config.js';
import { db } from './database.js';

export type SpaceRole = 'owner' | 'admin' | 'member';

export type SpaceSummary = {
  id: string;
  name: string;
  slug: string;
  role: SpaceRole;
  isPersonal: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SpaceContext = SpaceSummary & {
  userId: string;
};

export class SpaceError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = 'SPACE_ERROR') {
    super(message);
    this.name = 'SpaceError';
    this.status = status;
    this.code = code;
  }
}

const spaceColumnTables = [
  'surveys',
  'ai_jobs',
  'social_mentions',
  'x_connections',
  'x_oauth_requests',
  'social_reply_drafts',
  'social_intelligence_reports',
  'intelligence_reports',
  'journeys',
  'campaigns',
  'esign_envelopes'
] as const;

function columns(table: string) {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name));
}

function slugBase(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'space';
}

function uniqueSlug(name: string) {
  const base = slugBase(name);
  let slug = base;
  let suffix = 1;
  const exists = db.prepare('SELECT 1 FROM spaces WHERE slug=?');
  while (exists.get(slug)) {
    suffix += 1;
    slug = `${base.slice(0, Math.max(1, 48 - String(suffix).length - 1))}-${suffix}`;
  }
  return slug;
}

function cleanSpaceName(value: unknown, fallback: string) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (!name) return fallback;
  if (name.length < 2 || name.length > 100) throw new SpaceError('Space name must be between 2 and 100 characters.');
  return name;
}

function personalSpaceName(name: string) {
  const firstName = String(name || '').trim().split(/\s+/)[0] || 'My';
  return `${firstName}'s space`;
}

function createSpaceRecord(userId: string, name: string, personalForUserId: string | null) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO spaces (id,name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?)`).run(id, name, uniqueSlug(name), userId, personalForUserId, now, now);
  db.prepare(`INSERT INTO space_memberships (space_id,user_id,role,joined_at,updated_at)
    VALUES (?,?, 'owner', ?, ?)`).run(id, userId, now, now);
  return id;
}

function defaultSpaceIdForUser(userId: string) {
  return (db.prepare(`SELECT s.id FROM spaces s
    JOIN space_memberships m ON m.space_id=s.id
    WHERE m.user_id=? ORDER BY CASE WHEN s.personal_for_user_id=? THEN 0 ELSE 1 END,m.joined_at,s.id LIMIT 1`)
    .get(userId, userId) as { id: string } | undefined)?.id || null;
}

function createSpaceSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS spaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      personal_for_user_id TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS space_memberships (
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('owner','admin','member')),
      joined_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(space_id,user_id)
    );
    CREATE INDEX IF NOT EXISTS space_memberships_user ON space_memberships(user_id,joined_at);
    CREATE TABLE IF NOT EXISTS space_invitations (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      email TEXT NOT NULL COLLATE NOCASE,
      role TEXT NOT NULL CHECK(role IN ('admin','member')),
      token_hash TEXT NOT NULL UNIQUE,
      invited_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      accepted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS space_invitations_space ON space_invitations(space_id,created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS space_invitations_one_pending_email
      ON space_invitations(space_id,email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
    CREATE TABLE IF NOT EXISTS space_migration_quarantine (
      artifact_type TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      source_spaces_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      PRIMARY KEY(artifact_type,artifact_id)
    );
    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      collector_id TEXT REFERENCES collectors(id) ON DELETE CASCADE,
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      question_id TEXT REFERENCES questions(id) ON DELETE SET NULL,
      response_id TEXT REFERENCES responses(id) ON DELETE CASCADE,
      stored_filename TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      access_token_hash TEXT,
      expires_at TEXT,
      claimed_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS uploads_space_created ON uploads(space_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS uploads_collector ON uploads(collector_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS uploads_expiry ON uploads(expires_at) WHERE response_id IS NULL;
  `);

  const userColumns = columns('users');
  if (!userColumns.has('active_space_id')) db.exec('ALTER TABLE users ADD COLUMN active_space_id TEXT');
  for (const table of spaceColumnTables) {
    if (!columns(table).has('space_id')) db.exec(`ALTER TABLE ${table} ADD COLUMN space_id TEXT REFERENCES spaces(id) ON DELETE CASCADE`);
  }

  if (!columns('email_suppressions').has('space_id')) {
    db.exec('ALTER TABLE email_suppressions ADD COLUMN space_id TEXT REFERENCES spaces(id) ON DELETE CASCADE');
  }
  const uploadColumns = columns('uploads');
  if (!uploadColumns.has('question_id')) db.exec('ALTER TABLE uploads ADD COLUMN question_id TEXT REFERENCES questions(id) ON DELETE SET NULL');
  if (!uploadColumns.has('response_id')) db.exec('ALTER TABLE uploads ADD COLUMN response_id TEXT REFERENCES responses(id) ON DELETE CASCADE');
  if (!uploadColumns.has('expires_at')) db.exec('ALTER TABLE uploads ADD COLUMN expires_at TEXT');
  if (!uploadColumns.has('claimed_at')) db.exec('ALTER TABLE uploads ADD COLUMN claimed_at TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS uploads_expiry ON uploads(expires_at) WHERE response_id IS NULL');
}

function finalizeSuppressionSchema() {
  // Suppression must be tenant-local. A recipient opting out of one customer's
  // mail must not mutate another customer's sending state.
  const suppressionSql = String((db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='email_suppressions'").get() as any)?.sql || '');
  if (/email\s+TEXT\s+PRIMARY\s+KEY/i.test(suppressionSql)) {
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        db.exec(`CREATE TABLE email_suppressions_next (
          space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
          email TEXT NOT NULL COLLATE NOCASE,
          reason TEXT NOT NULL,
          source TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(space_id,email)
        )`);
        db.exec(`INSERT OR IGNORE INTO email_suppressions_next
          (space_id,email,reason,source,created_at,updated_at)
          SELECT space_id,email,reason,source,created_at,updated_at FROM email_suppressions WHERE space_id IS NOT NULL`);
        db.exec('DROP TABLE email_suppressions; ALTER TABLE email_suppressions_next RENAME TO email_suppressions;');
      })();
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }
}

function ensureExistingUserSpaces() {
  const users = db.prepare('SELECT id,name,active_space_id FROM users ORDER BY created_at,id').all() as Array<{ id: string; name: string; active_space_id: string | null }>;
  const create = db.transaction((user: { id: string; name: string; active_space_id: string | null }) => {
    let spaceId = defaultSpaceIdForUser(user.id);
    if (!spaceId) spaceId = createSpaceRecord(user.id, personalSpaceName(user.name), user.id);
    const activeMembership = user.active_space_id
      ? db.prepare('SELECT 1 FROM space_memberships WHERE space_id=? AND user_id=?').get(user.active_space_id, user.id)
      : null;
    if (!activeMembership) db.prepare('UPDATE users SET active_space_id=? WHERE id=?').run(spaceId, user.id);
  });
  for (const user of users) create(user);
}

function legacyOwnerSpaceId() {
  const owner = db.prepare(`SELECT u.id FROM users u
    ORDER BY CASE WHEN u.role='owner' THEN 0 ELSE 1 END,u.created_at,u.id LIMIT 1`).get() as { id: string } | undefined;
  return owner ? defaultSpaceIdForUser(owner.id) : null;
}

function actorSpace(userId: string | null | undefined) {
  return userId ? defaultSpaceIdForUser(userId) : null;
}

function legacyQuarantineSpace(fallbackSpaceId: string) {
  const existing = db.prepare(`SELECT id FROM spaces
    WHERE slug LIKE 'legacy-data-review-%' AND personal_for_user_id IS NULL ORDER BY created_at LIMIT 1`)
    .get() as { id: string } | undefined;
  if (existing) return existing.id;
  const owner = db.prepare('SELECT created_by_user_id FROM spaces WHERE id=?').get(fallbackSpaceId) as { created_by_user_id: string };
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO spaces (id,name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at)
    VALUES (?, 'Legacy data review', ?, ?, NULL, ?, ?)`)
    .run(id, `legacy-data-review-${id.slice(0, 8)}`, owner.created_by_user_id, now, now);
  return id;
}

function backfillLegacyIntelligenceReports(fallbackSpaceId: string) {
  const reports = db.prepare(`SELECT id,user_id,source_refs_json,source_snapshot_json FROM intelligence_reports
    WHERE space_id IS NULL ORDER BY created_at,id`).all() as Array<{
      id: string; user_id: string; source_refs_json: string; source_snapshot_json: string;
    }>;
  const surveySpace = db.prepare(`SELECT s.space_id FROM insights i JOIN surveys s ON s.id=i.survey_id WHERE i.id=?`);
  const socialSpace = db.prepare('SELECT space_id FROM social_intelligence_reports WHERE id=?');
  const update = db.prepare('UPDATE intelligence_reports SET space_id=? WHERE id=? AND space_id IS NULL');
  const quarantine = db.prepare(`INSERT OR IGNORE INTO space_migration_quarantine
    (artifact_type,artifact_id,reason,source_spaces_json,created_at) VALUES ('intelligence_report',?,?,?,?)`);
  let quarantineSpaceId: string | null = null;

  for (const report of reports) {
    const refs = new Set<string>();
    try {
      const parsed = JSON.parse(report.source_refs_json) as { survey?: unknown[]; social?: unknown[] };
      for (const ref of [...(Array.isArray(parsed?.survey) ? parsed.survey : []), ...(Array.isArray(parsed?.social) ? parsed.social : [])]) refs.add(String(ref));
    } catch { /* Snapshot refs below remain available for valid historical records. */ }
    try {
      const snapshot = JSON.parse(report.source_snapshot_json);
      if (Array.isArray(snapshot)) for (const source of snapshot) {
        if (source && typeof source === 'object' && 'ref' in source) refs.add(String((source as any).ref));
      }
    } catch { /* Invalid legacy snapshots are treated as unattributed. */ }

    const sourceSpaces = new Set<string>();
    for (const ref of refs) {
      if (ref.startsWith('survey-insight:')) {
        const row = surveySpace.get(ref.slice('survey-insight:'.length)) as { space_id: string } | undefined;
        if (row?.space_id) sourceSpaces.add(row.space_id);
      } else if (ref.startsWith('social-report:')) {
        const row = socialSpace.get(ref.slice('social-report:'.length)) as { space_id: string } | undefined;
        if (row?.space_id) sourceSpaces.add(row.space_id);
      }
    }

    if (sourceSpaces.size === 1) {
      update.run([...sourceSpaces][0], report.id);
    } else if (sourceSpaces.size > 1) {
      quarantineSpaceId ||= legacyQuarantineSpace(fallbackSpaceId);
      update.run(quarantineSpaceId, report.id);
      quarantine.run(report.id, 'Historical report contains sources from multiple spaces.', JSON.stringify([...sourceSpaces].sort()), new Date().toISOString());
    } else {
      update.run(actorSpace(report.user_id) || fallbackSpaceId, report.id);
    }
  }
}

function parseStringArray(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function mentionCloneKey(spaceId: string, mentionId: string) {
  return `${spaceId}\u0000${mentionId}`;
}

/**
 * A pre-space X post could be deduplicated globally and linked to connections
 * owned by different accounts. Give every destination space its own row before
 * installing the new per-space uniqueness constraint, then move every
 * connection-owned reference to the matching clone.
 */
function splitLegacySharedXMentions() {
  const clones = new Map<string, string>();
  const crossSpaceLinks = db.prepare(`SELECT
      cm.connection_id,cm.mention_id,cm.streams_json,cm.query_ids_json,cm.discovered_at,cm.last_seen_at,
      c.space_id target_space,m.space_id mention_space,m.source,m.external_id
    FROM x_connection_mentions cm
    JOIN x_connections c ON c.id=cm.connection_id
    JOIN social_mentions m ON m.id=cm.mention_id
    WHERE c.space_id<>m.space_id
    ORDER BY cm.discovered_at,cm.connection_id,cm.mention_id`).all() as Array<{
      connection_id: string; mention_id: string; streams_json: string; query_ids_json: string;
      discovered_at: string; last_seen_at: string; target_space: string; mention_space: string;
      source: string; external_id: string | null;
    }>;

  const insertClone = db.prepare(`INSERT INTO social_mentions
      (id,space_id,source,external_id,x_connection_id,ingestion_kind,author,content,url,language,published_at,metadata_json,analysis_json,created_at)
    SELECT ?,?,source,external_id,?,ingestion_kind,author,content,url,language,published_at,metadata_json,analysis_json,created_at
    FROM social_mentions WHERE id=?`);
  const existingExternal = db.prepare(`SELECT id FROM social_mentions
    WHERE space_id=? AND source=? AND external_id=? LIMIT 1`);
  const existingLink = db.prepare(`SELECT streams_json,query_ids_json,discovered_at,last_seen_at
    FROM x_connection_mentions WHERE connection_id=? AND mention_id=?`);
  const upsertLink = db.prepare(`INSERT INTO x_connection_mentions
      (connection_id,mention_id,streams_json,query_ids_json,discovered_at,last_seen_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(connection_id,mention_id) DO UPDATE SET
      streams_json=excluded.streams_json,
      query_ids_json=excluded.query_ids_json,
      discovered_at=excluded.discovered_at,
      last_seen_at=excluded.last_seen_at`);
  const removeLink = db.prepare('DELETE FROM x_connection_mentions WHERE connection_id=? AND mention_id=?');
  const moveReplyDrafts = db.prepare(`UPDATE social_reply_drafts SET mention_id=?
    WHERE connection_id=? AND mention_id=?`);
  const reportsForConnection = db.prepare(`SELECT id,mention_ids_json FROM social_intelligence_reports
    WHERE connection_id=?`);
  const updateReportMentions = db.prepare('UPDATE social_intelligence_reports SET mention_ids_json=? WHERE id=?');

  for (const link of crossSpaceLinks) {
    const key = mentionCloneKey(link.target_space, link.mention_id);
    let targetMentionId = clones.get(key);
    if (!targetMentionId && link.external_id) {
      targetMentionId = (existingExternal.get(link.target_space, link.source, link.external_id) as { id: string } | undefined)?.id;
    }
    if (!targetMentionId) {
      targetMentionId = crypto.randomUUID();
      insertClone.run(targetMentionId, link.target_space, link.connection_id, link.mention_id);
    }
    clones.set(key, targetMentionId);

    const current = existingLink.get(link.connection_id, targetMentionId) as {
      streams_json: string; query_ids_json: string; discovered_at: string; last_seen_at: string;
    } | undefined;
    const streams = [...new Set([...parseStringArray(current?.streams_json), ...parseStringArray(link.streams_json)])];
    const queryIds = [...new Set([...parseStringArray(current?.query_ids_json), ...parseStringArray(link.query_ids_json)])];
    upsertLink.run(
      link.connection_id,
      targetMentionId,
      JSON.stringify(streams),
      JSON.stringify(queryIds),
      current && current.discovered_at < link.discovered_at ? current.discovered_at : link.discovered_at,
      current && current.last_seen_at > link.last_seen_at ? current.last_seen_at : link.last_seen_at
    );
    removeLink.run(link.connection_id, link.mention_id);
    moveReplyDrafts.run(targetMentionId, link.connection_id, link.mention_id);

    for (const report of reportsForConnection.all(link.connection_id) as Array<{ id: string; mention_ids_json: string }>) {
      const mentionIds = parseStringArray(report.mention_ids_json);
      if (!mentionIds.includes(link.mention_id)) continue;
      updateReportMentions.run(JSON.stringify(mentionIds.map((id) => id === link.mention_id ? targetMentionId : id)), report.id);
    }
  }
  return clones;
}

function rewriteLegacySocialJobMentionIds(clones: Map<string, string>) {
  const rows = db.prepare(`SELECT id,requested_by,input_json FROM ai_jobs
    WHERE kind='social.analyze' AND json_valid(input_json)`).all() as Array<{
      id: string; requested_by: string | null; input_json: string;
    }>;
  const mentionSpace = db.prepare('SELECT space_id FROM social_mentions WHERE id=?');
  const update = db.prepare('UPDATE ai_jobs SET input_json=? WHERE id=?');
  for (const row of rows) {
    const input = JSON.parse(row.input_json) as Record<string, unknown>;
    if (!Array.isArray(input.mentionIds) || !input.mentionIds.length) continue;
    const candidateSpace = actorSpace(row.requested_by);
    if (!candidateSpace) continue;
    const rewritten = input.mentionIds.map(String).map((mentionId) => {
      const currentSpace = (mentionSpace.get(mentionId) as { space_id: string } | undefined)?.space_id;
      if (currentSpace === candidateSpace) return mentionId;
      return clones.get(mentionCloneKey(candidateSpace, mentionId)) || mentionId;
    });
    const allBelongToCandidate = rewritten.every((mentionId) =>
      (mentionSpace.get(mentionId) as { space_id: string } | undefined)?.space_id === candidateSpace);
    if (allBelongToCandidate) update.run(JSON.stringify({ ...input, mentionIds: rewritten }), row.id);
  }
}

function legacyUploadFilename(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const pathname = new URL(value, `${config.publicUrl}/`).pathname;
    const match = pathname.match(/^\/uploads\/([^/]+)$/);
    if (!match) return null;
    const filename = decodeURIComponent(match[1]);
    return filename && path.basename(filename) === filename ? filename : null;
  } catch {
    return null;
  }
}

function legacyUploadMime(filename: string, supplied: unknown) {
  const declared = String(supplied || '').trim().toLowerCase();
  if (/^(image\/(png|jpeg|webp|gif)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+)$/.test(declared)
    || declared === 'application/pdf') return declared;
  const extension = path.extname(filename).toLowerCase();
  return ({
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
    '.pdf': 'application/pdf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
    '.mp4': 'video/mp4', '.webm': 'video/webm'
  } as Record<string, string>)[extension] || 'application/octet-stream';
}

/**
 * Old survey answers stored a directly-served /uploads URL. Convert every
 * existing file reference into a space-owned capability URL before the raw
 * static route is removed. The metadata insert and answer rewrite share the
 * surrounding SQLite transaction, so a restart cannot expose a half-migrated
 * reference.
 */
function migrateLegacyResponseUploads(createdCopies: string[]) {
  const responses = db.prepare(`SELECT r.id,r.collector_id,r.answers_json,r.started_at,s.space_id
    FROM responses r JOIN surveys s ON s.id=r.survey_id
    WHERE r.answers_json LIKE '%/uploads/%'`).all() as Array<{
      id: string; collector_id: string; answers_json: string; started_at: string; space_id: string;
    }>;
  const migrated = new Map<string, {
    id: string; token: string; originalName: string; mimeType: string; size: number;
  }>();
  const insert = db.prepare(`INSERT INTO uploads
      (id,space_id,collector_id,created_by_user_id,question_id,response_id,stored_filename,original_name,mime_type,size,access_token_hash,expires_at,claimed_at,created_at)
    VALUES (?,?,?,NULL,NULL,?,?,?,?,?,?,NULL,?,?)`);
  const updateAnswers = db.prepare('UPDATE responses SET answers_json=? WHERE id=?');

  for (const response of responses) {
    let answers: unknown;
    try { answers = JSON.parse(response.answers_json); } catch { continue; }
    let changed = false;
    const rewrite = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(rewrite);
      if (value && typeof value === 'object') {
        const source = value as Record<string, unknown>;
        const filename = legacyUploadFilename(source.url);
        if (filename) {
          const resolved = path.resolve(config.uploadDir, filename);
          const root = `${path.resolve(config.uploadDir)}${path.sep}`.toLowerCase();
          if (resolved.toLowerCase().startsWith(root) && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
            const key = `${response.space_id}\u0000${response.collector_id}\u0000${filename}`;
            let upload = migrated.get(key);
            if (!upload) {
              const stat = fs.statSync(resolved);
              const id = crypto.randomUUID();
              const token = crypto.randomBytes(32).toString('base64url');
              const originalName = path.basename(String(source.name || filename)).slice(0, 255) || filename;
              const mimeType = legacyUploadMime(filename, source.mimeType);
              const storedFilename = `space-migrated-${crypto.randomUUID()}${path.extname(filename).toLowerCase().slice(0, 10)}`;
              const copiedPath = path.resolve(config.uploadDir, storedFilename);
              fs.copyFileSync(resolved, copiedPath);
              createdCopies.push(copiedPath);
              try {
                insert.run(id, response.space_id, response.collector_id, response.id, storedFilename, originalName, mimeType, stat.size,
                  crypto.createHash('sha256').update(token).digest('hex'), response.started_at, response.started_at);
              } catch (error) {
                fs.rmSync(copiedPath, { force: true });
                createdCopies.splice(createdCopies.indexOf(copiedPath), 1);
                throw error;
              }
              upload = { id, token, originalName, mimeType, size: stat.size };
              migrated.set(key, upload);
            }
            changed = true;
            return {
              ...source,
              id: upload.id,
              name: upload.originalName,
              mimeType: upload.mimeType,
              size: upload.size,
              url: `${config.publicUrl}/api/public/uploads/${encodeURIComponent(upload.id)}/${encodeURIComponent(upload.token)}`
            };
          }
        }
        return Object.fromEntries(Object.entries(source).map(([key, child]) => [key, rewrite(child)]));
      }
      const filename = legacyUploadFilename(value);
      if (!filename) return value;
      const resolved = path.resolve(config.uploadDir, filename);
      const root = `${path.resolve(config.uploadDir)}${path.sep}`.toLowerCase();
      if (!resolved.toLowerCase().startsWith(root) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return value;
      const key = `${response.space_id}\u0000${response.collector_id}\u0000${filename}`;
      let upload = migrated.get(key);
      if (!upload) {
        const stat = fs.statSync(resolved);
        const id = crypto.randomUUID();
        const token = crypto.randomBytes(32).toString('base64url');
        const mimeType = legacyUploadMime(filename, null);
        const storedFilename = `space-migrated-${crypto.randomUUID()}${path.extname(filename).toLowerCase().slice(0, 10)}`;
        const copiedPath = path.resolve(config.uploadDir, storedFilename);
        fs.copyFileSync(resolved, copiedPath);
        createdCopies.push(copiedPath);
        try {
          insert.run(id, response.space_id, response.collector_id, response.id, storedFilename, filename, mimeType, stat.size,
            crypto.createHash('sha256').update(token).digest('hex'), response.started_at, response.started_at);
        } catch (error) {
          fs.rmSync(copiedPath, { force: true });
          createdCopies.splice(createdCopies.indexOf(copiedPath), 1);
          throw error;
        }
        upload = { id, token, originalName: filename, mimeType, size: stat.size };
        migrated.set(key, upload);
      }
      changed = true;
      return `${config.publicUrl}/api/public/uploads/${encodeURIComponent(upload.id)}/${encodeURIComponent(upload.token)}`;
    };
    const rewritten = rewrite(answers);
    if (changed) updateAnswers.run(JSON.stringify(rewritten), response.id);
  }
}

function backfillExistingArtifacts() {
  const fallbackSpaceId = legacyOwnerSpaceId();
  if (!fallbackSpaceId) {
    const artifactCount = spaceColumnTables.reduce((total, table) => total + Number((db.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as any).count), 0);
    if (artifactCount) throw new Error('Tenant artifacts exist but there is no account available to own their legacy space.');
  } else {
    const createdUploadCopies: string[] = [];
    const transaction = db.transaction(() => {
    // The old indexes deduplicated X data across the whole installation. Drop
    // them transactionally before splitting shared rows below.
    db.exec('DROP INDEX IF EXISTS social_mentions_x_external; DROP INDEX IF EXISTS x_connections_user_account;');

    // Generation result links are authoritative creation evidence. Preserve
    // that ownership before assigning genuinely unattributed legacy content to
    // the original workspace owner.
    const generatedSurveys = db.prepare(`SELECT
        json_extract(job.result_json,'$.output.survey.id') artifact_id,personal.id space_id
      FROM ai_jobs job JOIN spaces personal ON personal.personal_for_user_id=job.requested_by
      JOIN surveys artifact ON artifact.id=json_extract(job.result_json,'$.output.survey.id')
      WHERE job.kind='survey.generate' AND json_valid(job.result_json) AND artifact.space_id IS NULL
      ORDER BY job.completed_at,job.created_at,job.id`).all() as Array<{ artifact_id: string; space_id: string }>;
    const assignGeneratedSurvey = db.prepare('UPDATE surveys SET space_id=? WHERE id=? AND space_id IS NULL');
    for (const artifact of generatedSurveys) assignGeneratedSurvey.run(artifact.space_id, artifact.artifact_id);
    db.prepare('UPDATE surveys SET space_id=? WHERE space_id IS NULL').run(fallbackSpaceId);
    migrateLegacyResponseUploads(createdUploadCopies);

    db.prepare(`UPDATE campaigns SET space_id=COALESCE(
      (SELECT s.space_id FROM surveys s WHERE s.id=campaigns.survey_id), ?
    ) WHERE space_id IS NULL`).run(fallbackSpaceId);

    const generatedJourneys = db.prepare(`SELECT application.journey_id artifact_id,personal.id space_id
      FROM journey_ai_applications application
      JOIN ai_jobs job ON job.id=application.job_id
      JOIN spaces personal ON personal.personal_for_user_id=job.requested_by
      JOIN journeys artifact ON artifact.id=application.journey_id
      WHERE application.kind='journey.generate' AND artifact.space_id IS NULL
      ORDER BY application.created_at,application.job_id`).all() as Array<{ artifact_id: string; space_id: string }>;
    const assignGeneratedJourney = db.prepare('UPDATE journeys SET space_id=? WHERE id=? AND space_id IS NULL');
    for (const artifact of generatedJourneys) assignGeneratedJourney.run(artifact.space_id, artifact.artifact_id);
    db.prepare('UPDATE journeys SET space_id=? WHERE space_id IS NULL').run(fallbackSpaceId);

    const userOwned = [
      ['x_connections', 'user_id'],
      ['x_oauth_requests', 'user_id'],
      ['esign_envelopes', 'created_by_user_id']
    ] as const;
    for (const [table, userColumn] of userOwned) {
      const rows = db.prepare(`SELECT id,${userColumn} user_id FROM ${table} WHERE space_id IS NULL`).all() as Array<{ id: string; user_id: string | null }>;
      const update = db.prepare(`UPDATE ${table} SET space_id=? WHERE id=?`);
      for (const row of rows) update.run(actorSpace(row.user_id) || fallbackSpaceId, row.id);
    }

    db.prepare(`UPDATE social_mentions SET space_id=COALESCE(
      (SELECT c.space_id FROM x_connections c WHERE c.id=social_mentions.x_connection_id),
      (SELECT c.space_id FROM x_connection_mentions cm JOIN x_connections c ON c.id=cm.connection_id
        WHERE cm.mention_id=social_mentions.id ORDER BY cm.discovered_at LIMIT 1),
      ?
    ) WHERE space_id IS NULL`).run(fallbackSpaceId);
    const mentionClones = splitLegacySharedXMentions();
    rewriteLegacySocialJobMentionIds(mentionClones);

    db.prepare(`UPDATE social_reply_drafts SET space_id=COALESCE(
      (SELECT c.space_id FROM x_connections c WHERE c.id=social_reply_drafts.connection_id),
      (SELECT m.space_id FROM social_mentions m WHERE m.id=social_reply_drafts.mention_id),
      (SELECT s.id FROM spaces s WHERE s.personal_for_user_id=social_reply_drafts.requested_by),
      ?
    ) WHERE space_id IS NULL`).run(fallbackSpaceId);

    db.prepare(`UPDATE social_intelligence_reports SET space_id=COALESCE(
      (SELECT c.space_id FROM x_connections c WHERE c.id=social_intelligence_reports.connection_id),
      (SELECT s.id FROM spaces s WHERE s.personal_for_user_id=social_intelligence_reports.user_id),
      ?
    ) WHERE space_id IS NULL`).run(fallbackSpaceId);
    backfillLegacyIntelligenceReports(fallbackSpaceId);

    db.prepare(`UPDATE ai_jobs SET space_id=COALESCE(
      (SELECT s.space_id FROM surveys s WHERE s.id=ai_jobs.survey_id),
      (SELECT s.space_id FROM responses r JOIN surveys s ON s.id=r.survey_id WHERE r.id=ai_jobs.response_id),
      (SELECT j.space_id FROM journey_ai_applications a JOIN journeys j ON j.id=a.journey_id
        WHERE a.job_id=ai_jobs.id),
      (SELECT j.space_id FROM journeys j WHERE json_valid(ai_jobs.input_json)
        AND j.id=json_extract(ai_jobs.input_json,'$.journeyId')),
      (SELECT s.space_id FROM surveys s WHERE json_valid(ai_jobs.result_json)
        AND s.id=json_extract(ai_jobs.result_json,'$.output.survey.id')),
      (SELECT j.space_id FROM journeys j WHERE json_valid(ai_jobs.result_json)
        AND j.id=json_extract(ai_jobs.result_json,'$.output.journey.id')),
      (SELECT d.space_id FROM social_reply_drafts d WHERE ai_jobs.kind='social.reply_draft'
        AND json_valid(ai_jobs.input_json) AND d.id=json_extract(ai_jobs.input_json,'$.draftId')),
      (SELECT r.space_id FROM social_intelligence_reports r WHERE ai_jobs.kind='social.report'
        AND json_valid(ai_jobs.input_json) AND r.id=json_extract(ai_jobs.input_json,'$.reportId')),
      (SELECT r.space_id FROM intelligence_reports r WHERE ai_jobs.kind='intelligence.synthesize'
        AND json_valid(ai_jobs.input_json) AND r.id=json_extract(ai_jobs.input_json,'$.reportId')),
      (SELECT c.space_id FROM x_sync_jobs x JOIN x_connections c ON c.id=x.connection_id
        WHERE json_valid(ai_jobs.input_json) AND x.id=json_extract(ai_jobs.input_json,'$.xSyncJobId')),
      (SELECT m.space_id FROM json_each(ai_jobs.input_json,'$.mentionIds') mention
        JOIN social_mentions m ON m.id=mention.value
        WHERE ai_jobs.kind='social.analyze' LIMIT 1),
      (SELECT s.id FROM spaces s WHERE s.personal_for_user_id=ai_jobs.requested_by),
      ?
    ) WHERE space_id IS NULL`).run(fallbackSpaceId);

    // Legacy suppressions were global. They belonged to the one historical
    // workspace, so preserve them there during the table rebuild.
    if (columns('email_suppressions').has('space_id')) {
      db.prepare('UPDATE email_suppressions SET space_id=? WHERE space_id IS NULL').run(fallbackSpaceId);
    }
    });
    try {
      transaction();
    } catch (error) {
      for (const file of createdUploadCopies) fs.rmSync(file, { force: true });
      throw error;
    }
  }

  for (const table of spaceColumnTables) {
    db.exec(`CREATE INDEX IF NOT EXISTS ${table}_space_scope ON ${table}(space_id)`);
  }
  db.exec(`DROP INDEX IF EXISTS social_mentions_x_external;
    CREATE UNIQUE INDEX IF NOT EXISTS social_mentions_space_x_external
      ON social_mentions(space_id,source,external_id) WHERE external_id IS NOT NULL;
    DROP INDEX IF EXISTS x_connections_user_account;
    CREATE UNIQUE INDEX IF NOT EXISTS x_connections_space_account
      ON x_connections(space_id,x_user_id) WHERE x_user_id IS NOT NULL;
    DROP INDEX IF EXISTS social_reply_drafts_one_active_request;
    DROP INDEX IF EXISTS social_reply_drafts_idempotency;
    DROP INDEX IF EXISTS social_intelligence_reports_one_active_request;
    DROP INDEX IF EXISTS social_intelligence_reports_idempotency;
    DROP INDEX IF EXISTS intelligence_reports_one_active_request;
    DROP INDEX IF EXISTS intelligence_reports_idempotency;
    CREATE UNIQUE INDEX IF NOT EXISTS social_reply_drafts_one_active_request
      ON social_reply_drafts(space_id,requested_by,mention_id,tone,instructions) WHERE state='queued';
    CREATE UNIQUE INDEX IF NOT EXISTS social_reply_drafts_idempotency
      ON social_reply_drafts(space_id,requested_by,idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS social_intelligence_reports_one_active_request
      ON social_intelligence_reports(space_id,user_id,connection_id,title,mention_ids_json) WHERE state='queued';
    CREATE UNIQUE INDEX IF NOT EXISTS social_intelligence_reports_idempotency
      ON social_intelligence_reports(space_id,user_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS intelligence_reports_one_active_request
      ON intelligence_reports(space_id,user_id,title,objective,source_refs_json) WHERE state='queued';
    CREATE UNIQUE INDEX IF NOT EXISTS intelligence_reports_idempotency
      ON intelligence_reports(space_id,user_id,idempotency_key) WHERE idempotency_key IS NOT NULL;`);

  for (const table of spaceColumnTables) {
    const missing = Number((db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE space_id IS NULL`).get() as any).count);
    if (missing) throw new Error(`Space migration left ${missing} unassigned ${table} record(s).`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_space_required_insert
      BEFORE INSERT ON ${table} WHEN NEW.space_id IS NULL
      BEGIN SELECT RAISE(ABORT,'${table}.space_id is required'); END;
      CREATE TRIGGER IF NOT EXISTS ${table}_space_required_update
      BEFORE UPDATE OF space_id ON ${table} WHEN NEW.space_id IS NULL
      BEGIN SELECT RAISE(ABORT,'${table}.space_id is required'); END;`);
  }
}

function initializeSpaces() {
  createSpaceSchema();
  ensureExistingUserSpaces();
  backfillExistingArtifacts();
  finalizeSuppressionSchema();
  const violations = db.prepare('PRAGMA foreign_key_check').all();
  if (violations.length) throw new Error('Space migration left invalid foreign keys.');
}

initializeSpaces();

export function ensureDefaultSpaceForUser(user: { id: string; name: string }, requestedName?: unknown) {
  return db.transaction(() => {
    let id = defaultSpaceIdForUser(user.id);
    if (!id) {
      const name = cleanSpaceName(requestedName, personalSpaceName(user.name));
      id = createSpaceRecord(user.id, name, user.id);
    }
    db.prepare('UPDATE users SET active_space_id=? WHERE id=? AND (active_space_id IS NULL OR NOT EXISTS ' +
      '(SELECT 1 FROM space_memberships m WHERE m.space_id=users.active_space_id AND m.user_id=users.id))').run(id, user.id);
    return id;
  })();
}

function rowSpace(row: any): SpaceSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    role: row.role,
    isPersonal: row.personal_for_user_id === row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listSpacesForUser(userId: string): SpaceSummary[] {
  return (db.prepare(`SELECT s.*,m.role,m.user_id FROM spaces s
    JOIN space_memberships m ON m.space_id=s.id WHERE m.user_id=?
    ORDER BY CASE WHEN s.personal_for_user_id=? THEN 0 ELSE 1 END,s.name COLLATE NOCASE,s.id`).all(userId, userId) as any[]).map(rowSpace);
}

export function activeSpaceForUser(userId: string): SpaceSummary {
  let row = db.prepare(`SELECT s.*,m.role,m.user_id FROM users u
    JOIN space_memberships m ON m.space_id=u.active_space_id AND m.user_id=u.id
    JOIN spaces s ON s.id=m.space_id WHERE u.id=?`).get(userId) as any;
  if (!row) {
    const fallback = listSpacesForUser(userId)[0];
    if (!fallback) throw new SpaceError('This account does not have a space.', 403, 'SPACE_MEMBERSHIP_REQUIRED');
    db.prepare('UPDATE users SET active_space_id=? WHERE id=?').run(fallback.id, userId);
    return fallback;
  }
  return rowSpace(row);
}

export function resolveRequestSpace(request: Request, userId: string): SpaceContext {
  const requested = String(request.get('x-seemplify-space') || request.query.spaceId || '').trim();
  let row: any;
  if (requested) {
    row = db.prepare(`SELECT s.*,m.role,m.user_id FROM spaces s
      JOIN space_memberships m ON m.space_id=s.id WHERE s.id=? AND m.user_id=?`).get(requested, userId);
    if (!row) throw new SpaceError('You do not have access to this space.', 403, 'SPACE_ACCESS_DENIED');
  } else {
    const active = activeSpaceForUser(userId);
    return { ...active, userId };
  }
  return { ...rowSpace(row), userId };
}

export function getSpaceForUser(userId: string, spaceId: string): SpaceContext | null {
  const row = db.prepare(`SELECT s.*,m.role,m.user_id FROM spaces s
    JOIN space_memberships m ON m.space_id=s.id WHERE s.id=? AND m.user_id=?`).get(spaceId, userId) as any;
  return row ? { ...rowSpace(row), userId } : null;
}

export function setActiveSpace(userId: string, spaceId: string) {
  const space = getSpaceForUser(userId, spaceId);
  if (!space) throw new SpaceError('You do not have access to this space.', 403, 'SPACE_ACCESS_DENIED');
  db.prepare('UPDATE users SET active_space_id=?,updated_at=? WHERE id=?').run(spaceId, new Date().toISOString(), userId);
  return space;
}

export function createSpace(user: { id: string; name: string }, input: { name?: unknown }) {
  return db.transaction(() => {
    const name = cleanSpaceName(input.name, personalSpaceName(user.name));
    const id = createSpaceRecord(user.id, name, null);
    db.prepare('UPDATE users SET active_space_id=?,updated_at=? WHERE id=?').run(id, new Date().toISOString(), user.id);
    return getSpaceForUser(user.id, id)!;
  })();
}

function requireSpaceManager(context: SpaceContext) {
  if (context.role !== 'owner' && context.role !== 'admin') {
    throw new SpaceError('Space owner or admin access is required.', 403, 'SPACE_MANAGER_REQUIRED');
  }
}

function requireSpaceOwner(context: SpaceContext) {
  if (context.role !== 'owner') throw new SpaceError('Space owner access is required.', 403, 'SPACE_OWNER_REQUIRED');
}

export function renameSpace(context: SpaceContext, nameValue: unknown) {
  requireSpaceManager(context);
  const name = cleanSpaceName(nameValue, context.name);
  const now = new Date().toISOString();
  db.prepare('UPDATE spaces SET name=?,updated_at=? WHERE id=?').run(name, now, context.id);
  return getSpaceForUser(context.userId, context.id)!;
}

export function listSpaceMembers(context: SpaceContext) {
  return db.prepare(`SELECT u.id,u.name,u.email,m.role,m.joined_at joinedAt
    FROM space_memberships m JOIN users u ON u.id=m.user_id
    WHERE m.space_id=? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,u.name COLLATE NOCASE,u.id`)
    .all(context.id);
}

export function updateSpaceMember(context: SpaceContext, memberUserId: string, role: SpaceRole) {
  requireSpaceOwner(context);
  if (memberUserId === context.userId) throw new SpaceError('Transfer ownership before changing your own role.', 409, 'OWNER_ROLE_PROTECTED');
  if (role === 'owner') throw new SpaceError('Ownership transfer is not available yet.', 400, 'OWNERSHIP_TRANSFER_UNAVAILABLE');
  const changed = db.prepare('UPDATE space_memberships SET role=?,updated_at=? WHERE space_id=? AND user_id=? AND role<>?')
    .run(role, new Date().toISOString(), context.id, memberUserId, 'owner').changes;
  if (!changed) throw new SpaceError('Member not found or role cannot be changed.', 404, 'MEMBER_NOT_FOUND');
  return listSpaceMembers(context);
}

export function removeSpaceMember(context: SpaceContext, memberUserId: string) {
  requireSpaceManager(context);
  const membership = db.prepare('SELECT role FROM space_memberships WHERE space_id=? AND user_id=?').get(context.id, memberUserId) as { role: SpaceRole } | undefined;
  if (!membership) throw new SpaceError('Member not found.', 404, 'MEMBER_NOT_FOUND');
  if (membership.role === 'owner') throw new SpaceError('The space owner cannot be removed.', 409, 'OWNER_MEMBERSHIP_PROTECTED');
  if (context.role === 'admin' && membership.role === 'admin') throw new SpaceError('Only an owner can remove an admin.', 403, 'SPACE_OWNER_REQUIRED');
  db.transaction(() => {
    const now = new Date().toISOString();
    db.prepare(`UPDATE x_oauth_requests SET consumed_at=?
      WHERE space_id=? AND user_id=? AND consumed_at IS NULL`).run(now, context.id, memberUserId);
    db.prepare('DELETE FROM space_memberships WHERE space_id=? AND user_id=?').run(context.id, memberUserId);
    const fallback = defaultSpaceIdForUser(memberUserId);
    db.prepare('UPDATE users SET active_space_id=? WHERE id=? AND active_space_id=?').run(fallback, memberUserId, context.id);
  })();
}

function normalizedEmail(value: unknown) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new SpaceError('Enter a valid email address.');
  }
  return email;
}

function invitationTokenHash(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createSpaceInvitation(context: SpaceContext, input: { email?: unknown; role?: unknown }) {
  requireSpaceManager(context);
  const email = normalizedEmail(input.email);
  const role = input.role === 'admin' ? 'admin' : 'member';
  const existingMember = db.prepare(`SELECT 1 FROM space_memberships m JOIN users u ON u.id=m.user_id
    WHERE m.space_id=? AND u.email=?`).get(context.id, email);
  if (existingMember) throw new SpaceError('That person is already a member of this space.', 409, 'ALREADY_A_MEMBER');
  const token = crypto.randomBytes(32).toString('base64url');
  const id = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60_000).toISOString();
  db.transaction(() => {
    db.prepare(`UPDATE space_invitations SET revoked_at=?,updated_at=?
      WHERE space_id=? AND email=? AND accepted_at IS NULL AND revoked_at IS NULL`).run(now.toISOString(), now.toISOString(), context.id, email);
    db.prepare(`INSERT INTO space_invitations
      (id,space_id,email,role,token_hash,invited_by_user_id,expires_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(id, context.id, email, role, invitationTokenHash(token), context.userId, expiresAt, now.toISOString(), now.toISOString());
  })();
  return { id, token, email, role, expiresAt, space: { id: context.id, name: context.name } };
}

export function listSpaceInvitations(context: SpaceContext) {
  requireSpaceManager(context);
  return db.prepare(`SELECT i.id,i.email,i.role,i.expires_at expiresAt,i.accepted_at acceptedAt,i.revoked_at revokedAt,
      i.created_at createdAt,u.name invitedBy
    FROM space_invitations i JOIN users u ON u.id=i.invited_by_user_id
    WHERE i.space_id=? ORDER BY i.created_at DESC`).all(context.id);
}

export function revokeSpaceInvitation(context: SpaceContext, invitationId: string) {
  requireSpaceManager(context);
  const changed = db.prepare(`UPDATE space_invitations SET revoked_at=?,updated_at=?
    WHERE id=? AND space_id=? AND accepted_at IS NULL AND revoked_at IS NULL`)
    .run(new Date().toISOString(), new Date().toISOString(), invitationId, context.id).changes;
  if (!changed) throw new SpaceError('Pending invitation not found.', 404, 'INVITATION_NOT_FOUND');
}

export function invitationPreview(token: string) {
  const tokenHash = invitationTokenHash(String(token || ''));
  const row = db.prepare(`SELECT i.id,i.email,i.role,i.expires_at,s.id space_id,s.name space_name,u.name invited_by
    FROM space_invitations i JOIN spaces s ON s.id=i.space_id JOIN users u ON u.id=i.invited_by_user_id
    WHERE i.token_hash=? AND i.accepted_at IS NULL AND i.revoked_at IS NULL`).get(tokenHash) as any;
  if (!row || Date.parse(row.expires_at) <= Date.now()) throw new SpaceError('This invitation is invalid or has expired.', 404, 'INVITATION_INVALID');
  return {
    email: row.email,
    role: row.role,
    expiresAt: row.expires_at,
    space: { id: row.space_id, name: row.space_name },
    invitedBy: row.invited_by
  };
}

export function acceptSpaceInvitation(user: { id: string; email: string }, token: string) {
  return db.transaction(() => {
    const tokenHash = invitationTokenHash(String(token || ''));
    const row = db.prepare(`SELECT * FROM space_invitations
      WHERE token_hash=? AND accepted_at IS NULL AND revoked_at IS NULL`).get(tokenHash) as any;
    if (!row || Date.parse(row.expires_at) <= Date.now()) throw new SpaceError('This invitation is invalid or has expired.', 404, 'INVITATION_INVALID');
    if (String(row.email).toLowerCase() !== user.email.toLowerCase()) {
      throw new SpaceError(`This invitation was sent to ${row.email}. Sign in with that email address to accept it.`, 403, 'INVITATION_EMAIL_MISMATCH');
    }
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO space_memberships (space_id,user_id,role,joined_at,updated_at)
      VALUES (?,?,?,?,?) ON CONFLICT(space_id,user_id) DO UPDATE SET
      role=CASE WHEN space_memberships.role='owner' THEN 'owner' ELSE excluded.role END,updated_at=excluded.updated_at`)
      .run(row.space_id, user.id, row.role, now, now);
    db.prepare(`UPDATE space_invitations SET accepted_at=?,accepted_by_user_id=?,updated_at=?
      WHERE id=? AND accepted_at IS NULL AND revoked_at IS NULL`).run(now, user.id, now, row.id);
    db.prepare('UPDATE users SET active_space_id=?,updated_at=? WHERE id=?').run(row.space_id, now, user.id);
    return getSpaceForUser(user.id, row.space_id)!;
  })();
}

export function spaceSession(userId: string) {
  const spaces = listSpacesForUser(userId);
  const activeSpace = activeSpaceForUser(userId);
  return { spaces, activeSpace };
}

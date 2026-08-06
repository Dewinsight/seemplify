import crypto from 'node:crypto';
import { db } from './database.js';
import { journeyEvidenceSnapshotFingerprint } from './journeyEvidenceLifecycle.js';
import { assertSubscriptionFeature } from './subscriptionEntitlements.js';

export const personaClaimTypes = ['summary', 'attribute', 'goal', 'behaviour', 'need', 'barrier'] as const;
export type PersonaClaimType = typeof personaClaimTypes[number];
export type PersonaReviewState = 'draft' | 'in_review' | 'changes_requested' | 'approved';
export type PersonaReviewAction = 'submitted' | 'approved' | 'changes_requested' | 'withdrawn';

export class JourneyPersonaVersionError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = 'JOURNEY_PERSONA_VERSION_INVALID',
    public details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'JourneyPersonaVersionError';
  }
}

export type PersonaSnapshot = {
  name: string;
  summary: string;
  lifecycleState: 'draft' | 'in_review' | 'active' | 'retired';
  ownerUserId: string | null;
  source: 'workspace' | 'legacy_audience_draft' | 'ai_draft';
  attributes: Record<string, string>;
  goals: string[];
  behaviours: string[];
  needs: string[];
  barriers: string[];
  reviewAt: string | null;
};

export type PersonaClaim = {
  id: string;
  personaVersionId: string;
  type: PersonaClaimType;
  label: string;
  value: string;
  ordinal: number;
  checksum: string;
  evidence: PersonaClaimEvidence[];
};

export type PersonaClaimEvidence = {
  id: string;
  evidenceLinkId: string;
  assessmentAtLink: 'supports' | 'contradicts' | 'neutral';
  pinnedFingerprint: string;
  currentFingerprint: string | null;
  state: 'current' | 'changed' | 'invalidated' | 'deleted';
  createdByUserId: string | null;
  createdAt: string;
};

export type PersonaReviewEvent = {
  id: string;
  sequence: number;
  action: PersonaReviewAction;
  actorUserId: string | null;
  comment: string;
  createdAt: string;
};

export type PersonaVersion = PersonaSnapshot & {
  id: string;
  personaId: string;
  spaceId: string;
  versionNumber: number;
  checksum: string;
  createdByUserId: string | null;
  createdAt: string;
  reviewState: PersonaReviewState;
  claims: PersonaClaim[];
  reviewEvents: PersonaReviewEvent[];
  evidenceCoverage: {
    claimCount: number;
    evidencedClaimCount: number;
    currentSupportingLinks: number;
    changedLinks: number;
    invalidatedLinks: number;
  };
};

type PersonaRow = {
  id: string;
  space_id: string;
  name: string;
  summary: string;
  lifecycle_state: PersonaSnapshot['lifecycleState'];
  owner_user_id: string | null;
  source: PersonaSnapshot['source'];
  attributes_json: string | Record<string, string>;
  goals_json: string | string[];
  behaviours_json: string | string[];
  needs_json: string | string[];
  barriers_json: string | string[];
  review_at: string | null;
  revision: number;
  current_version_id?: string | null;
  approved_version_id?: string | null;
};

function parseJson<T>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object') return value as T;
  try { return value ? JSON.parse(String(value)) as T : fallback; }
  catch { return fallback; }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, stable(item)]));
}

function checksum(value: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function deterministicId(namespace: string, ...parts: unknown[]) {
  return `${namespace}_${checksum(parts).slice(0, 48)}`;
}

function nowIso() { return new Date().toISOString(); }

function snapshotFromRow(row: PersonaRow): PersonaSnapshot {
  return {
    name: row.name,
    summary: row.summary || '',
    lifecycleState: row.lifecycle_state,
    ownerUserId: row.owner_user_id || null,
    source: row.source,
    attributes: parseJson(row.attributes_json, {} as Record<string, string>),
    goals: parseJson(row.goals_json, [] as string[]),
    behaviours: parseJson(row.behaviours_json, [] as string[]),
    needs: parseJson(row.needs_json, [] as string[]),
    barriers: parseJson(row.barriers_json, [] as string[]),
    reviewAt: row.review_at || null
  };
}

function claimsForSnapshot(snapshot: PersonaSnapshot) {
  const claims: Array<{ type: PersonaClaimType; label: string; value: string; ordinal: number }> = [];
  if (snapshot.summary) claims.push({ type: 'summary', label: 'Summary', value: snapshot.summary, ordinal: 0 });
  for (const [ordinal, [label, value]] of Object.entries(snapshot.attributes)
    .sort(([left], [right]) => left.localeCompare(right)).entries()) {
    claims.push({ type: 'attribute', label, value, ordinal });
  }
  const lists: Array<[PersonaClaimType, string, string[]]> = [
    ['goal', 'Goal', snapshot.goals],
    ['behaviour', 'Behaviour', snapshot.behaviours],
    ['need', 'Need', snapshot.needs],
    ['barrier', 'Barrier', snapshot.barriers]
  ];
  for (const [type, label, values] of lists) {
    values.forEach((value, ordinal) => claims.push({ type, label, value, ordinal }));
  }
  return claims;
}

function evidenceFingerprint(row: any) {
  return journeyEvidenceSnapshotFingerprint({
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    sourceLabel: row.source_label,
    excerpt: row.excerpt,
    population: row.population,
    sampleSize: row.sample_size === null || row.sample_size === undefined ? null : Number(row.sample_size),
    collectedAt: row.collected_at || null,
    windowStart: row.window_start || null,
    windowEnd: row.window_end || null,
    sourceUpdatedAt: row.source_updated_at || null
  });
}

/**
 * SQLite mirrors runtime 23 for local development and tests. PostgreSQL is
 * upgraded only through the checksummed 0023 migration.
 */
function ensureSqliteSchema() {
  if (db.provider !== 'sqlite') return;
  const personaColumns = new Set((db.prepare('PRAGMA table_info(journey_personas)').all() as Array<{ name: string }>)
    .map((column) => String(column.name)));
  if (!personaColumns.has('current_version_id')) db.exec('ALTER TABLE journey_personas ADD COLUMN current_version_id TEXT');
  if (!personaColumns.has('approved_version_id')) db.exec('ALTER TABLE journey_personas ADD COLUMN approved_version_id TEXT');
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS journey_personas_tenant_identity ON journey_personas(id,space_id);
    CREATE UNIQUE INDEX IF NOT EXISTS journey_evidence_links_tenant_identity ON journey_evidence_links(id,space_id);
    CREATE UNIQUE INDEX IF NOT EXISTS journey_map_versions_tenant_identity
      ON journey_map_versions(id,definition_id,space_id);

    CREATE TABLE IF NOT EXISTS journey_persona_versions (
      id TEXT PRIMARY KEY,
      persona_id TEXT NOT NULL,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
      version_number INTEGER NOT NULL CHECK(version_number>0),
      name TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      lifecycle_state TEXT NOT NULL CHECK(lifecycle_state IN ('draft','in_review','active','retired')),
      owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      source TEXT NOT NULL CHECK(source IN ('workspace','legacy_audience_draft','ai_draft')),
      attributes_json TEXT NOT NULL DEFAULT '{}',
      goals_json TEXT NOT NULL DEFAULT '[]',
      behaviours_json TEXT NOT NULL DEFAULT '[]',
      needs_json TEXT NOT NULL DEFAULT '[]',
      barriers_json TEXT NOT NULL DEFAULT '[]',
      review_at TEXT,
      content_checksum TEXT NOT NULL CHECK(length(content_checksum)=64),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      UNIQUE(persona_id,version_number),
      UNIQUE(id,persona_id,space_id),
      FOREIGN KEY(persona_id,space_id) REFERENCES journey_personas(id,space_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS journey_persona_versions_persona
      ON journey_persona_versions(space_id,persona_id,version_number DESC);

    CREATE TABLE IF NOT EXISTS journey_persona_claims (
      id TEXT PRIMARY KEY,
      persona_version_id TEXT NOT NULL,
      persona_id TEXT NOT NULL,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
      claim_type TEXT NOT NULL CHECK(claim_type IN ('summary','attribute','goal','behaviour','need','barrier')),
      label TEXT NOT NULL DEFAULT '',
      value TEXT NOT NULL,
      ordinal INTEGER NOT NULL CHECK(ordinal>=0),
      claim_checksum TEXT NOT NULL CHECK(length(claim_checksum)=64),
      created_at TEXT NOT NULL,
      UNIQUE(persona_version_id,claim_type,ordinal),
      UNIQUE(id,persona_version_id,persona_id,space_id),
      FOREIGN KEY(persona_version_id,persona_id,space_id)
        REFERENCES journey_persona_versions(id,persona_id,space_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS journey_persona_claims_version
      ON journey_persona_claims(persona_version_id,claim_type,ordinal,id);

    CREATE TABLE IF NOT EXISTS journey_persona_claim_evidence (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL,
      persona_version_id TEXT NOT NULL,
      persona_id TEXT NOT NULL,
      evidence_link_id TEXT NOT NULL,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
      assessment_at_link TEXT NOT NULL CHECK(assessment_at_link IN ('supports','contradicts','neutral')),
      evidence_snapshot_fingerprint TEXT NOT NULL CHECK(length(evidence_snapshot_fingerprint)=64),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      UNIQUE(claim_id,evidence_link_id),
      FOREIGN KEY(claim_id,persona_version_id,persona_id,space_id)
        REFERENCES journey_persona_claims(id,persona_version_id,persona_id,space_id) ON DELETE RESTRICT,
      FOREIGN KEY(evidence_link_id,space_id)
        REFERENCES journey_evidence_links(id,space_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS journey_persona_claim_evidence_claim
      ON journey_persona_claim_evidence(claim_id,evidence_link_id,id);

    CREATE TABLE IF NOT EXISTS journey_persona_review_events (
      id TEXT PRIMARY KEY,
      persona_version_id TEXT NOT NULL,
      persona_id TEXT NOT NULL,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
      sequence INTEGER NOT NULL CHECK(sequence>0),
      action TEXT NOT NULL CHECK(action IN ('submitted','approved','changes_requested','withdrawn')),
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      UNIQUE(persona_version_id,sequence),
      FOREIGN KEY(persona_version_id,persona_id,space_id)
        REFERENCES journey_persona_versions(id,persona_id,space_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS journey_persona_review_events_version
      ON journey_persona_review_events(persona_version_id,sequence DESC,id);

    CREATE TABLE IF NOT EXISTS journey_map_version_personas (
      version_id TEXT NOT NULL,
      definition_id TEXT NOT NULL,
      persona_id TEXT NOT NULL,
      persona_version_id TEXT NOT NULL,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
      ordinal INTEGER NOT NULL CHECK(ordinal>=0),
      review_state_at_pin TEXT NOT NULL CHECK(review_state_at_pin IN ('draft','in_review','changes_requested','approved')),
      content_checksum_at_pin TEXT NOT NULL CHECK(length(content_checksum_at_pin)=64),
      evidence_coverage_at_pin INTEGER NOT NULL DEFAULT 0 CHECK(evidence_coverage_at_pin>=0),
      pinned_at TEXT NOT NULL,
      PRIMARY KEY(version_id,persona_id),
      FOREIGN KEY(version_id,definition_id,space_id)
        REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(persona_version_id,persona_id,space_id)
        REFERENCES journey_persona_versions(id,persona_id,space_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS journey_map_version_personas_persona
      ON journey_map_version_personas(space_id,persona_id,version_id);

    CREATE TRIGGER IF NOT EXISTS journey_persona_versions_no_update
      BEFORE UPDATE ON journey_persona_versions BEGIN SELECT RAISE(ABORT,'persona versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_persona_versions_no_delete
      BEFORE DELETE ON journey_persona_versions BEGIN SELECT RAISE(ABORT,'persona versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_persona_claims_no_update
      BEFORE UPDATE ON journey_persona_claims BEGIN SELECT RAISE(ABORT,'persona claims are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_persona_claims_no_delete
      BEFORE DELETE ON journey_persona_claims BEGIN SELECT RAISE(ABORT,'persona claims are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_persona_claim_evidence_no_update
      BEFORE UPDATE ON journey_persona_claim_evidence BEGIN SELECT RAISE(ABORT,'persona claim evidence is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_persona_claim_evidence_no_delete
      BEFORE DELETE ON journey_persona_claim_evidence BEGIN SELECT RAISE(ABORT,'persona claim evidence is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_persona_review_events_no_update
      BEFORE UPDATE ON journey_persona_review_events BEGIN SELECT RAISE(ABORT,'persona review history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_persona_review_events_no_delete
      BEFORE DELETE ON journey_persona_review_events BEGIN SELECT RAISE(ABORT,'persona review history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_map_version_personas_no_update
      BEFORE UPDATE ON journey_map_version_personas BEGIN SELECT RAISE(ABORT,'published persona pins are immutable'); END;
  `);
}

function requirePersonaRow(spaceId: string, personaId: string, lock = false) {
  const suffix = lock && db.provider === 'postgres' ? ' FOR UPDATE' : '';
  const row = db.prepare(`SELECT * FROM journey_personas WHERE id=? AND space_id=?${suffix}`)
    .get(personaId, spaceId) as PersonaRow | undefined;
  if (!row) throw new JourneyPersonaVersionError('Persona not found.', 404, 'JOURNEY_PERSONA_NOT_FOUND');
  return row;
}

function insertPersonaVersion(
  row: PersonaRow,
  snapshot: PersonaSnapshot,
  versionNumber: number,
  actorUserId: string | null,
  id: string = crypto.randomUUID(),
  createdAt: string = nowIso()
) {
  const contentChecksum = checksum(snapshot);
  db.prepare(`INSERT INTO journey_persona_versions
    (id,persona_id,space_id,version_number,name,summary,lifecycle_state,owner_user_id,source,attributes_json,
      goals_json,behaviours_json,needs_json,barriers_json,review_at,content_checksum,created_by_user_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, row.id, row.space_id, versionNumber, snapshot.name, snapshot.summary, snapshot.lifecycleState,
      snapshot.ownerUserId, snapshot.source, JSON.stringify(snapshot.attributes), JSON.stringify(snapshot.goals),
      JSON.stringify(snapshot.behaviours), JSON.stringify(snapshot.needs), JSON.stringify(snapshot.barriers),
      snapshot.reviewAt, contentChecksum, actorUserId, createdAt
    );
  const insertClaim = db.prepare(`INSERT INTO journey_persona_claims
    (id,persona_version_id,persona_id,space_id,claim_type,label,value,ordinal,claim_checksum,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  for (const claim of claimsForSnapshot(snapshot)) {
    const claimChecksum = checksum({ type: claim.type, label: claim.label, value: claim.value, ordinal: claim.ordinal });
    insertClaim.run(deterministicId('pc', id, claim.type, claim.ordinal, claimChecksum), id, row.id, row.space_id,
      claim.type, claim.label, claim.value, claim.ordinal, claimChecksum, createdAt);
  }
  return { id, contentChecksum };
}

export function ensurePersonaVersionSeed(spaceId: string, personaId: string) {
  const row = requirePersonaRow(spaceId, personaId);
  if (row.current_version_id) {
    const exists = db.prepare(`SELECT 1 FROM journey_persona_versions
      WHERE id=? AND persona_id=? AND space_id=?`).get(row.current_version_id, personaId, spaceId);
    if (!exists) throw new JourneyPersonaVersionError('The persona points to a missing current version.', 409,
      'JOURNEY_PERSONA_CURRENT_VERSION_ORPHANED');
    return row.current_version_id;
  }
  return db.transaction(() => {
    const locked = requirePersonaRow(spaceId, personaId, true);
    if (locked.current_version_id) return locked.current_version_id;
    const id = deterministicId('pv', personaId, 1);
    insertPersonaVersion(locked, snapshotFromRow(locked), 1, locked.owner_user_id, id,
      String((db.prepare('SELECT created_at FROM journey_personas WHERE id=? AND space_id=?')
        .get(personaId, spaceId) as { created_at?: string } | undefined)?.created_at || nowIso()));
    const changed = db.prepare(`UPDATE journey_personas SET current_version_id=?
      WHERE id=? AND space_id=? AND current_version_id IS NULL`).run(id, personaId, spaceId).changes;
    if (changed !== 1) {
      const winner = requirePersonaRow(spaceId, personaId);
      if (winner.current_version_id) return winner.current_version_id;
      throw new JourneyPersonaVersionError('The initial persona version could not be recorded.', 409,
        'JOURNEY_PERSONA_VERSION_SEED_CONFLICT');
    }
    return id;
  })();
}

/** Create the other half of a new persona's cyclic root/version identity.
 * The caller must insert the root with this pre-allocated version ID and keep
 * both writes in one transaction. PostgreSQL validates the pointer at commit;
 * SQLite validates the non-null pointer and this exact insert in the domain. */
export function createInitialPersonaVersion(
  spaceId: string,
  personaId: string,
  personaVersionId: string,
  actorUserId: string | null
) {
  const row = requirePersonaRow(spaceId, personaId, true);
  if (row.current_version_id !== personaVersionId) throw new JourneyPersonaVersionError(
    'The initial persona version does not match its reserved current pointer.', 409,
    'JOURNEY_PERSONA_CURRENT_VERSION_MISMATCH');
  if (db.prepare(`SELECT 1 FROM journey_persona_versions WHERE id=? OR (persona_id=? AND version_number=1)`)
    .get(personaVersionId, personaId)) throw new JourneyPersonaVersionError(
      'The initial persona version already exists.', 409, 'JOURNEY_PERSONA_VERSION_EXISTS');
  insertPersonaVersion(row, snapshotFromRow(row), 1, actorUserId, personaVersionId,
    String((db.prepare('SELECT created_at FROM journey_personas WHERE id=? AND space_id=?')
      .get(personaId, spaceId) as { created_at?: string } | undefined)?.created_at || nowIso()));
  return personaVersionId;
}

function backfillPersonaVersions() {
  if (db.provider !== 'sqlite') return;
  const rows = db.prepare('SELECT id,space_id FROM journey_personas WHERE current_version_id IS NULL ORDER BY space_id,id')
    .all() as Array<{ id: string; space_id: string }>;
  for (const row of rows) ensurePersonaVersionSeed(row.space_id, row.id);
  // The pre-runtime schema treated persona links as definition-wide. Freeze
  // what historical published reads exposed at upgrade time so later edits can
  // no longer rewrite them.
  const published = db.prepare(`SELECT version.id version_id,version.definition_id,version.space_id
    FROM journey_map_versions version
    WHERE version.state IN ('published','superseded')
      AND NOT EXISTS (SELECT 1 FROM journey_map_version_personas pin WHERE pin.version_id=version.id)
    ORDER BY version.space_id,version.definition_id,version.version_number`).all() as Array<{
      version_id: string; definition_id: string; space_id: string;
    }>;
  for (const version of published) pinJourneyPersonaVersions(version.space_id, version.definition_id, version.version_id);
}

ensureSqliteSchema();
backfillPersonaVersions();
if (db.provider === 'sqlite') db.exec(`
  CREATE TRIGGER IF NOT EXISTS journey_personas_current_required_insert
    BEFORE INSERT ON journey_personas WHEN NEW.current_version_id IS NULL
    BEGIN SELECT RAISE(ABORT,'journey_personas.current_version_id is required'); END;
  CREATE TRIGGER IF NOT EXISTS journey_personas_current_required_update
    BEFORE UPDATE OF current_version_id ON journey_personas
    WHEN NEW.current_version_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM journey_persona_versions version
      WHERE version.id=NEW.current_version_id AND version.persona_id=NEW.id AND version.space_id=NEW.space_id
    )
    BEGIN SELECT RAISE(ABORT,'journey_personas.current_version_id must reference this persona'); END;
`);

function reviewEvents(spaceId: string, personaId: string, personaVersionId: string): PersonaReviewEvent[] {
  return (db.prepare(`SELECT * FROM journey_persona_review_events
    WHERE space_id=? AND persona_id=? AND persona_version_id=? ORDER BY sequence,id`)
    .all(spaceId, personaId, personaVersionId) as any[]).map((row) => ({
      id: row.id,
      sequence: Number(row.sequence),
      action: row.action,
      actorUserId: row.actor_user_id || null,
      comment: row.comment || '',
      createdAt: row.created_at
    }));
}

function reviewStateFromEvents(events: PersonaReviewEvent[]): PersonaReviewState {
  const latest = events.at(-1)?.action;
  if (latest === 'submitted') return 'in_review';
  if (latest === 'approved') return 'approved';
  if (latest === 'changes_requested') return 'changes_requested';
  return 'draft';
}

export function personaVersionReviewState(spaceId: string, personaId: string, personaVersionId: string) {
  return reviewStateFromEvents(reviewEvents(spaceId, personaId, personaVersionId));
}

function claimEvidenceForRows(rows: any[]): PersonaClaimEvidence[] {
  return rows.map((row) => {
    const currentFingerprint = row.evidence_link_id && row.source_type ? evidenceFingerprint(row) : null;
    const state: PersonaClaimEvidence['state'] = !row.evidence_link_id ? 'deleted'
      : row.invalidated_at ? 'invalidated'
      : currentFingerprint !== row.evidence_snapshot_fingerprint ? 'changed' : 'current';
    return {
      id: row.id,
      evidenceLinkId: row.original_evidence_link_id || row.evidence_link_id,
      assessmentAtLink: row.assessment_at_link,
      pinnedFingerprint: row.evidence_snapshot_fingerprint,
      currentFingerprint,
      state,
      createdByUserId: row.created_by_user_id || null,
      createdAt: row.created_at
    };
  });
}

export function getPersonaVersion(spaceId: string, personaId: string, personaVersionId: string): PersonaVersion | null {
  const row = db.prepare(`SELECT * FROM journey_persona_versions
    WHERE id=? AND persona_id=? AND space_id=?`).get(personaVersionId, personaId, spaceId) as any;
  if (!row) return null;
  const events = reviewEvents(spaceId, personaId, personaVersionId);
  const claimRows = db.prepare(`SELECT * FROM journey_persona_claims
    WHERE persona_version_id=? AND persona_id=? AND space_id=? ORDER BY claim_type,ordinal,id`)
    .all(personaVersionId, personaId, spaceId) as any[];
  const allEvidence = claimRows.length ? db.prepare(`SELECT
      pinned.id,
      pinned.claim_id,
      pinned.evidence_link_id,
      pinned.assessment_at_link,
      pinned.evidence_snapshot_fingerprint,
      pinned.created_by_user_id,
      pinned.created_at,
      link.id original_evidence_link_id,
      link.source_type,
      link.source_ref,
      link.source_label,
      link.excerpt,
      link.population,
      link.sample_size,
      link.collected_at,
      link.window_start,
      link.window_end,
      link.source_updated_at,
      link.invalidated_at
    FROM journey_persona_claim_evidence pinned
    LEFT JOIN journey_evidence_links link ON link.id=pinned.evidence_link_id AND link.space_id=pinned.space_id
    WHERE pinned.persona_version_id=? AND pinned.persona_id=? AND pinned.space_id=?
    ORDER BY pinned.claim_id,pinned.created_at,pinned.id`).all(personaVersionId, personaId, spaceId) as any[] : [];
  const evidenceByClaim = new Map<string, any[]>();
  for (const evidence of allEvidence) {
    const list = evidenceByClaim.get(String(evidence.claim_id)) || [];
    list.push(evidence);
    evidenceByClaim.set(String(evidence.claim_id), list);
  }
  const claims = claimRows.map((claim): PersonaClaim => ({
    id: claim.id,
    personaVersionId,
    type: claim.claim_type,
    label: claim.label,
    value: claim.value,
    ordinal: Number(claim.ordinal),
    checksum: claim.claim_checksum,
    evidence: claimEvidenceForRows(evidenceByClaim.get(String(claim.id)) || [])
  }));
  const evidence = claims.flatMap((claim) => claim.evidence);
  return {
    id: row.id,
    personaId: row.persona_id,
    spaceId: row.space_id,
    versionNumber: Number(row.version_number),
    name: row.name,
    summary: row.summary,
    lifecycleState: row.lifecycle_state,
    ownerUserId: row.owner_user_id || null,
    source: row.source,
    attributes: parseJson(row.attributes_json, {} as Record<string, string>),
    goals: parseJson(row.goals_json, [] as string[]),
    behaviours: parseJson(row.behaviours_json, [] as string[]),
    needs: parseJson(row.needs_json, [] as string[]),
    barriers: parseJson(row.barriers_json, [] as string[]),
    reviewAt: row.review_at || null,
    checksum: row.content_checksum,
    createdByUserId: row.created_by_user_id || null,
    createdAt: row.created_at,
    reviewState: reviewStateFromEvents(events),
    claims,
    reviewEvents: events,
    evidenceCoverage: {
      claimCount: claims.length,
      evidencedClaimCount: claims.filter((claim) => claim.evidence.length > 0).length,
      currentSupportingLinks: evidence.filter((item) => item.state === 'current' && item.assessmentAtLink === 'supports').length,
      changedLinks: evidence.filter((item) => item.state === 'changed').length,
      invalidatedLinks: evidence.filter((item) => ['invalidated', 'deleted'].includes(item.state)).length
    }
  };
}

export function listPersonaVersions(spaceId: string, personaId: string) {
  requirePersonaRow(spaceId, personaId);
  return (db.prepare(`SELECT id FROM journey_persona_versions WHERE persona_id=? AND space_id=?
    ORDER BY version_number DESC,id DESC`).all(personaId, spaceId) as Array<{ id: string }>)
    .map((row) => getPersonaVersion(spaceId, personaId, row.id)!);
}

export function createPersonaWorkingVersion(input: {
  spaceId: string;
  personaId: string;
  expectedRevision: number;
  actorUserId: string | null;
  snapshot: PersonaSnapshot;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyPersonas');
  return db.transaction(() => {
    const row = requirePersonaRow(input.spaceId, input.personaId, true);
    if (Number(row.revision) !== input.expectedRevision) {
      throw new JourneyPersonaVersionError('This persona changed since it was opened. Refresh it before saving.', 409,
        'JOURNEY_PERSONA_REVISION_CONFLICT', { currentRevision: Number(row.revision) });
    }
    const currentVersionId = row.current_version_id || ensurePersonaVersionSeed(input.spaceId, input.personaId);
    const currentState = personaVersionReviewState(input.spaceId, input.personaId, currentVersionId);
    if (currentState === 'in_review') {
      throw new JourneyPersonaVersionError('Withdraw the current review or request changes before editing this persona.',
        409, 'JOURNEY_PERSONA_REVIEW_LOCKED', { currentVersionId });
    }
    const nextNumber = Number((db.prepare(`SELECT MAX(version_number) top FROM journey_persona_versions
      WHERE persona_id=? AND space_id=?`).get(input.personaId, input.spaceId) as any)?.top || 0) + 1;
    const lifecycleState: PersonaSnapshot['lifecycleState'] = input.snapshot.lifecycleState === 'retired' ? 'retired' : 'draft';
    const snapshot = { ...input.snapshot, lifecycleState };
    const next = insertPersonaVersion(row, snapshot, nextNumber, input.actorUserId);
    const changed = db.prepare(`UPDATE journey_personas SET name=?,summary=?,lifecycle_state=?,attributes_json=?,
      goals_json=?,behaviours_json=?,needs_json=?,barriers_json=?,review_at=?,current_version_id=?,
      revision=revision+1,updated_at=? WHERE id=? AND space_id=? AND revision=?`).run(
        snapshot.name, snapshot.summary, snapshot.lifecycleState, JSON.stringify(snapshot.attributes),
        JSON.stringify(snapshot.goals), JSON.stringify(snapshot.behaviours), JSON.stringify(snapshot.needs),
        JSON.stringify(snapshot.barriers), snapshot.reviewAt, next.id, nowIso(), input.personaId, input.spaceId,
        input.expectedRevision
      ).changes;
    if (changed !== 1) throw new JourneyPersonaVersionError('This persona changed while it was being saved.', 409,
      'JOURNEY_PERSONA_REVISION_CONFLICT');
    return getPersonaVersion(input.spaceId, input.personaId, next.id)!;
  })();
}

function requireCurrentPersonaVersion(spaceId: string, personaId: string, personaVersionId: string, expectedRevision: number) {
  const row = requirePersonaRow(spaceId, personaId, true);
  if (Number(row.revision) !== expectedRevision) {
    throw new JourneyPersonaVersionError('This persona changed since it was opened. Refresh it before continuing.', 409,
      'JOURNEY_PERSONA_REVISION_CONFLICT', { currentRevision: Number(row.revision) });
  }
  const currentVersionId = row.current_version_id || ensurePersonaVersionSeed(spaceId, personaId);
  if (currentVersionId !== personaVersionId) {
    throw new JourneyPersonaVersionError('Only the current working persona version can be changed or reviewed.', 409,
      'JOURNEY_PERSONA_VERSION_NOT_CURRENT', { currentVersionId });
  }
  const version = getPersonaVersion(spaceId, personaId, personaVersionId);
  if (!version) throw new JourneyPersonaVersionError('Persona version not found.', 404, 'JOURNEY_PERSONA_VERSION_NOT_FOUND');
  return { row, version };
}

export function linkPersonaClaimEvidence(input: {
  spaceId: string;
  personaId: string;
  personaVersionId: string;
  claimId: string;
  evidenceLinkId: string;
  expectedRevision: number;
  actorUserId: string | null;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyPersonas');
  assertSubscriptionFeature(input.spaceId, 'journeyEvidence');
  return db.transaction(() => {
    const { version } = requireCurrentPersonaVersion(input.spaceId, input.personaId, input.personaVersionId,
      input.expectedRevision);
    if (!['draft', 'changes_requested'].includes(version.reviewState)) {
      throw new JourneyPersonaVersionError('Evidence can only be added before a persona version is submitted.', 409,
        'JOURNEY_PERSONA_REVIEW_LOCKED');
    }
    const claim = db.prepare(`SELECT id FROM journey_persona_claims
      WHERE id=? AND persona_version_id=? AND persona_id=? AND space_id=?`)
      .get(input.claimId, input.personaVersionId, input.personaId, input.spaceId);
    if (!claim) throw new JourneyPersonaVersionError('Persona claim not found.', 404, 'JOURNEY_PERSONA_CLAIM_NOT_FOUND');
    const evidence = db.prepare(`SELECT * FROM journey_evidence_links
      WHERE id=? AND space_id=? AND target_type='persona' AND target_id=?`)
      .get(input.evidenceLinkId, input.spaceId, input.personaId) as any;
    if (!evidence) throw new JourneyPersonaVersionError(
      'Evidence must be attached to this persona before it can support a claim.', 404,
      'JOURNEY_PERSONA_EVIDENCE_NOT_FOUND');
    if (evidence.invalidated_at) throw new JourneyPersonaVersionError('Invalidated evidence cannot support a persona claim.', 409,
      'JOURNEY_PERSONA_EVIDENCE_INVALIDATED');
    const fingerprint = evidenceFingerprint(evidence);
    const id = deterministicId('pce', input.claimId, input.evidenceLinkId, fingerprint);
    try {
      db.prepare(`INSERT INTO journey_persona_claim_evidence
        (id,claim_id,persona_version_id,persona_id,evidence_link_id,space_id,assessment_at_link,
          evidence_snapshot_fingerprint,created_by_user_id,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, input.claimId, input.personaVersionId, input.personaId,
          input.evidenceLinkId, input.spaceId, evidence.assessment, fingerprint, input.actorUserId, nowIso());
    } catch (error) {
      const existing = db.prepare(`SELECT id FROM journey_persona_claim_evidence
        WHERE claim_id=? AND evidence_link_id=?`).get(input.claimId, input.evidenceLinkId);
      if (!existing) throw error;
    }
    const changed = db.prepare(`UPDATE journey_personas SET revision=revision+1,updated_at=?
      WHERE id=? AND space_id=? AND revision=?`).run(nowIso(), input.personaId, input.spaceId, input.expectedRevision).changes;
    if (changed !== 1) throw new JourneyPersonaVersionError('This persona changed while evidence was attached.', 409,
      'JOURNEY_PERSONA_REVISION_CONFLICT');
    return getPersonaVersion(input.spaceId, input.personaId, input.personaVersionId)!;
  })();
}

function nextReviewSequence(spaceId: string, personaId: string, personaVersionId: string) {
  return Number((db.prepare(`SELECT MAX(sequence) top FROM journey_persona_review_events
    WHERE space_id=? AND persona_id=? AND persona_version_id=?`).get(spaceId, personaId, personaVersionId) as any)?.top || 0) + 1;
}

function appendReviewEvent(input: {
  spaceId: string; personaId: string; personaVersionId: string; action: PersonaReviewAction;
  actorUserId: string | null; comment: string;
}) {
  const sequence = nextReviewSequence(input.spaceId, input.personaId, input.personaVersionId);
  db.prepare(`INSERT INTO journey_persona_review_events
    (id,persona_version_id,persona_id,space_id,sequence,action,actor_user_id,comment,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), input.personaVersionId, input.personaId, input.spaceId,
      sequence, input.action, input.actorUserId, input.comment, nowIso());
}

function assertReviewEvidence(version: PersonaVersion) {
  if (version.claims.length === 0) {
    throw new JourneyPersonaVersionError('Add at least one explicit persona claim before review.', 422,
      'JOURNEY_PERSONA_CLAIM_REQUIRED');
  }
  if (version.evidenceCoverage.currentSupportingLinks === 0) {
    throw new JourneyPersonaVersionError('At least one current supporting evidence link is required before review.', 422,
      'JOURNEY_PERSONA_SUPPORTING_EVIDENCE_REQUIRED', version.evidenceCoverage);
  }
  if (version.evidenceCoverage.changedLinks || version.evidenceCoverage.invalidatedLinks) {
    throw new JourneyPersonaVersionError('Refresh changed or invalidated persona evidence in a new version before review.', 409,
      'JOURNEY_PERSONA_EVIDENCE_STALE', version.evidenceCoverage);
  }
}

export function submitPersonaVersion(input: {
  spaceId: string; personaId: string; personaVersionId: string; expectedRevision: number;
  actorUserId: string | null; comment: string;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyPersonas');
  return db.transaction(() => {
    const { version } = requireCurrentPersonaVersion(input.spaceId, input.personaId, input.personaVersionId,
      input.expectedRevision);
    if (!['draft', 'changes_requested'].includes(version.reviewState)) {
      throw new JourneyPersonaVersionError('This persona version is already in review or approved.', 409,
        'JOURNEY_PERSONA_REVIEW_STATE_CONFLICT', { reviewState: version.reviewState });
    }
    assertReviewEvidence(version);
    appendReviewEvent({ ...input, action: 'submitted' });
    const changed = db.prepare(`UPDATE journey_personas SET lifecycle_state='in_review',revision=revision+1,updated_at=?
      WHERE id=? AND space_id=? AND revision=?`).run(nowIso(), input.personaId, input.spaceId, input.expectedRevision).changes;
    if (changed !== 1) throw new JourneyPersonaVersionError('This persona changed while review was submitted.', 409,
      'JOURNEY_PERSONA_REVISION_CONFLICT');
    return getPersonaVersion(input.spaceId, input.personaId, input.personaVersionId)!;
  })();
}

export function decidePersonaVersion(input: {
  spaceId: string; personaId: string; personaVersionId: string; expectedRevision: number;
  actorUserId: string | null; decision: 'approved' | 'changes_requested'; comment: string;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyPersonas');
  return db.transaction(() => {
    const { version } = requireCurrentPersonaVersion(input.spaceId, input.personaId, input.personaVersionId,
      input.expectedRevision);
    if (version.reviewState !== 'in_review') {
      throw new JourneyPersonaVersionError('Only a submitted persona version can be reviewed.', 409,
        'JOURNEY_PERSONA_REVIEW_STATE_CONFLICT', { reviewState: version.reviewState });
    }
    if (input.decision === 'approved' && (!input.actorUserId || input.actorUserId === version.createdByUserId)) {
      throw new JourneyPersonaVersionError(
        'Persona approval requires a different space owner or administrator from the version author.',
        409,
        'JOURNEY_PERSONA_TWO_PERSON_APPROVAL_REQUIRED',
        { versionAuthorUserId: version.createdByUserId }
      );
    }
    if (input.decision === 'approved') assertReviewEvidence(version);
    appendReviewEvent({ ...input, action: input.decision });
    const changed = input.decision === 'approved'
      ? db.prepare(`UPDATE journey_personas SET lifecycle_state='active',approved_version_id=?,revision=revision+1,updated_at=?
          WHERE id=? AND space_id=? AND revision=?`).run(input.personaVersionId, nowIso(), input.personaId,
            input.spaceId, input.expectedRevision).changes
      : db.prepare(`UPDATE journey_personas SET lifecycle_state='draft',revision=revision+1,updated_at=?
          WHERE id=? AND space_id=? AND revision=?`).run(nowIso(), input.personaId, input.spaceId,
            input.expectedRevision).changes;
    if (changed !== 1) throw new JourneyPersonaVersionError('This persona changed while the review was recorded.', 409,
      'JOURNEY_PERSONA_REVISION_CONFLICT');
    return getPersonaVersion(input.spaceId, input.personaId, input.personaVersionId)!;
  })();
}

export function withdrawPersonaReview(input: {
  spaceId: string; personaId: string; personaVersionId: string; expectedRevision: number;
  actorUserId: string | null; comment: string;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyPersonas');
  return db.transaction(() => {
    const { version } = requireCurrentPersonaVersion(input.spaceId, input.personaId, input.personaVersionId,
      input.expectedRevision);
    if (version.reviewState !== 'in_review') throw new JourneyPersonaVersionError(
      'Only an in-review persona can be withdrawn.', 409, 'JOURNEY_PERSONA_REVIEW_STATE_CONFLICT');
    appendReviewEvent({ ...input, action: 'withdrawn' });
    const changed = db.prepare(`UPDATE journey_personas SET lifecycle_state='draft',revision=revision+1,updated_at=?
      WHERE id=? AND space_id=? AND revision=?`).run(nowIso(), input.personaId, input.spaceId, input.expectedRevision).changes;
    if (changed !== 1) throw new JourneyPersonaVersionError('This persona changed while the review was withdrawn.', 409,
      'JOURNEY_PERSONA_REVISION_CONFLICT');
    return getPersonaVersion(input.spaceId, input.personaId, input.personaVersionId)!;
  })();
}

export function pinJourneyPersonaVersions(spaceId: string, definitionId: string, versionId: string) {
  const version = db.prepare(`SELECT id FROM journey_map_versions WHERE id=? AND definition_id=? AND space_id=?`)
    .get(versionId, definitionId, spaceId);
  if (!version) throw new JourneyPersonaVersionError('Journey map version not found for persona pinning.', 404,
    'JOURNEY_MAP_VERSION_NOT_FOUND');
  const links = db.prepare(`SELECT link.persona_id,link.ordinal,persona.current_version_id
    FROM journey_definition_personas link
    JOIN journey_personas persona ON persona.id=link.persona_id AND persona.space_id=link.space_id
    WHERE link.definition_id=? AND link.space_id=? ORDER BY link.ordinal,link.persona_id`)
    .all(definitionId, spaceId) as Array<{ persona_id: string; ordinal: number; current_version_id: string | null }>;
  const insert = db.prepare(`INSERT INTO journey_map_version_personas
    (version_id,definition_id,persona_id,persona_version_id,space_id,ordinal,review_state_at_pin,
      content_checksum_at_pin,evidence_coverage_at_pin,pinned_at)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(version_id,persona_id) DO NOTHING`);
  for (const link of links) {
    const personaVersionId = link.current_version_id || ensurePersonaVersionSeed(spaceId, link.persona_id);
    const personaVersion = getPersonaVersion(spaceId, link.persona_id, personaVersionId);
    if (!personaVersion) throw new JourneyPersonaVersionError('A linked persona has no durable current version.', 409,
      'JOURNEY_PERSONA_VERSION_MISSING', { personaId: link.persona_id });
    insert.run(versionId, definitionId, link.persona_id, personaVersionId, spaceId, Number(link.ordinal),
      personaVersion.reviewState, personaVersion.checksum, personaVersion.evidenceCoverage.evidencedClaimCount, nowIso());
  }
  return links.length;
}

export function personaRowsForJourneyVersion(spaceId: string, definitionId: string, versionId: string) {
  const pinned = db.prepare(`SELECT persona.id,version.name,version.summary,version.lifecycle_state,version.owner_user_id,
      version.source,version.attributes_json,version.goals_json,version.behaviours_json,version.needs_json,
      version.barriers_json,version.review_at,persona.revision,persona.created_at,persona.updated_at,
      pin.persona_version_id,pin.review_state_at_pin persona_review_state,version.version_number persona_version_number,
      1 persona_version_pinned
    FROM journey_map_version_personas pin
    JOIN journey_persona_versions version ON version.id=pin.persona_version_id
      AND version.persona_id=pin.persona_id AND version.space_id=pin.space_id
    JOIN journey_personas persona ON persona.id=pin.persona_id AND persona.space_id=pin.space_id
    WHERE pin.version_id=? AND pin.definition_id=? AND pin.space_id=?
    ORDER BY pin.ordinal,version.name`).all(versionId, definitionId, spaceId) as any[];
  if (pinned.length) return pinned;
  return db.prepare(`SELECT persona.*,persona.current_version_id persona_version_id,
      current.version_number persona_version_number,
      CASE latest.action WHEN 'submitted' THEN 'in_review' WHEN 'approved' THEN 'approved'
        WHEN 'changes_requested' THEN 'changes_requested' ELSE 'draft' END persona_review_state,
      0 persona_version_pinned
    FROM journey_personas persona
    JOIN journey_definition_personas link ON link.persona_id=persona.id AND link.space_id=persona.space_id
    LEFT JOIN journey_persona_versions current ON current.id=persona.current_version_id
      AND current.persona_id=persona.id AND current.space_id=persona.space_id
    LEFT JOIN journey_persona_review_events latest ON latest.persona_version_id=current.id
      AND latest.sequence=(SELECT MAX(event.sequence) FROM journey_persona_review_events event
        WHERE event.persona_version_id=current.id AND event.persona_id=persona.id AND event.space_id=persona.space_id)
    WHERE link.definition_id=? AND link.space_id=? ORDER BY link.ordinal,persona.name`)
    .all(definitionId, spaceId) as any[];
}

export function assertPersonaCanBeLinked(spaceId: string, definitionId: string, personaId: string) {
  const row = requirePersonaRow(spaceId, personaId);
  if (row.lifecycle_state === 'retired') throw new JourneyPersonaVersionError(
    'Retired personas cannot be linked to another journey.', 409, 'JOURNEY_PERSONA_RETIRED');
  const definition = db.prepare('SELECT id FROM journey_definitions WHERE id=? AND space_id=?')
    .get(definitionId, spaceId);
  if (!definition) throw new JourneyPersonaVersionError('Journey map not found.', 404, 'JOURNEY_MAP_NOT_FOUND');
  return row;
}

export function assertPersonaLinkedToJourney(spaceId: string, definitionId: string, personaId: string) {
  const link = db.prepare(`SELECT 1 FROM journey_definition_personas
    WHERE definition_id=? AND persona_id=? AND space_id=?`).get(definitionId, personaId, spaceId);
  if (!link) throw new JourneyPersonaVersionError(
    'Link the persona to this journey before assigning persona-specific content.', 422,
    'JOURNEY_PERSONA_NOT_LINKED', { personaId, definitionId });
  const row = requirePersonaRow(spaceId, personaId);
  if (row.lifecycle_state === 'retired') throw new JourneyPersonaVersionError(
    'Retired personas cannot receive new journey content.', 409, 'JOURNEY_PERSONA_RETIRED');
}

export function assertPersonaDeletionAllowed(spaceId: string, personaId: string) {
  const row = requirePersonaRow(spaceId, personaId);
  const linkedJourneyCount = Number((db.prepare(`SELECT COUNT(*) count FROM journey_definition_personas
    WHERE persona_id=? AND space_id=?`).get(personaId, spaceId) as any)?.count || 0);
  const pinnedVersionCount = Number((db.prepare(`SELECT COUNT(*) count FROM journey_map_version_personas
    WHERE persona_id=? AND space_id=?`).get(personaId, spaceId) as any)?.count || 0);
  const evidenceCount = Number((db.prepare(`SELECT COUNT(*) count FROM journey_evidence_links
    WHERE target_type='persona' AND target_id=? AND space_id=?`).get(personaId, spaceId) as any)?.count || 0);
  throw new JourneyPersonaVersionError(
    'Versioned personas are retained for audit. Retire the persona instead of deleting it.', 409,
    'JOURNEY_PERSONA_RETIRE_REQUIRED', {
      lifecycleState: row.lifecycle_state, linkedJourneyCount, pinnedVersionCount, evidenceCount
    }
  );
}

export function personaUsage(spaceId: string, personaId: string) {
  requirePersonaRow(spaceId, personaId);
  const working = db.prepare(`SELECT definition.id,definition.name,link.ordinal
    FROM journey_definition_personas link
    JOIN journey_definitions definition ON definition.id=link.definition_id AND definition.space_id=link.space_id
    WHERE link.persona_id=? AND link.space_id=? ORDER BY definition.name,definition.id`)
    .all(personaId, spaceId) as any[];
  const published = db.prepare(`SELECT pin.definition_id,definition.name,pin.version_id,version.version_number,
      pin.persona_version_id,pin.review_state_at_pin,pin.pinned_at
    FROM journey_map_version_personas pin
    JOIN journey_definitions definition ON definition.id=pin.definition_id AND definition.space_id=pin.space_id
    JOIN journey_map_versions version ON version.id=pin.version_id AND version.space_id=pin.space_id
    WHERE pin.persona_id=? AND pin.space_id=? ORDER BY pin.pinned_at DESC,pin.version_id`)
    .all(personaId, spaceId) as any[];
  return {
    workingJourneys: working.map((row) => ({ definitionId: row.id, name: row.name, ordinal: Number(row.ordinal) })),
    publishedSnapshots: published.map((row) => ({
      definitionId: row.definition_id, name: row.name, mapVersionId: row.version_id,
      mapVersionNumber: Number(row.version_number), personaVersionId: row.persona_version_id,
      reviewState: row.review_state_at_pin, pinnedAt: row.pinned_at
    }))
  };
}

export function compareJourneyPersonas(input: {
  spaceId: string; definitionId: string; versionId: string; personaIds: string[];
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyPersonas');
  const personaIds = [...new Set(input.personaIds)];
  if (personaIds.length < 1 || personaIds.length > 2) throw new JourneyPersonaVersionError(
    'Choose one or two distinct personas.', 400, 'JOURNEY_PERSONA_COMPARE_SELECTION_INVALID');
  const version = db.prepare(`SELECT id FROM journey_map_versions
    WHERE id=? AND definition_id=? AND space_id=?`).get(input.versionId, input.definitionId, input.spaceId);
  if (!version) throw new JourneyPersonaVersionError('Journey map version not found.', 404, 'JOURNEY_MAP_VERSION_NOT_FOUND');
  const available = personaRowsForJourneyVersion(input.spaceId, input.definitionId, input.versionId);
  const availableIds = new Set(available.map((row) => String(row.id)));
  const missing = personaIds.filter((id) => !availableIds.has(id));
  if (missing.length) throw new JourneyPersonaVersionError('Every compared persona must belong to the selected map version.',
    422, 'JOURNEY_PERSONA_COMPARE_NOT_LINKED', { personaIds: missing });
  const placeholders = personaIds.map(() => '?').join(',');
  const cards = db.prepare(`SELECT id,stage_key,lane_type,kind,title,content,ordinal,persona_id,status
    FROM journey_map_cards WHERE version_id=? AND space_id=?
      AND (persona_id IS NULL OR persona_id IN (${placeholders}))
    ORDER BY stage_key,lane_type,ordinal,id`).all(input.versionId, input.spaceId, ...personaIds) as any[];
  return {
    definitionId: input.definitionId,
    versionId: input.versionId,
    personas: available.filter((row) => personaIds.includes(String(row.id))).map((row) => ({
      id: row.id, name: row.name, versionId: row.persona_version_id || null,
      versionNumber: row.persona_version_number === null ? null : Number(row.persona_version_number),
      reviewState: row.persona_review_state, pinned: Number(row.persona_version_pinned) === 1
    })),
    sharedCards: cards.filter((card) => !card.persona_id).map(compareCard),
    layers: personaIds.map((personaId) => ({
      personaId,
      cards: cards.filter((card) => !card.persona_id || card.persona_id === personaId).map(compareCard)
    }))
  };
}

function compareCard(row: any) {
  return {
    id: row.id, stageKey: row.stage_key, laneType: row.lane_type, kind: row.kind,
    title: row.title, content: row.content, ordinal: Number(row.ordinal),
    personaId: row.persona_id || null, status: row.status
  };
}

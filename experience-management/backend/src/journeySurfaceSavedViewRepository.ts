import crypto from 'node:crypto';
import { z } from 'zod';
import { db } from './database.js';

/**
 * Runtime-55 saved views for the hierarchy and service-blueprint surfaces.
 *
 * The durable contract lives in
 * `migrations/postgres/future/0055_journey_surface_saved_views.sql`; this module
 * is the only writer and mirrors that schema for SQLite so development and test
 * runs enforce the same shape. Two rules shape everything below:
 *
 *   Configuration is append-only. A revise never rewrites a row another reader,
 *   export or pinned default already observed; it appends a version under an
 *   optimistic definition revision, and the database refuses a stale one.
 *
 *   Failures are enumeration-safe. A view in another tenant, a view that does
 *   not exist and an owner-private view belonging to somebody else all fail the
 *   same way, so no caller can probe for the existence of a view it may not see.
 */

export const JOURNEY_SURFACE_VIEW_SCHEMA_VERSION = 'journey-surface-view/v1' as const;
export const JOURNEY_SURFACE_VIEW_RUNTIME_SCHEMA_VERSION = 55 as const;

export const journeySurfaceViewSurfaces = ['hierarchy', 'service_blueprint'] as const;
export const journeySurfaceViewAudiences = ['internal', 'executive', 'research', 'delivery', 'external'] as const;
export const journeySurfaceViewLifecycles = ['active', 'retired'] as const;
export const journeySurfaceViewDirections = ['descendants', 'ancestors', 'both'] as const;
export const journeySurfaceViewLinkTypes = [
  'parent_child', 'stage_subjourney', 'variant', 'handoff', 'related'] as const;
export const journeySurfaceViewReviewStates = [
  'draft', 'in_review', 'approved', 'changes_requested'] as const;
export const journeySurfaceViewHierarchyLifecycles = ['active', 'retired', 'all'] as const;
export const journeySurfaceViewVersionModes = ['current', 'pinned'] as const;
export const journeySurfaceViewBlueprintTabs = [
  'overview', 'lanes', 'relationships', 'gaps', 'portfolio', 'measurements'] as const;
export const journeySurfaceViewBlueprintLifecycles = [
  'draft', 'in_review', 'approved', 'retired', 'all'] as const;
export const journeySurfaceViewAuditActions = [
  'view.created', 'view.revised', 'view.retired', 'view.reactivated',
  'default.selected', 'default.reset'] as const;

export const journeySurfaceViewLimits = Object.freeze({
  nameCharacters: 160,
  configurationBytes: 8_192,
  viewsPerSurface: 200
});

export type JourneySurfaceViewSurface = typeof journeySurfaceViewSurfaces[number];
export type JourneySurfaceViewAudience = typeof journeySurfaceViewAudiences[number];
export type JourneySurfaceViewLifecycle = typeof journeySurfaceViewLifecycles[number];
export type JourneySurfaceViewAuditAction = typeof journeySurfaceViewAuditActions[number];

export class JourneySurfaceSavedViewError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = 'JOURNEY_SURFACE_VIEW_INVALID',
    public details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'JourneySurfaceSavedViewError';
  }
}

const boundedId = z.string().trim().min(1).max(128);

/**
 * The closed configuration surface. Every leaf is an enumerated value, a bounded
 * identifier or a boolean, and every object is `.strict()`, so a saved view can
 * never carry a SQL fragment, a query string or a filter expression for the
 * service to interpret. The migration restates the same key allowlist as a CHECK
 * on the stored document, so a writer that bypassed this module could not widen
 * it either.
 */
const hierarchyConfigurationSchema = z.object({
  rootDefinitionId: boundedId.nullable().default(null),
  direction: z.enum(journeySurfaceViewDirections).default('both'),
  linkType: z.enum(journeySurfaceViewLinkTypes).nullable().default(null),
  taxonomyTermId: boundedId.nullable().default(null),
  reviewState: z.enum(journeySurfaceViewReviewStates).nullable().default(null),
  lifecycle: z.enum(journeySurfaceViewHierarchyLifecycles).default('active')
}).strict();
const blueprintConfigurationSchema = z.object({
  blueprintId: boundedId,
  versionMode: z.enum(journeySurfaceViewVersionModes).default('current'),
  versionId: boundedId.nullable().default(null),
  tab: z.enum(journeySurfaceViewBlueprintTabs).default('overview'),
  lifecycle: z.enum(journeySurfaceViewBlueprintLifecycles).default('all')
}).strict();
const presentationConfigurationSchema = z.object({
  density: z.enum(['comfortable', 'compact']).default('comfortable'),
  showRetired: z.boolean().default(false),
  showLegend: z.boolean().default(true)
}).strict();
export const journeySurfaceViewConfigurationSchema = z.object({
  schemaVersion: z.literal(JOURNEY_SURFACE_VIEW_SCHEMA_VERSION),
  surface: z.enum(journeySurfaceViewSurfaces),
  hierarchy: hierarchyConfigurationSchema.nullable().default(null),
  blueprint: blueprintConfigurationSchema.nullable().default(null),
  presentation: presentationConfigurationSchema.default({
    density: 'comfortable', showRetired: false, showLegend: true
  })
}).strict();

export type JourneySurfaceViewConfiguration = {
  schemaVersion: typeof JOURNEY_SURFACE_VIEW_SCHEMA_VERSION;
  surface: JourneySurfaceViewSurface;
  hierarchy: {
    rootDefinitionId: string | null;
    direction: typeof journeySurfaceViewDirections[number];
    linkType: typeof journeySurfaceViewLinkTypes[number] | null;
    taxonomyTermId: string | null;
    reviewState: typeof journeySurfaceViewReviewStates[number] | null;
    lifecycle: typeof journeySurfaceViewHierarchyLifecycles[number];
  } | null;
  blueprint: {
    blueprintId: string;
    versionMode: typeof journeySurfaceViewVersionModes[number];
    versionId: string | null;
    tab: typeof journeySurfaceViewBlueprintTabs[number];
    lifecycle: typeof journeySurfaceViewBlueprintLifecycles[number];
  } | null;
  presentation: { density: 'comfortable' | 'compact'; showRetired: boolean; showLegend: boolean };
};

export type JourneySurfaceSavedView = {
  id: string;
  spaceId: string;
  surface: JourneySurfaceViewSurface;
  audience: JourneySurfaceViewAudience;
  name: string;
  ownerUserId: string;
  ownerPrivate: boolean;
  lifecycle: JourneySurfaceViewLifecycle;
  revision: number;
  versionId: string;
  versionNumber: number;
  configuration: JourneySurfaceViewConfiguration;
  configurationSha256: string;
  createdAt: string;
  updatedAt: string;
  retiredAt: string | null;
};

export type JourneySurfaceViewDefault = {
  spaceId: string;
  userId: string;
  surface: JourneySurfaceViewSurface;
  viewId: string;
  viewVersionId: string;
  viewDefinitionRevision: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

function iso(value: Date | string) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new JourneySurfaceSavedViewError(
    'An invalid timestamp was supplied.', 400, 'JOURNEY_SURFACE_VIEW_TIME_INVALID');
  return parsed.toISOString();
}
function sha256(value: string) { return crypto.createHash('sha256').update(value).digest('hex'); }
function safeJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
}

/** Case-folded and whitespace-collapsed, so "Exec  View" and "exec view" cannot
 * both occupy one owner's surface. Stored alongside the display name and keyed
 * by journey_surface_view_definitions_name_once. */
function normalizedName(name: string) {
  return String(name || '').trim().replace(/\s+/gu, ' ').toLowerCase();
}

/** A missing view, a view in another tenant and somebody else's owner-private
 * view are one indistinguishable failure: any other answer is an existence
 * oracle that lets a caller enumerate what it may not read. */
function viewNotFound(viewId: string): never {
  throw new JourneySurfaceSavedViewError('Saved view not found.', 404,
    'JOURNEY_SURFACE_VIEW_NOT_FOUND', { viewId });
}

/**
 * Canonicalisation is explicit rather than a re-serialisation of the parsed
 * object: key order is then a property of THIS function, not of the validator's
 * internals, so the stored document, its SHA-256 and the integrity check on read
 * cannot drift apart when the schema is reordered.
 */
export function canonicalJourneySurfaceViewConfiguration(input: unknown) {
  let parsed: z.infer<typeof journeySurfaceViewConfigurationSchema>;
  try {
    parsed = journeySurfaceViewConfigurationSchema.parse(input);
  } catch (error) {
    throw new JourneySurfaceSavedViewError('The saved-view configuration is not valid.', 400,
      'JOURNEY_SURFACE_VIEW_CONFIG_INVALID',
      { issues: error instanceof z.ZodError ? error.issues.slice(0, 10) : [] });
  }
  if (parsed.surface === 'hierarchy' && (!parsed.hierarchy || parsed.blueprint)) {
    throw new JourneySurfaceSavedViewError(
      'A hierarchy saved view carries hierarchy configuration and no blueprint configuration.',
      400, 'JOURNEY_SURFACE_VIEW_CONFIG_SURFACE_MISMATCH');
  }
  if (parsed.surface === 'service_blueprint' && (!parsed.blueprint || parsed.hierarchy)) {
    throw new JourneySurfaceSavedViewError(
      'A service-blueprint saved view carries blueprint configuration and no hierarchy configuration.',
      400, 'JOURNEY_SURFACE_VIEW_CONFIG_SURFACE_MISMATCH');
  }
  if (parsed.hierarchy && parsed.hierarchy.direction !== 'both' && !parsed.hierarchy.rootDefinitionId) {
    throw new JourneySurfaceSavedViewError('A directed hierarchy view requires a root journey.', 400,
      'JOURNEY_SURFACE_VIEW_CONFIG_ROOT_REQUIRED');
  }
  if (parsed.blueprint && parsed.blueprint.versionMode === 'pinned' && !parsed.blueprint.versionId) {
    throw new JourneySurfaceSavedViewError('A pinned blueprint view requires a blueprint version.', 400,
      'JOURNEY_SURFACE_VIEW_CONFIG_PIN_REQUIRED');
  }
  if (parsed.blueprint && parsed.blueprint.versionMode === 'current' && parsed.blueprint.versionId) {
    throw new JourneySurfaceSavedViewError('A current-version blueprint view cannot pin a version.', 400,
      'JOURNEY_SURFACE_VIEW_CONFIG_PIN_REQUIRED');
  }
  const configuration: JourneySurfaceViewConfiguration = {
    schemaVersion: JOURNEY_SURFACE_VIEW_SCHEMA_VERSION,
    surface: parsed.surface,
    hierarchy: parsed.hierarchy ? {
      rootDefinitionId: parsed.hierarchy.rootDefinitionId,
      direction: parsed.hierarchy.direction,
      linkType: parsed.hierarchy.linkType,
      taxonomyTermId: parsed.hierarchy.taxonomyTermId,
      reviewState: parsed.hierarchy.reviewState,
      lifecycle: parsed.hierarchy.lifecycle
    } : null,
    blueprint: parsed.blueprint ? {
      blueprintId: parsed.blueprint.blueprintId,
      versionMode: parsed.blueprint.versionMode,
      versionId: parsed.blueprint.versionId,
      tab: parsed.blueprint.tab,
      lifecycle: parsed.blueprint.lifecycle
    } : null,
    presentation: {
      density: parsed.presentation.density,
      showRetired: parsed.presentation.showRetired,
      showLegend: parsed.presentation.showLegend
    }
  };
  const serialized = JSON.stringify(configuration);
  if (Buffer.byteLength(serialized, 'utf8') > journeySurfaceViewLimits.configurationBytes) {
    throw new JourneySurfaceSavedViewError('The saved-view configuration is too large.', 413,
      'JOURNEY_SURFACE_VIEW_CONFIG_TOO_LARGE');
  }
  return { configuration, serialized, checksum: sha256(serialized) };
}

/** PostgreSQL is migrated offline by runtime-55. SQLite creates the same shape,
 * including the guards, when this module is imported. */
function ensureSqliteSchema() {
  if (db.provider !== 'sqlite') return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS journey_surface_view_definitions (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      surface TEXT NOT NULL CHECK(surface IN ('hierarchy','service_blueprint')),
      audience TEXT NOT NULL CHECK(audience IN ('internal','executive','research','delivery','external')),
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
      normalized_name TEXT NOT NULL CHECK(
        length(normalized_name) BETWEEN 1 AND 160 AND normalized_name=lower(normalized_name)),
      owner_user_id TEXT NOT NULL,
      owner_private INTEGER NOT NULL DEFAULT 1 CHECK(owner_private IN (0,1)),
      lifecycle TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle IN ('active','retired')),
      current_version_id TEXT,
      current_version_number INTEGER NOT NULL DEFAULT 0 CHECK(current_version_number>=0),
      definition_revision INTEGER NOT NULL DEFAULT 1 CHECK(definition_revision>0),
      create_request_sha256 TEXT NOT NULL CHECK(length(create_request_sha256)=64),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, retired_at TEXT,
      UNIQUE(id,space_id), UNIQUE(id,space_id,surface),
      UNIQUE(space_id,owner_user_id,surface,normalized_name),
      UNIQUE(space_id,owner_user_id,create_request_sha256),
      FOREIGN KEY(space_id,owner_user_id)
        REFERENCES space_memberships(space_id,user_id) ON DELETE RESTRICT,
      FOREIGN KEY(current_version_id,id,space_id)
        REFERENCES journey_surface_view_versions(id,view_id,space_id) DEFERRABLE INITIALLY DEFERRED,
      CHECK((lifecycle='active' AND retired_at IS NULL)
        OR (lifecycle='retired' AND retired_at IS NOT NULL AND retired_at>=created_at)),
      CHECK((current_version_id IS NULL AND current_version_number=0)
        OR (current_version_id IS NOT NULL AND current_version_number>0)),
      CHECK(updated_at>=created_at)
    );
    CREATE INDEX IF NOT EXISTS journey_surface_view_definitions_surface
      ON journey_surface_view_definitions(space_id,surface,lifecycle,owner_private,updated_at DESC,id);
    CREATE INDEX IF NOT EXISTS journey_surface_view_definitions_owner
      ON journey_surface_view_definitions(space_id,owner_user_id,surface,lifecycle,updated_at DESC,id);
    CREATE TABLE IF NOT EXISTS journey_surface_view_versions (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      view_id TEXT NOT NULL, space_id TEXT NOT NULL,
      surface TEXT NOT NULL CHECK(surface IN ('hierarchy','service_blueprint')),
      version_number INTEGER NOT NULL CHECK(version_number>0),
      schema_version TEXT NOT NULL CHECK(schema_version='journey-surface-view/v1'),
      definition_revision INTEGER NOT NULL CHECK(definition_revision>0),
      configuration_json TEXT NOT NULL CHECK(
        length(CAST(configuration_json AS BLOB)) BETWEEN 2 AND 8192
        AND json_valid(configuration_json) AND json_type(configuration_json)='object'),
      configuration_sha256 TEXT NOT NULL CHECK(length(configuration_sha256)=64),
      request_sha256 TEXT NOT NULL CHECK(length(request_sha256)=64),
      hierarchy_root_definition_id TEXT,
      hierarchy_direction TEXT CHECK(hierarchy_direction IN ('descendants','ancestors','both')),
      hierarchy_link_type TEXT CHECK(hierarchy_link_type IN (
        'parent_child','stage_subjourney','variant','handoff','related')),
      hierarchy_taxonomy_term_id TEXT,
      hierarchy_review_state TEXT CHECK(hierarchy_review_state IN (
        'draft','in_review','approved','changes_requested')),
      hierarchy_lifecycle TEXT CHECK(hierarchy_lifecycle IN ('active','retired','all')),
      blueprint_id TEXT,
      blueprint_version_mode TEXT CHECK(blueprint_version_mode IN ('current','pinned')),
      blueprint_version_id TEXT,
      blueprint_tab TEXT CHECK(blueprint_tab IN (
        'overview','lanes','relationships','gaps','portfolio','measurements')),
      blueprint_lifecycle TEXT CHECK(blueprint_lifecycle IN (
        'draft','in_review','approved','retired','all')),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      UNIQUE(id,space_id), UNIQUE(id,view_id,space_id), UNIQUE(view_id,space_id,version_number),
      UNIQUE(view_id,space_id,request_sha256),
      FOREIGN KEY(view_id,space_id,surface)
        REFERENCES journey_surface_view_definitions(id,space_id,surface) ON DELETE CASCADE,
      CHECK((surface='hierarchy'
          AND hierarchy_direction IS NOT NULL AND hierarchy_lifecycle IS NOT NULL
          AND blueprint_id IS NULL AND blueprint_version_mode IS NULL AND blueprint_version_id IS NULL
          AND blueprint_tab IS NULL AND blueprint_lifecycle IS NULL)
        OR (surface='service_blueprint'
          AND blueprint_id IS NOT NULL AND blueprint_version_mode IS NOT NULL
          AND blueprint_tab IS NOT NULL AND blueprint_lifecycle IS NOT NULL
          AND hierarchy_root_definition_id IS NULL AND hierarchy_direction IS NULL
          AND hierarchy_link_type IS NULL AND hierarchy_taxonomy_term_id IS NULL
          AND hierarchy_review_state IS NULL AND hierarchy_lifecycle IS NULL)),
      CHECK(hierarchy_direction IS NULL OR hierarchy_direction='both'
        OR hierarchy_root_definition_id IS NOT NULL),
      CHECK((blueprint_version_mode IS NULL AND blueprint_version_id IS NULL)
        OR (blueprint_version_mode='current' AND blueprint_version_id IS NULL)
        OR (blueprint_version_mode='pinned' AND blueprint_version_id IS NOT NULL)),
      CHECK(json_extract(configuration_json,'$.schemaVersion')='journey-surface-view/v1'
        AND json_extract(configuration_json,'$.surface')=surface)
    );
    CREATE INDEX IF NOT EXISTS journey_surface_view_versions_history
      ON journey_surface_view_versions(space_id,view_id,version_number DESC,id);
    CREATE INDEX IF NOT EXISTS journey_surface_view_versions_hierarchy_target
      ON journey_surface_view_versions(space_id,hierarchy_root_definition_id,view_id)
      WHERE hierarchy_root_definition_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS journey_surface_view_versions_blueprint_target
      ON journey_surface_view_versions(space_id,blueprint_id,view_id)
      WHERE blueprint_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS journey_surface_view_defaults (
      space_id TEXT NOT NULL, user_id TEXT NOT NULL,
      surface TEXT NOT NULL CHECK(surface IN ('hierarchy','service_blueprint')),
      view_id TEXT NOT NULL, view_version_id TEXT NOT NULL,
      view_definition_revision INTEGER NOT NULL CHECK(view_definition_revision>0),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      request_sha256 TEXT NOT NULL CHECK(length(request_sha256)=64),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(space_id,user_id,surface),
      FOREIGN KEY(space_id,user_id) REFERENCES space_memberships(space_id,user_id) ON DELETE CASCADE,
      FOREIGN KEY(view_id,space_id,surface)
        REFERENCES journey_surface_view_definitions(id,space_id,surface) ON DELETE CASCADE,
      FOREIGN KEY(view_version_id,view_id,space_id)
        REFERENCES journey_surface_view_versions(id,view_id,space_id) ON DELETE CASCADE,
      CHECK(updated_at>=created_at)
    );
    CREATE INDEX IF NOT EXISTS journey_surface_view_defaults_view
      ON journey_surface_view_defaults(space_id,view_id,user_id);
    CREATE TABLE IF NOT EXISTS journey_surface_view_audit_events (
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL CHECK(action IN (
        'view.created','view.revised','view.retired','view.reactivated',
        'default.selected','default.reset')),
      surface TEXT NOT NULL CHECK(surface IN ('hierarchy','service_blueprint')),
      view_sha256 TEXT NOT NULL CHECK(length(view_sha256)=64),
      configuration_sha256 TEXT CHECK(configuration_sha256 IS NULL OR length(configuration_sha256)=64),
      definition_revision INTEGER NOT NULL CHECK(definition_revision>0),
      version_number INTEGER CHECK(version_number IS NULL OR version_number>0),
      created_at TEXT NOT NULL, UNIQUE(id,space_id)
    );
    CREATE INDEX IF NOT EXISTS journey_surface_view_audit_history
      ON journey_surface_view_audit_events(space_id,surface,created_at DESC,id);
    CREATE INDEX IF NOT EXISTS journey_surface_view_audit_subject
      ON journey_surface_view_audit_events(space_id,view_sha256,created_at DESC,id);

    CREATE TRIGGER IF NOT EXISTS journey_surface_view_definition_identity_guard
      BEFORE UPDATE OF space_id,surface,owner_user_id,created_at ON journey_surface_view_definitions
      WHEN NEW.id<>OLD.id OR NEW.space_id<>OLD.space_id OR NEW.surface<>OLD.surface
        OR NEW.owner_user_id<>OLD.owner_user_id OR NEW.created_at<>OLD.created_at
      BEGIN SELECT RAISE(ABORT,'Journey surface view identity and ownership are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_surface_view_definition_revision_guard
      BEFORE UPDATE OF space_id,surface,audience,name,normalized_name,owner_user_id,owner_private,
        lifecycle,current_version_id,current_version_number,definition_revision,retired_at
      ON journey_surface_view_definitions
      WHEN NEW.definition_revision<>OLD.definition_revision+1
      BEGIN SELECT RAISE(ABORT,'Journey surface view revision is stale'); END;
    CREATE TRIGGER IF NOT EXISTS journey_surface_view_definition_version_guard
      BEFORE UPDATE OF current_version_id,current_version_number ON journey_surface_view_definitions
      WHEN NEW.current_version_number<OLD.current_version_number
      BEGIN SELECT RAISE(ABORT,'Journey surface view configuration versions never move backwards'); END;

    CREATE TRIGGER IF NOT EXISTS journey_surface_view_version_parent_guard
      BEFORE INSERT ON journey_surface_view_versions
      WHEN NOT EXISTS (SELECT 1 FROM journey_surface_view_definitions
        WHERE id=NEW.view_id AND space_id=NEW.space_id AND surface=NEW.surface)
      BEGIN SELECT RAISE(ABORT,
        'A journey surface view version requires a same-space view of the same surface'); END;
    CREATE TRIGGER IF NOT EXISTS journey_surface_view_version_lifecycle_guard
      BEFORE INSERT ON journey_surface_view_versions
      WHEN EXISTS (SELECT 1 FROM journey_surface_view_definitions
        WHERE id=NEW.view_id AND space_id=NEW.space_id AND surface=NEW.surface AND lifecycle<>'active')
      BEGIN SELECT RAISE(ABORT,'A retired journey surface view cannot be revised'); END;
    CREATE TRIGGER IF NOT EXISTS journey_surface_view_version_revision_guard
      BEFORE INSERT ON journey_surface_view_versions
      WHEN EXISTS (SELECT 1 FROM journey_surface_view_definitions
        WHERE id=NEW.view_id AND space_id=NEW.space_id AND surface=NEW.surface
          AND definition_revision<>NEW.definition_revision)
      BEGIN SELECT RAISE(ABORT,'Journey surface view revision is stale'); END;
    CREATE TRIGGER IF NOT EXISTS journey_surface_view_version_sequence_guard
      BEFORE INSERT ON journey_surface_view_versions
      WHEN NEW.version_number<>(SELECT COALESCE(MAX(version_number),0)+1
        FROM journey_surface_view_versions WHERE view_id=NEW.view_id AND space_id=NEW.space_id)
      BEGIN SELECT RAISE(ABORT,
        'Journey surface view configuration versions are gapless and monotone'); END;
    CREATE TRIGGER IF NOT EXISTS journey_surface_view_version_root_guard
      BEFORE INSERT ON journey_surface_view_versions
      WHEN NEW.hierarchy_root_definition_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM journey_definitions
        WHERE id=NEW.hierarchy_root_definition_id AND space_id=NEW.space_id)
      BEGIN SELECT RAISE(ABORT,'Journey surface view hierarchy root is outside the tenant'); END;
    CREATE TRIGGER IF NOT EXISTS journey_surface_view_version_taxonomy_guard
      BEFORE INSERT ON journey_surface_view_versions
      WHEN NEW.hierarchy_taxonomy_term_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM journey_taxonomy_terms
        WHERE id=NEW.hierarchy_taxonomy_term_id AND space_id=NEW.space_id)
      BEGIN SELECT RAISE(ABORT,'Journey surface view taxonomy filter is outside the tenant'); END;
    CREATE TRIGGER IF NOT EXISTS journey_surface_view_version_blueprint_guard
      BEFORE INSERT ON journey_surface_view_versions
      WHEN NEW.blueprint_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM journey_blueprints WHERE id=NEW.blueprint_id AND space_id=NEW.space_id)
      BEGIN SELECT RAISE(ABORT,'Journey surface view blueprint is outside the tenant'); END;
    CREATE TRIGGER IF NOT EXISTS journey_surface_view_version_blueprint_pin_guard
      BEFORE INSERT ON journey_surface_view_versions
      WHEN NEW.blueprint_version_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM journey_blueprint_versions WHERE id=NEW.blueprint_version_id
          AND space_id=NEW.space_id AND blueprint_id=NEW.blueprint_id)
      BEGIN SELECT RAISE(ABORT,'Journey surface view blueprint pin is outside its blueprint'); END;
    CREATE TRIGGER IF NOT EXISTS journey_surface_view_version_config_keys_guard
      BEFORE INSERT ON journey_surface_view_versions
      WHEN json_remove(NEW.configuration_json,
          '$.schemaVersion','$.surface','$.hierarchy','$.blueprint','$.presentation')<>'{}'
        OR COALESCE(json_remove(json_extract(NEW.configuration_json,'$.hierarchy'),
          '$.rootDefinitionId','$.direction','$.linkType','$.taxonomyTermId','$.reviewState','$.lifecycle'),'{}')<>'{}'
        OR COALESCE(json_remove(json_extract(NEW.configuration_json,'$.blueprint'),
          '$.blueprintId','$.versionMode','$.versionId','$.tab','$.lifecycle'),'{}')<>'{}'
        OR COALESCE(json_remove(json_extract(NEW.configuration_json,'$.presentation'),
          '$.density','$.showRetired','$.showLegend'),'{}')<>'{}'
      BEGIN SELECT RAISE(ABORT,
        'Journey surface view configuration carries a key outside the closed surface'); END;

    CREATE TRIGGER IF NOT EXISTS journey_surface_view_versions_update_append_only
      BEFORE UPDATE ON journey_surface_view_versions BEGIN SELECT RAISE(ABORT,
        'Journey surface view configuration versions and audit are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_surface_view_versions_delete_append_only
      BEFORE DELETE ON journey_surface_view_versions BEGIN SELECT RAISE(ABORT,
        'Journey surface view configuration versions and audit are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_surface_view_audit_update_append_only
      BEFORE UPDATE ON journey_surface_view_audit_events BEGIN SELECT RAISE(ABORT,
        'Journey surface view configuration versions and audit are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_surface_view_audit_delete_append_only
      BEFORE DELETE ON journey_surface_view_audit_events BEGIN SELECT RAISE(ABORT,
        'Journey surface view configuration versions and audit are append-only'); END;
  `);
}
ensureSqliteSchema();

type DefinitionRow = {
  id: string; space_id: string; surface: JourneySurfaceViewSurface; audience: JourneySurfaceViewAudience;
  name: string; normalized_name: string; owner_user_id: string; owner_private: unknown;
  lifecycle: JourneySurfaceViewLifecycle; current_version_id: string | null;
  current_version_number: number; definition_revision: number;
  created_at: string; updated_at: string; retired_at: string | null;
};

export class JourneySurfaceSavedViewRepository {
  available() {
    return db.provider === 'sqlite'
      || Number(db.health().runtimeSchemaVersion || 0) >= JOURNEY_SURFACE_VIEW_RUNTIME_SCHEMA_VERSION;
  }

  private assertAvailable() {
    if (!this.available()) {
      throw new JourneySurfaceSavedViewError('Journey surface saved views are not available on this runtime.',
        503, 'JOURNEY_SURFACE_VIEW_UNAVAILABLE');
    }
  }

  /**
   * The single tenancy gate. A caller outside the space is refused before any
   * lookup runs, so no query below can ever be reached with a foreign space id,
   * and the refusal is identical whether the space exists or not.
   */
  private membershipRole(spaceId: string, userId: string): 'owner' | 'admin' | 'member' {
    const row = db.prepare('SELECT role FROM space_memberships WHERE space_id=? AND user_id=?')
      .get(spaceId, userId) as { role?: string } | undefined;
    if (!row || !['owner', 'admin', 'member'].includes(String(row.role))) {
      throw new JourneySurfaceSavedViewError('Space membership is required.', 403,
        'JOURNEY_SURFACE_VIEW_FORBIDDEN');
    }
    return row.role as 'owner' | 'admin' | 'member';
  }

  /** Owner-private means private: a space owner or admin cannot read, manage or
   * pin another principal's private view either. */
  private visible(row: DefinitionRow, userId: string) {
    return !Number(row.owner_private) || row.owner_user_id === userId;
  }

  private readVisibleRow(spaceId: string, viewId: string, userId: string): DefinitionRow {
    const row = db.prepare('SELECT * FROM journey_surface_view_definitions WHERE id=? AND space_id=?')
      .get(viewId, spaceId) as DefinitionRow | undefined;
    if (!row || !this.visible(row, userId)) viewNotFound(viewId);
    return row;
  }

  /**
   * A plain member manages only what it owns. An owner or admin additionally
   * manages SHARED views, which is why the private branch is checked first and
   * unconditionally: role never overrides owner-private.
   */
  private assertCanManage(row: DefinitionRow, userId: string, role: 'owner' | 'admin' | 'member') {
    if (row.owner_user_id === userId) return;
    if (Number(row.owner_private)) viewNotFound(row.id);
    if (role === 'member') {
      throw new JourneySurfaceSavedViewError('A member can only manage saved views it owns.', 403,
        'JOURNEY_SURFACE_VIEW_NOT_OWNER');
    }
  }

  private lockDefinition(spaceId: string, viewId: string) {
    if (db.provider !== 'postgres') return;
    db.prepare('SELECT id FROM journey_surface_view_definitions WHERE id=? AND space_id=? FOR UPDATE')
      .get(viewId, spaceId);
  }
  private lockSpace(spaceId: string) {
    if (db.provider !== 'postgres') return;
    db.prepare('SELECT id FROM spaces WHERE id=? FOR UPDATE').get(spaceId);
  }

  private currentVersion(spaceId: string, viewId: string, versionId: string) {
    const row = db.prepare(`SELECT * FROM journey_surface_view_versions
      WHERE id=? AND view_id=? AND space_id=?`).get(versionId, viewId, spaceId) as any;
    if (!row) {
      throw new JourneySurfaceSavedViewError('The saved view failed its integrity check.', 409,
        'JOURNEY_SURFACE_VIEW_INTEGRITY_FAILED', { viewId });
    }
    return row;
  }

  /**
   * Re-canonicalises the stored document and compares the serialisation, the
   * checksum and every projected column. A row that was edited around this
   * module — a hand-run UPDATE, a restored backup — fails here instead of being
   * served as if it were governed configuration.
   */
  private view(row: DefinitionRow): JourneySurfaceSavedView {
    if (!row.current_version_id) {
      throw new JourneySurfaceSavedViewError('The saved view failed its integrity check.', 409,
        'JOURNEY_SURFACE_VIEW_INTEGRITY_FAILED', { viewId: row.id });
    }
    const version = this.currentVersion(row.space_id, row.id, row.current_version_id);
    const parsed = canonicalJourneySurfaceViewConfiguration(safeJson(version.configuration_json, null));
    const hierarchy = parsed.configuration.hierarchy;
    const blueprint = parsed.configuration.blueprint;
    if (parsed.serialized !== String(version.configuration_json)
      || parsed.checksum !== version.configuration_sha256
      || String(version.schema_version) !== JOURNEY_SURFACE_VIEW_SCHEMA_VERSION
      || String(version.surface) !== row.surface
      || parsed.configuration.surface !== row.surface
      || Number(version.version_number) !== Number(row.current_version_number)
      || (hierarchy?.rootDefinitionId ?? null) !== (version.hierarchy_root_definition_id ?? null)
      || (hierarchy?.direction ?? null) !== (version.hierarchy_direction ?? null)
      || (hierarchy?.linkType ?? null) !== (version.hierarchy_link_type ?? null)
      || (hierarchy?.taxonomyTermId ?? null) !== (version.hierarchy_taxonomy_term_id ?? null)
      || (hierarchy?.reviewState ?? null) !== (version.hierarchy_review_state ?? null)
      || (hierarchy?.lifecycle ?? null) !== (version.hierarchy_lifecycle ?? null)
      || (blueprint?.blueprintId ?? null) !== (version.blueprint_id ?? null)
      || (blueprint?.versionMode ?? null) !== (version.blueprint_version_mode ?? null)
      || (blueprint?.versionId ?? null) !== (version.blueprint_version_id ?? null)
      || (blueprint?.tab ?? null) !== (version.blueprint_tab ?? null)
      || (blueprint?.lifecycle ?? null) !== (version.blueprint_lifecycle ?? null)) {
      throw new JourneySurfaceSavedViewError('The saved view failed its integrity check.', 409,
        'JOURNEY_SURFACE_VIEW_INTEGRITY_FAILED', { viewId: row.id });
    }
    return {
      id: row.id, spaceId: row.space_id, surface: row.surface, audience: row.audience, name: row.name,
      ownerUserId: row.owner_user_id, ownerPrivate: Boolean(Number(row.owner_private)),
      lifecycle: row.lifecycle, revision: Number(row.definition_revision),
      versionId: String(version.id), versionNumber: Number(version.version_number),
      configuration: parsed.configuration, configurationSha256: String(version.configuration_sha256),
      createdAt: row.created_at, updatedAt: row.updated_at, retiredAt: row.retired_at || null
    };
  }

  /** Content-safe: the view identity is hashed and no name, configuration or
   * free text is ever written here. */
  private audit(input: {
    spaceId: string; actorUserId: string; action: JourneySurfaceViewAuditAction;
    surface: JourneySurfaceViewSurface; viewId: string; definitionRevision: number;
    configurationSha256?: string | null; versionNumber?: number | null; at: string;
  }) {
    db.prepare(`INSERT INTO journey_surface_view_audit_events
      (id,space_id,actor_user_id,action,surface,view_sha256,configuration_sha256,
        definition_revision,version_number,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), input.spaceId, input.actorUserId,
        input.action, input.surface, sha256(input.viewId), input.configurationSha256 ?? null,
        input.definitionRevision, input.versionNumber ?? null, input.at);
  }

  private versionColumns(configuration: JourneySurfaceViewConfiguration) {
    return {
      hierarchyRootDefinitionId: configuration.hierarchy?.rootDefinitionId ?? null,
      hierarchyDirection: configuration.hierarchy?.direction ?? null,
      hierarchyLinkType: configuration.hierarchy?.linkType ?? null,
      hierarchyTaxonomyTermId: configuration.hierarchy?.taxonomyTermId ?? null,
      hierarchyReviewState: configuration.hierarchy?.reviewState ?? null,
      hierarchyLifecycle: configuration.hierarchy?.lifecycle ?? null,
      blueprintId: configuration.blueprint?.blueprintId ?? null,
      blueprintVersionMode: configuration.blueprint?.versionMode ?? null,
      blueprintVersionId: configuration.blueprint?.versionId ?? null,
      blueprintTab: configuration.blueprint?.tab ?? null,
      blueprintLifecycle: configuration.blueprint?.lifecycle ?? null
    };
  }

  private insertVersion(input: {
    id: string; viewId: string; spaceId: string; surface: JourneySurfaceViewSurface;
    versionNumber: number; definitionRevision: number; serialized: string; checksum: string;
    requestSha256: string; configuration: JourneySurfaceViewConfiguration; actorUserId: string; at: string;
  }) {
    const columns = this.versionColumns(input.configuration);
    db.prepare(`INSERT INTO journey_surface_view_versions
      (id,view_id,space_id,surface,version_number,schema_version,definition_revision,
        configuration_json,configuration_sha256,request_sha256,
        hierarchy_root_definition_id,hierarchy_direction,hierarchy_link_type,hierarchy_taxonomy_term_id,
        hierarchy_review_state,hierarchy_lifecycle,
        blueprint_id,blueprint_version_mode,blueprint_version_id,blueprint_tab,blueprint_lifecycle,
        created_by_user_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(input.id, input.viewId, input.spaceId, input.surface, input.versionNumber,
        JOURNEY_SURFACE_VIEW_SCHEMA_VERSION, input.definitionRevision, input.serialized, input.checksum,
        input.requestSha256, columns.hierarchyRootDefinitionId, columns.hierarchyDirection,
        columns.hierarchyLinkType, columns.hierarchyTaxonomyTermId, columns.hierarchyReviewState,
        columns.hierarchyLifecycle, columns.blueprintId, columns.blueprintVersionMode,
        columns.blueprintVersionId, columns.blueprintTab, columns.blueprintLifecycle,
        input.actorUserId, input.at);
  }

  createView(input: {
    spaceId: string; actorUserId: string; surface: JourneySurfaceViewSurface; name: string;
    audience: JourneySurfaceViewAudience; ownerPrivate?: boolean; configuration: unknown;
    now?: Date | string;
  }): { view: JourneySurfaceSavedView; replayed: boolean } {
    this.assertAvailable();
    this.membershipRole(input.spaceId, input.actorUserId);
    if (!journeySurfaceViewSurfaces.includes(input.surface)) {
      throw new JourneySurfaceSavedViewError('An unknown saved-view surface was requested.', 400,
        'JOURNEY_SURFACE_VIEW_SURFACE_INVALID');
    }
    if (!journeySurfaceViewAudiences.includes(input.audience)) {
      throw new JourneySurfaceSavedViewError('An unknown saved-view audience was requested.', 400,
        'JOURNEY_SURFACE_VIEW_AUDIENCE_INVALID');
    }
    const name = String(input.name || '').trim();
    const normalized = normalizedName(name);
    if (!name || name.length > journeySurfaceViewLimits.nameCharacters || !normalized) {
      throw new JourneySurfaceSavedViewError('A saved view requires a bounded name.', 400,
        'JOURNEY_SURFACE_VIEW_NAME_INVALID');
    }
    const canonical = canonicalJourneySurfaceViewConfiguration(input.configuration);
    if (canonical.configuration.surface !== input.surface) {
      throw new JourneySurfaceSavedViewError('The configuration surface does not match the saved view.',
        400, 'JOURNEY_SURFACE_VIEW_CONFIG_SURFACE_MISMATCH');
    }
    const ownerPrivate = input.ownerPrivate === undefined ? true : Boolean(input.ownerPrivate);
    const at = iso(input.now || new Date());
    const requestSha256 = sha256(JSON.stringify({
      action: 'view.create', spaceId: input.spaceId, ownerUserId: input.actorUserId,
      surface: input.surface, normalizedName: normalized, audience: input.audience,
      ownerPrivate, configuration: canonical.configuration
    }));
    const readReplay = () => db.prepare(`SELECT * FROM journey_surface_view_definitions
      WHERE space_id=? AND owner_user_id=? AND create_request_sha256=?`)
      .get(input.spaceId, input.actorUserId, requestSha256) as DefinitionRow | undefined;
    const outcome = db.transaction(() => {
      const replay = readReplay();
      if (replay) return { row: replay, replayed: true };
      this.lockSpace(input.spaceId);
      // Recheck under the lock. Two concurrent identical creates would otherwise
      // both miss above and the loser would surface a raw unique-violation
      // instead of the receipt the winner already wrote.
      const concurrent = readReplay();
      if (concurrent) return { row: concurrent, replayed: true };
      const used = Number((db.prepare(`SELECT COUNT(*) count FROM journey_surface_view_definitions
        WHERE space_id=? AND surface=? AND lifecycle='active'`)
        .get(input.spaceId, input.surface) as any)?.count || 0);
      if (used >= journeySurfaceViewLimits.viewsPerSurface) {
        throw new JourneySurfaceSavedViewError('This surface has reached its saved-view limit.', 409,
          'JOURNEY_SURFACE_VIEW_LIMIT_REACHED', { limit: journeySurfaceViewLimits.viewsPerSurface });
      }
      const duplicate = db.prepare(`SELECT id FROM journey_surface_view_definitions
        WHERE space_id=? AND owner_user_id=? AND surface=? AND normalized_name=?`)
        .get(input.spaceId, input.actorUserId, input.surface, normalized) as { id?: string } | undefined;
      if (duplicate) {
        throw new JourneySurfaceSavedViewError('A saved view with this name already exists on this surface.',
          409, 'JOURNEY_SURFACE_VIEW_NAME_TAKEN');
      }
      const viewId = crypto.randomUUID(); const versionId = crypto.randomUUID();
      // The definition already points at the version this transaction is about
      // to append; the pointer foreign key is deferred for exactly this.
      db.prepare(`INSERT INTO journey_surface_view_definitions
        (id,space_id,surface,audience,name,normalized_name,owner_user_id,owner_private,lifecycle,
          current_version_id,current_version_number,definition_revision,create_request_sha256,
          created_by_user_id,updated_by_user_id,created_at,updated_at,retired_at)
        VALUES (?,?,?,?,?,?,?,?,'active',?,1,1,?,?,?,?,?,NULL)`)
        .run(viewId, input.spaceId, input.surface, input.audience, name, normalized, input.actorUserId,
          ownerPrivate ? 1 : 0, versionId, requestSha256, input.actorUserId, input.actorUserId, at, at);
      this.insertVersion({
        id: versionId, viewId, spaceId: input.spaceId, surface: input.surface, versionNumber: 1,
        definitionRevision: 1, serialized: canonical.serialized, checksum: canonical.checksum,
        requestSha256, configuration: canonical.configuration, actorUserId: input.actorUserId, at
      });
      this.audit({
        spaceId: input.spaceId, actorUserId: input.actorUserId, action: 'view.created',
        surface: input.surface, viewId, definitionRevision: 1,
        configurationSha256: canonical.checksum, versionNumber: 1, at
      });
      const created = db.prepare('SELECT * FROM journey_surface_view_definitions WHERE id=? AND space_id=?')
        .get(viewId, input.spaceId) as DefinitionRow;
      return { row: created, replayed: false };
    })();
    return { view: this.view(outcome.row), replayed: outcome.replayed };
  }

  reviseView(input: {
    spaceId: string; actorUserId: string; viewId: string; expectedRevision: number;
    configuration: unknown; now?: Date | string;
  }): { view: JourneySurfaceSavedView; replayed: boolean } {
    this.assertAvailable();
    const role = this.membershipRole(input.spaceId, input.actorUserId);
    const existing = this.readVisibleRow(input.spaceId, input.viewId, input.actorUserId);
    this.assertCanManage(existing, input.actorUserId, role);
    if (existing.lifecycle !== 'active') {
      throw new JourneySurfaceSavedViewError('A retired saved view cannot be revised.', 409,
        'JOURNEY_SURFACE_VIEW_RETIRED');
    }
    const canonical = canonicalJourneySurfaceViewConfiguration(input.configuration);
    if (canonical.configuration.surface !== existing.surface) {
      throw new JourneySurfaceSavedViewError('The configuration surface does not match the saved view.',
        400, 'JOURNEY_SURFACE_VIEW_CONFIG_SURFACE_MISMATCH');
    }
    const at = iso(input.now || new Date());
    const requestSha256 = sha256(JSON.stringify({
      action: 'view.revise', spaceId: input.spaceId, viewId: input.viewId,
      expectedRevision: Number(input.expectedRevision), configuration: canonical.configuration
    }));
    const readReplay = () => db.prepare(`SELECT id FROM journey_surface_view_versions
      WHERE view_id=? AND space_id=? AND request_sha256=?`)
      .get(input.viewId, input.spaceId, requestSha256) as { id?: string } | undefined;
    const result = db.transaction(() => {
      if (readReplay()) return { replayed: true };
      this.lockDefinition(input.spaceId, input.viewId);
      // Recheck under the row lock: a concurrent retry of the same revise is a
      // replay, not a revision conflict and not a unique-violation.
      if (readReplay()) return { replayed: true };
      const row = db.prepare('SELECT * FROM journey_surface_view_definitions WHERE id=? AND space_id=?')
        .get(input.viewId, input.spaceId) as DefinitionRow | undefined;
      if (!row) viewNotFound(input.viewId);
      if (Number(row.definition_revision) !== Number(input.expectedRevision)) {
        throw new JourneySurfaceSavedViewError('This saved view changed since it was read.', 409,
          'JOURNEY_SURFACE_VIEW_REVISION_CONFLICT',
          { expectedRevision: Number(input.expectedRevision), revision: Number(row.definition_revision) });
      }
      const versionId = crypto.randomUUID();
      const versionNumber = Number(row.current_version_number) + 1;
      this.insertVersion({
        id: versionId, viewId: input.viewId, spaceId: input.spaceId, surface: row.surface,
        versionNumber, definitionRevision: Number(row.definition_revision),
        serialized: canonical.serialized, checksum: canonical.checksum, requestSha256,
        configuration: canonical.configuration, actorUserId: input.actorUserId, at
      });
      const changed = db.prepare(`UPDATE journey_surface_view_definitions
        SET current_version_id=?,current_version_number=?,definition_revision=definition_revision+1,
          updated_by_user_id=?,updated_at=?
        WHERE id=? AND space_id=? AND definition_revision=?`)
        .run(versionId, versionNumber, input.actorUserId, at, input.viewId, input.spaceId,
          Number(input.expectedRevision)).changes;
      if (changed !== 1) {
        throw new JourneySurfaceSavedViewError('This saved view changed since it was read.', 409,
          'JOURNEY_SURFACE_VIEW_REVISION_CONFLICT', { expectedRevision: Number(input.expectedRevision) });
      }
      this.audit({
        spaceId: input.spaceId, actorUserId: input.actorUserId, action: 'view.revised',
        surface: row.surface, viewId: input.viewId, definitionRevision: Number(row.definition_revision) + 1,
        configurationSha256: canonical.checksum, versionNumber, at
      });
      return { replayed: false };
    })();
    const row = this.readVisibleRow(input.spaceId, input.viewId, input.actorUserId);
    return { view: this.view(row), replayed: result.replayed };
  }

  private setLifecycle(input: {
    spaceId: string; actorUserId: string; viewId: string; expectedRevision: number;
    lifecycle: JourneySurfaceViewLifecycle; now?: Date | string;
  }): { view: JourneySurfaceSavedView; replayed: boolean } {
    this.assertAvailable();
    const role = this.membershipRole(input.spaceId, input.actorUserId);
    const existing = this.readVisibleRow(input.spaceId, input.viewId, input.actorUserId);
    this.assertCanManage(existing, input.actorUserId, role);
    // Already in the target state: idempotent, and deliberately independent of
    // the supplied revision, because a retried request necessarily carries the
    // revision it read before the first attempt applied.
    if (existing.lifecycle === input.lifecycle) return { view: this.view(existing), replayed: true };
    const at = iso(input.now || new Date());
    db.transaction(() => {
      this.lockDefinition(input.spaceId, input.viewId);
      const row = db.prepare('SELECT * FROM journey_surface_view_definitions WHERE id=? AND space_id=?')
        .get(input.viewId, input.spaceId) as DefinitionRow | undefined;
      if (!row) viewNotFound(input.viewId);
      if (Number(row.definition_revision) !== Number(input.expectedRevision)) {
        throw new JourneySurfaceSavedViewError('This saved view changed since it was read.', 409,
          'JOURNEY_SURFACE_VIEW_REVISION_CONFLICT',
          { expectedRevision: Number(input.expectedRevision), revision: Number(row.definition_revision) });
      }
      const changed = db.prepare(`UPDATE journey_surface_view_definitions
        SET lifecycle=?,retired_at=?,definition_revision=definition_revision+1,
          updated_by_user_id=?,updated_at=?
        WHERE id=? AND space_id=? AND definition_revision=?`)
        .run(input.lifecycle, input.lifecycle === 'retired' ? at : null, input.actorUserId, at,
          input.viewId, input.spaceId, Number(input.expectedRevision)).changes;
      if (changed !== 1) {
        throw new JourneySurfaceSavedViewError('This saved view changed since it was read.', 409,
          'JOURNEY_SURFACE_VIEW_REVISION_CONFLICT', { expectedRevision: Number(input.expectedRevision) });
      }
      this.audit({
        spaceId: input.spaceId, actorUserId: input.actorUserId,
        action: input.lifecycle === 'retired' ? 'view.retired' : 'view.reactivated',
        surface: row.surface, viewId: input.viewId,
        definitionRevision: Number(row.definition_revision) + 1,
        versionNumber: Number(row.current_version_number) || null, at
      });
    })();
    return { view: this.view(this.readVisibleRow(input.spaceId, input.viewId, input.actorUserId)), replayed: false };
  }

  retireView(input: {
    spaceId: string; actorUserId: string; viewId: string; expectedRevision: number; now?: Date | string;
  }) {
    return this.setLifecycle({ ...input, lifecycle: 'retired' });
  }

  reactivateView(input: {
    spaceId: string; actorUserId: string; viewId: string; expectedRevision: number; now?: Date | string;
  }) {
    return this.setLifecycle({ ...input, lifecycle: 'active' });
  }

  getView(spaceId: string, actorUserId: string, viewId: string): JourneySurfaceSavedView {
    this.assertAvailable();
    this.membershipRole(spaceId, actorUserId);
    return this.view(this.readVisibleRow(spaceId, viewId, actorUserId));
  }

  listViews(input: {
    spaceId: string; actorUserId: string; surface: JourneySurfaceViewSurface;
    lifecycle?: JourneySurfaceViewLifecycle; limit?: number;
  }): JourneySurfaceSavedView[] {
    this.assertAvailable();
    this.membershipRole(input.spaceId, input.actorUserId);
    const limit = Math.max(1, Math.min(500, Math.trunc(Number(input.limit) || 100)));
    const lifecycle = input.lifecycle && journeySurfaceViewLifecycles.includes(input.lifecycle)
      ? input.lifecycle : null;
    // The owner-private predicate is part of the query, not a post-filter, so a
    // page never silently shortens because invisible rows were dropped after the
    // limit was applied. The lifecycle predicate is composed into the SQL rather
    // than passed as a nullable parameter: `? IS NULL` leaves the parameter type
    // underivable on PostgreSQL and fails to prepare. `NOT owner_private` rather
    // than `owner_private=0` for the same reason in reverse: the column is
    // BOOLEAN on PostgreSQL and INTEGER on SQLite, and only the negation reads
    // correctly on both.
    const rows = db.prepare(`SELECT * FROM journey_surface_view_definitions
      WHERE space_id=? AND surface=? AND (NOT owner_private OR owner_user_id=?)
      ${lifecycle ? 'AND lifecycle=?' : ''}
      ORDER BY updated_at DESC,id LIMIT ?`)
      .all(...[input.spaceId, input.surface, input.actorUserId,
        ...(lifecycle ? [lifecycle] : []), limit]) as DefinitionRow[];
    return rows.map((row) => this.view(row));
  }

  getDefault(spaceId: string, userId: string, surface: JourneySurfaceViewSurface): JourneySurfaceViewDefault | null {
    this.assertAvailable();
    this.membershipRole(spaceId, userId);
    const row = db.prepare(`SELECT * FROM journey_surface_view_defaults
      WHERE space_id=? AND user_id=? AND surface=?`).get(spaceId, userId, surface) as any;
    if (!row) return null;
    return {
      spaceId: String(row.space_id), userId: String(row.user_id), surface: row.surface,
      viewId: String(row.view_id), viewVersionId: String(row.view_version_id),
      viewDefinitionRevision: Number(row.view_definition_revision), revision: Number(row.revision),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at)
    };
  }

  /** Per-user, per-surface. Selecting pins the exact configuration version that
   * was current at selection time, so a later revision by the owner cannot
   * redefine somebody else's default behind their back. */
  setDefault(input: {
    spaceId: string; actorUserId: string; surface: JourneySurfaceViewSurface; viewId: string;
    now?: Date | string;
  }): { default: JourneySurfaceViewDefault; replayed: boolean } {
    this.assertAvailable();
    this.membershipRole(input.spaceId, input.actorUserId);
    const row = this.readVisibleRow(input.spaceId, input.viewId, input.actorUserId);
    if (row.surface !== input.surface) viewNotFound(input.viewId);
    if (row.lifecycle !== 'active' || !row.current_version_id) {
      throw new JourneySurfaceSavedViewError('A retired saved view cannot be a default.', 409,
        'JOURNEY_SURFACE_VIEW_RETIRED');
    }
    const at = iso(input.now || new Date());
    const requestSha256 = sha256(JSON.stringify({
      action: 'default.select', spaceId: input.spaceId, userId: input.actorUserId,
      surface: input.surface, viewId: input.viewId, versionId: row.current_version_id,
      revision: Number(row.definition_revision)
    }));
    const replayed = db.transaction(() => {
      const current = db.prepare(`SELECT request_sha256 FROM journey_surface_view_defaults
        WHERE space_id=? AND user_id=? AND surface=?`)
        .get(input.spaceId, input.actorUserId, input.surface) as { request_sha256?: string } | undefined;
      if (current?.request_sha256 === requestSha256) return true;
      db.prepare(`INSERT INTO journey_surface_view_defaults
        (space_id,user_id,surface,view_id,view_version_id,view_definition_revision,revision,
          request_sha256,created_at,updated_at)
        VALUES (?,?,?,?,?,?,1,?,?,?)
        ON CONFLICT(space_id,user_id,surface) DO UPDATE SET view_id=excluded.view_id,
          view_version_id=excluded.view_version_id,
          view_definition_revision=excluded.view_definition_revision,
          revision=journey_surface_view_defaults.revision+1,
          request_sha256=excluded.request_sha256,updated_at=excluded.updated_at`)
        .run(input.spaceId, input.actorUserId, input.surface, input.viewId, row.current_version_id,
          Number(row.definition_revision), requestSha256, at, at);
      this.audit({
        spaceId: input.spaceId, actorUserId: input.actorUserId, action: 'default.selected',
        surface: input.surface, viewId: input.viewId, definitionRevision: Number(row.definition_revision),
        versionNumber: Number(row.current_version_number) || null, at
      });
      return false;
    })();
    const stored = this.getDefault(input.spaceId, input.actorUserId, input.surface);
    if (!stored) {
      throw new JourneySurfaceSavedViewError('The saved-view default could not be read back.', 409,
        'JOURNEY_SURFACE_VIEW_DEFAULT_UNAVAILABLE');
    }
    return { default: stored, replayed };
  }

  /** Reset removes the pin. Repeating it is a no-op rather than an error, so a
   * retried reset does not surface as a failure the caller has to interpret. */
  resetDefault(input: {
    spaceId: string; actorUserId: string; surface: JourneySurfaceViewSurface; now?: Date | string;
  }): { cleared: boolean; replayed: boolean } {
    this.assertAvailable();
    this.membershipRole(input.spaceId, input.actorUserId);
    const at = iso(input.now || new Date());
    return db.transaction(() => {
      const current = db.prepare(`SELECT view_id,view_definition_revision FROM journey_surface_view_defaults
        WHERE space_id=? AND user_id=? AND surface=?`)
        .get(input.spaceId, input.actorUserId, input.surface) as
        { view_id?: string; view_definition_revision?: number } | undefined;
      if (!current) return { cleared: false, replayed: true };
      db.prepare('DELETE FROM journey_surface_view_defaults WHERE space_id=? AND user_id=? AND surface=?')
        .run(input.spaceId, input.actorUserId, input.surface);
      this.audit({
        spaceId: input.spaceId, actorUserId: input.actorUserId, action: 'default.reset',
        surface: input.surface, viewId: String(current.view_id),
        definitionRevision: Number(current.view_definition_revision), at
      });
      return { cleared: true, replayed: false };
    })();
  }

  listVersions(spaceId: string, actorUserId: string, viewId: string, limit = 50) {
    this.assertAvailable();
    this.membershipRole(spaceId, actorUserId);
    this.readVisibleRow(spaceId, viewId, actorUserId);
    const bounded = Math.max(1, Math.min(200, Math.trunc(limit)));
    return (db.prepare(`SELECT id,version_number,definition_revision,configuration_sha256,created_at
      FROM journey_surface_view_versions WHERE view_id=? AND space_id=?
      ORDER BY version_number DESC LIMIT ?`).all(viewId, spaceId, bounded) as any[])
      .map((row) => ({
        versionId: String(row.id), versionNumber: Number(row.version_number),
        definitionRevision: Number(row.definition_revision),
        configurationSha256: String(row.configuration_sha256), createdAt: String(row.created_at)
      }));
  }

  listAudit(spaceId: string, actorUserId: string, surface: JourneySurfaceViewSurface, limit = 100) {
    this.assertAvailable();
    this.membershipRole(spaceId, actorUserId);
    const bounded = Math.max(1, Math.min(500, Math.trunc(limit)));
    return (db.prepare(`SELECT action,surface,view_sha256,configuration_sha256,definition_revision,
      version_number,created_at FROM journey_surface_view_audit_events
      WHERE space_id=? AND surface=? ORDER BY created_at DESC,id LIMIT ?`)
      .all(spaceId, surface, bounded) as any[])
      .map((row) => ({
        action: row.action as JourneySurfaceViewAuditAction, surface: row.surface as JourneySurfaceViewSurface,
        viewSha256: String(row.view_sha256),
        configurationSha256: row.configuration_sha256 ? String(row.configuration_sha256) : null,
        definitionRevision: Number(row.definition_revision),
        versionNumber: row.version_number === null || row.version_number === undefined
          ? null : Number(row.version_number),
        createdAt: String(row.created_at)
      }));
  }
}

export const journeySurfaceSavedViewRepository = new JourneySurfaceSavedViewRepository();

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db } from './database.js';
import {
  assertSubscriptionFeature, assertSubscriptionQuota
} from './subscriptionEntitlements.js';

export const JOURNEY_RICH_CARD_SCHEMA_VERSION = 1;

export const journeyChannelCategories = [
  'web', 'mobile_app', 'email', 'social', 'phone', 'in_person', 'chat',
  'messaging', 'self_service', 'partner', 'other'
] as const;
export type JourneyChannelCategory = typeof journeyChannelCategories[number];

export const journeyRichTextBlockTypes = ['paragraph', 'heading', 'bullet', 'ordered', 'quote'] as const;
export type JourneyRichTextBlockType = typeof journeyRichTextBlockTypes[number];
export const journeyRichTextMarkTypes = ['bold', 'italic', 'code', 'link'] as const;
export type JourneyRichTextMarkType = typeof journeyRichTextMarkTypes[number];

export const journeyRichCardLimits = {
  richTextBlocks: 40,
  richTextCharacters: 8_000,
  richTextMarksPerBlock: 20,
  blockCharacters: 2_000,
  catalogNameCharacters: 120,
  catalogDescriptionCharacters: 1_000,
  touchpointsPerCard: 8,
  assetsPerCard: 8,
  imagesPerCard: 4,
  imageBytes: 10 * 1024 * 1024,
  attachmentBytes: 25 * 1024 * 1024,
  assetBytesPerCard: 50 * 1024 * 1024,
  assetNameCharacters: 255,
  altTextCharacters: 500,
  captionCharacters: 1_000,
  externalUrlCharacters: 2_048,
  deletedAssetRetentionDays: 30
} as const;

export type JourneyRichTextMark = {
  type: JourneyRichTextMarkType;
  start: number;
  end: number;
  href?: string;
};

export type JourneyRichTextBlock = {
  type: JourneyRichTextBlockType;
  text: string;
  marks: JourneyRichTextMark[];
};

export type JourneyRichTextDocument = {
  version: 1;
  blocks: JourneyRichTextBlock[];
};

export type JourneyEmotionPoint = {
  valence: number;
  intensity: number;
  label: string;
};

export type JourneyChannelSnapshot = {
  id: string;
  spaceId: string;
  status: 'active' | 'retired';
  revision: number;
  versionId: string;
  versionNumber: number;
  name: string;
  description: string;
  category: JourneyChannelCategory;
  createdAt: string;
  updatedAt: string;
};

export type JourneyTouchpointSnapshot = {
  id: string;
  spaceId: string;
  status: 'active' | 'retired';
  revision: number;
  versionId: string;
  versionNumber: number;
  name: string;
  description: string;
  channel: Pick<JourneyChannelSnapshot, 'id' | 'versionId' | 'versionNumber' | 'name' | 'category'>;
  createdAt: string;
  updatedAt: string;
};

export type JourneyCardAsset = {
  id: string;
  cardId: string;
  kind: 'image' | 'attachment';
  sourceKind: 'upload' | 'external_url';
  displayName: string;
  mimeType: string;
  byteSize: number;
  sha256: string | null;
  altText: string;
  caption: string;
  externalUrl: string | null;
  contentUrl: string | null;
  ordinal: number;
  state: 'active' | 'deleted';
  deletedAt: string | null;
  retentionExpiresAt: string | null;
  createdAt: string;
};

export type JourneyCardRichDetail = {
  cardId: string;
  revision: number;
  richText: JourneyRichTextDocument;
  plainText: string;
  emotion: JourneyEmotionPoint | null;
  touchpoints: JourneyTouchpointSnapshot[];
  assets: JourneyCardAsset[];
  updatedAt: string | null;
};

export type JourneyRichMapSnapshot = {
  definitionId: string;
  versionId: string;
  cards: JourneyCardRichDetail[];
  emotionalCurve: Array<{
    cardId: string;
    stageKey: string;
    stageName: string;
    stageOrdinal: number;
    cardOrdinal: number;
    valence: number;
    intensity: number;
    label: string;
  }>;
  catalog: {
    channels: JourneyChannelSnapshot[];
    touchpoints: JourneyTouchpointSnapshot[];
  };
  limits: typeof journeyRichCardLimits;
};

export class JourneyRichCardError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = 'JOURNEY_RICH_CARD_INVALID',
    public details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'JourneyRichCardError';
  }
}

function ensureSqliteSchema() {
  if (db.provider !== 'sqlite') return;
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS journey_rich_versions_tenant_identity
      ON journey_map_versions(id,space_id);
    CREATE UNIQUE INDEX IF NOT EXISTS journey_rich_cards_tenant_identity
      ON journey_map_cards(id,version_id,space_id);
    CREATE UNIQUE INDEX IF NOT EXISTS journey_rich_uploads_tenant_identity
      ON uploads(id,space_id);

    CREATE TABLE IF NOT EXISTS journey_channels (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','retired')),
      current_version_number INTEGER NOT NULL CHECK(current_version_number>=1),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(id,space_id)
    );
    CREATE INDEX IF NOT EXISTS journey_channels_space_status
      ON journey_channels(space_id,status,updated_at DESC,id);

    CREATE TABLE IF NOT EXISTS journey_channel_versions (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL CHECK(version_number>=1),
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
      description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=1000),
      category TEXT NOT NULL CHECK(category IN ('web','mobile_app','email','social','phone','in_person','chat','messaging','self_service','partner','other')),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      UNIQUE(channel_id,version_number),
      UNIQUE(id,channel_id,space_id),
      FOREIGN KEY(channel_id,space_id) REFERENCES journey_channels(id,space_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS journey_channel_versions_history
      ON journey_channel_versions(space_id,channel_id,version_number DESC,id);

    CREATE TABLE IF NOT EXISTS journey_touchpoints (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','retired')),
      current_version_number INTEGER NOT NULL CHECK(current_version_number>=1),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(id,space_id)
    );
    CREATE INDEX IF NOT EXISTS journey_touchpoints_space_status
      ON journey_touchpoints(space_id,status,updated_at DESC,id);

    CREATE TABLE IF NOT EXISTS journey_touchpoint_versions (
      id TEXT PRIMARY KEY,
      touchpoint_id TEXT NOT NULL,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL CHECK(version_number>=1),
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
      description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=1000),
      channel_id TEXT NOT NULL,
      channel_version_id TEXT NOT NULL,
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      UNIQUE(touchpoint_id,version_number),
      UNIQUE(id,touchpoint_id,space_id),
      FOREIGN KEY(touchpoint_id,space_id) REFERENCES journey_touchpoints(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(channel_version_id,channel_id,space_id)
        REFERENCES journey_channel_versions(id,channel_id,space_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS journey_touchpoint_versions_history
      ON journey_touchpoint_versions(space_id,touchpoint_id,version_number DESC,id);
    CREATE INDEX IF NOT EXISTS journey_touchpoint_versions_channel
      ON journey_touchpoint_versions(space_id,channel_id,channel_version_id,id);

    CREATE TABLE IF NOT EXISTS journey_card_details (
      card_id TEXT PRIMARY KEY,
      version_id TEXT NOT NULL,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version=1),
      rich_text_json TEXT NOT NULL
        CHECK(json_valid(rich_text_json) AND length(rich_text_json)<=65536),
      plain_text TEXT NOT NULL DEFAULT '' CHECK(length(plain_text)<=8000),
      emotion_valence INTEGER CHECK(emotion_valence IS NULL OR emotion_valence BETWEEN -5 AND 5),
      emotion_intensity INTEGER CHECK(emotion_intensity IS NULL OR emotion_intensity BETWEEN 0 AND 5),
      emotion_label TEXT NOT NULL DEFAULT '' CHECK(length(emotion_label)<=120),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
      updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(card_id,version_id,space_id),
      FOREIGN KEY(card_id,version_id,space_id)
        REFERENCES journey_map_cards(id,version_id,space_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS journey_card_details_version
      ON journey_card_details(space_id,version_id,card_id);

    CREATE TABLE IF NOT EXISTS journey_card_touchpoints (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      touchpoint_id TEXT NOT NULL,
      touchpoint_version_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 7),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      UNIQUE(card_id,touchpoint_id),
      UNIQUE(card_id,ordinal),
      UNIQUE(id,card_id,space_id),
      FOREIGN KEY(card_id,version_id,space_id)
        REFERENCES journey_map_cards(id,version_id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(touchpoint_version_id,touchpoint_id,space_id)
        REFERENCES journey_touchpoint_versions(id,touchpoint_id,space_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS journey_card_touchpoints_version
      ON journey_card_touchpoints(space_id,version_id,card_id,ordinal,id);

    CREATE TABLE IF NOT EXISTS journey_card_assets (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('image','attachment')),
      source_kind TEXT NOT NULL CHECK(source_kind IN ('upload','external_url')),
      source_upload_id TEXT,
      source_external_url TEXT CHECK(source_external_url IS NULL OR length(source_external_url)<=2048),
      display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 255),
      mime_type TEXT NOT NULL CHECK(length(mime_type) BETWEEN 1 AND 160),
      byte_size INTEGER NOT NULL DEFAULT 0 CHECK(byte_size>=0 AND byte_size<=26214400),
      sha256 TEXT CHECK(sha256 IS NULL OR (length(sha256)=64 AND sha256 NOT GLOB '*[^a-f0-9]*')),
      alt_text TEXT NOT NULL DEFAULT '' CHECK(length(alt_text)<=500),
      caption TEXT NOT NULL DEFAULT '' CHECK(length(caption)<=1000),
      ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 7),
      state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','deleted')),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      deleted_at TEXT,
      retention_expires_at TEXT,
      UNIQUE(id,card_id,space_id),
      FOREIGN KEY(card_id,version_id,space_id)
        REFERENCES journey_map_cards(id,version_id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(source_upload_id,space_id) REFERENCES uploads(id,space_id) ON DELETE RESTRICT,
      CHECK((source_kind='upload' AND source_upload_id IS NOT NULL AND source_external_url IS NULL AND sha256 IS NOT NULL)
        OR (source_kind='external_url' AND source_upload_id IS NULL AND source_external_url IS NOT NULL AND sha256 IS NULL)),
      CHECK((kind='image' AND source_kind='upload' AND alt_text<>'') OR kind='attachment'),
      CHECK((state='active' AND deleted_at IS NULL AND retention_expires_at IS NULL)
        OR (state='deleted' AND deleted_at IS NOT NULL AND retention_expires_at IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS journey_card_assets_version
      ON journey_card_assets(space_id,version_id,card_id,ordinal,id);
    CREATE UNIQUE INDEX IF NOT EXISTS journey_card_assets_active_ordinal_once
      ON journey_card_assets(card_id,ordinal) WHERE state='active';
    CREATE INDEX IF NOT EXISTS journey_card_assets_retention
      ON journey_card_assets(retention_expires_at,id) WHERE state='deleted';

    -- Purge work deliberately does not cascade with logical tenant deletion.
    CREATE TABLE IF NOT EXISTS journey_asset_blob_purge_outbox (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      source_upload_id TEXT NOT NULL,
      stored_filename TEXT NOT NULL CHECK(length(stored_filename) BETWEEN 1 AND 255),
      expected_sha256 TEXT NOT NULL CHECK(length(expected_sha256)=64 AND expected_sha256 NOT GLOB '*[^a-f0-9]*'),
      expected_byte_size INTEGER NOT NULL CHECK(expected_byte_size>=0),
      state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','failed','completed')),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
      last_error_fingerprint TEXT CHECK(last_error_fingerprint IS NULL OR length(last_error_fingerprint)=64),
      next_attempt_at TEXT NOT NULL,
      lease_expires_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(source_upload_id,space_id),
      CHECK((state='completed' AND completed_at IS NOT NULL AND lease_expires_at IS NULL)
        OR (state='processing' AND completed_at IS NULL AND lease_expires_at IS NOT NULL)
        OR (state IN ('pending','failed') AND completed_at IS NULL AND lease_expires_at IS NULL))
    );
    CREATE INDEX IF NOT EXISTS journey_asset_blob_purge_outbox_due
      ON journey_asset_blob_purge_outbox(state,next_attempt_at,lease_expires_at,id);

    CREATE TABLE IF NOT EXISTS journey_rich_card_audit_events (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL CHECK(action IN ('channel.created','channel.version_created','channel.retired',
        'touchpoint.created','touchpoint.version_created','touchpoint.retired','card.detail_updated',
        'card.touchpoint_linked','card.touchpoint_unlinked','card.asset_attached','card.asset_deleted','card.asset_restored',
        'card.asset_purged')),
      target_type TEXT NOT NULL CHECK(target_type IN ('channel','touchpoint','card','asset')),
      target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 128),
      definition_id TEXT,
      version_id TEXT,
      before_fingerprint TEXT CHECK(before_fingerprint IS NULL OR length(before_fingerprint)=64),
      after_fingerprint TEXT CHECK(after_fingerprint IS NULL OR length(after_fingerprint)=64),
      detail_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(detail_json) AND length(detail_json)<=8192),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS journey_rich_card_audit_history
      ON journey_rich_card_audit_events(space_id,created_at DESC,id);
    CREATE TRIGGER IF NOT EXISTS journey_channel_versions_update_immutable
      BEFORE UPDATE ON journey_channel_versions BEGIN SELECT RAISE(ABORT,'Journey channel versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_channel_versions_delete_immutable
      BEFORE DELETE ON journey_channel_versions BEGIN SELECT RAISE(ABORT,'Journey channel versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_touchpoint_versions_update_immutable
      BEFORE UPDATE ON journey_touchpoint_versions BEGIN SELECT RAISE(ABORT,'Journey touchpoint versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_touchpoint_versions_delete_immutable
      BEFORE DELETE ON journey_touchpoint_versions BEGIN SELECT RAISE(ABORT,'Journey touchpoint versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_rich_card_audit_update_append_only
      BEFORE UPDATE ON journey_rich_card_audit_events BEGIN SELECT RAISE(ABORT,'Journey rich-card audit is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_rich_card_audit_delete_append_only
      BEFORE DELETE ON journey_rich_card_audit_events BEGIN SELECT RAISE(ABORT,'Journey rich-card audit is append-only'); END;
  `);
}

ensureSqliteSchema();

function nowIso() { return new Date().toISOString(); }

function normalizeText(value: unknown, maximum: number, field: string, required = false) {
  if (typeof value !== 'string') {
    if (required) throw new JourneyRichCardError(`${field} is required.`, 400, 'JOURNEY_RICH_TEXT_INVALID', { field });
    return '';
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new JourneyRichCardError(`${field} contains unsupported control characters.`, 400,
      'JOURNEY_RICH_TEXT_INVALID', { field });
  }
  const normalized = value.replace(/\r\n?/gu, '\n').trim();
  if (required && !normalized) {
    throw new JourneyRichCardError(`${field} is required.`, 400, 'JOURNEY_RICH_TEXT_INVALID', { field });
  }
  if (normalized.length > maximum) {
    throw new JourneyRichCardError(`${field} exceeds its ${maximum}-character limit.`, 413,
      'JOURNEY_RICH_TEXT_TOO_LARGE', { field, maximum, actual: normalized.length });
  }
  return normalized;
}

function exactObject(value: unknown, allowed: readonly string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new JourneyRichCardError(`${field} must be an object.`, 400, 'JOURNEY_RICH_TEXT_INVALID', { field });
  }
  const input = value as Record<string, unknown>;
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length) {
    throw new JourneyRichCardError(`${field} contains unknown fields.`, 400,
      'JOURNEY_RICH_TEXT_INVALID', { field, unknownFields: unknown });
  }
  return input;
}

export function normalizeExternalJourneyUrl(value: unknown) {
  const raw = normalizeText(value, journeyRichCardLimits.externalUrlCharacters, 'externalUrl', true);
  let parsed: URL;
  try { parsed = new URL(raw); }
  catch { throw new JourneyRichCardError('External links must be valid HTTPS URLs.', 400, 'JOURNEY_ASSET_URL_INVALID'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new JourneyRichCardError('External links must use HTTPS and cannot contain credentials.', 400,
      'JOURNEY_ASSET_URL_INVALID');
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/u, '');
  const privateHost = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || host === '0.0.0.0' || host === '::1'
    || /^(?:10|127)\./u.test(host) || /^169\.254\./u.test(host) || /^192\.168\./u.test(host)
    || /^172\.(?:1[6-9]|2\d|3[01])\./u.test(host)
    || /^fc[0-9a-f]{2}:/u.test(host) || /^fd[0-9a-f]{2}:/u.test(host) || /^fe80:/u.test(host);
  if (!host || privateHost) {
    throw new JourneyRichCardError('External links cannot target local or private hosts.', 400,
      'JOURNEY_ASSET_URL_INVALID');
  }
  parsed.hash = '';
  return parsed.toString();
}

export function normalizeJourneyRichText(value: unknown): JourneyRichTextDocument {
  const document = exactObject(value, ['version', 'blocks'], 'richText');
  if (document.version !== 1 || !Array.isArray(document.blocks)) {
    throw new JourneyRichCardError('Rich text must use schema version 1 with a blocks array.', 400,
      'JOURNEY_RICH_TEXT_INVALID');
  }
  if (document.blocks.length > journeyRichCardLimits.richTextBlocks) {
    throw new JourneyRichCardError('Rich text has too many blocks.', 413, 'JOURNEY_RICH_TEXT_TOO_LARGE', {
      maximum: journeyRichCardLimits.richTextBlocks
    });
  }
  let characters = 0;
  const blocks = document.blocks.map((raw, blockIndex): JourneyRichTextBlock => {
    const block = exactObject(raw, ['type', 'text', 'marks'], `richText.blocks[${blockIndex}]`);
    if (!journeyRichTextBlockTypes.includes(block.type as JourneyRichTextBlockType)) {
      throw new JourneyRichCardError('Rich text contains an unsupported block type.', 400,
        'JOURNEY_RICH_TEXT_INVALID', { blockIndex, type: block.type });
    }
    const blockText = normalizeText(block.text, journeyRichCardLimits.blockCharacters,
      `richText.blocks[${blockIndex}].text`);
    characters += blockText.length;
    const rawMarks = block.marks === undefined ? [] : block.marks;
    if (!Array.isArray(rawMarks) || rawMarks.length > journeyRichCardLimits.richTextMarksPerBlock) {
      throw new JourneyRichCardError('A rich-text block has too many or malformed marks.', 400,
        'JOURNEY_RICH_TEXT_INVALID', { blockIndex });
    }
    const marks = rawMarks.map((rawMark, markIndex): JourneyRichTextMark => {
      const mark = exactObject(rawMark, ['type', 'start', 'end', 'href'],
        `richText.blocks[${blockIndex}].marks[${markIndex}]`);
      if (!journeyRichTextMarkTypes.includes(mark.type as JourneyRichTextMarkType)
        || !Number.isInteger(mark.start) || !Number.isInteger(mark.end)
        || Number(mark.start) < 0 || Number(mark.end) <= Number(mark.start) || Number(mark.end) > blockText.length) {
        throw new JourneyRichCardError('A rich-text mark has an invalid type or range.', 400,
          'JOURNEY_RICH_TEXT_INVALID', { blockIndex, markIndex });
      }
      if (mark.type === 'link') {
        return { type: 'link', start: Number(mark.start), end: Number(mark.end), href: normalizeExternalJourneyUrl(mark.href) };
      }
      if (mark.href !== undefined) {
        throw new JourneyRichCardError('Only link marks can include href.', 400,
          'JOURNEY_RICH_TEXT_INVALID', { blockIndex, markIndex });
      }
      return { type: mark.type as JourneyRichTextMarkType, start: Number(mark.start), end: Number(mark.end) };
    });
    const linkMarks = marks.filter((mark) => mark.type === 'link')
      .sort((left, right) => left.start - right.start || left.end - right.end);
    for (let index = 1; index < linkMarks.length; index += 1) {
      if (linkMarks[index].start < linkMarks[index - 1].end) {
        throw new JourneyRichCardError('Link marks cannot overlap.', 400,
          'JOURNEY_RICH_TEXT_INVALID', { blockIndex });
      }
    }
    return { type: block.type as JourneyRichTextBlockType, text: blockText, marks };
  });
  if (characters > journeyRichCardLimits.richTextCharacters) {
    throw new JourneyRichCardError('Rich text exceeds its total character limit.', 413,
      'JOURNEY_RICH_TEXT_TOO_LARGE', { maximum: journeyRichCardLimits.richTextCharacters, actual: characters });
  }
  return { version: 1, blocks };
}

export function richTextPlainText(document: JourneyRichTextDocument) {
  return document.blocks.map((block) => block.text).filter(Boolean).join('\n').slice(0, journeyRichCardLimits.richTextCharacters);
}

export function normalizeJourneyEmotion(value: unknown): JourneyEmotionPoint | null {
  if (value === null || value === undefined) return null;
  const emotion = exactObject(value, ['valence', 'intensity', 'label'], 'emotion');
  if (!Number.isInteger(emotion.valence) || Number(emotion.valence) < -5 || Number(emotion.valence) > 5
    || !Number.isInteger(emotion.intensity) || Number(emotion.intensity) < 0 || Number(emotion.intensity) > 5) {
    throw new JourneyRichCardError('Emotion valence must be -5 to 5 and intensity must be 0 to 5.', 400,
      'JOURNEY_EMOTION_INVALID');
  }
  return {
    valence: Number(emotion.valence), intensity: Number(emotion.intensity),
    label: normalizeText(emotion.label, 120, 'emotion.label')
  };
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)]));
}

function fingerprint(value: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object') return value as T;
  try { return value ? JSON.parse(String(value)) as T : fallback; }
  catch { return fallback; }
}

function audit(input: {
  spaceId: string;
  actorUserId: string | null;
  action: string;
  targetType: 'channel' | 'touchpoint' | 'card' | 'asset';
  targetId: string;
  definitionId?: string;
  versionId?: string;
  before?: unknown;
  after?: unknown;
  detail?: Record<string, unknown>;
}) {
  db.prepare(`INSERT INTO journey_rich_card_audit_events
    (id,space_id,actor_user_id,action,target_type,target_id,definition_id,version_id,
      before_fingerprint,after_fingerprint,detail_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    crypto.randomUUID(), input.spaceId, input.actorUserId, input.action, input.targetType, input.targetId,
    input.definitionId || null, input.versionId || null,
    input.before === undefined ? null : fingerprint(input.before),
    input.after === undefined ? null : fingerprint(input.after),
    JSON.stringify(input.detail || {}), nowIso()
  );
}

function bumpDefinition(spaceId: string, definitionId: string, expectedRevision: number) {
  const changed = db.prepare(`UPDATE journey_definitions SET revision=revision+1,updated_at=?
    WHERE id=? AND space_id=? AND revision=?`).run(nowIso(), definitionId, spaceId, expectedRevision).changes;
  if (changed !== 1) {
    throw new JourneyRichCardError('This journey changed since it was opened. Refresh before saving.', 409,
      'JOURNEY_MAP_REVISION_CONFLICT', { expectedRevision });
  }
}

/** Resource quotas use the space row as their PostgreSQL admission mutex.
 * SQLite write transactions already serialize the same count-and-insert
 * decision. This must run inside the surrounding transaction and before any
 * resource count used for quota admission. */
function lockSpaceForRichCardQuota(spaceId: string) {
  if (db.provider === 'postgres') {
    const locked = db.prepare('SELECT id FROM spaces WHERE id=? FOR UPDATE').get(spaceId);
    if (!locked) throw new JourneyRichCardError('Space not found.', 404, 'SPACE_NOT_FOUND');
  }
}

function requireCard(input: { spaceId: string; definitionId: string; cardId: string; mutable?: boolean }) {
  const row = db.prepare(`SELECT card.*,version.definition_id,version.state version_state,
      definition.current_version_id,definition.revision definition_revision
    FROM journey_map_cards card
    JOIN journey_map_versions version ON version.id=card.version_id AND version.space_id=card.space_id
    JOIN journey_definitions definition ON definition.id=version.definition_id AND definition.space_id=version.space_id
    WHERE card.id=? AND card.space_id=? AND definition.id=?`)
    .get(input.cardId, input.spaceId, input.definitionId) as any;
  if (!row) throw new JourneyRichCardError('Journey card not found.', 404, 'JOURNEY_CARD_NOT_FOUND');
  if (input.mutable && (row.version_state === 'published' || row.current_version_id !== row.version_id)) {
    throw new JourneyRichCardError('Published journey versions are immutable.', 409,
      'JOURNEY_MAP_VERSION_PUBLISHED');
  }
  return row;
}

function currentChannelRow(spaceId: string, channelId: string) {
  return db.prepare(`SELECT channel.*,version.id version_id,version.version_number,version.name,version.description,version.category
    FROM journey_channels channel JOIN journey_channel_versions version
      ON version.channel_id=channel.id AND version.space_id=channel.space_id
      AND version.version_number=channel.current_version_number
    WHERE channel.id=? AND channel.space_id=?`).get(channelId, spaceId) as any;
}

function channelView(row: any): JourneyChannelSnapshot {
  return {
    id: row.id, spaceId: row.space_id, status: row.status, revision: Number(row.revision),
    versionId: row.version_id, versionNumber: Number(row.version_number), name: row.name,
    description: row.description, category: row.category, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function currentTouchpointRow(spaceId: string, touchpointId: string) {
  return db.prepare(`SELECT touchpoint.*,version.id version_id,version.version_number,version.name,version.description,
      version.channel_id,version.channel_version_id,channel.name channel_name,channel.category channel_category,
      channel.version_number channel_version_number
    FROM journey_touchpoints touchpoint JOIN journey_touchpoint_versions version
      ON version.touchpoint_id=touchpoint.id AND version.space_id=touchpoint.space_id
      AND version.version_number=touchpoint.current_version_number
    JOIN journey_channel_versions channel
      ON channel.id=version.channel_version_id AND channel.channel_id=version.channel_id AND channel.space_id=version.space_id
    WHERE touchpoint.id=? AND touchpoint.space_id=?`).get(touchpointId, spaceId) as any;
}

function touchpointView(row: any): JourneyTouchpointSnapshot {
  return {
    id: row.id, spaceId: row.space_id, status: row.status, revision: Number(row.revision),
    versionId: row.version_id, versionNumber: Number(row.version_number), name: row.name,
    description: row.description,
    channel: {
      id: row.channel_id, versionId: row.channel_version_id,
      versionNumber: Number(row.channel_version_number), name: row.channel_name, category: row.channel_category
    },
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

export function listJourneyChannels(spaceId: string, includeRetired = false) {
  assertSubscriptionFeature(spaceId, 'journeyRichCards');
  const rows = db.prepare(`SELECT channel.*,version.id version_id,version.version_number,version.name,version.description,version.category
    FROM journey_channels channel JOIN journey_channel_versions version
      ON version.channel_id=channel.id AND version.space_id=channel.space_id
      AND version.version_number=channel.current_version_number
    WHERE channel.space_id=? ${includeRetired ? '' : "AND channel.status='active'"}
    ORDER BY lower(version.name),channel.id`).all(spaceId) as any[];
  return rows.map(channelView);
}

export function createJourneyChannel(spaceId: string, actorUserId: string | null, input: {
  name: unknown; description?: unknown; category: unknown;
}) {
  assertSubscriptionFeature(spaceId, 'journeyRichCards');
  const name = normalizeText(input.name, journeyRichCardLimits.catalogNameCharacters, 'name', true);
  const description = normalizeText(input.description, journeyRichCardLimits.catalogDescriptionCharacters, 'description');
  if (!journeyChannelCategories.includes(input.category as JourneyChannelCategory)) {
    throw new JourneyRichCardError('Choose a supported channel category.', 400, 'JOURNEY_CHANNEL_CATEGORY_INVALID');
  }
  const duplicate = db.prepare(`SELECT channel.id FROM journey_channels channel JOIN journey_channel_versions version
    ON version.channel_id=channel.id AND version.version_number=channel.current_version_number
    WHERE channel.space_id=? AND channel.status='active' AND lower(version.name)=lower(?)`).get(spaceId, name);
  if (duplicate) throw new JourneyRichCardError('An active channel already uses that name.', 409, 'JOURNEY_CHANNEL_NAME_CONFLICT');
  const id = crypto.randomUUID(); const versionId = crypto.randomUUID(); const createdAt = nowIso();
  return db.transaction(() => {
    lockSpaceForRichCardQuota(spaceId);
    const current = Number((db.prepare("SELECT COUNT(*) count FROM journey_channels WHERE space_id=? AND status='active'")
      .get(spaceId) as any)?.count || 0);
    assertSubscriptionQuota(spaceId, 'journeyChannels', current);
    const lockedDuplicate = db.prepare(`SELECT channel.id FROM journey_channels channel JOIN journey_channel_versions version
      ON version.channel_id=channel.id AND version.version_number=channel.current_version_number
      WHERE channel.space_id=? AND channel.status='active' AND lower(version.name)=lower(?)`).get(spaceId, name);
    if (lockedDuplicate) throw new JourneyRichCardError('An active channel already uses that name.', 409,
      'JOURNEY_CHANNEL_NAME_CONFLICT');
    db.prepare(`INSERT INTO journey_channels
      (id,space_id,status,current_version_number,revision,created_by_user_id,created_at,updated_at)
      VALUES (?,?,'active',1,1,?,?,?)`).run(id, spaceId, actorUserId, createdAt, createdAt);
    db.prepare(`INSERT INTO journey_channel_versions
      (id,channel_id,space_id,version_number,name,description,category,created_by_user_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      versionId, id, spaceId, 1, name, description, input.category, actorUserId, createdAt
    );
    const result = channelView(currentChannelRow(spaceId, id));
    audit({ spaceId, actorUserId, action: 'channel.created', targetType: 'channel', targetId: id,
      after: result, detail: { versionId, versionNumber: 1, category: input.category } });
    return result;
  })();
}

export function updateJourneyChannel(spaceId: string, actorUserId: string | null, channelId: string,
  expectedRevision: number, input: { name?: unknown; description?: unknown; category?: unknown }) {
  assertSubscriptionFeature(spaceId, 'journeyRichCards');
  const current = currentChannelRow(spaceId, channelId);
  if (!current) throw new JourneyRichCardError('Journey channel not found.', 404, 'JOURNEY_CHANNEL_NOT_FOUND');
  if (current.status !== 'active') throw new JourneyRichCardError('Retired channels cannot be edited.', 409, 'JOURNEY_CHANNEL_RETIRED');
  if (Number(current.revision) !== expectedRevision) {
    throw new JourneyRichCardError('This channel changed since it was opened.', 409,
      'JOURNEY_CHANNEL_REVISION_CONFLICT', { expectedRevision });
  }
  const name = input.name === undefined ? current.name
    : normalizeText(input.name, journeyRichCardLimits.catalogNameCharacters, 'name', true);
  const description = input.description === undefined ? current.description
    : normalizeText(input.description, journeyRichCardLimits.catalogDescriptionCharacters, 'description');
  const category = input.category === undefined ? current.category : input.category;
  if (!journeyChannelCategories.includes(category as JourneyChannelCategory)) {
    throw new JourneyRichCardError('Choose a supported channel category.', 400, 'JOURNEY_CHANNEL_CATEGORY_INVALID');
  }
  const duplicate = db.prepare(`SELECT channel.id FROM journey_channels channel JOIN journey_channel_versions version
    ON version.channel_id=channel.id AND version.version_number=channel.current_version_number
    WHERE channel.space_id=? AND channel.status='active' AND channel.id<>? AND lower(version.name)=lower(?)`)
    .get(spaceId, channelId, name);
  if (duplicate) throw new JourneyRichCardError('An active channel already uses that name.', 409, 'JOURNEY_CHANNEL_NAME_CONFLICT');
  return db.transaction(() => {
    const nextVersionNumber = Number(current.version_number) + 1;
    const versionId = crypto.randomUUID(); const updatedAt = nowIso();
    const changed = db.prepare(`UPDATE journey_channels SET current_version_number=?,revision=revision+1,updated_at=?
      WHERE id=? AND space_id=? AND revision=?`).run(
      nextVersionNumber, updatedAt, channelId, spaceId, expectedRevision
    ).changes;
    if (changed !== 1) throw new JourneyRichCardError('This channel changed since it was opened.', 409,
      'JOURNEY_CHANNEL_REVISION_CONFLICT', { expectedRevision });
    db.prepare(`INSERT INTO journey_channel_versions
      (id,channel_id,space_id,version_number,name,description,category,created_by_user_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      versionId, channelId, spaceId, nextVersionNumber, name, description, category, actorUserId, updatedAt
    );
    const result = channelView(currentChannelRow(spaceId, channelId));
    audit({ spaceId, actorUserId, action: 'channel.version_created', targetType: 'channel', targetId: channelId,
      before: channelView(current), after: result, detail: { versionId, versionNumber: nextVersionNumber } });
    return result;
  })();
}

export function retireJourneyChannel(spaceId: string, actorUserId: string | null, channelId: string,
  expectedRevision: number) {
  assertSubscriptionFeature(spaceId, 'journeyRichCards');
  const current = currentChannelRow(spaceId, channelId);
  if (!current) throw new JourneyRichCardError('Journey channel not found.', 404, 'JOURNEY_CHANNEL_NOT_FOUND');
  const activeTouchpoint = db.prepare(`SELECT touchpoint.id FROM journey_touchpoints touchpoint
    JOIN journey_touchpoint_versions version ON version.touchpoint_id=touchpoint.id
      AND version.version_number=touchpoint.current_version_number AND version.space_id=touchpoint.space_id
    WHERE touchpoint.space_id=? AND touchpoint.status='active' AND version.channel_id=? LIMIT 1`)
    .get(spaceId, channelId);
  if (activeTouchpoint) {
    throw new JourneyRichCardError('Retire or move active touchpoints before retiring this channel.', 409,
      'JOURNEY_CHANNEL_IN_USE');
  }
  return db.transaction(() => {
    const changed = db.prepare(`UPDATE journey_channels SET status='retired',revision=revision+1,updated_at=?
      WHERE id=? AND space_id=? AND revision=? AND status='active'`).run(
      nowIso(), channelId, spaceId, expectedRevision
    ).changes;
    if (changed !== 1) throw new JourneyRichCardError('This channel changed since it was opened.', 409,
      'JOURNEY_CHANNEL_REVISION_CONFLICT', { expectedRevision });
    const result = channelView(currentChannelRow(spaceId, channelId));
    audit({ spaceId, actorUserId, action: 'channel.retired', targetType: 'channel', targetId: channelId,
      before: channelView(current), after: result });
    return result;
  })();
}

export function listJourneyTouchpoints(spaceId: string, includeRetired = false) {
  assertSubscriptionFeature(spaceId, 'journeyRichCards');
  const rows = db.prepare(`SELECT touchpoint.*,version.id version_id,version.version_number,version.name,version.description,
      version.channel_id,version.channel_version_id,channel.name channel_name,channel.category channel_category,
      channel.version_number channel_version_number
    FROM journey_touchpoints touchpoint JOIN journey_touchpoint_versions version
      ON version.touchpoint_id=touchpoint.id AND version.space_id=touchpoint.space_id
      AND version.version_number=touchpoint.current_version_number
    JOIN journey_channel_versions channel
      ON channel.id=version.channel_version_id AND channel.channel_id=version.channel_id AND channel.space_id=version.space_id
    WHERE touchpoint.space_id=? ${includeRetired ? '' : "AND touchpoint.status='active'"}
    ORDER BY lower(version.name),touchpoint.id`).all(spaceId) as any[];
  return rows.map(touchpointView);
}

export function createJourneyTouchpoint(spaceId: string, actorUserId: string | null, input: {
  name: unknown; description?: unknown; channelId: string;
}) {
  assertSubscriptionFeature(spaceId, 'journeyRichCards');
  const name = normalizeText(input.name, journeyRichCardLimits.catalogNameCharacters, 'name', true);
  const description = normalizeText(input.description, journeyRichCardLimits.catalogDescriptionCharacters, 'description');
  const channel = currentChannelRow(spaceId, input.channelId);
  if (!channel || channel.status !== 'active') {
    throw new JourneyRichCardError('Choose an active channel in this space.', 422, 'JOURNEY_TOUCHPOINT_CHANNEL_INVALID');
  }
  const duplicate = db.prepare(`SELECT touchpoint.id FROM journey_touchpoints touchpoint
    JOIN journey_touchpoint_versions version ON version.touchpoint_id=touchpoint.id
      AND version.version_number=touchpoint.current_version_number
    WHERE touchpoint.space_id=? AND touchpoint.status='active' AND lower(version.name)=lower(?)`).get(spaceId, name);
  if (duplicate) throw new JourneyRichCardError('An active touchpoint already uses that name.', 409,
    'JOURNEY_TOUCHPOINT_NAME_CONFLICT');
  const id = crypto.randomUUID(); const versionId = crypto.randomUUID(); const createdAt = nowIso();
  return db.transaction(() => {
    lockSpaceForRichCardQuota(spaceId);
    const count = Number((db.prepare("SELECT COUNT(*) count FROM journey_touchpoints WHERE space_id=? AND status='active'")
      .get(spaceId) as any)?.count || 0);
    assertSubscriptionQuota(spaceId, 'journeyTouchpoints', count);
    const lockedDuplicate = db.prepare(`SELECT touchpoint.id FROM journey_touchpoints touchpoint
      JOIN journey_touchpoint_versions version ON version.touchpoint_id=touchpoint.id
        AND version.version_number=touchpoint.current_version_number
      WHERE touchpoint.space_id=? AND touchpoint.status='active' AND lower(version.name)=lower(?)`).get(spaceId, name);
    if (lockedDuplicate) throw new JourneyRichCardError('An active touchpoint already uses that name.', 409,
      'JOURNEY_TOUCHPOINT_NAME_CONFLICT');
    db.prepare(`INSERT INTO journey_touchpoints
      (id,space_id,status,current_version_number,revision,created_by_user_id,created_at,updated_at)
      VALUES (?,?,'active',1,1,?,?,?)`).run(id, spaceId, actorUserId, createdAt, createdAt);
    db.prepare(`INSERT INTO journey_touchpoint_versions
      (id,touchpoint_id,space_id,version_number,name,description,channel_id,channel_version_id,created_by_user_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      versionId, id, spaceId, 1, name, description, channel.id, channel.version_id, actorUserId, createdAt
    );
    const result = touchpointView(currentTouchpointRow(spaceId, id));
    audit({ spaceId, actorUserId, action: 'touchpoint.created', targetType: 'touchpoint', targetId: id,
      after: result, detail: { versionId, versionNumber: 1, channelId: channel.id, channelVersionId: channel.version_id } });
    return result;
  })();
}

export function updateJourneyTouchpoint(spaceId: string, actorUserId: string | null, touchpointId: string,
  expectedRevision: number, input: { name?: unknown; description?: unknown; channelId?: string }) {
  assertSubscriptionFeature(spaceId, 'journeyRichCards');
  const current = currentTouchpointRow(spaceId, touchpointId);
  if (!current) throw new JourneyRichCardError('Journey touchpoint not found.', 404, 'JOURNEY_TOUCHPOINT_NOT_FOUND');
  if (current.status !== 'active') throw new JourneyRichCardError('Retired touchpoints cannot be edited.', 409,
    'JOURNEY_TOUCHPOINT_RETIRED');
  if (Number(current.revision) !== expectedRevision) {
    throw new JourneyRichCardError('This touchpoint changed since it was opened.', 409,
      'JOURNEY_TOUCHPOINT_REVISION_CONFLICT', { expectedRevision });
  }
  const name = input.name === undefined ? current.name
    : normalizeText(input.name, journeyRichCardLimits.catalogNameCharacters, 'name', true);
  const description = input.description === undefined ? current.description
    : normalizeText(input.description, journeyRichCardLimits.catalogDescriptionCharacters, 'description');
  const channel = currentChannelRow(spaceId, input.channelId || current.channel_id);
  if (!channel || channel.status !== 'active') {
    throw new JourneyRichCardError('Choose an active channel in this space.', 422, 'JOURNEY_TOUCHPOINT_CHANNEL_INVALID');
  }
  const duplicate = db.prepare(`SELECT touchpoint.id FROM journey_touchpoints touchpoint
    JOIN journey_touchpoint_versions version ON version.touchpoint_id=touchpoint.id
      AND version.version_number=touchpoint.current_version_number
    WHERE touchpoint.space_id=? AND touchpoint.status='active' AND touchpoint.id<>? AND lower(version.name)=lower(?)`)
    .get(spaceId, touchpointId, name);
  if (duplicate) throw new JourneyRichCardError('An active touchpoint already uses that name.', 409,
    'JOURNEY_TOUCHPOINT_NAME_CONFLICT');
  return db.transaction(() => {
    const nextVersionNumber = Number(current.version_number) + 1;
    const versionId = crypto.randomUUID(); const updatedAt = nowIso();
    const changed = db.prepare(`UPDATE journey_touchpoints SET current_version_number=?,revision=revision+1,updated_at=?
      WHERE id=? AND space_id=? AND revision=?`).run(
      nextVersionNumber, updatedAt, touchpointId, spaceId, expectedRevision
    ).changes;
    if (changed !== 1) throw new JourneyRichCardError('This touchpoint changed since it was opened.', 409,
      'JOURNEY_TOUCHPOINT_REVISION_CONFLICT', { expectedRevision });
    db.prepare(`INSERT INTO journey_touchpoint_versions
      (id,touchpoint_id,space_id,version_number,name,description,channel_id,channel_version_id,created_by_user_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      versionId, touchpointId, spaceId, nextVersionNumber, name, description,
      channel.id, channel.version_id, actorUserId, updatedAt
    );
    const result = touchpointView(currentTouchpointRow(spaceId, touchpointId));
    audit({ spaceId, actorUserId, action: 'touchpoint.version_created', targetType: 'touchpoint', targetId: touchpointId,
      before: touchpointView(current), after: result,
      detail: { versionId, versionNumber: nextVersionNumber, channelId: channel.id, channelVersionId: channel.version_id } });
    return result;
  })();
}

export function retireJourneyTouchpoint(spaceId: string, actorUserId: string | null, touchpointId: string,
  expectedRevision: number) {
  assertSubscriptionFeature(spaceId, 'journeyRichCards');
  const current = currentTouchpointRow(spaceId, touchpointId);
  if (!current) throw new JourneyRichCardError('Journey touchpoint not found.', 404, 'JOURNEY_TOUCHPOINT_NOT_FOUND');
  return db.transaction(() => {
    const changed = db.prepare(`UPDATE journey_touchpoints SET status='retired',revision=revision+1,updated_at=?
      WHERE id=? AND space_id=? AND revision=? AND status='active'`).run(
      nowIso(), touchpointId, spaceId, expectedRevision
    ).changes;
    if (changed !== 1) throw new JourneyRichCardError('This touchpoint changed since it was opened.', 409,
      'JOURNEY_TOUCHPOINT_REVISION_CONFLICT', { expectedRevision });
    const result = touchpointView(currentTouchpointRow(spaceId, touchpointId));
    audit({ spaceId, actorUserId, action: 'touchpoint.retired', targetType: 'touchpoint', targetId: touchpointId,
      before: touchpointView(current), after: result });
    return result;
  })();
}

function detailRow(spaceId: string, cardId: string) {
  return db.prepare('SELECT * FROM journey_card_details WHERE card_id=? AND space_id=?').get(cardId, spaceId) as any;
}

function touchpointsForCard(spaceId: string, cardId: string): JourneyTouchpointSnapshot[] {
  const rows = db.prepare(`SELECT stable.id,stable.space_id,stable.status,stable.revision,stable.created_at,stable.updated_at,
      version.id version_id,version.version_number,version.name,version.description,version.channel_id,version.channel_version_id,
      channel.name channel_name,channel.category channel_category,channel.version_number channel_version_number
    FROM journey_card_touchpoints link
    JOIN journey_touchpoints stable ON stable.id=link.touchpoint_id AND stable.space_id=link.space_id
    JOIN journey_touchpoint_versions version
      ON version.id=link.touchpoint_version_id AND version.touchpoint_id=link.touchpoint_id AND version.space_id=link.space_id
    JOIN journey_channel_versions channel
      ON channel.id=version.channel_version_id AND channel.channel_id=version.channel_id AND channel.space_id=version.space_id
    WHERE link.card_id=? AND link.space_id=? ORDER BY link.ordinal,link.id`).all(cardId, spaceId) as any[];
  return rows.map(touchpointView);
}

function assetView(row: any): JourneyCardAsset {
  return {
    id: row.id, cardId: row.card_id, kind: row.kind, sourceKind: row.source_kind,
    displayName: row.display_name, mimeType: row.mime_type, byteSize: Number(row.byte_size),
    sha256: row.sha256 || null, altText: row.alt_text, caption: row.caption,
    externalUrl: row.state === 'active' ? (row.source_external_url || null) : null,
    contentUrl: row.state === 'active' && row.source_kind === 'upload'
      ? `/api/journey-rich-cards/assets/${encodeURIComponent(row.id)}/content` : null,
    ordinal: Number(row.ordinal), state: row.state, deletedAt: row.deleted_at || null,
    retentionExpiresAt: row.retention_expires_at || null, createdAt: row.created_at
  };
}

function assetsForCard(spaceId: string, cardId: string, includeDeleted = false) {
  return (db.prepare(`SELECT * FROM journey_card_assets WHERE card_id=? AND space_id=?
    ${includeDeleted ? '' : "AND state='active'"} ORDER BY ordinal,id`).all(cardId, spaceId) as any[]).map(assetView);
}

function detailView(spaceId: string, cardId: string, includeDeletedAssets = false): JourneyCardRichDetail {
  const row = detailRow(spaceId, cardId);
  const richText = row
    ? normalizeJourneyRichText(parseJson(row.rich_text_json, { version: 1, blocks: [] }))
    : { version: 1 as const, blocks: [] };
  return {
    cardId,
    revision: row ? Number(row.revision) : 0,
    richText,
    plainText: row ? row.plain_text : '',
    emotion: row && row.emotion_valence !== null ? {
      valence: Number(row.emotion_valence), intensity: Number(row.emotion_intensity), label: row.emotion_label
    } : null,
    touchpoints: touchpointsForCard(spaceId, cardId),
    assets: assetsForCard(spaceId, cardId, includeDeletedAssets),
    updatedAt: row?.updated_at || null
  };
}

export function getJourneyCardRichDetail(spaceId: string, definitionId: string, cardId: string,
  includeDeletedAssets = false) {
  assertSubscriptionFeature(spaceId, 'journeyRichCards');
  requireCard({ spaceId, definitionId, cardId });
  return detailView(spaceId, cardId, includeDeletedAssets);
}

export function updateJourneyCardRichDetail(spaceId: string, actorUserId: string | null,
  definitionId: string, cardId: string, input: {
    expectedRevision: number;
    expectedDetailRevision: number;
    richText: unknown;
    emotion?: unknown;
  }) {
  assertSubscriptionFeature(spaceId, 'journeyRichCards');
  const card = requireCard({ spaceId, definitionId, cardId, mutable: true });
  const richText = normalizeJourneyRichText(input.richText);
  const plainText = richTextPlainText(richText);
  const emotion = normalizeJourneyEmotion(input.emotion);
  if (emotion && card.kind !== 'emotion') {
    throw new JourneyRichCardError('Emotional curve values can only be stored on emotion cards.', 422,
      'JOURNEY_EMOTION_CARD_KIND');
  }
  const current = detailRow(spaceId, cardId);
  const actualDetailRevision = current ? Number(current.revision) : 0;
  if (actualDetailRevision !== input.expectedDetailRevision) {
    throw new JourneyRichCardError('This card detail changed since it was opened.', 409,
      'JOURNEY_CARD_DETAIL_REVISION_CONFLICT', { expectedDetailRevision: input.expectedDetailRevision, actualDetailRevision });
  }
  return db.transaction(() => {
    bumpDefinition(spaceId, definitionId, input.expectedRevision);
    const timestamp = nowIso();
    if (current) {
      const changed = db.prepare(`UPDATE journey_card_details
        SET rich_text_json=?,plain_text=?,emotion_valence=?,emotion_intensity=?,emotion_label=?,
          revision=revision+1,updated_by_user_id=?,updated_at=?
        WHERE card_id=? AND version_id=? AND space_id=? AND revision=?`).run(
        JSON.stringify(richText), plainText, emotion?.valence ?? null, emotion?.intensity ?? null,
        emotion?.label || '', actorUserId, timestamp, cardId, card.version_id, spaceId, input.expectedDetailRevision
      ).changes;
      if (changed !== 1) throw new JourneyRichCardError('This card detail changed since it was opened.', 409,
        'JOURNEY_CARD_DETAIL_REVISION_CONFLICT');
    } else {
      db.prepare(`INSERT INTO journey_card_details
        (card_id,version_id,space_id,schema_version,rich_text_json,plain_text,emotion_valence,emotion_intensity,
          emotion_label,revision,updated_by_user_id,created_at,updated_at)
        VALUES (?,?,?,1,?,?,?,?,?,1,?,?,?)`).run(
        cardId, card.version_id, spaceId, JSON.stringify(richText), plainText,
        emotion?.valence ?? null, emotion?.intensity ?? null, emotion?.label || '', actorUserId, timestamp, timestamp
      );
    }
    const result = detailView(spaceId, cardId);
    audit({ spaceId, actorUserId, action: 'card.detail_updated', targetType: 'card', targetId: cardId,
      definitionId, versionId: card.version_id,
      before: current ? { richText: parseJson(current.rich_text_json, {}), emotionValence: current.emotion_valence,
        emotionIntensity: current.emotion_intensity, emotionLabel: current.emotion_label } : null,
      after: { richText, emotion }, detail: { detailRevision: result.revision, hasEmotion: Boolean(emotion) } });
    return result;
  })();
}

export function linkJourneyCardTouchpoint(spaceId: string, actorUserId: string | null,
  definitionId: string, cardId: string, input: { expectedRevision: number; touchpointId: string }) {
  assertSubscriptionFeature(spaceId, 'journeyRichCards');
  const card = requireCard({ spaceId, definitionId, cardId, mutable: true });
  const touchpoint = currentTouchpointRow(spaceId, input.touchpointId);
  if (!touchpoint || touchpoint.status !== 'active') {
    throw new JourneyRichCardError('Choose an active touchpoint in this space.', 422,
      'JOURNEY_CARD_TOUCHPOINT_INVALID');
  }
  return db.transaction(() => {
    const existing = db.prepare(`SELECT id FROM journey_card_touchpoints
      WHERE card_id=? AND space_id=? AND touchpoint_id=?`).get(cardId, spaceId, touchpoint.id);
    if (existing) throw new JourneyRichCardError('This touchpoint is already linked to the card.', 409,
      'JOURNEY_CARD_TOUCHPOINT_DUPLICATE');
    const ordinal = Number((db.prepare('SELECT COUNT(*) count FROM journey_card_touchpoints WHERE card_id=? AND space_id=?')
      .get(cardId, spaceId) as any)?.count || 0);
    if (ordinal >= journeyRichCardLimits.touchpointsPerCard) {
      throw new JourneyRichCardError('This card has reached its touchpoint limit.', 409,
        'JOURNEY_CARD_TOUCHPOINT_LIMIT', { maximum: journeyRichCardLimits.touchpointsPerCard });
    }
    bumpDefinition(spaceId, definitionId, input.expectedRevision);
    const id = crypto.randomUUID(); const createdAt = nowIso();
    db.prepare(`INSERT INTO journey_card_touchpoints
      (id,card_id,version_id,space_id,touchpoint_id,touchpoint_version_id,ordinal,created_by_user_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      id, cardId, card.version_id, spaceId, touchpoint.id, touchpoint.version_id, ordinal, actorUserId, createdAt
    );
    audit({ spaceId, actorUserId, action: 'card.touchpoint_linked', targetType: 'card', targetId: cardId,
      definitionId, versionId: card.version_id, after: { touchpointId: touchpoint.id, versionId: touchpoint.version_id },
      detail: { linkId: id, touchpointId: touchpoint.id, touchpointVersionId: touchpoint.version_id } });
    return detailView(spaceId, cardId);
  })();
}

export function unlinkJourneyCardTouchpoint(spaceId: string, actorUserId: string | null,
  definitionId: string, cardId: string, touchpointId: string, expectedRevision: number) {
  assertSubscriptionFeature(spaceId, 'journeyRichCards');
  const card = requireCard({ spaceId, definitionId, cardId, mutable: true });
  return db.transaction(() => {
    const link = db.prepare(`SELECT * FROM journey_card_touchpoints
      WHERE card_id=? AND space_id=? AND touchpoint_id=?`).get(cardId, spaceId, touchpointId) as any;
    if (!link) throw new JourneyRichCardError('Card touchpoint link not found.', 404,
      'JOURNEY_CARD_TOUCHPOINT_NOT_FOUND');
    bumpDefinition(spaceId, definitionId, expectedRevision);
    db.prepare('DELETE FROM journey_card_touchpoints WHERE id=? AND card_id=? AND space_id=?')
      .run(link.id, cardId, spaceId);
    const remaining = db.prepare(`SELECT id FROM journey_card_touchpoints
      WHERE card_id=? AND space_id=? ORDER BY ordinal,id`).all(cardId, spaceId) as any[];
    const reorder = db.prepare('UPDATE journey_card_touchpoints SET ordinal=? WHERE id=? AND card_id=? AND space_id=?');
    remaining.forEach((row, ordinal) => reorder.run(ordinal, row.id, cardId, spaceId));
    audit({ spaceId, actorUserId, action: 'card.touchpoint_unlinked', targetType: 'card', targetId: cardId,
      definitionId, versionId: card.version_id,
      before: { touchpointId: link.touchpoint_id, versionId: link.touchpoint_version_id },
      detail: { linkId: link.id, touchpointId: link.touchpoint_id, touchpointVersionId: link.touchpoint_version_id } });
    return detailView(spaceId, cardId);
  })();
}

const imageMimes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const attachmentMimes = new Set([...imageMimes, 'application/pdf']);

function uploadPath(row: any) {
  const root = path.resolve(config.uploadDir);
  const resolved = path.resolve(root, String(row.stored_filename || ''));
  if (!resolved.toLowerCase().startsWith(`${root}${path.sep}`.toLowerCase())) {
    throw new JourneyRichCardError('Upload storage reference is invalid.', 410, 'JOURNEY_ASSET_UNAVAILABLE');
  }
  return resolved;
}

function assertAssetSignature(bytes: Buffer, mimeType: string) {
  const valid = mimeType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mimeType === 'image/jpeg' ? bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
      : mimeType === 'image/gif' ? ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))
        : mimeType === 'image/webp' ? bytes.subarray(0, 4).toString('ascii') === 'RIFF'
          && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
          : mimeType === 'application/pdf' ? bytes.subarray(0, 5).toString('ascii') === '%PDF-'
            : false;
  if (!valid) throw new JourneyRichCardError('The upload signature does not match its declared media type.', 415,
    'JOURNEY_ASSET_SIGNATURE_INVALID');
}

function readGovernedUploadBytes(row: any) {
  try { return fs.readFileSync(uploadPath(row)); }
  catch (error) {
    if (error instanceof JourneyRichCardError) throw error;
    throw new JourneyRichCardError('The source upload is no longer available.', 410, 'JOURNEY_ASSET_UNAVAILABLE');
  }
}

function requireClaimableUpload(spaceId: string, actorUserId: string | null, uploadId: string, canClaimSpaceUploads: boolean) {
  const row = db.prepare(`SELECT * FROM uploads WHERE id=? AND space_id=? AND collector_id IS NULL
    AND response_id IS NULL AND expires_at IS NULL`).get(uploadId, spaceId) as any;
  if (!row || (!canClaimSpaceUploads && row.created_by_user_id !== actorUserId)) {
    throw new JourneyRichCardError('Choose an authenticated upload you are allowed to use in this space.', 404,
      'JOURNEY_ASSET_UPLOAD_NOT_FOUND');
  }
  const bytes = readGovernedUploadBytes(row);
  if (bytes.length !== Number(row.size)) {
    throw new JourneyRichCardError('The uploaded file size no longer matches its stored metadata.', 410,
      'JOURNEY_ASSET_UNAVAILABLE');
  }
  assertAssetSignature(bytes, String(row.mime_type));
  return { row, bytes, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

export function attachJourneyCardAsset(spaceId: string, actorUserId: string | null,
  definitionId: string, cardId: string, input: {
    expectedRevision: number;
    kind: 'image' | 'attachment';
    uploadId?: string;
    externalUrl?: unknown;
    displayName?: unknown;
    mimeType?: unknown;
    altText?: unknown;
    caption?: unknown;
    canClaimSpaceUploads?: boolean;
  }) {
  assertSubscriptionFeature(spaceId, 'journeyRichCards');
  const card = requireCard({ spaceId, definitionId, cardId, mutable: true });
  if (!['image', 'attachment'].includes(input.kind)) {
    throw new JourneyRichCardError('Choose image or attachment.', 400, 'JOURNEY_ASSET_KIND_INVALID');
  }
  if (Boolean(input.uploadId) === Boolean(input.externalUrl)) {
    throw new JourneyRichCardError('Choose exactly one upload or external URL.', 400, 'JOURNEY_ASSET_SOURCE_INVALID');
  }
  const altText = normalizeText(input.altText, journeyRichCardLimits.altTextCharacters, 'altText', input.kind === 'image');
  const caption = normalizeText(input.caption, journeyRichCardLimits.captionCharacters, 'caption');
  let sourceKind: 'upload' | 'external_url';
  let sourceUploadId: string | null = null; let sourceExternalUrl: string | null = null;
  let displayName: string; let mimeType: string; let byteSize = 0; let sha256: string | null = null;
  if (input.uploadId) {
    sourceKind = 'upload';
    const upload = requireClaimableUpload(spaceId, actorUserId, input.uploadId, input.canClaimSpaceUploads === true);
    sourceUploadId = String(upload.row.id);
    displayName = normalizeText(upload.row.original_name, journeyRichCardLimits.assetNameCharacters, 'displayName', true);
    mimeType = String(upload.row.mime_type).toLowerCase();
    byteSize = upload.bytes.length; sha256 = upload.sha256;
    const allowed = input.kind === 'image' ? imageMimes : attachmentMimes;
    const maximum = input.kind === 'image' ? journeyRichCardLimits.imageBytes : journeyRichCardLimits.attachmentBytes;
    if (!allowed.has(mimeType)) throw new JourneyRichCardError('This media type is not allowed for the selected asset kind.', 415,
      'JOURNEY_ASSET_MIME_INVALID', { mimeType });
    if (byteSize > maximum) throw new JourneyRichCardError('The selected asset exceeds its size limit.', 413,
      'JOURNEY_ASSET_TOO_LARGE', { maximum, actual: byteSize });
  } else {
    if (input.kind === 'image') throw new JourneyRichCardError('Images must use protected uploads so they can be verified.', 400,
      'JOURNEY_IMAGE_UPLOAD_REQUIRED');
    sourceKind = 'external_url'; sourceExternalUrl = normalizeExternalJourneyUrl(input.externalUrl);
    displayName = normalizeText(input.displayName, journeyRichCardLimits.assetNameCharacters, 'displayName', true);
    mimeType = normalizeText(input.mimeType, 160, 'mimeType', true).toLowerCase();
    if (!attachmentMimes.has(mimeType)) throw new JourneyRichCardError('External references must declare an allowed media type.', 415,
      'JOURNEY_ASSET_MIME_INVALID', { mimeType });
  }
  return db.transaction(() => {
    lockSpaceForRichCardQuota(spaceId);
    const activeRows = db.prepare("SELECT * FROM journey_card_assets WHERE card_id=? AND space_id=? AND state='active'")
      .all(cardId, spaceId) as any[];
    if (activeRows.length >= journeyRichCardLimits.assetsPerCard) {
      throw new JourneyRichCardError('This card has reached its asset limit.', 409, 'JOURNEY_CARD_ASSET_LIMIT', {
        maximum: journeyRichCardLimits.assetsPerCard
      });
    }
    if (input.kind === 'image' && activeRows.filter((row) => row.kind === 'image').length >= journeyRichCardLimits.imagesPerCard) {
      throw new JourneyRichCardError('This card has reached its image limit.', 409, 'JOURNEY_CARD_IMAGE_LIMIT', {
        maximum: journeyRichCardLimits.imagesPerCard
      });
    }
    const cardBytes = activeRows.reduce((sum, row) => sum + Number(row.byte_size), 0);
    if (cardBytes + byteSize > journeyRichCardLimits.assetBytesPerCard) {
      throw new JourneyRichCardError('This card has reached its total media-size limit.', 409,
        'JOURNEY_CARD_ASSET_BYTES_LIMIT', { current: cardBytes, additional: byteSize,
          maximum: journeyRichCardLimits.assetBytesPerCard });
    }
    const spaceAssets = Number((db.prepare("SELECT COUNT(*) count FROM journey_card_assets WHERE space_id=? AND state='active'")
      .get(spaceId) as any)?.count || 0);
    const spaceBytes = Number((db.prepare("SELECT COALESCE(SUM(byte_size),0) bytes FROM journey_card_assets WHERE space_id=? AND state='active'")
      .get(spaceId) as any)?.bytes || 0);
    assertSubscriptionQuota(spaceId, 'journeyCardAssets', spaceAssets);
    assertSubscriptionQuota(spaceId, 'journeyCardAssetBytes', spaceBytes, byteSize);
    bumpDefinition(spaceId, definitionId, input.expectedRevision);
    const ordinal = activeRows.length; const id = crypto.randomUUID(); const createdAt = nowIso();
    db.prepare(`INSERT INTO journey_card_assets
      (id,card_id,version_id,space_id,kind,source_kind,source_upload_id,source_external_url,display_name,mime_type,
        byte_size,sha256,alt_text,caption,ordinal,state,created_by_user_id,created_at,deleted_at,retention_expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,NULL,NULL)`).run(
      id, cardId, card.version_id, spaceId, input.kind, sourceKind, sourceUploadId, sourceExternalUrl,
      displayName, mimeType, byteSize, sha256, altText, caption, ordinal, actorUserId, createdAt
    );
    const result = assetView(db.prepare('SELECT * FROM journey_card_assets WHERE id=? AND space_id=?').get(id, spaceId));
    audit({ spaceId, actorUserId, action: 'card.asset_attached', targetType: 'asset', targetId: id,
      definitionId, versionId: card.version_id, after: { kind: input.kind, sourceKind, mimeType, byteSize, sha256 },
      detail: { cardId, kind: input.kind, sourceKind, mimeType, byteSize } });
    return { asset: result, detail: detailView(spaceId, cardId) };
  })();
}

export function deleteJourneyCardAsset(spaceId: string, actorUserId: string | null,
  definitionId: string, cardId: string, assetId: string, expectedRevision: number) {
  assertSubscriptionFeature(spaceId, 'journeyRichCards');
  const card = requireCard({ spaceId, definitionId, cardId, mutable: true });
  return db.transaction(() => {
    lockSpaceForRichCardQuota(spaceId);
    const asset = db.prepare(`SELECT * FROM journey_card_assets
      WHERE id=? AND card_id=? AND version_id=? AND space_id=? AND state='active'`)
      .get(assetId, cardId, card.version_id, spaceId) as any;
    if (!asset) throw new JourneyRichCardError('Journey card asset not found.', 404, 'JOURNEY_ASSET_NOT_FOUND');
    bumpDefinition(spaceId, definitionId, expectedRevision);
    const deletedAt = nowIso();
    const retentionExpiresAt = new Date(Date.parse(deletedAt)
      + journeyRichCardLimits.deletedAssetRetentionDays * 86_400_000).toISOString();
    db.prepare(`UPDATE journey_card_assets SET state='deleted',deleted_at=?,retention_expires_at=?
      WHERE id=? AND card_id=? AND space_id=? AND state='active'`).run(
      deletedAt, retentionExpiresAt, assetId, cardId, spaceId
    );
    const active = db.prepare(`SELECT id FROM journey_card_assets WHERE card_id=? AND space_id=? AND state='active'
      ORDER BY ordinal,id`).all(cardId, spaceId) as any[];
    const reorder = db.prepare('UPDATE journey_card_assets SET ordinal=? WHERE id=? AND card_id=? AND space_id=?');
    active.forEach((row, ordinal) => reorder.run(ordinal, row.id, cardId, spaceId));
    audit({ spaceId, actorUserId, action: 'card.asset_deleted', targetType: 'asset', targetId: assetId,
      definitionId, versionId: card.version_id,
      before: { kind: asset.kind, sourceKind: asset.source_kind, mimeType: asset.mime_type,
        byteSize: asset.byte_size, sha256: asset.sha256 },
      after: { state: 'deleted', retentionExpiresAt }, detail: { cardId, retentionExpiresAt } });
    return detailView(spaceId, cardId, true);
  })();
}

export function restoreJourneyCardAsset(spaceId: string, actorUserId: string | null,
  definitionId: string, cardId: string, assetId: string, expectedRevision: number) {
  assertSubscriptionFeature(spaceId, 'journeyRichCards');
  const card = requireCard({ spaceId, definitionId, cardId, mutable: true });
  return db.transaction(() => {
    lockSpaceForRichCardQuota(spaceId);
    const asset = db.prepare(`SELECT * FROM journey_card_assets
      WHERE id=? AND card_id=? AND version_id=? AND space_id=? AND state='deleted'`)
      .get(assetId, cardId, card.version_id, spaceId) as any;
    if (!asset) throw new JourneyRichCardError('Deleted journey card asset not found.', 404, 'JOURNEY_ASSET_NOT_FOUND');
    if (Date.parse(asset.retention_expires_at) <= Date.now()) {
      throw new JourneyRichCardError('This asset has passed its restoration window.', 410, 'JOURNEY_ASSET_RETENTION_EXPIRED');
    }
    const active = db.prepare("SELECT * FROM journey_card_assets WHERE card_id=? AND space_id=? AND state='active'")
      .all(cardId, spaceId) as any[];
    if (active.length >= journeyRichCardLimits.assetsPerCard
      || (asset.kind === 'image' && active.filter((row) => row.kind === 'image').length >= journeyRichCardLimits.imagesPerCard)) {
      throw new JourneyRichCardError('This asset cannot be restored because the card limit is full.', 409,
        'JOURNEY_CARD_ASSET_LIMIT');
    }
    const cardBytes = active.reduce((sum, row) => sum + Number(row.byte_size), 0);
    if (cardBytes + Number(asset.byte_size) > journeyRichCardLimits.assetBytesPerCard) {
      throw new JourneyRichCardError('This asset cannot be restored because the card media-size limit is full.', 409,
        'JOURNEY_CARD_ASSET_BYTES_LIMIT');
    }
    const spaceAssets = Number((db.prepare("SELECT COUNT(*) count FROM journey_card_assets WHERE space_id=? AND state='active'")
      .get(spaceId) as any)?.count || 0);
    const spaceBytes = Number((db.prepare("SELECT COALESCE(SUM(byte_size),0) bytes FROM journey_card_assets WHERE space_id=? AND state='active'")
      .get(spaceId) as any)?.bytes || 0);
    assertSubscriptionQuota(spaceId, 'journeyCardAssets', spaceAssets);
    assertSubscriptionQuota(spaceId, 'journeyCardAssetBytes', spaceBytes, Number(asset.byte_size));
    bumpDefinition(spaceId, definitionId, expectedRevision);
    db.prepare(`UPDATE journey_card_assets SET state='active',ordinal=?,deleted_at=NULL,retention_expires_at=NULL
      WHERE id=? AND card_id=? AND space_id=? AND state='deleted'`).run(active.length, assetId, cardId, spaceId);
    audit({ spaceId, actorUserId, action: 'card.asset_restored', targetType: 'asset', targetId: assetId,
      definitionId, versionId: card.version_id, before: { state: 'deleted' }, after: { state: 'active' },
      detail: { cardId } });
    return detailView(spaceId, cardId, true);
  })();
}

type JourneyBlobPurgeFileRemover = (target: string) => void;

function purgeOutboxPath(storedFilename: string) {
  return uploadPath({ stored_filename: storedFilename });
}

function blobPurgeErrorFingerprint(error: unknown) {
  const message = error instanceof Error ? `${error.name}:${error.message}` : String(error);
  return crypto.createHash('sha256').update(message.slice(0, 2_000)).digest('hex');
}

/**
 * Claims durable blob-purge receipts before touching disk. A crash after the
 * unlink is harmless: the expired lease is reclaimed and `force` removal is
 * idempotent. Unexpected replacement bytes are never deleted.
 */
export function processJourneyAssetBlobPurgeOutbox(input: {
  asOf?: string;
  limit?: number;
  removeFile?: JourneyBlobPurgeFileRemover;
} = {}) {
  const asOf = input.asOf || nowIso();
  const limit = Math.max(1, Math.min(500, Math.trunc(input.limit || 100)));
  const leaseExpiresAt = new Date(Date.parse(asOf) + 5 * 60_000).toISOString();
  const candidates = db.transaction(() => {
    const suffix = db.provider === 'postgres' ? ' FOR UPDATE SKIP LOCKED' : '';
    const rows = db.prepare(`SELECT * FROM journey_asset_blob_purge_outbox
      WHERE ((state IN ('pending','failed') AND next_attempt_at<=?)
        OR (state='processing' AND lease_expires_at<=?))
      ORDER BY next_attempt_at,id LIMIT ?${suffix}`).all(asOf, asOf, limit) as any[];
    const claim = db.prepare(`UPDATE journey_asset_blob_purge_outbox
      SET state='processing',attempt_count=attempt_count+1,lease_expires_at=?,updated_at=?
      WHERE id=? AND ((state IN ('pending','failed') AND next_attempt_at<=?)
        OR (state='processing' AND lease_expires_at<=?))`);
    return rows.filter((row) => claim.run(leaseExpiresAt, asOf, row.id, asOf, asOf).changes === 1)
      .map((row) => ({ ...row, attempt_count: Number(row.attempt_count) + 1 }));
  })();
  const removeFile = input.removeFile || ((target: string) => fs.rmSync(target, { force: true }));
  let completed = 0; let failed = 0; const failedReceiptIds: string[] = [];
  for (const receipt of candidates) {
    try {
      const target = purgeOutboxPath(String(receipt.stored_filename));
      if (fs.existsSync(target)) {
        const bytes = fs.readFileSync(target);
        const actualSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
        if (bytes.length !== Number(receipt.expected_byte_size) || actualSha256 !== receipt.expected_sha256) {
          throw new JourneyRichCardError('Stored upload changed before governed purge.', 409,
            'JOURNEY_ASSET_PURGE_INTEGRITY_FAILED');
        }
        removeFile(target);
      }
      const finishedAt = nowIso();
      completed += db.prepare(`UPDATE journey_asset_blob_purge_outbox
        SET state='completed',completed_at=?,lease_expires_at=NULL,last_error_fingerprint=NULL,updated_at=?
        WHERE id=? AND state='processing'`).run(finishedAt, finishedAt, receipt.id).changes;
    } catch (error) {
      const failedAt = nowIso();
      const delayMinutes = Math.min(24 * 60, 2 ** Math.min(10, Number(receipt.attempt_count)));
      const nextAttemptAt = new Date(Date.parse(failedAt) + delayMinutes * 60_000).toISOString();
      failed += db.prepare(`UPDATE journey_asset_blob_purge_outbox
        SET state='failed',last_error_fingerprint=?,next_attempt_at=?,lease_expires_at=NULL,updated_at=?
        WHERE id=? AND state='processing'`).run(
        blobPurgeErrorFingerprint(error), nextAttemptAt, failedAt, receipt.id
      ).changes;
      failedReceiptIds.push(String(receipt.id));
    }
  }
  return { claimed: candidates.length, completed, failed, failedReceiptIds };
}

export function purgeExpiredJourneyCardAssets(asOf = nowIso(), options: {
  removeFile?: JourneyBlobPurgeFileRemover;
} = {}) {
  const outcome = db.transaction(() => {
    const rows = db.prepare(`SELECT * FROM journey_card_assets
      WHERE state='deleted' AND retention_expires_at<=? ORDER BY retention_expires_at,id LIMIT 500`).all(asOf) as any[];
    if (!rows.length) return { purged: 0, blobsScheduled: 0, blobsRetained: 0 };
    const remove = db.prepare("DELETE FROM journey_card_assets WHERE id=? AND state='deleted' AND retention_expires_at<=?");
    let purged = 0; let blobsScheduled = 0; let blobsRetained = 0;
    for (const row of rows) {
      audit({ spaceId: row.space_id, actorUserId: null, action: 'card.asset_purged', targetType: 'asset', targetId: row.id,
        versionId: row.version_id, before: { state: row.state, kind: row.kind, sourceKind: row.source_kind,
          byteSize: row.byte_size, sha256: row.sha256 }, after: null,
        detail: { cardId: row.card_id, retentionExpiredAt: row.retention_expires_at } });
      purged += remove.run(row.id, asOf).changes;
      if (row.source_kind !== 'upload' || !row.source_upload_id) continue;
      const remaining = db.prepare('SELECT id FROM journey_card_assets WHERE source_upload_id=? AND space_id=? LIMIT 1')
        .get(row.source_upload_id, row.space_id);
      if (remaining) { blobsRetained += 1; continue; }
      const upload = db.prepare(`SELECT * FROM uploads WHERE id=? AND space_id=? AND collector_id IS NULL
        AND response_id IS NULL AND expires_at IS NULL`).get(row.source_upload_id, row.space_id) as any;
      if (!upload) { blobsRetained += 1; continue; }
      const deleted = db.prepare(`DELETE FROM uploads WHERE id=? AND space_id=? AND collector_id IS NULL
        AND response_id IS NULL AND expires_at IS NULL`).run(row.source_upload_id, row.space_id).changes;
      if (deleted === 1) {
        const receiptId = crypto.randomUUID(); const queuedAt = asOf;
        db.prepare(`INSERT INTO journey_asset_blob_purge_outbox
          (id,space_id,source_upload_id,stored_filename,expected_sha256,expected_byte_size,state,attempt_count,
            last_error_fingerprint,next_attempt_at,lease_expires_at,completed_at,created_at,updated_at)
          VALUES (?,?,?,?,?,?,'pending',0,NULL,?,NULL,NULL,?,?)
          ON CONFLICT(source_upload_id,space_id) DO NOTHING`).run(
          receiptId, row.space_id, row.source_upload_id, String(upload.stored_filename), String(row.sha256),
          Number(row.byte_size), queuedAt, queuedAt, queuedAt
        );
        blobsScheduled += 1;
      } else blobsRetained += 1;
    }
    return { purged, blobsScheduled, blobsRetained };
  })();
  const processed = processJourneyAssetBlobPurgeOutbox({ asOf, removeFile: options.removeFile });
  return {
    ...outcome,
    blobsPurged: processed.completed,
    blobFileErrors: processed.failedReceiptIds,
    purgeReceiptsClaimed: processed.claimed,
    purgeReceiptsFailed: processed.failed
  };
}

export function getJourneyCardAssetContent(spaceId: string, assetId: string) {
  assertSubscriptionFeature(spaceId, 'journeyRichCards');
  const asset = db.prepare(`SELECT asset.*,version.definition_id FROM journey_card_assets asset
    JOIN journey_map_versions version ON version.id=asset.version_id AND version.space_id=asset.space_id
    WHERE asset.id=? AND asset.space_id=? AND asset.state='active' AND asset.source_kind='upload'`)
    .get(assetId, spaceId) as any;
  if (!asset) throw new JourneyRichCardError('Journey card asset not found.', 404, 'JOURNEY_ASSET_NOT_FOUND');
  const upload = db.prepare('SELECT * FROM uploads WHERE id=? AND space_id=?').get(asset.source_upload_id, spaceId) as any;
  if (!upload) throw new JourneyRichCardError('The source upload is no longer available.', 410, 'JOURNEY_ASSET_UNAVAILABLE');
  const bytes = readGovernedUploadBytes(upload);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== Number(asset.byte_size) || sha256 !== asset.sha256) {
    throw new JourneyRichCardError('The source upload no longer matches the governed asset.', 410,
      'JOURNEY_ASSET_INTEGRITY_FAILED');
  }
  assertAssetSignature(bytes, asset.mime_type);
  return {
    bytes, mimeType: asset.mime_type, displayName: asset.display_name, sha256,
    definitionId: asset.definition_id, cardId: asset.card_id
  };
}

export function getJourneyRichMapSnapshot(spaceId: string, definitionId: string, versionId?: string): JourneyRichMapSnapshot {
  assertSubscriptionFeature(spaceId, 'journeyRichCards');
  const definition = db.prepare('SELECT * FROM journey_definitions WHERE id=? AND space_id=?').get(definitionId, spaceId) as any;
  if (!definition) throw new JourneyRichCardError('Journey map not found.', 404, 'JOURNEY_MAP_NOT_FOUND');
  const selectedVersionId = versionId || definition.current_version_id;
  const version = db.prepare('SELECT * FROM journey_map_versions WHERE id=? AND definition_id=? AND space_id=?')
    .get(selectedVersionId, definitionId, spaceId) as any;
  if (!version) throw new JourneyRichCardError('Journey version not found.', 404, 'JOURNEY_MAP_VERSION_NOT_FOUND');
  const cards = db.prepare(`SELECT id,stage_key,lane_type,kind,ordinal FROM journey_map_cards
    WHERE version_id=? AND space_id=? ORDER BY stage_key,lane_type,ordinal,id`).all(version.id, spaceId) as any[];
  const details = cards.map((card) => detailView(spaceId, card.id));
  const stages = db.prepare(`SELECT stage_key,name,ordinal FROM journey_map_stages
    WHERE version_id=? AND space_id=? ORDER BY ordinal,id`).all(version.id, spaceId) as any[];
  const stageByKey = new Map(stages.map((stage) => [stage.stage_key, stage]));
  const emotionalCurve = cards.flatMap((card) => {
    const detail = details.find((item) => item.cardId === card.id)!;
    if (card.kind !== 'emotion' || !detail.emotion) return [];
    const stage = stageByKey.get(card.stage_key);
    return [{
      cardId: card.id, stageKey: card.stage_key, stageName: stage?.name || card.stage_key,
      stageOrdinal: Number(stage?.ordinal ?? 0), cardOrdinal: Number(card.ordinal),
      ...detail.emotion
    }];
  }).sort((left, right) => left.stageOrdinal - right.stageOrdinal || left.cardOrdinal - right.cardOrdinal
    || left.cardId.localeCompare(right.cardId));
  return {
    definitionId, versionId: version.id, cards: details, emotionalCurve,
    catalog: { channels: listJourneyChannels(spaceId), touchpoints: listJourneyTouchpoints(spaceId) },
    limits: journeyRichCardLimits
  };
}

/** Copy only active, visible relationships into the next working draft. The
 * source rows remain attached to the immutable published cards, while pinned
 * catalogue version identifiers ensure later channel/touchpoint edits cannot
 * rewrite history. The caller supplies the exact old-to-new card mapping from
 * the same publication transaction. */
export function cloneJourneyRichCardsForPublishedDraft(input: {
  spaceId: string;
  sourceVersionId: string;
  nextVersionId: string;
  cardIds: ReadonlyMap<string, string>;
  actorUserId: string | null;
}) {
  const insertDetail = db.prepare(`INSERT INTO journey_card_details
    (card_id,version_id,space_id,schema_version,rich_text_json,plain_text,emotion_valence,emotion_intensity,
      emotion_label,revision,updated_by_user_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertTouchpoint = db.prepare(`INSERT INTO journey_card_touchpoints
    (id,card_id,version_id,space_id,touchpoint_id,touchpoint_version_id,ordinal,created_by_user_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  const insertAsset = db.prepare(`INSERT INTO journey_card_assets
    (id,card_id,version_id,space_id,kind,source_kind,source_upload_id,source_external_url,display_name,mime_type,
      byte_size,sha256,alt_text,caption,ordinal,state,created_by_user_id,created_at,deleted_at,retention_expires_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,NULL,NULL)`);
  const timestamp = nowIso(); let details = 0; let touchpoints = 0; let assets = 0;
  for (const [sourceCardId, nextCardId] of input.cardIds.entries()) {
    const detail = db.prepare(`SELECT * FROM journey_card_details
      WHERE card_id=? AND version_id=? AND space_id=?`).get(sourceCardId, input.sourceVersionId, input.spaceId) as any;
    if (detail) {
      insertDetail.run(nextCardId, input.nextVersionId, input.spaceId, detail.schema_version,
        detail.rich_text_json, detail.plain_text, detail.emotion_valence, detail.emotion_intensity,
        detail.emotion_label, 1, input.actorUserId, timestamp, timestamp);
      details += 1;
    }
    const links = db.prepare(`SELECT * FROM journey_card_touchpoints
      WHERE card_id=? AND version_id=? AND space_id=? ORDER BY ordinal,id`)
      .all(sourceCardId, input.sourceVersionId, input.spaceId) as any[];
    for (const link of links) {
      insertTouchpoint.run(crypto.randomUUID(), nextCardId, input.nextVersionId, input.spaceId,
        link.touchpoint_id, link.touchpoint_version_id, link.ordinal, input.actorUserId, timestamp);
      touchpoints += 1;
    }
    const cardAssets = db.prepare(`SELECT * FROM journey_card_assets
      WHERE card_id=? AND version_id=? AND space_id=? AND state='active' ORDER BY ordinal,id`)
      .all(sourceCardId, input.sourceVersionId, input.spaceId) as any[];
    for (const asset of cardAssets) {
      insertAsset.run(crypto.randomUUID(), nextCardId, input.nextVersionId, input.spaceId,
        asset.kind, asset.source_kind, asset.source_upload_id, asset.source_external_url,
        asset.display_name, asset.mime_type, asset.byte_size, asset.sha256, asset.alt_text, asset.caption,
        asset.ordinal, input.actorUserId, timestamp);
      assets += 1;
    }
  }
  return { details, touchpoints, assets };
}

export function listJourneyRichCardAudit(spaceId: string, limit = 100, offset = 0) {
  assertSubscriptionFeature(spaceId, 'journeyRichCards');
  const safeLimit = Math.min(200, Math.max(1, Math.floor(limit)));
  const safeOffset = Math.max(0, Math.floor(offset));
  return (db.prepare(`SELECT id,actor_user_id,action,target_type,target_id,definition_id,version_id,
      before_fingerprint,after_fingerprint,detail_json,created_at
    FROM journey_rich_card_audit_events WHERE space_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`)
    .all(spaceId, safeLimit, safeOffset) as any[]).map((row) => ({
    id: row.id, actorUserId: row.actor_user_id || null, action: row.action,
    targetType: row.target_type, targetId: row.target_id, definitionId: row.definition_id || null,
    versionId: row.version_id || null, beforeFingerprint: row.before_fingerprint || null,
    afterFingerprint: row.after_fingerprint || null, detail: parseJson(row.detail_json, {}), createdAt: row.created_at
  }));
}

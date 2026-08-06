import { api, json, multipart } from '@/lib/api';

export type JourneyChannelCategory =
  | 'web' | 'mobile_app' | 'email' | 'social' | 'phone' | 'in_person' | 'chat'
  | 'messaging' | 'self_service' | 'partner' | 'other';
export type JourneyRichTextBlockType = 'paragraph' | 'heading' | 'bullet' | 'ordered' | 'quote';
export type JourneyRichTextMarkType = 'bold' | 'italic' | 'code' | 'link';

export interface JourneyRichTextMark {
  type: JourneyRichTextMarkType;
  start: number;
  end: number;
  href?: string;
}

export interface JourneyRichTextBlock {
  type: JourneyRichTextBlockType;
  text: string;
  marks: JourneyRichTextMark[];
}

export interface JourneyRichTextDocument {
  version: 1;
  blocks: JourneyRichTextBlock[];
}

export interface JourneyEmotionPoint { valence: number; intensity: number; label: string }

export interface JourneyChannelSnapshot {
  id: string; spaceId: string; status: 'active' | 'retired'; revision: number;
  versionId: string; versionNumber: number; name: string; description: string;
  category: JourneyChannelCategory; createdAt: string; updatedAt: string;
}

export interface JourneyTouchpointSnapshot {
  id: string; spaceId: string; status: 'active' | 'retired'; revision: number;
  versionId: string; versionNumber: number; name: string; description: string;
  channel: { id: string; versionId: string; versionNumber: number; name: string; category: JourneyChannelCategory };
  createdAt: string; updatedAt: string;
}

export interface JourneyCardAsset {
  id: string; cardId: string; kind: 'image' | 'attachment'; sourceKind: 'upload' | 'external_url';
  displayName: string; mimeType: string; byteSize: number; sha256: string | null;
  altText: string; caption: string; externalUrl: string | null; contentUrl: string | null;
  ordinal: number; state: 'active' | 'deleted'; deletedAt: string | null;
  retentionExpiresAt: string | null; createdAt: string;
}

export interface JourneyCardRichDetail {
  cardId: string; revision: number; richText: JourneyRichTextDocument; plainText: string;
  emotion: JourneyEmotionPoint | null; touchpoints: JourneyTouchpointSnapshot[];
  assets: JourneyCardAsset[]; updatedAt: string | null;
}

export interface JourneyRichCardLimits {
  richTextBlocks: number; richTextCharacters: number; richTextMarksPerBlock: number;
  blockCharacters: number; catalogNameCharacters: number; catalogDescriptionCharacters: number;
  touchpointsPerCard: number; assetsPerCard: number; imagesPerCard: number; imageBytes: number;
  attachmentBytes: number; assetBytesPerCard: number; assetNameCharacters: number;
  altTextCharacters: number; captionCharacters: number; externalUrlCharacters: number;
  deletedAssetRetentionDays: number;
}

export interface JourneyRichMapSnapshot {
  definitionId: string; versionId: string; cards: JourneyCardRichDetail[];
  emotionalCurve: Array<{
    cardId: string; stageKey: string; stageName: string; stageOrdinal: number; cardOrdinal: number;
    valence: number; intensity: number; label: string;
  }>;
  catalog: { channels: JourneyChannelSnapshot[]; touchpoints: JourneyTouchpointSnapshot[] };
  limits: JourneyRichCardLimits;
}

export class JourneyRichCardResponseError extends Error {
  constructor(message: string) {
    super(`Invalid rich journey card response: ${message}`);
    this.name = 'JourneyRichCardResponseError';
  }
}

type Row = Record<string, unknown>;
const channelCategories = [
  'web', 'mobile_app', 'email', 'social', 'phone', 'in_person', 'chat',
  'messaging', 'self_service', 'partner', 'other'
] as const;
const blockTypes = ['paragraph', 'heading', 'bullet', 'ordered', 'quote'] as const;
const markTypes = ['bold', 'italic', 'code', 'link'] as const;

function fail(message: string): never { throw new JourneyRichCardResponseError(message); }
function row(value: unknown, label: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Row;
}
function exact(value: unknown, label: string, keys: readonly string[]) {
  const result = row(value, label); const allowed = new Set(keys);
  const extra = Object.keys(result).filter((key) => !allowed.has(key));
  if (extra.length) fail(`${label} contains unexpected field ${extra[0]}`);
  return result;
}
function array(value: unknown, label: string): unknown[] { if (!Array.isArray(value)) fail(`${label} must be an array`); return value; }
function text(value: unknown, label: string) { if (typeof value !== 'string') fail(`${label} must be a string`); return value; }
function nonempty(value: unknown, label: string) { const result = text(value, label); if (!result) fail(`${label} must not be empty`); return result; }
function nullableText(value: unknown, label: string) { return value === null ? null : text(value, label); }
function number(value: unknown, label: string) { if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} must be finite`); return value; }
function integer(value: unknown, label: string, minimum = 0) {
  const result = number(value, label); if (!Number.isSafeInteger(result) || result < minimum) fail(`${label} must be an integer >= ${minimum}`);
  return result;
}
function rangedInteger(value: unknown, label: string, minimum: number, maximum: number) {
  const result = integer(value, label, minimum); if (result > maximum) fail(`${label} exceeds ${maximum}`); return result;
}
function iso(value: unknown, label: string) { const result = nonempty(value, label); if (!Number.isFinite(Date.parse(result))) fail(`${label} must be an ISO timestamp`); return result; }
function nullableIso(value: unknown, label: string) { return value === null ? null : iso(value, label); }
function enumValue<T extends string>(value: unknown, label: string, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) fail(`${label} is not allowed`); return value as T;
}
function nullableSha(value: unknown, label: string) {
  if (value === null) return null; const result = text(value, label); if (!/^[a-f0-9]{64}$/u.test(result)) fail(`${label} must be sha256`); return result;
}

export function parseJourneyRichText(value: unknown, label = 'richText'): JourneyRichTextDocument {
  const document = exact(value, label, ['version', 'blocks']);
  if (document.version !== 1) fail(`${label}.version must be 1`);
  const blocks = array(document.blocks, `${label}.blocks`).map((value, blockIndex): JourneyRichTextBlock => {
    const block = exact(value, `${label}.blocks[${blockIndex}]`, ['type', 'text', 'marks']);
    const blockText = text(block.text, `${label}.blocks[${blockIndex}].text`);
    const marks = array(block.marks, `${label}.blocks[${blockIndex}].marks`).map((value, markIndex): JourneyRichTextMark => {
      const mark = exact(value, `${label}.blocks[${blockIndex}].marks[${markIndex}]`, ['type', 'start', 'end', 'href']);
      const type = enumValue(mark.type, `${label}.blocks[${blockIndex}].marks[${markIndex}].type`, markTypes);
      const start = integer(mark.start, 'mark.start'); const end = integer(mark.end, 'mark.end');
      if (end <= start || end > blockText.length) fail('mark range is invalid');
      if (type === 'link') {
        const href = nonempty(mark.href, 'mark.href');
        let parsed: URL; try { parsed = new URL(href); } catch { return fail('mark.href is not a URL'); }
        if (parsed.protocol !== 'https:') fail('mark.href must use HTTPS');
        return { type, start, end, href };
      }
      if (mark.href !== undefined) fail('non-link marks cannot contain href');
      return { type, start, end };
    });
    const links = marks.filter((mark) => mark.type === 'link')
      .sort((left, right) => left.start - right.start || left.end - right.end);
    for (let index = 1; index < links.length; index += 1) {
      if (links[index].start < links[index - 1].end) fail('link mark ranges cannot overlap');
    }
    return { type: enumValue(block.type, `${label}.blocks[${blockIndex}].type`, blockTypes), text: blockText, marks };
  });
  return { version: 1, blocks };
}

function parseChannel(value: unknown, label: string): JourneyChannelSnapshot {
  const item = exact(value, label, ['id', 'spaceId', 'status', 'revision', 'versionId', 'versionNumber',
    'name', 'description', 'category', 'createdAt', 'updatedAt']);
  return {
    id: nonempty(item.id, `${label}.id`), spaceId: nonempty(item.spaceId, `${label}.spaceId`),
    status: enumValue(item.status, `${label}.status`, ['active', 'retired'] as const),
    revision: integer(item.revision, `${label}.revision`, 1), versionId: nonempty(item.versionId, `${label}.versionId`),
    versionNumber: integer(item.versionNumber, `${label}.versionNumber`, 1), name: nonempty(item.name, `${label}.name`),
    description: text(item.description, `${label}.description`), category: enumValue(item.category, `${label}.category`, channelCategories),
    createdAt: iso(item.createdAt, `${label}.createdAt`), updatedAt: iso(item.updatedAt, `${label}.updatedAt`)
  };
}

function parseTouchpoint(value: unknown, label: string): JourneyTouchpointSnapshot {
  const item = exact(value, label, ['id', 'spaceId', 'status', 'revision', 'versionId', 'versionNumber',
    'name', 'description', 'channel', 'createdAt', 'updatedAt']);
  const channel = exact(item.channel, `${label}.channel`, ['id', 'versionId', 'versionNumber', 'name', 'category']);
  return {
    id: nonempty(item.id, `${label}.id`), spaceId: nonempty(item.spaceId, `${label}.spaceId`),
    status: enumValue(item.status, `${label}.status`, ['active', 'retired'] as const),
    revision: integer(item.revision, `${label}.revision`, 1), versionId: nonempty(item.versionId, `${label}.versionId`),
    versionNumber: integer(item.versionNumber, `${label}.versionNumber`, 1), name: nonempty(item.name, `${label}.name`),
    description: text(item.description, `${label}.description`),
    channel: { id: nonempty(channel.id, 'channel.id'), versionId: nonempty(channel.versionId, 'channel.versionId'),
      versionNumber: integer(channel.versionNumber, 'channel.versionNumber', 1), name: nonempty(channel.name, 'channel.name'),
      category: enumValue(channel.category, 'channel.category', channelCategories) },
    createdAt: iso(item.createdAt, `${label}.createdAt`), updatedAt: iso(item.updatedAt, `${label}.updatedAt`)
  };
}

function parseAsset(value: unknown, label: string): JourneyCardAsset {
  const item = exact(value, label, ['id', 'cardId', 'kind', 'sourceKind', 'displayName', 'mimeType', 'byteSize',
    'sha256', 'altText', 'caption', 'externalUrl', 'contentUrl', 'ordinal', 'state', 'deletedAt',
    'retentionExpiresAt', 'createdAt']);
  const state = enumValue(item.state, `${label}.state`, ['active', 'deleted'] as const);
  const sourceKind = enumValue(item.sourceKind, `${label}.sourceKind`, ['upload', 'external_url'] as const);
  const externalUrl = nullableText(item.externalUrl, `${label}.externalUrl`);
  const contentUrl = nullableText(item.contentUrl, `${label}.contentUrl`);
  if (state === 'deleted' && (externalUrl !== null || contentUrl !== null)) fail(`${label} exposes deleted content`);
  if (state === 'active' && sourceKind === 'upload' && !contentUrl) fail(`${label} is missing protected content URL`);
  if (state === 'active' && sourceKind === 'external_url' && !externalUrl) fail(`${label} is missing external URL`);
  return {
    id: nonempty(item.id, `${label}.id`), cardId: nonempty(item.cardId, `${label}.cardId`),
    kind: enumValue(item.kind, `${label}.kind`, ['image', 'attachment'] as const), sourceKind,
    displayName: nonempty(item.displayName, `${label}.displayName`), mimeType: nonempty(item.mimeType, `${label}.mimeType`),
    byteSize: integer(item.byteSize, `${label}.byteSize`), sha256: nullableSha(item.sha256, `${label}.sha256`),
    altText: text(item.altText, `${label}.altText`), caption: text(item.caption, `${label}.caption`),
    externalUrl, contentUrl, ordinal: integer(item.ordinal, `${label}.ordinal`), state,
    deletedAt: nullableIso(item.deletedAt, `${label}.deletedAt`),
    retentionExpiresAt: nullableIso(item.retentionExpiresAt, `${label}.retentionExpiresAt`),
    createdAt: iso(item.createdAt, `${label}.createdAt`)
  };
}

export function parseJourneyCardRichDetail(value: unknown, label = 'detail'): JourneyCardRichDetail {
  const item = exact(value, label, ['cardId', 'revision', 'richText', 'plainText', 'emotion', 'touchpoints',
    'assets', 'updatedAt']);
  let emotion: JourneyEmotionPoint | null = null;
  if (item.emotion !== null) {
    const point = exact(item.emotion, `${label}.emotion`, ['valence', 'intensity', 'label']);
    emotion = { valence: rangedInteger(point.valence, 'emotion.valence', -5, 5),
      intensity: rangedInteger(point.intensity, 'emotion.intensity', 0, 5), label: text(point.label, 'emotion.label') };
  }
  return {
    cardId: nonempty(item.cardId, `${label}.cardId`), revision: integer(item.revision, `${label}.revision`),
    richText: parseJourneyRichText(item.richText, `${label}.richText`), plainText: text(item.plainText, `${label}.plainText`),
    emotion, touchpoints: array(item.touchpoints, `${label}.touchpoints`).map((value, index) => parseTouchpoint(value, `touchpoints[${index}]`)),
    assets: array(item.assets, `${label}.assets`).map((value, index) => parseAsset(value, `assets[${index}]`)),
    updatedAt: nullableIso(item.updatedAt, `${label}.updatedAt`)
  };
}

function parseLimits(value: unknown): JourneyRichCardLimits {
  const keys = ['richTextBlocks', 'richTextCharacters', 'richTextMarksPerBlock', 'blockCharacters',
    'catalogNameCharacters', 'catalogDescriptionCharacters', 'touchpointsPerCard', 'assetsPerCard',
    'imagesPerCard', 'imageBytes', 'attachmentBytes', 'assetBytesPerCard', 'assetNameCharacters',
    'altTextCharacters', 'captionCharacters', 'externalUrlCharacters', 'deletedAssetRetentionDays'] as const;
  const item = exact(value, 'limits', keys);
  return Object.fromEntries(keys.map((key) => [key, integer(item[key], `limits.${key}`, 1)])) as unknown as JourneyRichCardLimits;
}

function parseCatalog(value: unknown) {
  const item = exact(value, 'catalog', ['channels', 'touchpoints', 'categories', 'limits']);
  const categories = array(item.categories, 'catalog.categories').map((value) => enumValue(value, 'category', channelCategories));
  if (new Set(categories).size !== channelCategories.length || channelCategories.some((value) => !categories.includes(value))) {
    fail('catalog categories are incomplete');
  }
  return {
    channels: array(item.channels, 'catalog.channels').map((value, index) => parseChannel(value, `channels[${index}]`)),
    touchpoints: array(item.touchpoints, 'catalog.touchpoints').map((value, index) => parseTouchpoint(value, `touchpoints[${index}]`)),
    categories, limits: parseLimits(item.limits)
  };
}

export function parseJourneyRichMap(value: unknown): JourneyRichMapSnapshot {
  const item = exact(value, 'richMap', ['definitionId', 'versionId', 'cards', 'emotionalCurve', 'catalog', 'limits']);
  const catalog = exact(item.catalog, 'richMap.catalog', ['channels', 'touchpoints']);
  const emotionalCurve = array(item.emotionalCurve, 'richMap.emotionalCurve').map((value, index) => {
    const point = exact(value, `emotionalCurve[${index}]`, ['cardId', 'stageKey', 'stageName', 'stageOrdinal',
      'cardOrdinal', 'valence', 'intensity', 'label']);
    return { cardId: nonempty(point.cardId, 'curve.cardId'), stageKey: nonempty(point.stageKey, 'curve.stageKey'),
      stageName: nonempty(point.stageName, 'curve.stageName'), stageOrdinal: integer(point.stageOrdinal, 'curve.stageOrdinal'),
      cardOrdinal: integer(point.cardOrdinal, 'curve.cardOrdinal'),
      valence: rangedInteger(point.valence, 'curve.valence', -5, 5),
      intensity: rangedInteger(point.intensity, 'curve.intensity', 0, 5), label: text(point.label, 'curve.label') };
  });
  return {
    definitionId: nonempty(item.definitionId, 'richMap.definitionId'), versionId: nonempty(item.versionId, 'richMap.versionId'),
    cards: array(item.cards, 'richMap.cards').map((value, index) => parseJourneyCardRichDetail(value, `cards[${index}]`)),
    emotionalCurve,
    catalog: { channels: array(catalog.channels, 'catalog.channels').map((value, index) => parseChannel(value, `channels[${index}]`)),
      touchpoints: array(catalog.touchpoints, 'catalog.touchpoints').map((value, index) => parseTouchpoint(value, `touchpoints[${index}]`)) },
    limits: parseLimits(item.limits)
  };
}

export async function listJourneyRichCardCatalog(includeRetired = false) {
  const query = includeRetired ? '?includeRetired=true' : '';
  return parseCatalog(await api<unknown>(`/api/journey-rich-cards/catalog${query}`));
}

export async function createJourneyChannel(input: { name: string; description?: string; category: JourneyChannelCategory }) {
  return parseChannel(await api<unknown>('/api/journey-rich-cards/channels', json('POST', input)), 'channel');
}

export async function updateJourneyChannel(channelId: string, input: {
  expectedRevision: number; name?: string; description?: string; category?: JourneyChannelCategory;
}) {
  return parseChannel(await api<unknown>(`/api/journey-rich-cards/channels/${encodeURIComponent(channelId)}`,
    json('PATCH', input)), 'channel');
}

export async function retireJourneyChannel(channelId: string, expectedRevision: number) {
  return parseChannel(await api<unknown>(`/api/journey-rich-cards/channels/${encodeURIComponent(channelId)}/retire`,
    json('POST', { expectedRevision })), 'channel');
}

export async function createJourneyTouchpoint(input: { name: string; description?: string; channelId: string }) {
  return parseTouchpoint(await api<unknown>('/api/journey-rich-cards/touchpoints', json('POST', input)), 'touchpoint');
}

export async function updateJourneyTouchpoint(touchpointId: string, input: {
  expectedRevision: number; name?: string; description?: string; channelId?: string;
}) {
  return parseTouchpoint(await api<unknown>(`/api/journey-rich-cards/touchpoints/${encodeURIComponent(touchpointId)}`,
    json('PATCH', input)), 'touchpoint');
}

export async function retireJourneyTouchpoint(touchpointId: string, expectedRevision: number) {
  return parseTouchpoint(await api<unknown>(`/api/journey-rich-cards/touchpoints/${encodeURIComponent(touchpointId)}/retire`,
    json('POST', { expectedRevision })), 'touchpoint');
}

export async function readJourneyRichMap(definitionId: string, versionId?: string) {
  const query = versionId ? `?${new URLSearchParams({ versionId }).toString()}` : '';
  return parseJourneyRichMap(await api<unknown>(`/api/journey-rich-cards/maps/${encodeURIComponent(definitionId)}${query}`));
}

export async function readJourneyCardRichDetail(definitionId: string, cardId: string, includeDeletedAssets = false) {
  const query = includeDeletedAssets ? '?includeDeletedAssets=true' : '';
  return parseJourneyCardRichDetail(await api<unknown>(
    `/api/journey-rich-cards/maps/${encodeURIComponent(definitionId)}/cards/${encodeURIComponent(cardId)}${query}`));
}

export async function saveJourneyCardRichDetail(definitionId: string, cardId: string, input: {
  expectedRevision: number; expectedDetailRevision: number; richText: JourneyRichTextDocument;
  emotion?: JourneyEmotionPoint | null;
}) {
  return parseJourneyCardRichDetail(await api<unknown>(
    `/api/journey-rich-cards/maps/${encodeURIComponent(definitionId)}/cards/${encodeURIComponent(cardId)}`,
    json('PUT', input)));
}

export async function linkJourneyCardTouchpoint(definitionId: string, cardId: string,
  expectedRevision: number, touchpointId: string) {
  return parseJourneyCardRichDetail(await api<unknown>(
    `/api/journey-rich-cards/maps/${encodeURIComponent(definitionId)}/cards/${encodeURIComponent(cardId)}/touchpoints`,
    json('POST', { expectedRevision, touchpointId })));
}

export async function unlinkJourneyCardTouchpoint(definitionId: string, cardId: string,
  touchpointId: string, expectedRevision: number) {
  return parseJourneyCardRichDetail(await api<unknown>(
    `/api/journey-rich-cards/maps/${encodeURIComponent(definitionId)}/cards/${encodeURIComponent(cardId)}/touchpoints/${encodeURIComponent(touchpointId)}`,
    json('DELETE', { expectedRevision })));
}

export async function attachJourneyCardAsset(definitionId: string, cardId: string, input: {
  expectedRevision: number; kind: 'image' | 'attachment'; uploadId?: string; externalUrl?: string;
  displayName?: string; mimeType?: string; altText?: string; caption?: string;
}) {
  const response = exact(await api<unknown>(
    `/api/journey-rich-cards/maps/${encodeURIComponent(definitionId)}/cards/${encodeURIComponent(cardId)}/assets`,
    json('POST', input)), 'assetResponse', ['asset', 'detail']);
  return { asset: parseAsset(response.asset, 'asset'), detail: parseJourneyCardRichDetail(response.detail) };
}

export async function deleteJourneyCardAsset(definitionId: string, cardId: string,
  assetId: string, expectedRevision: number) {
  return parseJourneyCardRichDetail(await api<unknown>(
    `/api/journey-rich-cards/maps/${encodeURIComponent(definitionId)}/cards/${encodeURIComponent(cardId)}/assets/${encodeURIComponent(assetId)}`,
    json('DELETE', { expectedRevision })));
}

export async function restoreJourneyCardAsset(definitionId: string, cardId: string,
  assetId: string, expectedRevision: number) {
  return parseJourneyCardRichDetail(await api<unknown>(
    `/api/journey-rich-cards/maps/${encodeURIComponent(definitionId)}/cards/${encodeURIComponent(cardId)}/assets/${encodeURIComponent(assetId)}/restore`,
    json('POST', { expectedRevision })));
}

export async function uploadJourneyCardAssetFile(file: File) {
  const body = new FormData(); body.append('file', file);
  const item = exact(await api<unknown>('/api/uploads', multipart('POST', body)), 'upload',
    ['id', 'name', 'mimeType', 'size', 'url', 'transcriptionState']);
  return {
    id: nonempty(item.id, 'upload.id'), name: nonempty(item.name, 'upload.name'),
    mimeType: nonempty(item.mimeType, 'upload.mimeType'), size: integer(item.size, 'upload.size'),
    url: nonempty(item.url, 'upload.url')
  };
}

import crypto from 'node:crypto';
import path from 'node:path';
import type { SocialMention } from './types.js';

type Source = SocialMention['source'];
type ImportedMention = Partial<SocialMention> & { content: string; source: Source };

const SOURCES = new Set<Source>(['x', 'google_play', 'app_store', 'review', 'forum', 'other']);
const FIELD_ALIASES: Record<string, string[]> = {
  content: ['content', 'mention', 'text', 'post', 'review', 'message', 'body'],
  source: ['source', 'platform', 'channel', 'network'],
  author: ['author', 'username', 'user', 'reviewer', 'name'],
  url: ['url', 'link', 'permalink'],
  language: ['language', 'lang'],
  publishedAt: ['publishedat', 'published', 'date', 'datetime', 'timestamp', 'createdat']
};

function deterministicUuid(value: string) {
  const bytes = crypto.createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function decodeUtf8(buffer: Buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, ''); }
  catch { throw new Error('The import must be valid UTF-8 text.'); }
}

function parseCsv(text: string) {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]; const next = text[index + 1];
    if (char === '"') {
      if (quoted && next === '"') { cell += '"'; index += 1; } else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (quoted) throw new Error('The CSV contains an unterminated quoted value.');
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalized(value: unknown) { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ''); }

function resolveMapping(headers: string[], requested: Record<string, string>) {
  const byNormalized = new Map(headers.map((header) => [normalized(header), header])); const result: Record<string, string> = {};
  for (const field of Object.keys(FIELD_ALIASES)) {
    const explicit = requested[field];
    if (explicit) {
      const exact = headers.find((header) => header === explicit) || byNormalized.get(normalized(explicit));
      if (!exact) throw new Error(`Mapped column “${explicit}” was not found.`);
      result[field] = exact; continue;
    }
    const match = FIELD_ALIASES[field].map((alias) => byNormalized.get(alias)).find(Boolean);
    if (match) result[field] = match;
  }
  if (!result.content) throw new Error('Map a CSV column to the required content field.');
  return result;
}

function sourceValue(value: unknown, fallback: Source): Source {
  const normalizedSource = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_') as Source;
  if (!normalizedSource) return fallback;
  if (!SOURCES.has(normalizedSource)) throw new Error(`Unsupported source “${String(value)}”.`);
  return normalizedSource;
}

function dateValue(value: unknown) {
  if (!value) return new Date().toISOString();
  const date = new Date(String(value)); if (Number.isNaN(date.getTime())) throw new Error(`Invalid published date “${String(value)}”.`);
  return date.toISOString();
}

function normalizeObject(item: unknown, defaultSource: Source, rowNumber: number): ImportedMention {
  if (typeof item === 'string') return { source: defaultSource, content: item.trim(), publishedAt: new Date().toISOString() };
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Record ${rowNumber} must be text or an object.`);
  const value = item as Record<string, unknown>; const content = String(value.content ?? value.text ?? value.mention ?? value.review ?? '').trim();
  if (!content) throw new Error(`Record ${rowNumber} has no content.`);
  return {
    source: sourceValue(value.source, defaultSource), content, author: String(value.author || '').trim(),
    url: String(value.url || '').trim(), language: String(value.language || '').trim(), publishedAt: dateValue(value.publishedAt),
    metadata: value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata) ? value.metadata as Record<string, unknown> : {}
  };
}

function parseJson(text: string, defaultSource: Source) {
  let value: unknown; try { value = JSON.parse(text); } catch { throw new Error('The JSON file is not valid JSON.'); }
  const items = Array.isArray(value) ? value : (value && typeof value === 'object' && Array.isArray((value as any).mentions) ? (value as any).mentions : null);
  if (!items) throw new Error('JSON must be an array or an object with a mentions array.');
  return items.map((item: unknown, index: number) => normalizeObject(item, defaultSource, index + 1));
}

function parseCsvMentions(text: string, defaultSource: Source, requestedMapping: Record<string, string>) {
  const rows = parseCsv(text); if (rows.length < 2) throw new Error('The CSV must contain a header and at least one data row.');
  const headers = rows[0].map((header, index) => header || `Column ${index + 1}`);
  const mapping = resolveMapping(headers, requestedMapping); const mappedHeaders = new Set(Object.values(mapping));
  return rows.slice(1).map((row, rowIndex) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, row[index] || '']));
    const content = String(record[mapping.content] || '').trim(); if (!content) throw new Error(`CSV row ${rowIndex + 2} has no content.`);
    const metadata = Object.fromEntries(headers.filter((header) => !mappedHeaders.has(header) && record[header] !== '').map((header) => [header, record[header]]));
    return {
      source: sourceValue(mapping.source ? record[mapping.source] : '', defaultSource), content,
      author: mapping.author ? record[mapping.author] : '', url: mapping.url ? record[mapping.url] : '',
      language: mapping.language ? record[mapping.language] : '', publishedAt: dateValue(mapping.publishedAt ? record[mapping.publishedAt] : ''), metadata
    } satisfies ImportedMention;
  });
}

export function parseSocialMentionImport(input: { buffer: Buffer; fileName: string; defaultSource: Source; mapping?: Record<string, string> }) {
  const extension = path.extname(input.fileName).toLowerCase();
  if (!['.csv', '.json', '.txt'].includes(extension)) throw new Error('Use a UTF-8 CSV, JSON, or TXT file.');
  const text = decodeUtf8(input.buffer); let mentions: ImportedMention[];
  if (extension === '.csv') mentions = parseCsvMentions(text, input.defaultSource, input.mapping || {});
  else if (extension === '.json') mentions = parseJson(text, input.defaultSource);
  else mentions = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((content) => ({ source: input.defaultSource, content, publishedAt: new Date().toISOString() }));
  if (!mentions.length) throw new Error('The file contains no importable mentions.');
  if (mentions.length > 200) throw new Error('A social listening import can contain at most 200 records.');
  const fileName = path.basename(input.fileName); const fileHash = crypto.createHash('sha256').update(input.buffer).digest('hex');
  const canonicalMapping = Object.entries(input.mapping || {}).sort(([left], [right]) => left.localeCompare(right));
  const batchId = deterministicUuid(`social-import:${fileHash}:${input.defaultSource}:${JSON.stringify(canonicalMapping)}`);
  const identified = mentions.map((mention, index) => ({
    ...mention,
    id: deterministicUuid(`${batchId}:${index}`),
    metadata: { ...(mention.metadata || {}), seemplifyImport: { batchId, fileHash, fileName, row: index + 1 } }
  }));
  return {
    mentions: identified,
    summary: { fileName, format: extension.slice(1), totalRecords: mentions.length, imported: mentions.length, skipped: 0, mapping: input.mapping || {}, batchId, fileHash, replayed: false }
  };
}

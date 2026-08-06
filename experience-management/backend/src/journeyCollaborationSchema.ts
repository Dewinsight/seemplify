import { z } from 'zod';
import {
  normalizeJourneyRichText, richTextPlainText, type JourneyRichTextDocument
} from './journeyRichCards.js';

export const journeyCollaborationRoles = [
  'viewer', 'contributor', 'editor', 'approver', 'manager', 'administrator'
] as const;
export type JourneyCollaborationRole = typeof journeyCollaborationRoles[number];

export const journeyCollaborationCapabilities = [
  'journeys.read', 'journeys.comment', 'journeys.watch', 'journeys.edit',
  'journeys.manage_portfolio', 'journeys.request_review', 'journeys.review',
  'journeys.publish', 'journeys.manage_roles', 'journeys.manage_shares',
  'journeys.manage_views', 'journeys.view_activity', 'journeys.export'
] as const;
export type JourneyCollaborationCapability = typeof journeyCollaborationCapabilities[number];

export const journeyCollaborationTargetTypes = [
  'journey_map', 'journey_stage', 'journey_card', 'persona', 'portfolio_item', 'recommendation'
] as const;
export type JourneyCollaborationTargetType = typeof journeyCollaborationTargetTypes[number];

export const journeyGovernanceTargetTypes = [
  'journey_map', 'persona', 'portfolio_item', 'recommendation'
] as const;
export type JourneyGovernanceTargetType = typeof journeyGovernanceTargetTypes[number];

export const journeyCollaborationAudiences = [
  'internal', 'executive', 'research', 'delivery', 'external'
] as const;
export type JourneyCollaborationAudience = typeof journeyCollaborationAudiences[number];

export const journeyCollaborationLimits = Object.freeze({
  commentCharacters: 8_000,
  // journey_comments.body_json carries octet_length(body_json) BETWEEN 2 AND
  // 65536 in runtime-28. Characters alone do not bound bytes: 40 blocks x 20
  // link marks each hold a 2 048-character href, so a document inside the
  // character limit can still exceed the column check and land as a raw 23514.
  commentBodyBytes: 65_536,
  mentionsPerComment: 50,
  threadReplies: 500,
  viewNameCharacters: 160,
  viewConfigurationBytes: 65_536,
  viewFilterValues: 100,
  shareSnapshotBytes: 1_048_576,
  shareTokenBytes: 32,
  shareRequestsPerMinute: 60,
  pageSize: 100,
  commentRetentionDays: { minimum: 1, maximum: 3_650 },
  viewRetentionDays: { minimum: 1, maximum: 3_650 },
  maximumShareDays: { minimum: 1, maximum: 365 }
});

/** Capability sets are process-wide constants that authorise every write, so
 * they are exposed as frozen arrays rather than Sets. `Object.freeze` on a Set
 * leaves `add`/`delete`/`clear` fully functional, and the inheriting roles below
 * are built by spreading their parents, so one `viewer.add(...)` anywhere in the
 * process would have escalated every viewer in every space. Frozen arrays in the
 * canonical capability order also make the wire response deterministic. */
function capabilitySet(...groups: ReadonlyArray<readonly JourneyCollaborationCapability[]>) {
  const granted = new Set<JourneyCollaborationCapability>(groups.flat());
  return Object.freeze(journeyCollaborationCapabilities.filter((capability) => granted.has(capability)));
}

const read = capabilitySet(['journeys.read', 'journeys.comment', 'journeys.watch', 'journeys.view_activity']);
const contribute = capabilitySet(read, ['journeys.manage_portfolio', 'journeys.request_review']);
const edit = capabilitySet(contribute, ['journeys.edit', 'journeys.manage_views', 'journeys.export']);
const approve = capabilitySet(read, ['journeys.review', 'journeys.publish', 'journeys.export']);
const manage = capabilitySet(edit, approve, ['journeys.manage_roles', 'journeys.manage_shares']);
const all = capabilitySet(journeyCollaborationCapabilities);

export const journeyRoleCapabilities: Readonly<Record<JourneyCollaborationRole,
  readonly JourneyCollaborationCapability[]>> = Object.freeze({
  viewer: read,
  contributor: contribute,
  editor: edit,
  approver: approve,
  manager: manage,
  administrator: all
});

export function roleHasJourneyCapability(role: JourneyCollaborationRole,
  capability: JourneyCollaborationCapability) {
  return journeyRoleCapabilities[role].includes(capability);
}

/** Capability containment, not rank order. `roleRank` is a total order over a
 * lattice that is not monotonic — an approver holds review/publish without edit
 * and an editor the reverse — so "rank is lower" never implied "capabilities are
 * a subset". Role grants use both. */
export function journeyRoleCapabilitiesContained(inner: JourneyCollaborationRole,
  outer: Iterable<JourneyCollaborationCapability>) {
  const held = new Set<JourneyCollaborationCapability>(outer);
  return journeyRoleCapabilities[inner].every((capability) => held.has(capability));
}

/** Carries the HTTP status the facade must map to. `normalizeJourneyRichText`
 * already throws 413 for its own character overflow, but the joined-length
 * overflow below threw a bare `Error`, which the facade mapped to 400
 * `JOURNEY_COMMENT_BODY_INVALID`. The same semantic failure therefore landed on
 * two different statuses depending only on how far over the limit the caller
 * was: 40 blocks of exactly 200 characters pass the rich-text check at 8 000 but
 * join to 8 039, while 40 blocks of 201 fail it at 8 040 and return 413. */
export class JourneyCommentBodyError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = 'JourneyCommentBodyError';
  }
}

export function normalizeJourneyCommentBody(value: unknown): {
  document: JourneyRichTextDocument; plainText: string;
} {
  let candidate = value;
  if (typeof value === 'string') {
    const text = value.replace(/\r\n?/gu, '\n').trim();
    candidate = { version: 1, blocks: text ? [{ type: 'paragraph', text, marks: [] }] : [] };
  }
  const document = normalizeJourneyRichText(candidate);
  // `richTextPlainText` slices at the rich-text character limit, so testing its
  // result could never exceed that limit and the guard below was unreachable.
  // Block joins add one newline per block, so a document accepted by
  // `normalizeJourneyRichText` can still project past the comment limit — that
  // must be rejected, not silently truncated into a body whose stored
  // plain_text no longer matches the document it was derived from.
  const joined = document.blocks.map((block) => block.text).filter(Boolean).join('\n').trim();
  if (!joined) throw new JourneyCommentBodyError('A comment body cannot be empty.', 400);
  if (joined.length > journeyCollaborationLimits.commentCharacters) {
    throw new JourneyCommentBodyError('The comment body is too long.', 413);
  }
  // Unreachable while the comment limit stays at or below the rich-text limit
  // that `richTextPlainText` slices at, which is the case today. It is kept as
  // the guard on that coupling: were the rich-text limit ever lowered below the
  // comment limit, a body between the two would otherwise be silently truncated
  // into a stored plain_text that no longer matches its own document.
  const plainText = richTextPlainText(document).trim();
  if (plainText !== joined) throw new JourneyCommentBodyError('The comment body is too long.', 413);
  return { document, plainText };
}

const boundedId = z.string().trim().min(1).max(128);
const uniqueIds = z.array(boundedId).max(journeyCollaborationLimits.viewFilterValues)
  .superRefine((items, context) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item)) context.addIssue({
        code: z.ZodIssueCode.custom, path: [index], message: 'Filter values must be unique.'
      });
      seen.add(item);
    });
  });
const uniqueTokens = z.array(z.string().trim().min(1).max(100))
  .max(journeyCollaborationLimits.viewFilterValues).superRefine((items, context) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item.toLowerCase())) context.addIssue({
        code: z.ZodIssueCode.custom, path: [index], message: 'Filter values must be unique.'
      });
      seen.add(item.toLowerCase());
    });
  });

export const journeyCollaborationViewConfigurationSchema = z.object({
  schemaVersion: z.literal(1),
  layout: z.enum(['map', 'table', 'kanban', 'matrix', 'relationship', 'dashboard']),
  filters: z.object({
    kinds: z.array(z.enum(['pain_point', 'opportunity', 'solution', 'initiative'])).max(4)
      .superRefine((items, context) => {
        const seen = new Set<string>();
        items.forEach((item, index) => {
          if (seen.has(item)) context.addIssue({
            code: z.ZodIssueCode.custom, path: [index], message: 'Filter values must be unique.'
          });
          seen.add(item);
        });
      }).default([]),
    lifecycles: uniqueTokens.default([]),
    ownerUserIds: uniqueIds.default([]),
    tags: uniqueTokens.default([]),
    journeyDefinitionIds: uniqueIds.default([]),
    includeArchived: z.boolean().default(false)
  }).strict(),
  columns: z.array(z.enum([
    'title', 'kind', 'lifecycle', 'owner', 'priority', 'risk', 'score', 'due_date',
    'evidence_coverage', 'initiative_status', 'outcome'
  ])).min(1).max(11).superRefine((items, context) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item)) context.addIssue({
        code: z.ZodIssueCode.custom, path: [index], message: 'Columns must be unique.'
      });
      seen.add(item);
    });
  }),
  sort: z.array(z.object({
    field: z.enum(['title', 'kind', 'lifecycle', 'owner', 'priority', 'risk', 'updated_at']),
    direction: z.enum(['asc', 'desc'])
  }).strict()).max(3).default([]),
  presentation: z.object({
    title: z.string().trim().max(200).default(''),
    showEvidence: z.boolean().default(true),
    showMetrics: z.boolean().default(true),
    showOwnership: z.boolean().default(true),
    showSourceNotes: z.boolean().default(true)
  }).strict()
}).strict();

export type JourneyCollaborationViewConfiguration = z.infer<typeof journeyCollaborationViewConfigurationSchema>;

export function parseJourneyCollaborationViewConfiguration(value: unknown, resourceType?: 'journey_map' | 'portfolio') {
  const parsed = journeyCollaborationViewConfigurationSchema.parse(value);
  if (resourceType === 'journey_map' && !['map', 'table'].includes(parsed.layout)) {
    throw new Error('Journey-map collaboration views support map or table layouts.');
  }
  if (resourceType === 'portfolio' && parsed.layout === 'map') {
    throw new Error('Portfolio collaboration views do not support the map layout.');
  }
  return parsed;
}

export type JourneyPageCursor = { createdAt: string; id: string };

export function encodeJourneyPageCursor(cursor: JourneyPageCursor) {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeJourneyPageCursor(value: unknown): JourneyPageCursor | null {
  if (value === undefined || value === null || value === '') return null;
  const token = String(value);
  if (!/^[A-Za-z0-9_-]{1,512}$/u.test(token)) throw new Error('The pagination cursor is invalid.');
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')); }
  catch { throw new Error('The pagination cursor is invalid.'); }
  const result = z.object({
    createdAt: z.string().datetime({ offset: true }), id: boundedId
  }).strict().safeParse(parsed);
  if (!result.success) throw new Error('The pagination cursor is invalid.');
  return result.data;
}

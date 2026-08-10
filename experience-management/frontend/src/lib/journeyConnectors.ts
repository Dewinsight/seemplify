import { z } from 'zod';
import { api, json } from '@/lib/api';

export const journeyConnectorKinds = ['csv_upload', 'jsonl_upload', 'approved_object_store'] as const;
const connector = z.object({ id: z.string(), kind: z.enum(journeyConnectorKinds), name: z.string(), state: z.enum(['active', 'disabled']),
  deletionMode: z.literal('tombstone'), maximumAttempts: z.number(), baseRetrySeconds: z.number(), revision: z.number(),
  createdAt: z.string(), updatedAt: z.string() }).strict();
const run = z.object({ id: z.string(), connectorId: z.string(), state: z.enum(['open', 'retry_wait', 'completed', 'failed', 'cancelled']),
  checkpointRevision: z.number(), expectedCursor: z.string().nullable(), attemptCount: z.number(), retryAt: z.string().nullable(),
  acceptedCount: z.number(), rejectedCount: z.number(), tombstoneCount: z.number(), lastErrorCode: z.string().nullable(),
  createdAt: z.string(), updatedAt: z.string() }).strict();
const receipt = z.object({ id: z.string(), externalIdSha256: z.string(), operation: z.enum(['upsert', 'delete', 'invalid']),
  outcome: z.enum(['accepted', 'rejected', 'tombstoned']), code: z.string(), itemChecksum: z.string().nullable(),
  checkpointRevision: z.number(), createdAt: z.string() }).strict();
const audit = z.object({ id: z.string(), actorUserId: z.string().nullable(), action: z.string(), targetType: z.string(), targetId: z.string(),
  detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])), detailSha256: z.string(), createdAt: z.string() }).strict();
const mutation = <T extends z.ZodRawShape>(shape: T) => z.object({ ...shape, replayed: z.boolean() }).strict();

export type JourneyConnectorKind = typeof journeyConnectorKinds[number];
export type JourneyConnector = z.infer<typeof connector>;
export type JourneyConnectorRun = z.infer<typeof run>;
export type JourneyConnectorReceipt = z.infer<typeof receipt>;
export type JourneyConnectorAudit = z.infer<typeof audit>;
export interface JourneyConnectorPageItem { externalId: string; operation: 'upsert' | 'delete'; checksum: string; occurredAt: string; payload: unknown | null }
export interface JourneyConnectorPageInput { expectedCheckpointRevision: number; cursor: string | null; nextCursor: string | null;
  providerOutcome: 'ok' | 'rate_limited' | 'transient_failure'; retryAfterSeconds?: number; items: JourneyConnectorPageItem[] }

const mutationOptions = (method: string, body: unknown) => ({ ...json(method, body), headers: {
  'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID()
} });
async function parsed<T>(schema: z.ZodType<T>, path: string, options?: RequestInit) { return schema.parse(await api<unknown>(path, options)); }

export const listJourneyConnectors = () => parsed(z.object({ connectors: z.array(connector) }).strict(), '/api/journey-connectors/connectors').then((value) => value.connectors);
export const createJourneyConnector = (input: { kind: JourneyConnectorKind; name: string; maximumAttempts: number; baseRetrySeconds: number }) => parsed(
  mutation({ connector }), '/api/journey-connectors/connectors', mutationOptions('POST', input)).then((value) => value.connector);
export const setJourneyConnectorState = (item: JourneyConnector, state: 'active' | 'disabled') => parsed(mutation({ connector }),
  `/api/journey-connectors/connectors/${encodeURIComponent(item.id)}`, mutationOptions('PATCH', { expectedRevision: item.revision, state })).then((value) => value.connector);
export const startJourneyConnectorImport = (connectorId: string) => parsed(mutation({ run }),
  `/api/journey-connectors/connectors/${encodeURIComponent(connectorId)}/imports`, mutationOptions('POST', {})).then((value) => value.run);
export const readJourneyConnectorImport = (runId: string) => parsed(z.object({ run }).strict(),
  `/api/journey-connectors/imports/${encodeURIComponent(runId)}`).then((value) => value.run);
export const submitJourneyConnectorPage = (runId: string, input: JourneyConnectorPageInput) => parsed(mutation({ run, receipts: z.array(receipt) }),
  `/api/journey-connectors/imports/${encodeURIComponent(runId)}/pages`, mutationOptions('POST', input));
export const listJourneyConnectorReceipts = (runId: string, cursor?: string) => parsed(z.object({ items: z.array(receipt), nextCursor: z.string().nullable() }).strict(),
  `/api/journey-connectors/imports/${encodeURIComponent(runId)}/receipts?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
export const listJourneyConnectorAudit = () => parsed(z.object({ events: z.array(audit) }).strict(), '/api/journey-connectors/audit?limit=100').then((value) => value.events);

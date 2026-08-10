import { z } from 'zod';
import { api, json } from '@/lib/api';

/**
 * Runtime-56 Journey collaboration email preference and status.
 *
 * The tenant and the principal are both derived from the session on the server,
 * so nothing here sends a space id, a user id or an address: the only preference
 * a caller can read or write is its own.
 */

export const collaborationEmailPreferenceSchema = z.object({
  emailEnabled: z.boolean(),
  revision: z.number(),
  updatedAt: z.string().nullable(),
  decidedAt: z.string().nullable(),
  deliveryEnabled: z.boolean(),
  available: z.boolean()
}).strict();
export type CollaborationEmailPreference = z.infer<typeof collaborationEmailPreferenceSchema>;

export const collaborationEmailStatusSchema = z.object({
  deliveryEnabled: z.boolean(),
  available: z.boolean(),
  counts: z.object({
    pending: z.number(), sending: z.number(), sent: z.number(),
    cancelled: z.number(), dead_letter: z.number()
  }).strict()
}).strict();
export type CollaborationEmailStatus = z.infer<typeof collaborationEmailStatusSchema>;

const envelope = z.object({ preference: collaborationEmailPreferenceSchema }).strict();

export const getCollaborationEmailPreference = async () =>
  envelope.parse(await api<unknown>('/api/journey-collaboration-email/preference')).preference;

export const setCollaborationEmailPreference = async (enabled: boolean, expectedRevision: number) =>
  envelope.parse(await api<unknown>('/api/journey-collaboration-email/preference',
    json('PUT', { enabled, expectedRevision }))).preference;

export const getCollaborationEmailStatus = async () =>
  collaborationEmailStatusSchema.parse(await api<unknown>('/api/journey-collaboration-email/status'));

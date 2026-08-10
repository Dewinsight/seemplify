import { z } from 'zod';
import { api, json } from '@/lib/api';

export const journeyCustomer360Purposes = ['analytics', 'personalisation', 'research_contact', 'marketing'] as const;
export type JourneyCustomer360Purpose = typeof journeyCustomer360Purposes[number];

const identifierSchema = z.object({
  kind: z.enum(['anonymous_id', 'authenticated_user_id', 'external_user_id']), namespace: z.string(), value: z.string()
}).strict();
const profileSchema = z.object({
  spaceId: z.string(), profileId: z.string(), kind: z.enum(['anonymous', 'known']), status: z.enum(['active', 'deleted']),
  createdAt: z.string(), createdByCommandId: z.string(), knownAt: z.string().optional(), deletedAt: z.string().optional(),
  canonicalProfileId: z.string()
}).strict();
const profileListItemSchema = profileSchema.extend({
  identifierCount: z.number(), activeMembershipCount: z.number(), mergedIntoProfileId: z.string().nullable()
}).strict();
const bindingSchema = z.object({
  spaceId: z.string(), identifier: identifierSchema, profileId: z.string(), boundAt: z.string(), boundByCommandId: z.string()
}).strict();
const sourceFactSchema = z.object({
  factId: z.string(), source: z.string(), sourceRef: z.string(), occurredAt: z.string(), spaceId: z.string(),
  profileId: z.string(), recordedByCommandId: z.string()
}).strict();
const membershipSchema = z.object({
  membershipId: z.string(), spaceId: z.string(), profileId: z.string(), groupType: z.enum(['account', 'group']),
  groupId: z.string(), active: z.boolean(), addedAt: z.string(), addedByCommandId: z.string(),
  removedAt: z.string().optional(), removedByCommandId: z.string().optional()
}).strict();
const mergeSchema = z.object({
  mergeAuditId: z.string(), spaceId: z.string(), sourceProfileId: z.string(), targetProfileId: z.string(),
  canonicalTargetProfileId: z.string(), reason: z.string(), active: z.boolean(), mergedAt: z.string(),
  mergedByCommandId: z.string(), splitAt: z.string().optional(), splitByCommandId: z.string().optional()
}).strict();
const tombstoneSchema = z.object({
  spaceId: z.string(), profileId: z.string(), deletedAt: z.string(), deletedByCommandId: z.string(), reason: z.string()
}).strict();
const timelineEventSchema = z.object({
  id: z.string(), profileId: z.string(), canonicalProfileId: z.string(), eventKind: z.string(), occurredAt: z.string(),
  title: z.string(), summary: z.string(), sourceType: z.string(), sourceId: z.string(),
  detail: z.record(z.string(), z.unknown()), createdAt: z.string()
}).strict();
const sessionSchema = z.object({
  id: z.string(), spaceId: z.string(), profileId: z.string(), canonicalProfileId: z.string(),
  identifierNamespace: z.string(), identifierValue: z.string(), startedAt: z.string(), lastSeenAt: z.string(),
  endedAt: z.string().nullable(), eventCount: z.number(), sourceFactCount: z.number(), createdAt: z.string(), updatedAt: z.string()
}).strict();
const groupSchema = z.object({
  id: z.string(), spaceId: z.string(), groupType: z.enum(['account', 'group']), name: z.string(), externalRef: z.string().nullable(),
  status: z.enum(['active', 'archived']), createdAt: z.string(), updatedAt: z.string(), createdByUserId: z.string().nullable()
}).strict();
const groupListItemSchema = groupSchema.extend({ activeMemberCount: z.number() }).strict();
const ruleSchema = z.object({
  match: z.enum(['all', 'any']), clauses: z.array(z.object({
    field: z.enum(['profile.kind', 'membership.accountId', 'membership.groupId']), op: z.literal('eq'), value: z.string()
  }).strict())
}).strict();
const segmentSchema = z.object({
  id: z.string(), spaceId: z.string(), name: z.string(), description: z.string(), state: z.enum(['active', 'retired']),
  activeVersionId: z.string(), activeVersionNumber: z.number(), materializedMemberCount: z.number(),
  createdByUserId: z.string().nullable(), createdAt: z.string(), updatedAt: z.string()
}).strict();
const segmentVersionSchema = z.object({
  id: z.string(), segmentId: z.string(), versionNumber: z.number(), rule: ruleSchema, state: z.enum(['active', 'superseded']),
  validationState: z.literal('valid'), createdByUserId: z.string().nullable(), createdAt: z.string()
}).strict();
const segmentMembershipSchema = z.object({
  id: z.string(), segmentId: z.string(), segmentVersionId: z.string(), profileId: z.string(),
  canonicalProfileId: z.string(), matchedAt: z.string()
}).strict();
const namedSegmentMembershipSchema = segmentMembershipSchema.extend({ segmentName: z.string(), segmentDescription: z.string() }).strict();
const privacyStateSchema = z.object({
  profileId: z.string(), purpose: z.enum(journeyCustomer360Purposes), state: z.enum(['unknown', 'granted', 'denied', 'suppressed']),
  lawfulBasis: z.string().nullable(), policyReference: z.string().nullable(), updatedAt: z.string(), updatedByUserId: z.string().nullable()
}).strict();
const journeyInstanceSchema = z.object({
  instanceId: z.string(), journeyDefinitionId: z.string(), journeyName: z.string(), state: z.string(), currentStageKey: z.string().nullable(),
  firstEventAt: z.string(), latestEventAt: z.string(), sourceId: z.string(), environment: z.string()
}).strict();
const privacyPropagationTargetSchema = z.object({
  state: z.enum(['completed', 'preserved_append_only', 'waiting', 'operator_required']),
  affectedCount: z.number().int().nonnegative(), code: z.string(), updatedAt: z.string()
}).strict();
const privacyPropagationSchema = z.object({
  schema: z.literal('seemplify.journey-privacy-propagation/v1'),
  status: z.enum(['running', 'waiting', 'operator_required', 'completed']), cursor: z.number().int().nonnegative(),
  updatedAt: z.string(), targets: z.record(z.string(), privacyPropagationTargetSchema), limitations: z.array(z.string())
}).strict();
const correctionRunSchema = z.object({
  id: z.string(), spaceId: z.string(), reason: z.enum(['merge_command', 'late_source_fact', 'identity_command']), commandId: z.string(),
  profileIds: z.array(z.string()), state: z.literal('completed'), requestedByUserId: z.string().nullable(), createdAt: z.string(), completedAt: z.string()
}).strict();
const correctionResultSchema = z.object({
  timelineEventCount: z.number().int().nonnegative().optional(), sessionCount: z.number().int().nonnegative().optional(),
  segmentMembershipCount: z.number().int().nonnegative().optional(), activeProfileCount: z.number().int().nonnegative().optional(),
  privacyPropagation: privacyPropagationSchema.optional()
}).strict();
const correctionEntrySchema = z.object({ run: correctionRunSchema, result: correctionResultSchema }).strict();
const identityAuditSchema = z.object({
  auditId: z.string(), policyVersion: z.literal('journey.identity-policy.v1'), commandId: z.string(), spaceId: z.string(),
  actorId: z.string(), action: z.enum(['observe', 'identify', 'alias', 'merge', 'split', 'add_membership', 'remove_membership', 'delete']),
  outcome: z.enum(['accepted', 'rejected']), code: z.string(), explanation: z.string(), occurredAt: z.string(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
}).strict();
const identityDecisionSchema = z.object({
  policyVersion: z.literal('journey.identity-policy.v1'), stateVersion: z.literal('journey.identity-state.v1'), commandId: z.string(),
  status: z.enum(['accepted', 'rejected', 'replayed']), code: z.string(), explanation: z.string(), audit: identityAuditSchema,
  resolvedProfileId: z.string().optional(), canonicalProfileId: z.string().optional(), mergeAuditId: z.string().optional(),
  membershipId: z.string().optional(), sourceFactId: z.string().optional(), replayedOutcome: z.enum(['accepted', 'rejected']).optional(),
  replayedCode: z.string().optional()
}).strict();
const identityCommandResultSchema = z.object({ state: z.unknown(), result: identityDecisionSchema }).strict();
const privacyJobSchema = z.object({
  id: z.string(), spaceId: z.string(), profileId: z.string(), operation: z.enum(['suppress', 'erasure']),
  purpose: z.enum(journeyCustomer360Purposes).nullable(), state: z.enum(['queued', 'completed']), requestedByUserId: z.string().nullable(),
  createdAt: z.string(), completedAt: z.string().nullable()
}).strict();
const exportJobSchema = z.object({
  id: z.string(), spaceId: z.string(), profileId: z.string(), purpose: z.enum(journeyCustomer360Purposes), format: z.literal('json'),
  state: z.literal('completed'), requestedByUserId: z.string().nullable(), createdAt: z.string(), completedAt: z.string()
}).strict();

const profileDetailSchema = z.object({
  profile: profileSchema, bindings: z.array(bindingSchema), sourceFacts: z.array(sourceFactSchema),
  memberships: z.array(membershipSchema), merges: z.array(mergeSchema), tombstone: tombstoneSchema.nullable()
}).strict();
const profile360Schema = z.object({
  profile: profileSchema, purpose: z.enum(journeyCustomer360Purposes), privacyState: privacyStateSchema,
  identitySummary: z.object({ identifierCount: z.number(), anonymousIdentifierCount: z.number(), knownIdentifierCount: z.number() }).strict(),
  consentSummary: z.object({ purpose: z.enum(journeyCustomer360Purposes), states: z.array(z.object({ state: z.string(), count: z.number() }).strict()), latestObservedAt: z.string().nullable() }).strict(),
  memberships: z.object({ accounts: z.array(membershipSchema), groups: z.array(membershipSchema) }).strict(),
  segmentMemberships: z.array(namedSegmentMembershipSchema), sessions: z.array(sessionSchema),
  journeyInstances: z.array(journeyInstanceSchema), timeline: z.array(timelineEventSchema)
}).strict();
const groupDetailSchema = z.object({
  group: groupSchema, memberships: z.array(membershipSchema),
  members: z.array(profileSchema.extend({ membership: membershipSchema }).strict())
}).strict();
const segmentDetailSchema = z.object({
  segment: segmentSchema, activeVersion: segmentVersionSchema.nullable(), memberships: z.array(segmentMembershipSchema)
}).strict();

export type JourneyIdentityProfile = z.infer<typeof profileListItemSchema>;
export type JourneyIdentityProfileDetail = z.infer<typeof profileDetailSchema>;
export type JourneyProfile360 = z.infer<typeof profile360Schema>;
export type JourneyIdentityGroup = z.infer<typeof groupListItemSchema>;
export type JourneyIdentityGroupDetail = z.infer<typeof groupDetailSchema>;
export type JourneyIdentitySegment = z.infer<typeof segmentSchema>;
export type JourneyIdentitySegmentDetail = z.infer<typeof segmentDetailSchema>;
export type JourneyProfilePrivacyState = z.infer<typeof privacyStateSchema>;
export type JourneyProfilePrivacyJob = z.infer<typeof privacyJobSchema>;
export type JourneyProfileExportJob = z.infer<typeof exportJobSchema>;
export type JourneyIdentityCorrectionEntry = z.infer<typeof correctionEntrySchema>;
export type JourneyIdentityAudit = z.infer<typeof identityAuditSchema>;
export type JourneyIdentityCommandResult = z.infer<typeof identityCommandResultSchema>;

function query(path: string, values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== '') params.set(key, String(value));
  return params.size ? `${path}?${params}` : path;
}
async function parsed<T>(schema: z.ZodType<T>, path: string, options?: RequestInit): Promise<T> {
  return schema.parse(await api<unknown>(path, options));
}

export function listJourneyIdentityProfiles(filters: { kind?: 'anonymous' | 'known'; status?: 'active' | 'deleted'; limit?: number; offset?: number } = {}) {
  return parsed(z.object({ profiles: z.array(profileListItemSchema) }).strict(), query('/api/journey-identities/profiles', filters));
}
export function readJourneyIdentityProfile(profileId: string) {
  return parsed(profileDetailSchema, `/api/journey-identities/profiles/${encodeURIComponent(profileId)}`);
}
export function listJourneyProfileTimeline(profileId: string) {
  return parsed(z.object({ events: z.array(timelineEventSchema) }).strict(), `/api/journey-identities/profiles/${encodeURIComponent(profileId)}/timeline`);
}
export function listJourneyProfileSessions(profileId: string) {
  return parsed(z.object({ sessions: z.array(sessionSchema) }).strict(), `/api/journey-identities/profiles/${encodeURIComponent(profileId)}/sessions`);
}
export function readJourneyProfile360(profileId: string, purpose: JourneyCustomer360Purpose) {
  return parsed(profile360Schema, query(`/api/journey-identities/profiles/${encodeURIComponent(profileId)}/customer-360`, { purpose }));
}
export function listJourneyProfilePrivacy(profileId: string) {
  return parsed(z.object({ states: z.array(privacyStateSchema) }).strict(), `/api/journey-identities/profiles/${encodeURIComponent(profileId)}/privacy`);
}
export function updateJourneyProfilePrivacy(profileId: string, input: { purpose: JourneyCustomer360Purpose; state: JourneyProfilePrivacyState['state']; lawfulBasis?: string | null; policyReference?: string | null }) {
  return parsed(z.object({ state: privacyStateSchema }).strict(), `/api/journey-identities/profiles/${encodeURIComponent(profileId)}/privacy`, json('PUT', input));
}
export function listJourneyIdentityCorrectionRuns(profileId: string) {
  return parsed(z.object({ runs: z.array(correctionEntrySchema) }).strict(), `/api/journey-identities/profiles/${encodeURIComponent(profileId)}/corrections`);
}
export function listJourneyIdentityAudit(limit = 50) {
  return parsed(z.object({ audit: z.array(identityAuditSchema) }).strict(), query('/api/journey-identities/audit', { limit }));
}
export function mergeJourneyIdentityProfiles(input: { commandId: string; occurredAt: string; sourceProfileId: string;
  targetProfileId: string; reason: string }) {
  return parsed(identityCommandResultSchema, '/api/journey-identities/commands', json('POST', {
    type: 'merge', commandId: input.commandId, occurredAt: input.occurredAt,
    source: { profileId: input.sourceProfileId }, target: { profileId: input.targetProfileId }, reason: input.reason
  }));
}
export function splitJourneyIdentityMerge(input: { commandId: string; occurredAt: string; mergeAuditId: string; reason: string }) {
  return parsed(identityCommandResultSchema, '/api/journey-identities/commands', json('POST', {
    type: 'split', commandId: input.commandId, occurredAt: input.occurredAt, mergeAuditId: input.mergeAuditId, reason: input.reason
  }));
}
export function createJourneyProfileExport(profileId: string, purpose: JourneyCustomer360Purpose) {
  return parsed(z.object({ job: exportJobSchema, export: z.record(z.string(), z.unknown()) }).strict(), `/api/journey-identities/profiles/${encodeURIComponent(profileId)}/export`, json('POST', { purpose }));
}
export function readJourneyProfileExport(jobId: string) {
  return parsed(z.object({ job: exportJobSchema, export: z.record(z.string(), z.unknown()) }).strict(), `/api/journey-identities/exports/${encodeURIComponent(jobId)}`);
}
export function createJourneyProfilePrivacyJob(profileId: string, input: { operation: 'suppress' | 'erasure'; purpose?: JourneyCustomer360Purpose | null; lawfulBasis?: string | null; policyReference?: string | null; reason?: string | null }) {
  return parsed(z.object({ job: privacyJobSchema, result: z.record(z.string(), z.unknown()) }).strict(), `/api/journey-identities/profiles/${encodeURIComponent(profileId)}/privacy-jobs`, json('POST', input));
}
export function readJourneyProfilePrivacyJob(jobId: string) {
  return parsed(z.object({ job: privacyJobSchema, request: z.record(z.string(), z.unknown()), result: z.record(z.string(), z.unknown()) }).strict(), `/api/journey-identities/privacy-jobs/${encodeURIComponent(jobId)}`);
}
export function listJourneyIdentityGroups(groupType?: 'account' | 'group') {
  return parsed(z.object({ groups: z.array(groupListItemSchema) }).strict(), query('/api/journey-identities/groups', { groupType }));
}
export function readJourneyIdentityGroup(groupId: string) {
  return parsed(groupDetailSchema, `/api/journey-identities/groups/${encodeURIComponent(groupId)}`);
}
export function readJourneyAccount360(accountId: string, purpose: JourneyCustomer360Purpose) {
  return parsed(z.object({
    account: groupSchema, purpose: z.enum(journeyCustomer360Purposes), memberCount: z.number(),
    members: z.array(profileSchema.extend({ membership: membershipSchema }).strict()),
    segmentMemberships: z.array(namedSegmentMembershipSchema), journeyInstances: z.array(journeyInstanceSchema), timeline: z.array(timelineEventSchema)
  }).strict(), query(`/api/journey-identities/accounts/${encodeURIComponent(accountId)}/customer-360`, { purpose }));
}
export function createJourneyIdentityGroup(input: { id: string; groupType: 'account' | 'group'; name: string; externalRef?: string | null }) {
  return parsed(z.object({ group: groupSchema, replayed: z.boolean() }).strict(), '/api/journey-identities/groups', json('POST', input));
}
export function listJourneyIdentitySegments() {
  return parsed(z.object({ segments: z.array(segmentSchema) }).strict(), '/api/journey-identities/segments');
}
export function readJourneyIdentitySegment(segmentId: string) {
  return parsed(segmentDetailSchema, `/api/journey-identities/segments/${encodeURIComponent(segmentId)}`);
}
export function createJourneyIdentitySegment(input: { name: string; description?: string; rule: z.infer<typeof ruleSchema> }) {
  return parsed(segmentDetailSchema, '/api/journey-identities/segments', json('POST', input));
}
export function createJourneyIdentitySegmentVersion(segmentId: string, rule: z.infer<typeof ruleSchema>) {
  return parsed(segmentDetailSchema, `/api/journey-identities/segments/${encodeURIComponent(segmentId)}/versions`, json('POST', { rule }));
}

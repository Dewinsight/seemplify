import { api, json } from '@/lib/api';

export type JourneyMetricAlertRuleKind = 'falling_metric' | 'stale_source' | 'small_sample' | 'contradictory_evidence';
export type JourneyMetricAlertDirection = 'decrease' | 'increase' | 'any';
export type JourneyMetricAlertState = 'open' | 'acknowledged' | 'snoozed' | 'resolved';
export interface JourneyMetricAlertVersionInput {
  ruleKind: JourneyMetricAlertRuleKind; direction: JourneyMetricAlertDirection; thresholdValue: number;
  windowSeconds: number; cooldownSeconds: number; minimumSampleSize: number;
  staleAfterSeconds: number; contradictionMinRatio: number;
}
export interface JourneyMetricAlertVersion extends JourneyMetricAlertVersionInput {
  id: string; definitionId: string; metricDefinitionId: string; versionNumber: number;
  contentSha256: string; createdByUserId: string | null; createdAt: string;
}
export interface JourneyMetricAlertDefinition {
  id: string; journeyDefinitionId: string; metricDefinitionId: string; name: string;
  state: 'active' | 'disabled' | 'retired'; revision: number; currentVersion: JourneyMetricAlertVersion | null;
  createdByUserId: string | null; createdAt: string; updatedAt: string;
}
export interface JourneyMetricAlert {
  id: string; journeyDefinitionId: string; alertDefinitionId: string; alertDefinitionVersionId: string;
  metricDefinitionId: string; metricDefinitionVersionId: string | null; observationId: string | null;
  definitionName: string | null; severity: 'warning' | 'strong'; reasonCode: string;
  state: JourneyMetricAlertState; lineage: Record<string, unknown>; observedValue: number | null;
  baselineValue: number | null; deltaValue: number | null; sampleSize: number | null;
  privacySuppressed: boolean; openedAt: string;
  lastEvaluatedAt: string; updatedAt: string; acknowledgedAt: string | null; snoozedUntil: string | null;
  resolvedAt: string | null; resolvedReason: string | null; revision: number;
}
export interface JourneyMetricAlertRun {
  id: string; journeyDefinitionId: string; asOf: string; state: 'evaluating' | 'completed' | 'failed';
  evaluatedCount: number; triggeredCount: number; warningCount: number; resolvedCount: number;
  errorCode: string | null; createdAt: string; completedAt: string | null;
}
export interface JourneyMetricAlertNotification {
  id: string; alertId: string; definitionName: string; severity: 'warning' | 'strong'; reasonCode: string;
  alertState: JourneyMetricAlertState; state: 'unread' | 'read' | 'dismissed'; revision: number;
  createdAt: string; readAt: string | null;
}
export interface JourneyMetricAlertNotificationPreference { enabled: boolean; eligible: boolean; revision: number; updatedAt: string | null; }

class AlertResponseError extends Error { constructor(message: string) { super(`Invalid journey metric alert response: ${message}`); } }
type Row = Record<string, unknown>;
const fail = (message: string): never => { throw new AlertResponseError(message); };
function record(value: unknown, label: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`); return value as Row;
}
function exact(value: unknown, label: string, keys: readonly string[]): Row {
  const row = record(value, label); const allowed = new Set(keys); const extra = Object.keys(row).find((key) => !allowed.has(key));
  if (extra) fail(`${label} contains unexpected field ${extra}`); return row;
}
function text(value: unknown, label: string): string { if (typeof value !== 'string') fail(`${label} must be text`); return value as string; }
function nullableText(value: unknown, label: string): string | null { return value === null ? null : text(value, label); }
function number(value: unknown, label: string): number { if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} must be a number`); return value as number; }
function integer(value: unknown, label: string): number { const parsed = number(value, label); if (!Number.isSafeInteger(parsed)) fail(`${label} must be an integer`); return parsed; }
function nullableNumber(value: unknown, label: string): number | null { return value === null ? null : number(value, label); }
function bool(value: unknown, label: string): boolean { if (typeof value !== 'boolean') fail(`${label} must be boolean`); return value as boolean; }
function iso(value: unknown, label: string): string { const parsed = text(value, label); if (!Number.isFinite(Date.parse(parsed))) fail(`${label} must be a timestamp`); return parsed; }
function nullableIso(value: unknown, label: string): string | null { return value === null ? null : iso(value, label); }
function choice<T extends string>(value: unknown, label: string, options: readonly T[]) {
  if (typeof value !== 'string' || !options.includes(value as T)) fail(`${label} is invalid`); return value as T;
}
function parseVersion(value: unknown): JourneyMetricAlertVersion {
  const row = exact(value, 'alert version', ['id', 'definitionId', 'metricDefinitionId', 'versionNumber', 'ruleKind',
    'direction', 'thresholdValue', 'windowSeconds', 'cooldownSeconds', 'minimumSampleSize', 'staleAfterSeconds',
    'contradictionMinRatio', 'contentSha256', 'createdByUserId', 'createdAt']);
  return { id: text(row.id, 'version.id'), definitionId: text(row.definitionId, 'version.definitionId'),
    metricDefinitionId: text(row.metricDefinitionId, 'version.metricDefinitionId'), versionNumber: integer(row.versionNumber, 'version.versionNumber'),
    ruleKind: choice(row.ruleKind, 'version.ruleKind', ['falling_metric', 'stale_source', 'small_sample', 'contradictory_evidence']),
    direction: choice(row.direction, 'version.direction', ['decrease', 'increase', 'any']), thresholdValue: number(row.thresholdValue, 'version.thresholdValue'),
    windowSeconds: integer(row.windowSeconds, 'version.windowSeconds'), cooldownSeconds: integer(row.cooldownSeconds, 'version.cooldownSeconds'),
    minimumSampleSize: integer(row.minimumSampleSize, 'version.minimumSampleSize'), staleAfterSeconds: integer(row.staleAfterSeconds, 'version.staleAfterSeconds'),
    contradictionMinRatio: number(row.contradictionMinRatio, 'version.contradictionMinRatio'), contentSha256: text(row.contentSha256, 'version.contentSha256'),
    createdByUserId: nullableText(row.createdByUserId, 'version.createdByUserId'), createdAt: iso(row.createdAt, 'version.createdAt') };
}
export function parseJourneyMetricAlertDefinition(value: unknown): JourneyMetricAlertDefinition {
  const row = exact(value, 'alert definition', ['id', 'journeyDefinitionId', 'metricDefinitionId', 'name', 'state',
    'revision', 'currentVersion', 'createdByUserId', 'createdAt', 'updatedAt']);
  return { id: text(row.id, 'definition.id'), journeyDefinitionId: text(row.journeyDefinitionId, 'definition.journeyDefinitionId'),
    metricDefinitionId: text(row.metricDefinitionId, 'definition.metricDefinitionId'), name: text(row.name, 'definition.name'),
    state: choice(row.state, 'definition.state', ['active', 'disabled', 'retired']), revision: integer(row.revision, 'definition.revision'),
    currentVersion: row.currentVersion === null ? null : parseVersion(row.currentVersion),
    createdByUserId: nullableText(row.createdByUserId, 'definition.createdByUserId'), createdAt: iso(row.createdAt, 'definition.createdAt'),
    updatedAt: iso(row.updatedAt, 'definition.updatedAt') };
}
export function parseJourneyMetricAlert(value: unknown): JourneyMetricAlert {
  const row = exact(value, 'alert', ['id', 'journeyDefinitionId', 'alertDefinitionId', 'alertDefinitionVersionId',
    'metricDefinitionId', 'metricDefinitionVersionId', 'observationId', 'definitionName', 'severity', 'reasonCode',
    'state', 'lineage', 'observedValue', 'baselineValue', 'deltaValue', 'sampleSize', 'privacySuppressed',
    'openedAt', 'lastEvaluatedAt',
    'updatedAt', 'acknowledgedAt', 'snoozedUntil', 'resolvedAt', 'resolvedReason', 'revision']);
  const privacySuppressed = bool(row.privacySuppressed, 'alert.privacySuppressed');
  // A suppressed alert may carry its warning, never the number the warning is
  // protecting. Refuse the response rather than render a leaked sample.
  if (privacySuppressed && (row.sampleSize !== null || row.observedValue !== null)) {
    fail('suppressed alert must not disclose a sample size or observed value');
  }
  return { id: text(row.id, 'alert.id'), journeyDefinitionId: text(row.journeyDefinitionId, 'alert.journeyDefinitionId'),
    alertDefinitionId: text(row.alertDefinitionId, 'alert.alertDefinitionId'), alertDefinitionVersionId: text(row.alertDefinitionVersionId, 'alert.alertDefinitionVersionId'),
    metricDefinitionId: text(row.metricDefinitionId, 'alert.metricDefinitionId'), metricDefinitionVersionId: nullableText(row.metricDefinitionVersionId, 'alert.metricDefinitionVersionId'),
    observationId: nullableText(row.observationId, 'alert.observationId'), definitionName: nullableText(row.definitionName, 'alert.definitionName'),
    severity: choice(row.severity, 'alert.severity', ['warning', 'strong']), reasonCode: text(row.reasonCode, 'alert.reasonCode'),
    state: choice(row.state, 'alert.state', ['open', 'acknowledged', 'snoozed', 'resolved']), lineage: record(row.lineage, 'alert.lineage'),
    observedValue: nullableNumber(row.observedValue, 'alert.observedValue'), baselineValue: nullableNumber(row.baselineValue, 'alert.baselineValue'),
    deltaValue: nullableNumber(row.deltaValue, 'alert.deltaValue'),
    sampleSize: row.sampleSize === null ? null : integer(row.sampleSize, 'alert.sampleSize'), privacySuppressed,
    openedAt: iso(row.openedAt, 'alert.openedAt'), lastEvaluatedAt: iso(row.lastEvaluatedAt, 'alert.lastEvaluatedAt'),
    updatedAt: iso(row.updatedAt, 'alert.updatedAt'), acknowledgedAt: nullableIso(row.acknowledgedAt, 'alert.acknowledgedAt'),
    snoozedUntil: nullableIso(row.snoozedUntil, 'alert.snoozedUntil'), resolvedAt: nullableIso(row.resolvedAt, 'alert.resolvedAt'),
    resolvedReason: nullableText(row.resolvedReason, 'alert.resolvedReason'), revision: integer(row.revision, 'alert.revision') };
}
function parseRun(value: unknown): JourneyMetricAlertRun {
  const row = exact(value, 'alert run', ['id', 'journeyDefinitionId', 'asOf', 'state', 'evaluatedCount', 'triggeredCount',
    'warningCount', 'resolvedCount', 'errorCode', 'createdAt', 'completedAt']);
  return { id: text(row.id, 'run.id'), journeyDefinitionId: text(row.journeyDefinitionId, 'run.journeyDefinitionId'),
    asOf: iso(row.asOf, 'run.asOf'), state: choice(row.state, 'run.state', ['evaluating', 'completed', 'failed']),
    evaluatedCount: integer(row.evaluatedCount, 'run.evaluatedCount'), triggeredCount: integer(row.triggeredCount, 'run.triggeredCount'),
    warningCount: integer(row.warningCount, 'run.warningCount'), resolvedCount: integer(row.resolvedCount, 'run.resolvedCount'),
    errorCode: nullableText(row.errorCode, 'run.errorCode'), createdAt: iso(row.createdAt, 'run.createdAt'),
    completedAt: nullableIso(row.completedAt, 'run.completedAt') };
}
function parseNotification(value: unknown): JourneyMetricAlertNotification {
  const row = exact(value, 'alert notification', ['id', 'alertId', 'definitionName', 'severity', 'reasonCode',
    'alertState', 'state', 'revision', 'createdAt', 'readAt']);
  return { id: text(row.id, 'notification.id'), alertId: text(row.alertId, 'notification.alertId'),
    definitionName: text(row.definitionName, 'notification.definitionName'),
    severity: choice(row.severity, 'notification.severity', ['warning', 'strong']),
    reasonCode: text(row.reasonCode, 'notification.reasonCode'),
    alertState: choice(row.alertState, 'notification.alertState', ['open', 'acknowledged', 'snoozed', 'resolved']),
    state: choice(row.state, 'notification.state', ['unread', 'read', 'dismissed']),
    revision: integer(row.revision, 'notification.revision'), createdAt: iso(row.createdAt, 'notification.createdAt'),
    readAt: nullableIso(row.readAt, 'notification.readAt') };
}
function parsePreference(value: unknown): JourneyMetricAlertNotificationPreference {
  const row = exact(value, 'notification preference', ['enabled', 'eligible', 'revision', 'updatedAt']);
  if (typeof row.enabled !== 'boolean' || typeof row.eligible !== 'boolean') fail('notification preference booleans are invalid');
  return { enabled: row.enabled as boolean, eligible: row.eligible as boolean,
    revision: integer(row.revision, 'preference.revision'), updatedAt: nullableIso(row.updatedAt, 'preference.updatedAt') };
}
function key(prefix: string) { return `${prefix}-${Date.now()}-${crypto.randomUUID()}`; }
function options(method: 'POST' | 'PATCH', body: Row, idempotencyKey?: string) {
  return { ...json(method, body), ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}) };
}
function query(path: string, values: Record<string, string | number | undefined>) {
  const search = new URLSearchParams(); Object.entries(values).forEach(([name, value]) => { if (value !== undefined) search.set(name, String(value)); });
  return `${path}?${search.toString()}`;
}
export async function listJourneyMetricAlertDefinitions(journeyDefinitionId: string) {
  const envelope = exact(await api<unknown>(query('/api/journey-metrics/alert-definitions', { journeyDefinitionId, limit: 100 })), 'response', ['definitions']);
  const rows = envelope.definitions; if (!Array.isArray(rows)) fail('definitions must be an array'); return (rows as unknown[]).map(parseJourneyMetricAlertDefinition);
}
export async function createJourneyMetricAlertDefinition(input: { journeyDefinitionId: string; metricDefinitionId: string;
  name: string; version: JourneyMetricAlertVersionInput }) {
  const response = exact(await api<unknown>('/api/journey-metrics/alert-definitions', options('POST', {
    ...input, versionIdempotencyKey: key('metric-alert-version') }, key('metric-alert-definition'))), 'response', ['definition', 'replayed']);
  return parseJourneyMetricAlertDefinition(response.definition);
}
export async function updateJourneyMetricAlertDefinition(definitionId: string, input: { expectedRevision: number;
  name?: string; state?: 'active' | 'disabled' | 'retired' }) {
  const response = exact(await api<unknown>(`/api/journey-metrics/alert-definitions/${encodeURIComponent(definitionId)}`,
    options('PATCH', input)), 'response', ['definition']); return parseJourneyMetricAlertDefinition(response.definition);
}
export async function createJourneyMetricAlertVersion(definitionId: string, expectedRevision: number,
  version: JourneyMetricAlertVersionInput) {
  const response = exact(await api<unknown>(`/api/journey-metrics/alert-definitions/${encodeURIComponent(definitionId)}/versions`,
    options('POST', { expectedRevision, version }, key('metric-alert-version'))), 'response', ['version', 'replayed']);
  return parseVersion(response.version);
}
export async function listJourneyMetricAlerts(journeyDefinitionId: string) {
  const envelope = exact(await api<unknown>(query('/api/journey-metrics/alerts', { journeyDefinitionId, limit: 100 })), 'response', ['alerts']);
  const rows = envelope.alerts; if (!Array.isArray(rows)) fail('alerts must be an array'); return (rows as unknown[]).map(parseJourneyMetricAlert);
}
export async function evaluateJourneyMetricAlerts(journeyDefinitionId: string) {
  const response = exact(await api<unknown>('/api/journey-metrics/alert-evaluations', options('POST', {
    journeyDefinitionId, asOf: new Date().toISOString() }, key('metric-alert-evaluation'))), 'response', ['run', 'replayed']);
  return parseRun(response.run);
}
export async function transitionJourneyMetricAlert(alertId: string, input: { expectedRevision: number;
  action: 'acknowledge' | 'snooze' | 'resolve'; snoozedUntil?: string }) {
  const response = exact(await api<unknown>(`/api/journey-metrics/alerts/${encodeURIComponent(alertId)}/actions`,
    options('POST', input)), 'response', ['alert']); return parseJourneyMetricAlert(response.alert);
}
export async function listJourneyMetricAlertRuns(journeyDefinitionId: string) {
  const envelope = exact(await api<unknown>(query('/api/journey-metrics/alert-runs', { journeyDefinitionId, limit: 25 })), 'response', ['runs']);
  const rows = envelope.runs; if (!Array.isArray(rows)) fail('runs must be an array'); return (rows as unknown[]).map(parseRun);
}
export async function listJourneyMetricAlertNotifications() {
  const envelope = exact(await api<unknown>('/api/journey-metrics/alert-notifications?limit=100'), 'response', ['notifications']);
  const rows = envelope.notifications; if (!Array.isArray(rows)) fail('notifications must be an array');
  return (rows as unknown[]).map(parseNotification);
}
export async function updateJourneyMetricAlertNotification(notificationId: string, expectedRevision: number,
  state: 'read' | 'dismissed') {
  const envelope = exact(await api<unknown>(`/api/journey-metrics/alert-notifications/${encodeURIComponent(notificationId)}`,
    options('PATCH', { expectedRevision, state })), 'response', ['notification']); return parseNotification(envelope.notification);
}
export async function readJourneyMetricAlertNotificationPreference() {
  const envelope = exact(await api<unknown>('/api/journey-metrics/alert-notification-preference'), 'response', ['preference']);
  return parsePreference(envelope.preference);
}
export async function updateJourneyMetricAlertNotificationPreference(enabled: boolean, expectedRevision: number) {
  const envelope = exact(await api<unknown>('/api/journey-metrics/alert-notification-preference',
    options('PATCH', { enabled, expectedRevision })), 'response', ['preference']); return parsePreference(envelope.preference);
}

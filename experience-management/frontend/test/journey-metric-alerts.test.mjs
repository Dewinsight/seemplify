import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const client = read('frontend', 'src', 'lib', 'journeyMetricAlerts.ts');
const page = read('frontend', 'src', 'pages', 'JourneyMetricsPage.tsx');
const routes = read('backend', 'src', 'journeyMetricRoutes.ts');
const repository = read('backend', 'src', 'journeyMetricAlerts.ts');
const sqlite = read('backend', 'src', 'journeyMetricAlertSchema.ts');

test('metric alert client strictly parses every durable resource without accepting tenant identity', () => {
  for (const endpoint of ['/alert-definitions', '/alerts', '/alert-evaluations', '/alert-runs',
    '/alert-notifications', '/alert-notification-preference']) assert.ok(client.includes(endpoint), endpoint);
  assert.match(client, /class AlertResponseError/u);
  assert.match(client, /function exact\(/u);
  assert.match(client, /contains unexpected field/u);
  assert.match(client, /parseJourneyMetricAlertDefinition\(value: unknown\)/u);
  assert.match(client, /parseJourneyMetricAlert\(value: unknown\)/u);
  assert.match(client, /headers: \{ 'Idempotency-Key': idempotencyKey \}/u);
  assert.doesNotMatch(client, /spaceId\??:/u);
});

test('members read alert evidence while only owners and administrators mutate conditions', () => {
  for (const path of ['/alert-definitions', '/alerts', '/alert-runs', '/alert-notifications']) {
    assert.match(routes, new RegExp(`get\\('${path.replaceAll('/', '\\/')}`, 'u'));
  }
  assert.match(routes, /post\('\/alert-definitions'[\s\S]{0,160}?editor\(request\)/u);
  assert.match(routes, /post\('\/alert-evaluations'[\s\S]{0,160}?editor\(request\)/u);
  assert.match(routes, /post\('\/alerts\/:alertId\/actions'[\s\S]{0,160}?editor\(request\)/u);
  assert.match(page, /data-testid="journey-metric-alerts"/u);
  assert.match(page, /\{canManage && <div className="flex flex-wrap gap-2"/u);
  assert.match(page, /\{canManage && <td className="px-4 py-3"/u);
  assert.ok(page.includes('data-testid={`ack-alert-${alert.id}`}'));
});

test('strong decisions are bounded by windows, metric direction, privacy, and explicit reviewed research', () => {
  assert.match(repository, /observation\.period_end>=\? AND observation\.period_end<=\?/u);
  assert.match(repository, /BASELINE_OUTSIDE_ALERT_WINDOW/u);
  assert.match(repository, /METRIC_DIRECTION_NOT_ACTIONABLE/u);
  assert.match(repository, /ALERT_DIRECTION_CONFLICT/u);
  assert.match(repository, /PRIVACY_SUPPRESSED_SAMPLE/u);
  assert.match(repository, /SMALL_SAMPLE_SUPPRESSED_STRONG/u);
  assert.match(repository, /assessment\.relationship IN \('supports','contradicts'\)/u);
  assert.match(repository, /CONTRADICTORY_RESEARCH_ASSESSMENTS/u);
  assert.doesNotMatch(repository, /sentiment.*CONTRADICTORY_RESEARCH_ASSESSMENTS/isu);
  assert.match(repository, /const LINEAGE_KEYS = \['observationIds'/u);
  assert.doesNotMatch(repository, /excerpt|reason_summary|source_ref/u,
    'alert evaluation must not copy customer text or source references into durable lineage');
});

test('notification fan-out is recipient-specific, preference-aware, durable, and role-rechecked', () => {
  assert.match(repository, /membership\.role IN \('owner','admin'\)/u);
  assert.match(repository, /COALESCE\(preference\.enabled,1\)=1/u);
  assert.match(repository, /sha\(\{ eventId: input\.eventId, userId: recipient\.user_id, channel: 'in_app' \}\)/u);
  assert.match(repository, /eligibleAlertRecipient/u);
  assert.match(repository, /notification\.user_id=\?/u);
  assert.match(sqlite, /UNIQUE\(id,space_id,user_id\)/u);
  assert.match(sqlite, /FOREIGN KEY\(notification_id,space_id,user_id\)/u);
  assert.match(sqlite, /journey_metric_alert_notifications_append_only/u);
  assert.match(sqlite, /journey_metric_alert_notification_state_events_append_only/u);
});

test('the alert workspace is contained, accessible, and avoids causal overclaiming', () => {
  for (const phrase of ['Metric and evidence alerts', 'Detected conditions', 'Alert definitions',
    'Your alert inbox', 'Evaluation history', 'do not claim causation', 'Small or privacy-suppressed samples']) {
    assert.ok(page.includes(phrase), `missing alert workspace text: ${phrase}`);
  }
  assert.match(page, /data-testid="alert-definition-dialog"/u);
  assert.ok((page.match(/overflow-x-auto/gu) || []).length >= 9, 'alert tables must remain contained on narrow screens');
  assert.doesNotMatch(page, /gradient|backdrop-blur|rounded-\[2/iu);
});
